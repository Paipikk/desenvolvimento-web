-- =====================================================================
-- Rotina automática: pg_cron chama a edge function "rotina-diaria"
-- =====================================================================
-- A função é chamada a cada 10 minutos, mas só consulta os processos de
-- um escritório depois do horário configurado (padrão 7h de Brasília) e
-- apenas uma vez por dia por processo. Isso deixa a rotina "retomável":
-- se houver muitos processos, cada chamada processa um lote e a próxima
-- continua de onde parou, sem estourar o tempo limite da edge function.
--
-- Antes de aplicar, guarde dois segredos no Vault (SQL Editor):
--   select vault.create_secret('https://<ref>.supabase.co', 'andamento_project_url');
--   select vault.create_secret('<um segredo longo e aleatório>', 'andamento_cron_secret');
-- e configure o mesmo valor em CRON_SECRET nas variáveis das edge functions.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.disparar_rotina_diaria()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'andamento_project_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'andamento_cron_secret';

  if v_url is null or v_secret is null then
    raise warning 'Andamento: segredos andamento_project_url/andamento_cron_secret ausentes no Vault';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/rotina-diaria',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
end $$;

revoke execute on function public.disparar_rotina_diaria() from public, anon, authenticated;

select cron.schedule(
  'andamento-rotina-diaria',
  '*/10 * * * *',
  $$ select public.disparar_rotina_diaria(); $$
);
