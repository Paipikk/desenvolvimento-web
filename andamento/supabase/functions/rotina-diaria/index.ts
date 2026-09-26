// Rotina automática (chamada pelo pg_cron a cada 10 minutos).
//
// Para cada escritório cujo horário de consulta já passou hoje, consulta os
// processos ativos que ainda não foram consultados hoje. Processa em lotes
// com limite de tempo: o que não couber fica para a próxima chamada.
// Uma falha em um processo nunca derruba a rotina — é registrada nele.
import { corsHeaders, erro, json } from "../_shared/cors.ts";
import { clienteAdmin } from "../_shared/supabase.ts";
import { sincronizarProcesso, type ResultadoSincronizacao } from "../_shared/sincronizar.ts";

const ORCAMENTO_MS = 110_000; // margem abaixo do limite de tempo da edge function
const PAUSA_ENTRE_CONSULTAS_MS = 400; // gentileza com a API pública do CNJ
const PAUSA_APOS_LIMITE_MS = 5_000;
const MAX_FALHAS_TEMPORARIAS_SEGUIDAS = 4; // Datajud fora do ar: para e tenta na próxima chamada
const RETENTAR_FALHA_APOS_MS = 60 * 60_000; // falhas são tentadas de novo 1h depois (até 3x no dia)

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Brasil não tem horário de verão desde 2019: Brasília = UTC-3 fixo.
function agoraBrasilia() {
  const agora = new Date();
  const local = new Date(agora.getTime() - 3 * 3600_000);
  return {
    agora,
    hora: local.getUTCHours(),
    dataIso: local.toISOString().slice(0, 10),
  };
}

function limiarDoDia(dataIso: string, hora: number): number {
  return new Date(`${dataIso}T${String(hora).padStart(2, "0")}:00:00-03:00`).getTime();
}

type ProcessoFila = {
  id: string;
  ultima_consulta: string | null;
  ultima_tentativa: string | null;
  falhas_consecutivas: number;
};

function precisaConsultar(p: ProcessoFila, limiar: number, agora: number): boolean {
  const ultimaOk = p.ultima_consulta ? new Date(p.ultima_consulta).getTime() : 0;
  if (ultimaOk >= limiar) return false; // já consultado com sucesso hoje
  const tentativa = p.ultima_tentativa ? new Date(p.ultima_tentativa).getTime() : 0;
  if (tentativa < limiar) return true; // ainda não tentou hoje
  // Já tentou hoje e falhou: tenta de novo mais tarde, algumas vezes
  return p.falhas_consecutivas <= 3 && agora - tentativa >= RETENTAR_FALHA_APOS_MS;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const segredo = Deno.env.get("CRON_SECRET");
  if (!segredo || req.headers.get("x-cron-secret") !== segredo) {
    return erro("Não autorizado", 401);
  }

  const sb = clienteAdmin();
  const inicio = Date.now();
  const { agora, hora, dataIso } = agoraBrasilia();

  const { data: escritorios, error } = await sb
    .from("escritorios")
    .select("id, horario_consulta")
    .lte("horario_consulta", hora);
  if (error) return erro(error.message, 500);

  const resumo: Array<{ escritorio_id: string; ok: number; erro: number; novas: number; pendentes: number }> = [];
  let falhasTemporariasSeguidas = 0;
  let interrompida: string | null = null;

  for (const escr of escritorios ?? []) {
    if (interrompida) break;
    const limiar = limiarDoDia(dataIso, escr.horario_consulta);

    const { data: processos, error: erroProc } = await sb
      .from("processos")
      .select("id, ultima_consulta, ultima_tentativa, falhas_consecutivas")
      .eq("escritorio_id", escr.id)
      .eq("ativo", true)
      .order("ultima_tentativa", { ascending: true, nullsFirst: true });
    if (erroProc) {
      console.error(`Escritório ${escr.id}: erro ao listar processos`, erroProc.message);
      continue;
    }

    const fila = (processos ?? []).filter((p) => precisaConsultar(p, limiar, agora.getTime()));
    if (!fila.length) continue;

    let ok = 0, falhas = 0, novas = 0, feitos = 0;
    for (const p of fila) {
      if (Date.now() - inicio > ORCAMENTO_MS) {
        interrompida = "tempo";
        break;
      }
      let r: ResultadoSincronizacao;
      try {
        r = await sincronizarProcesso(sb, p.id, "rotina");
      } catch (e) {
        // sincronizarProcesso já trata os próprios erros; isto é só um cinto de segurança
        console.error(`Processo ${p.id}: erro inesperado`, e);
        r = { processo_id: p.id, sucesso: false, novas: 0, mensagens: 0, erro: String(e), temporario: true };
      }
      feitos++;
      if (r.sucesso) {
        ok++;
        novas += r.novas;
        falhasTemporariasSeguidas = 0;
      } else {
        falhas++;
        if (r.temporario) {
          falhasTemporariasSeguidas++;
          if (r.erro?.includes("Limite")) await esperar(PAUSA_APOS_LIMITE_MS);
        } else {
          falhasTemporariasSeguidas = 0;
        }
      }
      if (falhasTemporariasSeguidas >= MAX_FALHAS_TEMPORARIAS_SEGUIDAS) {
        interrompida = "datajud_instavel";
        break;
      }
      await esperar(PAUSA_ENTRE_CONSULTAS_MS);
    }

    await sb.from("rotina_execucoes").insert({
      escritorio_id: escr.id,
      processos_ok: ok,
      processos_erro: falhas,
      novas,
    });
    resumo.push({ escritorio_id: escr.id, ok, erro: falhas, novas, pendentes: fila.length - feitos });
  }

  return json({
    executada_em: agora.toISOString(),
    hora_brasilia: hora,
    duracao_ms: Date.now() - inicio,
    interrompida,
    escritorios: resumo,
  });
});
