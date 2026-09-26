// Envia mensagens da fila por e-mail (uma ou várias).
// Só envia mensagens do próprio escritório, pendentes ou aprovadas, de clientes com e-mail.
// Clicar em "enviar" é a aprovação humana: nada sai sem esse clique.
//
//   { "mensagem_ids": ["..."] }  -> envia
//   { "acao": "status" }         -> diz se o e-mail está configurado / em modo teste
import { corsHeaders, erro, json } from "../_shared/cors.ts";
import { clienteAdmin, clienteUsuario, usuarioLogado } from "../_shared/supabase.ts";
import { configuracaoEmail, enviarEmail } from "../_shared/email.ts";

const MAX_POR_CHAMADA = 50;

type MensagemEnvio = {
  id: string;
  status: string;
  texto_final: string;
  movimentacoes: {
    processos: {
      apelido: string | null;
      clientes: { nome: string; email: string | null } | null;
    } | null;
  } | null;
};

type Resultado = { id: string; ok: boolean; erro?: string; destino?: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return erro("Método não permitido", 405);

  const usuario = await usuarioLogado(req);
  if (!usuario) return erro("Faça login novamente.", 401);

  const corpo = await req.json().catch(() => ({}));
  const cfg = configuracaoEmail();

  if (corpo.acao === "status") {
    return json({ configurado: cfg.configurado, modo_teste: Boolean(cfg.destinoTeste), destino_teste: cfg.destinoTeste, remetente: cfg.remetente });
  }

  const ids: string[] = Array.isArray(corpo.mensagem_ids) ? corpo.mensagem_ids.filter((x: unknown) => typeof x === "string") : [];
  if (!ids.length) return erro("Informe mensagem_ids.");
  if (ids.length > MAX_POR_CHAMADA) return erro(`Envie no máximo ${MAX_POR_CHAMADA} por vez.`);
  if (!cfg.configurado) return erro("Envio por e-mail não configurado. Defina RESEND_API_KEY nas variáveis das edge functions.");

  const sbUsuario = clienteUsuario(req);
  const { data: escritorio } = await sbUsuario
    .from("escritorios").select("nome, email_resposta").eq("id", usuario.escritorio_id).single();

  // RLS garante que só vêm mensagens do escritório do usuário
  const { data: mensagens, error: erroBusca } = await sbUsuario
    .from("mensagens")
    .select("id, status, texto_final, movimentacoes(processos(apelido, clientes(nome, email)))")
    .in("id", ids)
    .returns<MensagemEnvio[]>();
  if (erroBusca) return erro(erroBusca.message, 500);

  const admin = clienteAdmin();
  const resultados: Resultado[] = [];
  const encontradas = new Map((mensagens ?? []).map((m) => [m.id, m]));

  for (const id of ids) {
    const m = encontradas.get(id);
    if (!m) {
      resultados.push({ id, ok: false, erro: "Mensagem não encontrada." });
      continue;
    }
    if (m.status !== "pendente" && m.status !== "aprovada") {
      resultados.push({ id, ok: false, erro: `Mensagem já está como "${m.status}".` });
      continue;
    }
    const proc = m.movimentacoes?.processos;
    const cliente = proc?.clientes;
    if (!cliente?.email) {
      resultados.push({ id, ok: false, erro: `${cliente?.nome ?? "Cliente"} não tem e-mail cadastrado.` });
      continue;
    }

    const r = await enviarEmail({
      para: cliente.email,
      assunto: proc?.apelido ? `Novidade no processo: ${proc.apelido}` : "Novidade no seu processo",
      texto: m.texto_final,
      nomeRemetente: escritorio?.nome ?? "Escritório",
      responderPara: escritorio?.email_resposta,
    });

    if (r.ok) {
      const agora = new Date().toISOString();
      await admin.from("mensagens").update({
        status: "enviada",
        canal: "email",
        email_id: r.id,
        erro_envio: null,
        aprovada_em: agora,
        aprovada_por: usuario.id,
        enviada_em: agora,
        enviada_por: usuario.id,
      }).eq("id", id).eq("escritorio_id", usuario.escritorio_id);
      resultados.push({ id, ok: true, destino: r.destino });
    } else {
      await admin.from("mensagens").update({ erro_envio: r.erro }).eq("id", id).eq("escritorio_id", usuario.escritorio_id);
      resultados.push({ id, ok: false, erro: r.erro });
    }

    // O Resend permite ~2 envios por segundo no plano gratuito
    if (ids.length > 1) await new Promise((res) => setTimeout(res, 600));
  }

  return json({
    enviados: resultados.filter((r) => r.ok).length,
    falhas: resultados.filter((r) => !r.ok).length,
    modo_teste: Boolean(cfg.destinoTeste),
    resultados,
  });
});
