# Andamento

SaaS para escritórios pequenos de advocacia: acompanha os processos no **Datajud (CNJ)** todos os dias e prepara,
com IA, uma mensagem de WhatsApp em linguagem simples para cada novidade. O advogado só revisa, aprova e envia.
Nada é enviado sem aprovação humana.

- **Frontend:** React + TypeScript + Tailwind (Vite), responsivo, todo em português
- **Backend:** Supabase (Auth, Postgres com RLS, Edge Functions em Deno, pg_cron)
- **IA:** Claude (Anthropic), com texto-modelo de segurança quando a IA não está disponível

## Estrutura

```
andamento/
├── src/                          # frontend
│   ├── pages/                    # Entrar, Painel, Clientes, ClienteDetalhe, Processos,
│   │                             # ProcessoDetalhe, Fila (mensagens), Configuracoes
│   ├── components/               # Layout, formulários, modais, toasts
│   └── lib/                      # cliente Supabase, auth, formatação, link wa.me
└── supabase/
    ├── migrations/
    │   ├── 20260926000001_modelo_dados.sql   # tabelas, gatilhos, RLS, cadastro/convites
    │   └── 20260926000002_rotina_cron.sql    # pg_cron -> rotina-diaria
    └── functions/
        ├── _shared/              # datajud, cnj, tribunais, relevancia, ia, sincronizar (+ testes)
        ├── consultar-processo/   # botão "Consultar agora"
        ├── testar-datajud/       # teste manual da API (não grava nada)
        ├── gerar-mensagem/       # gera/regenera texto, cria mensagem de movimentação antiga, prévia
        ├── enviar-email/         # envia mensagens por e-mail (Resend), uma ou várias
        └── rotina-diaria/        # chamada pelo cron
```

`_shared/cnj.ts` e `_shared/tribunais.ts` são puros e usados também pelo frontend (alias `@shared`).

## Modelo de dados

| Tabela | Conteúdo |
|---|---|
| `escritorios` | nome, oab_responsavel, telefone, assinatura, horario_consulta (+ campos de plano, para cobrança futura) |
| `usuarios` | 1:1 com `auth.users`, ligado a um escritório, papel `admin`/`membro` |
| `convites` | e-mails convidados para entrar num escritório |
| `clientes` | nome, telefone (WhatsApp, só dígitos com DDD), email, observações (+ `portal_ativo`, para o portal futuro) |
| `processos` | numero_cnj (20 dígitos), tribunal, cliente, apelido, ativo, ultima_consulta, ultima_tentativa, ultimo_erro |
| `movimentacoes` | codigo, nome, data_hora, complemento, relevancia, **hash único por processo** |
| `mensagens` | texto_gerado, texto_final (editável), status `pendente/aprovada/enviada/ignorada`, relevancia, enviada_em (+ `canal`, para a API oficial do WhatsApp) |
| `consultas_log` | toda consulta ao Datajud, com sucesso/erro, por processo |
| `rotina_execucoes` | resumo de cada execução da rotina por escritório |

### Isolamento entre escritórios (RLS)

- Toda tabela de dados tem `escritorio_id`. Ele é **preenchido por gatilho a partir do registro pai** (processo ← cliente,
  movimentação ← processo, mensagem ← movimentação); o valor enviado pelo navegador é ignorado.
- As políticas liberam apenas linhas com `escritorio_id = meu_escritorio_id()`.
- O navegador **não** insere movimentações nem mensagens, e só pode alterar `texto_final`, `status` e os carimbos
  de aprovação/envio (permissões por coluna). Campos de controle da consulta e de plano também são protegidos.
- O cadastro cria o escritório automaticamente (gatilho em `auth.users`); se o e-mail tiver convite, a pessoa entra
  no escritório que convidou.
- **LGPD:** excluir um cliente apaga em cascata processos, movimentações, mensagens e registros de consulta. A tela
  mostra antes quantos registros serão apagados (`resumo_exclusao_cliente`) e pede confirmação digitando o nome.

## Integração Datajud

- `POST https://api-publica.datajud.cnj.jus.br/api_publica_{alias}/_search` com
  `Authorization: APIKey $DATAJUD_API_KEY` e `{"query":{"match":{"numeroProcesso":"<20 dígitos>"}}}`.
- Sempre chamada pelas edge functions. A chave fica em `DATAJUD_API_KEY` (o CNJ troca de tempos em tempos; é só
  atualizar o segredo).
- `_shared/tribunais.ts` mapeia TJs, TRTs, TRFs, TREs, TJMs e superiores para o alias correto, e descobre o tribunal
  pelos segmentos J.TR do número CNJ (o formulário já sugere o tribunal).
- Movimentos de todos os registros retornados (1º e 2º grau) são unidos; datas nos dois formatos do Datajud são
  normalizadas; complementos tabelados viram texto.
- Timeout de 20 s, até 3 tentativas com espera exponencial em 429/5xx (respeitando `Retry-After`).
- Mensagens de erro em português são gravadas no processo (`ultimo_erro`) e no `consultas_log`.

**Teste manual:** em *Configurações → Testar conexão com o Datajud*, informe qualquer número e veja as movimentações
retornadas, sem gravar nada. Na página do processo há o botão **Consultar agora**.

## Rotina automática

- O `pg_cron` chama `rotina-diaria` **a cada 10 minutos**. A função só consulta os processos de um escritório depois
  do horário configurado (padrão 7h de Brasília) e só uma vez por dia por processo.
- Trabalha em lotes com limite de tempo (~110 s); o que não couber fica para a próxima chamada. Assim, muitos
  processos não estouram o tempo da edge function.
- Pausa entre consultas; se o Datajud falhar 4 vezes seguidas por erro temporário, a execução para e retoma na
  próxima chamada. Processos com erro são tentados de novo 1 h depois (até 3 vezes no dia).
- Uma falha num processo nunca derruba a rotina.
- **Primeira consulta** de um processo: grava todo o histórico, mas só gera mensagem para a movimentação mais recente,
  e só se for dos últimos 7 dias. Depois disso, no máximo 5 mensagens por consulta (as mais recentes).

## Mensagens com IA

- `_shared/ia.ts` usa o SDK da Anthropic com saída estruturada (`mensagem` + `relevancia`), modelo configurável em
  `ANTHROPIC_MODEL` (padrão `claude-opus-5`, com esforço baixo, pois a tarefa é curta).
- O prompt exige português simples, até ~400 caracteres, sem juridiquês, sem inventar prazos, valores ou resultados e
  sem prometer nada. A assinatura (ou o nome do escritório) é acrescentada pelo código.
- **Trava contra invenção:** se a resposta citar um número que não aparece nos dados da movimentação, ela é descartada
  e usa-se o texto-modelo.
- Sem `ANTHROPIC_API_KEY`, ou se a IA falhar ou recusar, usa-se um texto-modelo neutro (marcado como "texto padrão"
  na fila). A rotina nunca para por causa da IA.
- **Relevância:** uma regra fixa (`_shared/relevancia.ts`, por nome e código TPU) marca como *baixa* o que é
  burocrático (conclusos, juntada, expedição de certidão, remessa, ato ordinatório…) e como *normal* o que importa
  (sentença, audiência, acordo, alvará…). Nos casos indefinidos vale a classificação da IA. As de baixa relevância
  vão para uma aba separada da fila.

## Fila de mensagens

Abas: *Para revisar*, *Baixa relevância*, *Aprovadas*, *Enviadas*, *Ignoradas*. Cada cartão mostra cliente,
processo, a movimentação técnica e a mensagem, lado a lado (empilhados no celular).

- **Editar**, **Novo texto** (pede outra versão à IA), **Ignorar**, **Aprovar e enviar**.
- *Aprovar e enviar* abre `https://wa.me/55{telefone}?text={mensagem}` em nova aba e marca a mensagem como enviada.
- **Aprovar várias de uma vez:** selecione e aprove; elas vão para *Aprovadas*. O envio pelo WhatsApp é feito uma a
  uma, porque o navegador bloqueia várias abas abertas de uma vez.

## Envio por e-mail

- Botão **✉️ Enviar por e-mail** em cada cartão (só aparece se o cliente tiver e-mail e o Resend estiver configurado).
- **Envio em lote:** selecione várias mensagens (em *Para revisar*, *Baixa relevância* ou *Aprovadas*) e clique em
  *Enviar por e-mail*. Clientes sem e-mail são pulados.
- O e-mail sai com o nome do escritório como remetente, assunto "Novidade no processo: {apelido}" e o texto da
  mensagem. Se o escritório preencher *E-mail para respostas* em Configurações, as respostas vão para lá.
- A mensagem fica como *enviada* com `canal = 'email'`; se falhar, o erro aparece no cartão e ela continua na fila.
- **Modo teste (`EMAIL_TESTE_DESTINO`):** todo e-mail vai para esse endereço, com o assunto
  `[TESTE → cliente@...]`. Uma faixa amarela na fila avisa que o modo teste está ligado.
- No histórico do processo, movimentações sem mensagem têm o link **Criar mensagem para o cliente**: a IA escreve e a
  mensagem entra na fila (útil para avisar de algo antigo, e para testar).

## Como testar (passo a passo, sem instalar Docker)

1. **Supabase:** crie um projeto gratuito em <https://supabase.com>. Anote o *Project ref* e, em
   *Project Settings → API*, a URL e a chave `anon`.
2. **Resend:** crie uma conta gratuita em <https://resend.com> com o **seu e-mail** e gere uma API key
   (*API Keys → Create*). Não precisa verificar domínio para testar.
3. **Banco e funções** (na pasta `andamento/`):
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push
   cp supabase/functions/.env.example supabase/functions/.env
   ```
   Preencha o `.env`: `DATAJUD_API_KEY` (chave pública do CNJ), `ANTHROPIC_API_KEY` (opcional),
   `RESEND_API_KEY`, e **`EMAIL_TESTE_DESTINO` = o e-mail da sua conta Resend**. Depois:
   ```bash
   npx supabase secrets set --env-file supabase/functions/.env
   npx supabase functions deploy consultar-processo testar-datajud gerar-mensagem enviar-email
   npx supabase functions deploy rotina-diaria --no-verify-jwt
   ```
4. **Frontend:** `cp .env.example .env`, preencha URL e chave anon, `npm install` e `npm run dev`.
   Abra <http://localhost:5173>. (Para não depender do e-mail de confirmação, desligue *Confirm email* em
   *Authentication → Providers → Email* enquanto testa.)
5. **Roteiro:**
   1. Crie a conta do escritório.
   2. *Configurações → Testar conexão com o Datajud*: cole um número real (ex.: `0000832-35.2018.4.01.3202`, TRF1) e
      veja as movimentações.
   3. Cadastre um cliente **com e-mail** (pode ser um e-mail qualquer — no modo teste nada vai para ele).
   4. Cadastre um processo real para esse cliente. A primeira consulta roda sozinha.
   5. No histórico do processo, clique em **Criar mensagem para o cliente** numa movimentação.
   6. Vá em *Mensagens*: a faixa amarela confirma o modo teste. Clique em **✉️ Enviar por e-mail**.
   7. Confira sua caixa de entrada (e o spam): chega um e-mail com assunto `[TESTE → email-do-cliente] ...`.
      O painel do Resend (*Emails*) também mostra o envio.
   8. A mensagem vai para a aba *Enviadas* como "enviada por e-mail". Repita com várias e teste o envio em lote.
6. **Para enviar de verdade para clientes:** verifique um domínio no Resend (*Domains*), defina
   `EMAIL_REMETENTE=avisos@seudominio.com.br`, **apague** `EMAIL_TESTE_DESTINO` e rode `supabase secrets set` de novo.

## Como rodar

### 1. Supabase

```bash
npm i -g supabase            # ou use npx supabase
supabase login
supabase link --project-ref <ref>
supabase db push             # aplica as migrations
```

No SQL Editor, guarde os segredos usados pelo cron:

```sql
select vault.create_secret('https://<ref>.supabase.co', 'andamento_project_url');
select vault.create_secret('<segredo-longo-aleatorio>', 'andamento_cron_secret');
```

(Aplique a migration do cron depois de criar os segredos, ou apenas crie-os depois: a função lê os segredos a cada
execução.)

### 2. Edge functions

```bash
cp supabase/functions/.env.example supabase/functions/.env   # preencha
supabase secrets set --env-file supabase/functions/.env
supabase functions deploy consultar-processo testar-datajud gerar-mensagem enviar-email
supabase functions deploy rotina-diaria --no-verify-jwt
```

- `DATAJUD_API_KEY`: chave pública divulgada em <https://datajud-wiki.cnj.jus.br/api-publica/acesso>
- `ANTHROPIC_API_KEY`: chave da API da Anthropic (opcional; sem ela usa texto-modelo)
- `CRON_SECRET`: o mesmo valor de `andamento_cron_secret`
- `RESEND_API_KEY`, `EMAIL_REMETENTE`, `EMAIL_TESTE_DESTINO`: envio por e-mail (veja "Como testar")

### 3. Frontend

```bash
cp .env.example .env          # VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Em *Authentication → URL Configuration* do Supabase, cadastre a URL do app (para confirmação de e-mail e
recuperação de senha).

### Testes

```bash
npm run build                 # typecheck + build do frontend
deno test supabase/functions/_shared/   # validação CNJ, tribunais, relevância, datas, hash
```

## Preparado para depois (não implementado)

- **Envio automático pela API oficial do WhatsApp:** `mensagens.canal` (`whatsapp_link` | `whatsapp_api` | `email`) e o fluxo
  de status já separam *aprovada* de *enviada*; basta um worker que envie as aprovadas.
- **Cobrança/assinatura:** `escritorios.plano` e `plano_expira_em` (não editáveis pelo navegador).
- **Portal do cliente:** `clientes.portal_ativo`; as mensagens enviadas já formam o histórico a exibir.
