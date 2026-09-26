// Envio de e-mail pelo Resend (https://resend.com).
//
// Variáveis:
//   RESEND_API_KEY       chave da API do Resend (obrigatória para enviar)
//   EMAIL_REMETENTE      endereço remetente de um domínio verificado no Resend.
//                        Padrão: onboarding@resend.dev (remetente de teste do Resend,
//                        que só entrega para o e-mail da própria conta Resend)
//   EMAIL_TESTE_DESTINO  se preenchido, TODO e-mail vai para este endereço em vez do
//                        cliente (modo teste). O assunto mostra quem seria o destinatário.

export type EmailParaEnviar = {
  para: string;
  assunto: string;
  texto: string;
  nomeRemetente: string;
  responderPara?: string | null;
};

export type ResultadoEmail =
  | { ok: true; id: string; destino: string; modoTeste: boolean }
  | { ok: false; erro: string; temporario: boolean };

export function configuracaoEmail() {
  const destinoTeste = Deno.env.get("EMAIL_TESTE_DESTINO")?.trim() || null;
  return {
    configurado: Boolean(Deno.env.get("RESEND_API_KEY")),
    remetente: Deno.env.get("EMAIL_REMETENTE")?.trim() || "onboarding@resend.dev",
    destinoTeste,
  };
}

function escaparHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function montarHtml(texto: string, aviso?: string): string {
  const corpo = escaparHtml(texto).replace(/\n/g, "<br>");
  const faixa = aviso
    ? `<p style="background:#fef3c7;color:#92400e;padding:8px 12px;border-radius:6px;font-size:13px">${escaparHtml(aviso)}</p>`
    : "";
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f8fafc;padding:24px;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;color:#1e293b;font-size:15px;line-height:1.6">
${faixa}<p style="margin:0">${corpo}</p>
</div></body></html>`;
}

// Remove caracteres que poderiam quebrar o cabeçalho "From"
function nomeSeguro(nome: string): string {
  return nome.replace(/[\r\n"<>]/g, "").trim().slice(0, 80) || "Escritório";
}

export async function enviarEmail(e: EmailParaEnviar): Promise<ResultadoEmail> {
  const chave = Deno.env.get("RESEND_API_KEY");
  if (!chave) {
    return { ok: false, erro: "Envio por e-mail não configurado (RESEND_API_KEY ausente).", temporario: false };
  }
  const { remetente, destinoTeste } = configuracaoEmail();
  const destino = destinoTeste ?? e.para;
  const assunto = destinoTeste ? `[TESTE → ${e.para}] ${e.assunto}` : e.assunto;
  const aviso = destinoTeste
    ? `Modo teste: este e-mail seria enviado para ${e.para}.`
    : undefined;

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${nomeSeguro(e.nomeRemetente)} <${remetente}>`,
        to: [destino],
        subject: assunto,
        text: aviso ? `${aviso}\n\n${e.texto}` : e.texto,
        html: montarHtml(e.texto, aviso),
        ...(e.responderPara ? { reply_to: e.responderPara } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = json?.message ?? `erro ${resp.status}`;
      let erro = `Falha no envio do e-mail: ${msg}`;
      if (resp.status === 403 && remetente === "onboarding@resend.dev") {
        erro += " — com o remetente de teste do Resend só é possível enviar para o e-mail da sua conta Resend. " +
          "Preencha EMAIL_TESTE_DESTINO com esse e-mail ou verifique um domínio.";
      }
      return { ok: false, erro, temporario: resp.status === 429 || resp.status >= 500 };
    }
    return { ok: true, id: String(json.id ?? ""), destino, modoTeste: Boolean(destinoTeste) };
  } catch (err) {
    return { ok: false, erro: `Falha de conexão com o serviço de e-mail: ${String(err)}`, temporario: true };
  }
}
