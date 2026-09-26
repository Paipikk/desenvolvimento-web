-- =====================================================================
-- Andamento — modelo de dados e isolamento por escritório (RLS)
-- =====================================================================
-- Regra de ouro: toda tabela com dados de clientes carrega a coluna
-- escritorio_id. Ela é preenchida por gatilho a partir do registro "pai"
-- (nunca confiamos no valor enviado pelo navegador) e as políticas RLS só
-- liberam linhas cujo escritorio_id é o do usuário logado.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type status_mensagem as enum ('pendente', 'aprovada', 'enviada', 'ignorada');
create type relevancia_mov as enum ('normal', 'baixa');
create type papel_usuario as enum ('admin', 'membro');
-- Preparado para o envio automático pela API oficial do WhatsApp (fora do escopo agora)
create type canal_envio as enum ('whatsapp_link', 'whatsapp_api');

-- ---------------------------------------------------------------------
-- Escritório (tenant)
-- ---------------------------------------------------------------------
create table public.escritorios (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null check (length(trim(nome)) > 0),
  oab_responsavel   text,
  telefone          text,
  assinatura        text,                          -- se vazio, usa o nome
  horario_consulta  smallint not null default 7    -- hora cheia, horário de Brasília
                    check (horario_consulta between 0 and 23),
  -- Campos preparados para cobrança/assinatura (fora do escopo agora)
  plano             text not null default 'gratuito',
  plano_expira_em   timestamptz,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Usuário (1:1 com auth.users, sempre ligado a um escritório)
-- ---------------------------------------------------------------------
create table public.usuarios (
  id             uuid primary key references auth.users (id) on delete cascade,
  escritorio_id  uuid not null references public.escritorios (id) on delete cascade,
  nome           text,
  email          text,
  papel          papel_usuario not null default 'membro',
  criado_em      timestamptz not null default now()
);
create index on public.usuarios (escritorio_id);

-- Convites para outros advogados/estagiários entrarem no mesmo escritório
create table public.convites (
  id             uuid primary key default gen_random_uuid(),
  escritorio_id  uuid not null references public.escritorios (id) on delete cascade,
  email          text not null,
  papel          papel_usuario not null default 'membro',
  criado_por     uuid references auth.users (id) on delete set null,
  aceito_em      timestamptz,
  criado_em      timestamptz not null default now()
);
create unique index convites_email_pendente on public.convites (lower(email)) where aceito_em is null;

-- ---------------------------------------------------------------------
-- Função auxiliar: escritório do usuário logado
-- security definer evita recursão de RLS ao consultar "usuarios".
-- ---------------------------------------------------------------------
create or replace function public.meu_escritorio_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select escritorio_id from public.usuarios where id = auth.uid()
$$;

create or replace function public.sou_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.usuarios where id = auth.uid() and papel = 'admin')
$$;

-- ---------------------------------------------------------------------
-- Cliente
-- ---------------------------------------------------------------------
create table public.clientes (
  id             uuid primary key default gen_random_uuid(),
  escritorio_id  uuid not null default public.meu_escritorio_id()
                 references public.escritorios (id) on delete cascade,
  nome           text not null check (length(trim(nome)) > 0),
  telefone       text not null check (telefone ~ '^[0-9]{10,13}$'),  -- só dígitos, com DDD
  email          text,
  observacoes    text,
  -- Preparado para o portal do cliente (fora do escopo agora)
  portal_ativo   boolean not null default false,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index on public.clientes (escritorio_id, nome);

-- ---------------------------------------------------------------------
-- Processo
-- ---------------------------------------------------------------------
create table public.processos (
  id                    uuid primary key default gen_random_uuid(),
  escritorio_id         uuid not null references public.escritorios (id) on delete cascade,
  cliente_id            uuid not null references public.clientes (id) on delete cascade,
  numero_cnj            char(20) not null check (numero_cnj ~ '^[0-9]{20}$'),  -- sem pontuação
  tribunal              text not null check (tribunal ~ '^[A-Z0-9-]{2,10}$'),   -- ex.: TJRS, TRT4, TRE-SP
  apelido               text,
  ativo                 boolean not null default true,
  ultima_consulta       timestamptz,   -- última consulta bem-sucedida
  ultima_tentativa      timestamptz,   -- última tentativa (sucesso ou erro)
  ultimo_erro           text,          -- null quando a última consulta deu certo
  falhas_consecutivas   integer not null default 0,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now(),
  unique (escritorio_id, numero_cnj)
);
create index on public.processos (escritorio_id, cliente_id);
create index on public.processos (ativo, ultima_tentativa);

-- ---------------------------------------------------------------------
-- Movimentação
-- ---------------------------------------------------------------------
create table public.movimentacoes (
  id             uuid primary key default gen_random_uuid(),
  escritorio_id  uuid not null references public.escritorios (id) on delete cascade,
  processo_id    uuid not null references public.processos (id) on delete cascade,
  codigo         integer,
  nome           text not null,
  data_hora      timestamptz not null,
  complemento    text,
  relevancia     relevancia_mov not null default 'normal',
  hash           text not null,        -- sha256(codigo|dataHora|nome|complemento)
  criado_em      timestamptz not null default now(),
  unique (processo_id, hash)
);
create index on public.movimentacoes (escritorio_id, data_hora desc);
create index on public.movimentacoes (processo_id, data_hora desc);

-- ---------------------------------------------------------------------
-- Mensagem
-- ---------------------------------------------------------------------
create table public.mensagens (
  id               uuid primary key default gen_random_uuid(),
  escritorio_id    uuid not null references public.escritorios (id) on delete cascade,
  movimentacao_id  uuid not null unique references public.movimentacoes (id) on delete cascade,
  texto_gerado     text not null,
  texto_final      text not null,
  status           status_mensagem not null default 'pendente',
  relevancia       relevancia_mov not null default 'normal',
  gerada_por       text not null default 'ia',          -- 'ia' | 'modelo' (texto padrão, se a IA falhar)
  canal            canal_envio not null default 'whatsapp_link',
  aprovada_em      timestamptz,
  aprovada_por     uuid references auth.users (id) on delete set null,
  enviada_em       timestamptz,
  enviada_por      uuid references auth.users (id) on delete set null,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create index on public.mensagens (escritorio_id, status, relevancia, criado_em desc);

-- ---------------------------------------------------------------------
-- Registro de consultas ao Datajud (sucesso e falha, por processo)
-- ---------------------------------------------------------------------
create table public.consultas_log (
  id                 uuid primary key default gen_random_uuid(),
  escritorio_id      uuid not null references public.escritorios (id) on delete cascade,
  processo_id        uuid not null references public.processos (id) on delete cascade,
  origem             text not null check (origem in ('manual', 'rotina')),
  sucesso            boolean not null,
  novas              integer not null default 0,
  erro               text,
  duracao_ms         integer,
  criado_em          timestamptz not null default now()
);
create index on public.consultas_log (processo_id, criado_em desc);

-- Controle de execução da rotina diária por escritório
create table public.rotina_execucoes (
  id              uuid primary key default gen_random_uuid(),
  escritorio_id   uuid not null references public.escritorios (id) on delete cascade,
  iniciada_em     timestamptz not null default now(),
  processos_ok    integer not null default 0,
  processos_erro  integer not null default 0,
  novas           integer not null default 0
);
create index on public.rotina_execucoes (escritorio_id, iniciada_em desc);

-- =====================================================================
-- Gatilhos: herdar escritorio_id do registro pai + atualizado_em
-- =====================================================================
create or replace function public.tg_atualizado_em()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

create trigger escritorios_atualizado before update on public.escritorios
  for each row execute function public.tg_atualizado_em();
create trigger clientes_atualizado before update on public.clientes
  for each row execute function public.tg_atualizado_em();
create trigger processos_atualizado before update on public.processos
  for each row execute function public.tg_atualizado_em();
create trigger mensagens_atualizado before update on public.mensagens
  for each row execute function public.tg_atualizado_em();

-- processo herda do cliente
create or replace function public.tg_processo_escritorio()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select escritorio_id into new.escritorio_id from public.clientes where id = new.cliente_id;
  if new.escritorio_id is null then
    raise exception 'Cliente não encontrado';
  end if;
  return new;
end $$;
create trigger processos_escritorio before insert or update of cliente_id on public.processos
  for each row execute function public.tg_processo_escritorio();

-- movimentação herda do processo
create or replace function public.tg_movimentacao_escritorio()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select escritorio_id into new.escritorio_id from public.processos where id = new.processo_id;
  if new.escritorio_id is null then
    raise exception 'Processo não encontrado';
  end if;
  return new;
end $$;
create trigger movimentacoes_escritorio before insert or update of processo_id on public.movimentacoes
  for each row execute function public.tg_movimentacao_escritorio();

-- mensagem herda da movimentação
create or replace function public.tg_mensagem_escritorio()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select escritorio_id into new.escritorio_id from public.movimentacoes where id = new.movimentacao_id;
  if new.escritorio_id is null then
    raise exception 'Movimentação não encontrada';
  end if;
  return new;
end $$;
create trigger mensagens_escritorio before insert or update of movimentacao_id on public.mensagens
  for each row execute function public.tg_mensagem_escritorio();

-- log herda do processo
create or replace function public.tg_log_escritorio()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select escritorio_id into new.escritorio_id from public.processos where id = new.processo_id;
  return new;
end $$;
create trigger consultas_log_escritorio before insert on public.consultas_log
  for each row execute function public.tg_log_escritorio();

-- Nunca deixar mudar o escritório de um cliente
create or replace function public.tg_bloqueia_troca_escritorio()
returns trigger language plpgsql as $$
begin
  if new.escritorio_id is distinct from old.escritorio_id then
    raise exception 'Não é permitido mudar o escritório de um registro';
  end if;
  return new;
end $$;
create trigger clientes_bloqueia_troca before update of escritorio_id on public.clientes
  for each row execute function public.tg_bloqueia_troca_escritorio();

-- =====================================================================
-- Cadastro: ao criar um usuário no Auth, cria o escritório (ou aceita convite)
-- metadados esperados no signUp: { nome, escritorio_nome, oab_responsavel, telefone }
-- =====================================================================
create or replace function public.tg_novo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_convite  public.convites%rowtype;
  v_escr_id  uuid;
  v_meta     jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  select * into v_convite
    from public.convites
   where lower(email) = lower(new.email) and aceito_em is null
   limit 1;

  if found then
    insert into public.usuarios (id, escritorio_id, nome, email, papel)
    values (new.id, v_convite.escritorio_id, v_meta->>'nome', new.email, v_convite.papel);
    update public.convites set aceito_em = now() where id = v_convite.id;
  else
    insert into public.escritorios (nome, oab_responsavel, telefone)
    values (
      coalesce(nullif(trim(v_meta->>'escritorio_nome'), ''), 'Meu escritório'),
      nullif(trim(v_meta->>'oab_responsavel'), ''),
      nullif(regexp_replace(coalesce(v_meta->>'telefone', ''), '\D', '', 'g'), '')
    )
    returning id into v_escr_id;

    insert into public.usuarios (id, escritorio_id, nome, email, papel)
    values (new.id, v_escr_id, v_meta->>'nome', new.email, 'admin');
  end if;

  return new;
end $$;

create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.tg_novo_usuario();

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.escritorios      enable row level security;
alter table public.usuarios         enable row level security;
alter table public.convites         enable row level security;
alter table public.clientes         enable row level security;
alter table public.processos        enable row level security;
alter table public.movimentacoes    enable row level security;
alter table public.mensagens        enable row level security;
alter table public.consultas_log    enable row level security;
alter table public.rotina_execucoes enable row level security;

-- Escritório: todos do escritório leem; só admin altera. Criação só via gatilho.
create policy escritorio_ler on public.escritorios
  for select to authenticated using (id = public.meu_escritorio_id());
create policy escritorio_alterar on public.escritorios
  for update to authenticated
  using (id = public.meu_escritorio_id() and public.sou_admin())
  with check (id = public.meu_escritorio_id());

-- Usuários: ver colegas; editar o próprio nome; admin remove colegas
create policy usuarios_ler on public.usuarios
  for select to authenticated using (escritorio_id = public.meu_escritorio_id());
create policy usuarios_alterar_proprio on public.usuarios
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and escritorio_id = public.meu_escritorio_id());
create policy usuarios_admin_remove on public.usuarios
  for delete to authenticated
  using (escritorio_id = public.meu_escritorio_id() and public.sou_admin() and id <> auth.uid());

-- Impede que um usuário promova a si mesmo a admin
create or replace function public.tg_usuario_papel()
returns trigger language plpgsql as $$
begin
  if new.papel is distinct from old.papel and auth.uid() is not null and not public.sou_admin() then
    raise exception 'Somente administradores podem mudar papéis';
  end if;
  return new;
end $$;
create trigger usuarios_papel before update of papel on public.usuarios
  for each row execute function public.tg_usuario_papel();

-- Convites: só admin
create policy convites_admin on public.convites
  for all to authenticated
  using (escritorio_id = public.meu_escritorio_id() and public.sou_admin())
  with check (escritorio_id = public.meu_escritorio_id() and public.sou_admin());

-- Tabelas de dados: tudo restrito ao próprio escritório
create policy clientes_escritorio on public.clientes
  for all to authenticated
  using (escritorio_id = public.meu_escritorio_id())
  with check (escritorio_id = public.meu_escritorio_id());

create policy processos_escritorio on public.processos
  for all to authenticated
  using (escritorio_id = public.meu_escritorio_id())
  with check (escritorio_id = public.meu_escritorio_id());

-- Movimentações são gravadas só pelas edge functions (service role); usuário apenas lê
create policy movimentacoes_ler on public.movimentacoes
  for select to authenticated using (escritorio_id = public.meu_escritorio_id());

-- Mensagens: usuário lê e atualiza (editar/aprovar/ignorar/enviar); criação pelas edge functions
create policy mensagens_ler on public.mensagens
  for select to authenticated using (escritorio_id = public.meu_escritorio_id());
create policy mensagens_alterar on public.mensagens
  for update to authenticated
  using (escritorio_id = public.meu_escritorio_id())
  with check (escritorio_id = public.meu_escritorio_id());

create policy consultas_log_ler on public.consultas_log
  for select to authenticated using (escritorio_id = public.meu_escritorio_id());

create policy rotina_ler on public.rotina_execucoes
  for select to authenticated using (escritorio_id = public.meu_escritorio_id());

-- Mensagens: o usuário só pode mexer em texto_final/status e carimbos.
-- (texto_gerado, relevância e vínculos são imutáveis pelo navegador)
revoke update on public.mensagens from authenticated;
grant update (texto_final, status, aprovada_em, aprovada_por, enviada_em, enviada_por)
  on public.mensagens to authenticated;

-- Processos: campos de controle da consulta só pelas edge functions
revoke update on public.processos from authenticated;
grant update (cliente_id, numero_cnj, tribunal, apelido, ativo) on public.processos to authenticated;

-- Escritório: plano/cobrança não editável pelo navegador
revoke update on public.escritorios from authenticated;
grant update (nome, oab_responsavel, telefone, assinatura, horario_consulta)
  on public.escritorios to authenticated;

revoke update on public.usuarios from authenticated;
grant update (nome) on public.usuarios to authenticated;

-- =====================================================================
-- LGPD: resumo do que será apagado junto com um cliente
-- (a exclusão em si é um DELETE comum; as FKs com ON DELETE CASCADE
--  removem processos, movimentações, mensagens e registros de consulta)
-- =====================================================================
create or replace function public.resumo_exclusao_cliente(p_cliente_id uuid)
returns table (processos bigint, movimentacoes bigint, mensagens bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (select count(*) from public.processos p where p.cliente_id = p_cliente_id),
    (select count(*) from public.movimentacoes m
       join public.processos p on p.id = m.processo_id where p.cliente_id = p_cliente_id),
    (select count(*) from public.mensagens g
       join public.movimentacoes m on m.id = g.movimentacao_id
       join public.processos p on p.id = m.processo_id where p.cliente_id = p_cliente_id)
$$;
