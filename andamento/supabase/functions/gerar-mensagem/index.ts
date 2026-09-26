// Gera (ou regenera) a mensagem de WhatsApp para uma movimentação.
//
// Dois modos:
//  1) { mensagem_id }              -> regenera o texto de uma mensagem pendente e salva
//  2) { nome_cliente, apelido, nome_movimentacao, complemento, data_hora }
//                                  -> só devolve uma prévia (nada é gravado)
import { corsHeaders, erro, json } from "../_shared/cors.ts";
import { clienteAdmin, clienteUsuario, usuarioLogado } from "../_shared/supabase.ts";
import { gerarMensagem } from "../_shared/ia.ts";
import { classificarPorRegra, relevanciaFinal } from "../_shared/relevancia.ts";
import { formatarCnj } from "../_shared/cnj.ts";

type MensagemCompleta = {
  id: string;
  status: string;
  movimentacoes: {
    nome: string;
    complemento: string | null;
    codigo: number | null;
    data_hora: string;
    processos: {
      numero_cnj: string;
      apelido: string | null;
      clientes: { nome: string } | null;
    } | null;
  } | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return erro("Método não permitido", 405);

  const usuario = await usuarioLogado(req);
  if (!usuario) return erro("Faça login novamente.", 401);

  const corpo = await req.json().catch(() => ({}));
  const sbUsuario = clienteUsuario(req);

  const { data: escritorio } = await sbUsuario
    .from("escritorios").select("nome, assinatura").eq("id", usuario.escritorio_id).single();
  if (!escritorio) return erro("Escritório não encontrado.", 404);

  if (typeof corpo.mensagem_id === "string") {
    // RLS garante que a mensagem é do escritório
    const { data: msg } = await sbUsuario
      .from("mensagens")
      .select("id, status, movimentacoes(nome, complemento, codigo, data_hora, processos(numero_cnj, apelido, clientes(nome)))")
      .eq("id", corpo.mensagem_id)
      .maybeSingle<MensagemCompleta>();
    if (!msg?.movimentacoes?.processos) return erro("Mensagem não encontrada.", 404);
    if (msg.status === "enviada") return erro("Esta mensagem já foi enviada.");

    const mov = msg.movimentacoes;
    const proc = mov.processos!;
    const gerada = await gerarMensagem({
      nomeCliente: proc.clientes?.nome ?? "cliente",
      apelidoProcesso: proc.apelido,
      numeroProcesso: formatarCnj(proc.numero_cnj),
      nomeMovimentacao: mov.nome,
      complemento: mov.complemento,
      dataHora: mov.data_hora,
      nomeEscritorio: escritorio.nome,
      assinatura: escritorio.assinatura,
    });
    const relevancia = relevanciaFinal(classificarPorRegra(mov.nome, mov.complemento, mov.codigo), gerada.relevanciaIa);

    // texto_gerado é protegido contra escrita pelo navegador; gravamos com service role
    const { data: atualizada, error } = await clienteAdmin()
      .from("mensagens")
      .update({
        texto_gerado: gerada.texto,
        texto_final: gerada.texto,
        gerada_por: gerada.geradaPor,
        relevancia,
        status: "pendente",
      })
      .eq("id", msg.id)
      .eq("escritorio_id", usuario.escritorio_id)
      .select()
      .single();
    if (error) return erro(`Não foi possível salvar: ${error.message}`, 500);
    return json({ mensagem: atualizada, aviso: gerada.aviso });
  }

  // Modo prévia
  const nomeMov = String(corpo.nome_movimentacao ?? "").trim();
  if (!nomeMov) return erro("Informe nome_movimentacao.");
  const dataHora = corpo.data_hora ? new Date(corpo.data_hora) : new Date();
  if (isNaN(dataHora.getTime())) return erro("data_hora inválida.");

  const gerada = await gerarMensagem({
    nomeCliente: String(corpo.nome_cliente ?? "cliente"),
    apelidoProcesso: corpo.apelido ? String(corpo.apelido) : null,
    numeroProcesso: corpo.numero_processo ? formatarCnj(String(corpo.numero_processo)) : "",
    nomeMovimentacao: nomeMov,
    complemento: corpo.complemento ? String(corpo.complemento) : null,
    dataHora: dataHora.toISOString(),
    nomeEscritorio: escritorio.nome,
    assinatura: escritorio.assinatura,
  });
  const relevancia = relevanciaFinal(
    classificarPorRegra(nomeMov, corpo.complemento ?? null, null),
    gerada.relevanciaIa,
  );
  return json({ texto: gerada.texto, relevancia, gerada_por: gerada.geradaPor, aviso: gerada.aviso });
});
