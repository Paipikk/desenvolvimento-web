-- =====================================================================
-- Envio por e-mail (Resend)
-- =====================================================================

alter type canal_envio add value if not exists 'email';

-- canal passa a ser preenchido só quando a mensagem é enviada
alter table public.mensagens alter column canal drop not null;
alter table public.mensagens alter column canal drop default;
update public.mensagens set canal = null where status <> 'enviada';

alter table public.mensagens
  add column if not exists email_id    text,   -- id devolvido pelo provedor de e-mail
  add column if not exists erro_envio  text;   -- último erro de envio (e-mail)

-- E-mail para onde os clientes respondem (reply-to)
alter table public.escritorios
  add column if not exists email_resposta text;

grant update (email_resposta) on public.escritorios to authenticated;
-- envio pelo botão do WhatsApp continua sendo marcado pelo navegador
grant update (canal) on public.mensagens to authenticated;
