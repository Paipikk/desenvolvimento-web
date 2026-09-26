// Consulta um processo no Datajud, grava só as movimentações novas e gera
// mensagens (status "pendente") para o escritório aprovar.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import { consultarDatajud, ErroDatajud, hashMovimento, type MovimentoDatajud } from "./datajud.ts";
import { classificarPorRegra, relevanciaFinal } from "./relevancia.ts";
import { gerarMensagem } from "./ia.ts";
import { formatarCnj } from "./cnj.ts";

// Na primeira consulta de um processo antigo, o histórico inteiro chega de uma vez.
// Gravamos tudo, mas só geramos mensagem para a movimentação mais recente, e só se
// ela for destes últimos dias — ninguém quer avisar o cliente de algo de 2019.
const DIAS_RECENTES_PRIMEIRA_CONSULTA = 7;
// Se um processo acumular muitas novidades de uma vez, só as mais recentes viram mensagem.
const MAX_MENSAGENS_POR_CONSULTA = 5;

export type ResultadoSincronizacao = {
  processo_id: string;
  sucesso: boolean;
  novas: number;
  mensagens: number;
  erro?: string;
  temporario?: boolean;
  avisos?: string[];
};

type ProcessoCompleto = {
  id: string;
  escritorio_id: string;
  numero_cnj: string;
  tribunal: string;
  apelido: string | null;
  ultima_consulta: string | null;
  falhas_consecutivas: number;
  clientes: { nome: string } | null;
  escritorios: { nome: string; assinatura: string | null } | null;
};

export async function sincronizarProcesso(
  sb: SupabaseClient,
  processoId: string,
  origem: "manual" | "rotina",
): Promise<ResultadoSincronizacao> {
  const inicio = Date.now();

  const { data: processo, error: erroBusca } = await sb
    .from("processos")
    .select(
      "id, escritorio_id, numero_cnj, tribunal, apelido, ultima_consulta, falhas_consecutivas, clientes(nome), escritorios(nome, assinatura)",
    )
    .eq("id", processoId)
    .single<ProcessoCompleto>();

  if (erroBusca || !processo) {
    return { processo_id: processoId, sucesso: false, novas: 0, mensagens: 0, erro: "Processo não encontrado." };
  }

  const registrarFalha = async (mensagem: string, temporario: boolean): Promise<ResultadoSincronizacao> => {
    await sb.from("processos").update({
      ultima_tentativa: new Date().toISOString(),
      ultimo_erro: mensagem,
      falhas_consecutivas: processo.falhas_consecutivas + 1,
    }).eq("id", processo.id);
    await sb.from("consultas_log").insert({
      processo_id: processo.id,
      escritorio_id: processo.escritorio_id,
      origem,
      sucesso: false,
      erro: mensagem,
      duracao_ms: Date.now() - inicio,
    });
    return { processo_id: processo.id, sucesso: false, novas: 0, mensagens: 0, erro: mensagem, temporario };
  };

  try {
    const resultado = await consultarDatajud(processo.numero_cnj, processo.tribunal);
    if (!resultado.encontrado) {
      return await registrarFalha(
        `Processo não encontrado no Datajud (${processo.tribunal}). Confira o número e o tribunal. ` +
          "Processos sigilosos ou muito recentes podem não aparecer.",
        false,
      );
    }

    // Hashes já gravados
    const { data: existentes, error: erroExist } = await sb
      .from("movimentacoes")
      .select("hash")
      .eq("processo_id", processo.id);
    if (erroExist) throw erroExist;
    const jaTem = new Set((existentes ?? []).map((m: { hash: string }) => m.hash));
    const primeiraConsulta = !processo.ultima_consulta && jaTem.size === 0;

    const novos: Array<MovimentoDatajud & { hash: string }> = [];
    const vistosAgora = new Set<string>();
    for (const m of resultado.movimentos) {
      const hash = await hashMovimento(m);
      if (jaTem.has(hash) || vistosAgora.has(hash)) continue;
      vistosAgora.add(hash);
      novos.push({ ...m, hash });
    }

    let mensagensCriadas = 0;
    let novasGravadas = 0;
    const avisos: string[] = [];

    if (novos.length) {
      const linhas = novos.map((m) => ({
        processo_id: processo.id,
        escritorio_id: processo.escritorio_id,
        codigo: m.codigo,
        nome: m.nome,
        data_hora: m.dataHora,
        complemento: m.complemento,
        hash: m.hash,
        relevancia: classificarPorRegra(m.nome, m.complemento, m.codigo) === "baixa" ? "baixa" : "normal",
      }));

      const { data: inseridas, error: erroIns } = await sb
        .from("movimentacoes")
        .upsert(linhas, { onConflict: "processo_id,hash", ignoreDuplicates: true })
        .select("id, codigo, nome, data_hora, complemento, hash");
      if (erroIns) throw erroIns;
      // O upsert com ignoreDuplicates devolve só o que foi realmente inserido:
      // essa é a contagem confiável de novidades (o filtro por hash acima é só otimização).
      novasGravadas = inseridas?.length ?? 0;

      // Quais recebem mensagem
      const ordenadas = [...(inseridas ?? [])].sort((a, b) => b.data_hora.localeCompare(a.data_hora));
      let alvo = ordenadas.slice(0, MAX_MENSAGENS_POR_CONSULTA);
      if (primeiraConsulta) {
        const limite = Date.now() - DIAS_RECENTES_PRIMEIRA_CONSULTA * 86_400_000;
        alvo = ordenadas.slice(0, 1).filter((m) => new Date(m.data_hora).getTime() >= limite);
      }

      for (const mov of alvo) {
        const regra = classificarPorRegra(mov.nome, mov.complemento, mov.codigo);
        const gerada = await gerarMensagem({
          nomeCliente: processo.clientes?.nome ?? "cliente",
          apelidoProcesso: processo.apelido,
          numeroProcesso: formatarCnj(processo.numero_cnj),
          nomeMovimentacao: mov.nome,
          complemento: mov.complemento,
          dataHora: mov.data_hora,
          nomeEscritorio: processo.escritorios?.nome ?? "",
          assinatura: processo.escritorios?.assinatura ?? null,
        });
        if (gerada.aviso) avisos.push(gerada.aviso);
        const relevancia = relevanciaFinal(regra, gerada.relevanciaIa);

        if (relevancia === "baixa" && regra !== "baixa") {
          await sb.from("movimentacoes").update({ relevancia }).eq("id", mov.id);
        }

        const { error: erroMsg } = await sb.from("mensagens").insert({
          movimentacao_id: mov.id,
          escritorio_id: processo.escritorio_id,
          texto_gerado: gerada.texto,
          texto_final: gerada.texto,
          relevancia,
          gerada_por: gerada.geradaPor,
        });
        if (erroMsg) {
          avisos.push(`Falha ao salvar mensagem: ${erroMsg.message}`);
        } else {
          mensagensCriadas++;
        }
      }
    }

    const agora = new Date().toISOString();
    await sb.from("processos").update({
      ultima_consulta: agora,
      ultima_tentativa: agora,
      ultimo_erro: null,
      falhas_consecutivas: 0,
    }).eq("id", processo.id);

    await sb.from("consultas_log").insert({
      processo_id: processo.id,
      escritorio_id: processo.escritorio_id,
      origem,
      sucesso: true,
      novas: novasGravadas,
      erro: avisos.length ? avisos.join(" | ").slice(0, 1000) : null,
      duracao_ms: Date.now() - inicio,
    });

    return {
      processo_id: processo.id,
      sucesso: true,
      novas: novasGravadas,
      mensagens: mensagensCriadas,
      avisos: avisos.length ? avisos : undefined,
    };
  } catch (e) {
    if (e instanceof ErroDatajud) return await registrarFalha(e.message, e.temporario);
    const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e);
    console.error(`Erro ao sincronizar processo ${processo.id}:`, msg);
    return await registrarFalha(`Erro interno: ${msg}`.slice(0, 500), true);
  }
}
