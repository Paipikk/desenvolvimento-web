// Geração da mensagem de WhatsApp para o cliente, em linguagem simples.
// Usa a API do Claude (Anthropic). Se a IA não estiver configurada ou falhar,
// cai para um texto-modelo neutro — a rotina nunca para por causa disso.

import Anthropic from "npm:@anthropic-ai/sdk@0.128.0";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@0.128.0/helpers/zod";
import { z } from "npm:zod@4.1.12";

export type EntradaMensagem = {
  nomeCliente: string;
  apelidoProcesso: string | null;
  numeroProcesso: string; // formatado
  nomeMovimentacao: string;
  complemento: string | null;
  dataHora: string; // ISO
  nomeEscritorio: string;
  assinatura: string | null;
};

export type SaidaMensagem = {
  texto: string; // já com assinatura
  relevanciaIa: "normal" | "baixa" | null;
  geradaPor: "ia" | "modelo";
  aviso?: string;
};

const LIMITE_CORPO = 400;

const Resposta = z.object({
  mensagem: z.string().describe("Texto da mensagem de WhatsApp, sem assinatura."),
  relevancia: z.enum(["normal", "baixa"]).describe(
    "'baixa' se a movimentação é só andamento interno/burocrático sem efeito prático para o cliente.",
  ),
});

const SISTEMA = `Você escreve mensagens de WhatsApp de um escritório de advocacia brasileiro para os seus clientes, avisando sobre novidades nos processos deles.

Regras obrigatórias:
- Português do Brasil, tom cordial e profissional, frases curtas, sem juridiquês. Se precisar citar um termo técnico, explique em palavras simples.
- No máximo ${LIMITE_CORPO} caracteres. Não use emojis nem formatação markdown.
- Comece cumprimentando o cliente pelo primeiro nome.
- Diga o que aconteceu no processo e, se fizer sentido, o que isso significa na prática.
- NUNCA invente prazos, datas, valores, nomes, decisões ou resultados que não estejam nas informações recebidas. Se a movimentação não diz o resultado, não suponha qual foi.
- NUNCA prometa ou sugira resultado ("vamos ganhar", "logo sai o dinheiro" etc.).
- Se não houver nada que o cliente precise fazer, diga que o escritório está acompanhando. Se houver dúvida sobre o significado, convide o cliente a falar com o escritório.
- Não assine a mensagem; a assinatura é adicionada automaticamente.

Relevância:
- Classifique como "baixa" movimentações puramente burocráticas, que não mudam nada para o cliente (ex.: conclusos ao juiz, juntada de petição ou documento, expedição de certidão, remessa, recebimento dos autos, ato ordinatório, publicação/intimação de rotina).
- Classifique como "normal" o que o cliente gostaria de saber (sentença, decisão, audiência marcada, acordo, perícia, recurso julgado, pagamento/alvará, arquivamento, etc.).`;

function primeiroNome(nome: string): string {
  return (nome ?? "").trim().split(/\s+/)[0] ?? "";
}

export function formatarData(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

function assinar(corpo: string, entrada: EntradaMensagem): string {
  const assinatura = (entrada.assinatura?.trim() || entrada.nomeEscritorio).trim();
  return `${corpo.trim()}\n\n${assinatura}`;
}

export function mensagemModelo(entrada: EntradaMensagem): string {
  const ref = entrada.apelidoProcesso?.trim()
    ? `no processo "${entrada.apelidoProcesso.trim()}"`
    : `no seu processo (nº ${entrada.numeroProcesso})`;
  const corpo =
    `Olá, ${primeiroNome(entrada.nomeCliente)}! Passando para avisar que houve uma nova movimentação ${ref} ` +
    `em ${formatarData(entrada.dataHora)}: "${entrada.nomeMovimentacao}". ` +
    `Estamos acompanhando e qualquer dúvida é só nos chamar.`;
  return assinar(corpo, entrada);
}

// Proteção extra contra "alucinação": números na resposta (prazos, valores)
// que não aparecem em nenhum dado de entrada fazem a mensagem cair no modelo.
function temNumeroInventado(texto: string, entrada: EntradaMensagem): boolean {
  const fonte = [
    entrada.nomeMovimentacao,
    entrada.complemento ?? "",
    entrada.apelidoProcesso ?? "",
    entrada.numeroProcesso,
    formatarData(entrada.dataHora),
    entrada.nomeCliente,
  ].join(" ");
  const permitidos = new Set((fonte.match(/\d+/g) ?? []).map((n) => String(Number(n))));
  const usados = (texto.match(/\d+/g) ?? []).map((n) => String(Number(n)));
  return usados.some((n) => !permitidos.has(n));
}

let cliente: Anthropic | null = null;
function obterCliente(): Anthropic | null {
  const chave = Deno.env.get("ANTHROPIC_API_KEY");
  if (!chave) return null;
  cliente ??= new Anthropic({ apiKey: chave, maxRetries: 2, timeout: 60_000 });
  return cliente;
}

export async function gerarMensagem(entrada: EntradaMensagem): Promise<SaidaMensagem> {
  const ia = obterCliente();
  if (!ia) {
    return {
      texto: mensagemModelo(entrada),
      relevanciaIa: null,
      geradaPor: "modelo",
      aviso: "ANTHROPIC_API_KEY não configurada; usado texto-modelo.",
    };
  }

  const dados = [
    `Nome do cliente: ${entrada.nomeCliente}`,
    `Como o cliente conhece o processo: ${entrada.apelidoProcesso?.trim() || "(sem apelido)"}`,
    `Número do processo: ${entrada.numeroProcesso}`,
    `Data da movimentação: ${formatarData(entrada.dataHora)}`,
    `Movimentação (texto técnico do tribunal): ${entrada.nomeMovimentacao}`,
    `Complemento: ${entrada.complemento?.trim() || "(nenhum)"}`,
  ].join("\n");

  try {
    const resposta = await ia.messages.parse({
      model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-opus-5",
      max_tokens: 4000,
      system: SISTEMA,
      output_config: { effort: "low", format: zodOutputFormat(Resposta) },
      messages: [{ role: "user", content: `Escreva a mensagem para este cliente.\n\n${dados}` }],
    });

    if (resposta.stop_reason === "refusal" || !resposta.parsed_output) {
      return {
        texto: mensagemModelo(entrada),
        relevanciaIa: null,
        geradaPor: "modelo",
        aviso: `IA não retornou texto utilizável (stop_reason=${resposta.stop_reason}).`,
      };
    }

    let corpo = resposta.parsed_output.mensagem.trim();
    const relevanciaIa = resposta.parsed_output.relevancia;

    if (temNumeroInventado(corpo, entrada)) {
      return {
        texto: mensagemModelo(entrada),
        relevanciaIa,
        geradaPor: "modelo",
        aviso: "A IA citou números que não estão na movimentação; usado texto-modelo por segurança.",
      };
    }
    if (corpo.length > LIMITE_CORPO + 80) {
      corpo = corpo.slice(0, LIMITE_CORPO).replace(/\s+\S*$/, "") + "…";
    }

    return { texto: assinar(corpo, entrada), relevanciaIa, geradaPor: "ia" };
  } catch (e) {
    const detalhe = e instanceof Anthropic.APIError ? `${e.status ?? ""} ${e.message}` : String(e);
    console.error("Falha na geração por IA:", detalhe);
    return {
      texto: mensagemModelo(entrada),
      relevanciaIa: null,
      geradaPor: "modelo",
      aviso: `Falha na IA: ${detalhe.slice(0, 200)}`,
    };
  }
}
