# Contrato de dados — KeyToTwo Print (D2a, v0.2)

| | |
| --- | --- |
| Versão | 0.2.2, 2026-10-08. A v0.1 foi revisada pelo Ferrolho e o orquestrador aprovou 9 ajustes (seção 13); a v0.2.1 aplica o D-12 (`service_role` sem `SELECT` em tabelas, exceto `email_outbox`); a v0.2.2 acrescenta `email_outbox.product_name`. |
| Dono | Lastro (Dados e Supabase). Consumidor: Ferrolho (`docs/api-contract.md`, Edge Functions). |
| Escopo | Referência para as migrações do I2/I4. **Nenhuma migração, nenhuma escrita remota.** |
| Ambiente | Postgres 17 (projeto de teste `keytotwo-print-db`, sa-east-1, plano Free). Desenvolvimento local com Supabase CLI. |
| Fontes | Plano do site P1 (§3 e ajustes do orquestrador, que prevalecem), `Site - Compra e acesso`, `P001`, skills `supabase` e `supabase-postgres-best-practices`. |
| Verificado | Os blocos `-- @ddl` e os stubs das 11 assinaturas aplicam sem erro em Postgres 17.11 (contêiner descartável, mesma versão do projeto, com GRANT automático emulado) e **114 verificações passaram** (v0.1: 93; v0.2: +13; v0.2.1: +3, `service_role` sem `SELECT` fora de `email_outbox`; v0.2.2: +5, `email_outbox.product_name`): CHECKs (inclusive `failed` sem e-mail), FKs compostas, índices únicos parciais, RLS/policies, privilégios por papel, ACL das 11 RPCs, `p_livemode` obrigatório em `create_order`, `p_payment_intent_id` NULL, retornos de `create_order` e `get_order_status`, índice de toda FK, ausência de colunas de URL/IP e ACL/RLS de uma tabela sósia da `public.test` inalterados. |
| Não verificado | Corpo das RPCs, triggers de `private`, seed, arquivos pgTAP e concorrência: são desenho, a implementar e testar no I2/I4. Regras de plataforma (Data API, Auth) não foram lidas do projeto. |

Os blocos `sql` marcados com `-- @ddl` são o DDL de referência (exequível). Os demais são assinaturas e exemplos. Preço, nome comercial, prazo de acesso, licença e política de reembolso **não são decididos aqui**: aparecem como `PENDENTE` (seção 11).

## 0. Decisões (resumo)

| # | Decisão | Por quê |
| --- | --- | --- |
| D-1 | **Zero acesso direto do cliente.** `anon` e `authenticated` não têm GRANT em nenhuma tabela, sequência ou função deste contrato. RLS ligada em todas, com uma policy `deny_client_access`. | Ajuste 3 do orquestrador (tabelas sensíveis sem grant) e mudança da Data API em 2026-10-30. Diverge do esboço §3 (leitura dos próprios pedidos pelo `authenticated`); a leitura passa pela API. |
| D-2 | **Toda escrita passa por RPC** `SECURITY DEFINER` com `EXECUTE` só para `service_role`. Única exceção: colunas de envio em `email_outbox`. | Invariantes ficam no banco e testáveis por pgTAP; um bug de rota não consegue gravar estado inválido. |
| D-3 | **Idempotência em 3 camadas:** PK do evento Stripe, constraints únicas (sessão, intent, acesso, e-mail) e trava `FOR UPDATE` da linha do pedido. | Evento repetido, webhook e página de retorno simultâneos não duplicam pedido, acesso nem e-mail. |
| D-4 | O evento Stripe é gravado **na mesma transação do efeito** (dentro de `fulfill_order`/`set_order_status`), não antes. | Refina o esboço §2.1: evita evento "registrado e não processado". Falha antes do commit = Stripe reenvia. |
| D-5 | **Comprar ≠ poder baixar.** `orders.status` (pagamento) e `entitlements.status` (acesso) são estados separados, ligados por uma invariante diferida (I-5). | Regra de `Compra e acesso`: reembolso, contestação e atraso de liberação têm estado próprio. |
| D-6 | Composição do pacote **congelada** em `entitlement_games` na compra. Os arquivos servidos são a versão **publicada vigente** de cada jogo (P-2). | "Não substituir silenciosamente um jogo comprado". Política de atualizações segue pendente. |
| D-7 | Chave do B2 só em `file_objects`, sem URL, com prefixo igual a `access`. FKs compostas impedem arquivo grátis em jogo pago e jogo grátis em pacote. | Conteúdo pago nunca vira URL pública; o jogo grátis não vaza o pacote. |
| D-8 | IDs: `uuid` (v4) nas entidades que aparecem na API (`orders`, `entitlements`, `files`, `email_outbox`); `bigint identity` no catálogo e nos logs. Texto + `CHECK`, sem `ENUM`. | Opaco contra enumeração; volume baixo torna a fragmentação irrelevante. PG17 não tem `uuidv7()` nativo. |
| D-9 | **Gate de venda no banco:** `create_order` só aceita produto `active` com todos os jogos publicados e PDF pago publicado (`products.games_expected`). | "Vender o pacote completo quando os cinco conteúdos estiverem disponíveis." |
| D-10 | Além das 3 RPCs pedidas, 8 auxiliares: `create_order`, `attach_checkout_session`, `get_library`, `get_account`, `get_order_status`, `resolve_download`, `get_free_game`, `resolve_free_download`. | A regra de direito de download e a chave do B2 ficam em SQL testável; a rota só assina a URL. Nenhuma rota lê tabela (D-12). |
| D-11 | `public.test` intocada. Nenhuma migração usa `alter default privileges` nem `GRANT/REVOKE ... ON ALL ... IN SCHEMA public` (seção 10). | Restrição permanente do responsável (keep-alive externo). |
| D-12 | **`service_role` não tem `SELECT` em nenhuma tabela, exceto `email_outbox`.** Toda leitura passa pelas RPCs; suporte e testes leem como dono (`postgres`). | Menor privilégio: com `get_library`, `get_account`, `get_order_status`, `create_order` e `resolve_*`, nenhuma rota precisa de `SELECT`. Aprovado pelo orquestrador (antes P-14). O envio do e-mail lê só `email_outbox`, que guarda `to_email` e `product_name` como fotografia. |

## 1. Convenções e fronteiras

- **Schemas.** `public`: tabelas e RPCs (único schema que a Data API expõe). `private`: funções auxiliares e de trigger, sem acesso para nenhum papel de API.
- **Nomes.** `snake_case`, tabelas no plural, constraints nomeadas `<tabela>_<coluna>_<tipo>`. `position` é aceito como nome de coluna no Postgres.
- **Tempo e dinheiro.** `timestamptz` em tudo. Valores em `bigint` na menor unidade da moeda (centavos), moeda em `text` de 3 letras minúsculas como a Stripe (`brl`). O banco **não guarda preço de vitrine**: o preço cobrado é o Price da Stripe.
- **E-mail.** Sempre `lower(btrim(...))`. As RPCs normalizam; o `CHECK` é a rede de segurança. Não normalizamos pontos nem `+tag` (são endereços distintos).
- **Referência do pedido** mostrada ao usuário: derivada, `upper(left(replace(id::text,'-',''),8))`. Sem coluna.
- **Erros de contrato** das RPCs: `SQLSTATE` da classe `KT` (tabela na seção 6.1). Resultados esperados de negócio (duplicado, não encontrado, adiado) **não** são erros: voltam no campo `outcome`.
- **Implementação das RPCs:** `language plpgsql`, `security definer`, `set search_path = ''`, tudo qualificado (`public.`, `auth.`, `private.`), dono `postgres`. Colunas de retorno (`order_id`...) colidem com colunas de tabela: usar `#variable_conflict use_column` ou qualificar.
- **Migrações** (regras de segurança, seção 10): só objetos nomeados; GRANT/REVOKE explícitos por objeto; todo `drop`+`create` de função repete o `REVOKE`/`GRANT` (o Postgres e a plataforma reaplicam padrões na criação).

## 2. Entidades

### 2.1 Fundação

```sql
-- @ddl
create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;
```

### 2.2 Catálogo: `products`, `games`, `product_games`

`products` é a unidade de venda (P001). `games` são os componentes. `games.access` separa jogo do pacote (`paid`) do jogo gratuito (`free`).

```sql
-- @ddl
create table public.products (
  id              bigint generated always as identity primary key,
  code            text not null unique,
  slug            text not null unique,
  name            text,                      -- nome comercial: PENDENTE até decisão do responsável
  status          text not null default 'draft',
  stripe_price_id text unique,               -- por ambiente (P-5); nunca é preço de vitrine
  games_expected  smallint,                  -- P001 = 5; trava a venda de composição incompleta
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint products_code_check   check (code ~ '^P[0-9]{3}$'),
  constraint products_slug_check   check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint products_name_check   check (name is null or btrim(name) <> ''),
  constraint products_status_check check (status in ('draft', 'active', 'archived')),
  constraint products_price_check  check (stripe_price_id is null or stripe_price_id ~ '^price_[A-Za-z0-9_]+$'),
  constraint products_games_expected_check check (games_expected is null or games_expected > 0),
  constraint products_active_requires_data check (
    status <> 'active' or (name is not null and stripe_price_id is not null and games_expected is not null))
);

-- @ddl
create table public.games (
  id         bigint generated always as identity primary key,
  code       text not null unique,
  slug       text not null unique,
  name       text not null,
  access     text not null default 'paid',
  status     text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint games_code_check   check (code ~ '^[A-Z][A-Z0-9-]{1,23}$'),
  constraint games_slug_check   check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint games_name_check   check (btrim(name) <> ''),
  constraint games_access_check check (access in ('paid', 'free')),
  constraint games_status_check check (status in ('draft', 'published')),
  constraint games_id_access_key unique (id, access)   -- alvo das FKs compostas
);
-- no máximo UM jogo gratuito publicado (singular em "O site terá um jogo gratuito"; P-10)
create unique index games_one_published_free on public.games ((true))
  where access = 'free' and status = 'published';

-- @ddl
create table public.product_games (
  product_id  bigint   not null references public.products (id),
  game_id     bigint   not null,
  game_access text     not null default 'paid',
  position    smallint not null,
  primary key (product_id, game_id),
  constraint product_games_position_check check (position >= 1),
  constraint product_games_paid_only      check (game_access = 'paid'),
  constraint product_games_position_key   unique (product_id, position),
  constraint product_games_game_fkey foreign key (game_id, game_access) references public.games (id, access)
);
create index product_games_game_id_idx on public.product_games (game_id);
```

### 2.3 Arquivos: `files` e `file_objects` (metadados do B2)

`files` descreve o arquivo (versão, tamanho, checksum, estado). `file_objects` guarda **onde** ele está no B2. Detalhes e ciclo de publicação na seção 7.

```sql
-- @ddl
create table public.files (
  id           uuid primary key default gen_random_uuid(),
  game_id      bigint,
  product_id   bigint references public.products (id),   -- ZIP do pacote (futuro)
  kind         text   not null,
  access       text   not null,
  version      text   not null,
  filename     text   not null,                           -- nome mostrado no download
  size_bytes   bigint not null,
  sha256       text   not null,                           -- hex minúsculo do conteúdo
  status       text   not null default 'draft',
  published_at timestamptz,
  retired_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint files_game_fkey foreign key (game_id, access) references public.games (id, access),
  constraint files_id_access_key unique (id, access),
  constraint files_owner_check check (
    (game_id is not null and product_id is null)
    or (game_id is null and product_id is not null and access = 'paid')),
  constraint files_kind_check    check (kind in ('pdf', 'zip')),
  constraint files_access_check  check (access in ('paid', 'free')),
  constraint files_version_check check (version ~ '^[0-9]+\.[0-9]+(\.[0-9]+)?$'),
  constraint files_filename_check check (
    char_length(filename) between 5 and 200
    and filename !~ '[/\\[:cntrl:]]'
    and lower(filename) like ('%.' || kind)),
  constraint files_size_check   check (size_bytes > 0),
  constraint files_sha256_check check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint files_status_check check (status in ('draft', 'published', 'retired')),
  constraint files_status_dates_check check (
    (status = 'draft'     and published_at is null     and retired_at is null) or
    (status = 'published' and published_at is not null and retired_at is null) or
    (status = 'retired'   and published_at is not null and retired_at is not null))
);
create unique index files_game_version_key    on public.files (game_id, kind, access, version) where game_id is not null;
create unique index files_product_version_key on public.files (product_id, kind, version)      where product_id is not null;
-- um único arquivo publicado por (jogo, tipo, acesso) e por (pacote, tipo)
create unique index files_one_published_per_game    on public.files (game_id, kind, access)
  where status = 'published' and game_id is not null;
create unique index files_one_published_per_product on public.files (product_id, kind)
  where status = 'published' and product_id is not null;

-- @ddl
create table public.file_objects (
  file_id     uuid primary key,
  access      text not null,                       -- espelha files.access (FK composta)
  bucket      text not null,
  object_key  text not null,
  b2_file_id  text,                                -- fileId nativo do B2, opcional
  uploaded_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint file_objects_file_fkey foreign key (file_id, access) references public.files (id, access) on delete cascade,
  constraint file_objects_bucket_check check (bucket ~ '^[A-Za-z0-9-]{6,50}$'),
  -- lista branca: sem esquema (https:), sem "?", sem espaço; prefixo = acesso
  constraint file_objects_key_check check (
    char_length(object_key) <= 1024
    and object_key ~ '^(paid|free)/[A-Za-z0-9._/-]+$'
    and object_key !~ '\.\.'
    and left(object_key, char_length(access) + 1) = access || '/'),
  constraint file_objects_location_key unique (bucket, object_key)
);
```

### 2.4 Pedidos: `orders` e `order_events`

```sql
-- @ddl
create table public.orders (
  id                         uuid primary key default gen_random_uuid(),   -- vai em client_reference_id e é a chave de idempotência da Stripe
  user_id                    uuid references auth.users (id) on delete set null,
  email                      text,                 -- e-mail do checkout (normalizado); vazio até o checkout informar
  product_id                 bigint not null references public.products (id),
  status                     text   not null default 'open',
  amount_total               bigint,
  currency                   text,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id   text unique,
  livemode                   boolean not null,
  checkout_expires_at        timestamptz,
  paid_at                    timestamptz,
  refunded_at                timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint orders_id_product_key unique (id, product_id),   -- alvo da FK composta de entitlements
  constraint orders_status_check check (status in
    ('open', 'pending_payment', 'paid', 'failed', 'expired', 'refunded', 'disputed')),
  constraint orders_email_check check (
    email is null or (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  constraint orders_email_required check (status in ('open', 'expired', 'failed') or email is not null),   -- failed pode vir de open, sem e-mail
  constraint orders_money_pair     check ((amount_total is null) = (currency is null)),
  constraint orders_amount_check   check (amount_total is null or amount_total >= 0),
  constraint orders_currency_check check (currency is null or currency ~ '^[a-z]{3}$'),
  constraint orders_session_check  check (stripe_checkout_session_id is null or stripe_checkout_session_id ~ '^cs_(test|live)_[A-Za-z0-9_]+$'),
  constraint orders_intent_check   check (stripe_payment_intent_id is null or stripe_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
  constraint orders_amount_required check (
    status not in ('pending_payment', 'paid', 'refunded', 'disputed') or amount_total is not null),
  constraint orders_paid_at_check     check ((status in ('paid', 'refunded', 'disputed')) = (paid_at is not null)),
  constraint orders_refunded_at_check check ((status = 'refunded') = (refunded_at is not null))
);
create index orders_user_id_idx on public.orders (user_id) where user_id is not null;
create index orders_unclaimed_email_idx on public.orders (email) where user_id is null and email is not null;
create index orders_product_id_idx on public.orders (product_id);
create index orders_stale_idx on public.orders (created_at) where status in ('open', 'pending_payment');

-- @ddl
-- Trilha de transições (append-only). Sem dado pessoal.
create table public.order_events (
  id               bigint generated always as identity primary key,
  order_id         uuid not null references public.orders (id),
  from_status      text,
  to_status        text not null,
  source           text not null,
  stripe_event_id  text,
  reason           text,
  created_at       timestamptz not null default now(),
  constraint order_events_source_check check (source in ('checkout', 'webhook', 'return_page', 'reconcile', 'system')),
  constraint order_events_reason_check check (reason is null or char_length(reason) <= 200)
);
create index order_events_order_id_idx on public.order_events (order_id, id);
```

### 2.5 Acesso: `entitlements` e `entitlement_games`

`entitlements` é o **direito de baixar**. O dono é sempre `orders.user_id` (fonte única; sem `user_id` duplicado aqui). Um pedido gera no máximo um direito.

```sql
-- @ddl
create table public.entitlements (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid   not null,
  product_id    bigint not null,
  status        text   not null default 'active',
  granted_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  revoke_reason text,
  expires_at    timestamptz,            -- reservado (P-3): no P1 é sempre NULL; NULL = sem expiração
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint entitlements_order_product_fkey foreign key (order_id, product_id) references public.orders (id, product_id),
  constraint entitlements_order_product_key unique (order_id, product_id),
  constraint entitlements_status_check check (status in ('active', 'revoked')),
  constraint entitlements_reason_check check (revoke_reason is null or revoke_reason in ('refund', 'dispute', 'manual')),
  constraint entitlements_state_check check (
    (status = 'active'  and revoked_at is null     and revoke_reason is null) or
    (status = 'revoked' and revoked_at is not null and revoke_reason is not null))
);
create index entitlements_product_id_idx on public.entitlements (product_id);

-- @ddl
-- Fotografia da composição na compra. Imutável.
create table public.entitlement_games (
  entitlement_id uuid     not null references public.entitlements (id),
  game_id        bigint   not null references public.games (id),
  position       smallint not null,
  primary key (entitlement_id, game_id),
  constraint entitlement_games_position_check check (position >= 1)
);
create index entitlement_games_game_id_idx on public.entitlement_games (game_id);
```

### 2.6 Eventos e e-mail: `stripe_events`, `email_outbox`, `download_events`

```sql
-- @ddl
-- Livro-razão de idempotência. Sem payload (evita dado pessoal). Escrito só pelas RPCs, na transação do efeito.
create table public.stripe_events (
  id               text primary key,             -- evt_...
  type             text not null,
  livemode         boolean not null,
  stripe_object_id text,                         -- cs_..., ch_..., dp_...
  order_id         uuid references public.orders (id),
  outcome          text not null,
  received_at      timestamptz not null default now(),
  constraint stripe_events_id_check check (id ~ '^evt_[A-Za-z0-9_]+$'),
  constraint stripe_events_outcome_check check (outcome in ('applied', 'noop', 'ignored', 'not_found'))
);
create index stripe_events_order_id_idx on public.stripe_events (order_id) where order_id is not null;

-- @ddl
create table public.email_outbox (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders (id),
  kind                text not null,
  to_email            text not null,             -- destinatário: e-mail da conta (comprador logado) ou do pedido
  product_name        text not null,             -- nome do pacote na compra; o envio não lê outra tabela (D-12)
  status              text not null default 'queued',
  attempts            integer not null default 0,
  last_error          text,                      -- sem e-mail nem token
  provider_message_id text,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  updated_at          timestamptz not null default now(),
  constraint email_outbox_order_kind_key unique (order_id, kind),
  constraint email_outbox_kind_check   check (kind in ('access')),
  constraint email_outbox_status_check check (status in ('queued', 'sending', 'sent', 'failed')),
  constraint email_outbox_attempts_check check (attempts >= 0),
  constraint email_outbox_product_name_check check (btrim(product_name) <> ''),
  constraint email_outbox_error_check  check (last_error is null or char_length(last_error) <= 500),
  constraint email_outbox_to_check     check (to_email = lower(btrim(to_email)) and to_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint email_outbox_sent_check   check ((status = 'sent') = (sent_at is not null))
);
create index email_outbox_pending_idx on public.email_outbox (created_at) where status in ('queued', 'sending', 'failed');

-- @ddl
-- Sem IP, sem user agent. Escrito só por resolve_download/resolve_free_download (append-only).
create table public.download_events (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users (id) on delete set null,   -- NULL no gratuito (e se a conta for apagada)
  file_id    uuid not null references public.files (id),
  kind       text not null,
  created_at timestamptz not null default now(),
  constraint download_events_kind_check check (kind in ('paid', 'free'))
);
create index download_events_file_idx on public.download_events (file_id, created_at);
create index download_events_user_idx on public.download_events (user_id, created_at) where user_id is not null;
```

### 2.7 Funções e triggers internos (schema `private`)

Sem GRANT para nenhum papel de API. Disparam como parte das operações; a checagem de `EXECUTE` de trigger ocorre só na criação.

| Objeto | Onde | Regra |
| --- | --- | --- |
| `private.set_updated_at()` | `products`, `games`, `files`, `orders`, `entitlements`, `email_outbox` (BEFORE UPDATE) | `new.updated_at := now()` |
| `private.guard_order_changes()` | `orders` (BEFORE UPDATE) | (a) transições só pelas arestas da seção 4.1, senão `KT006`; (b) imutáveis: `id`, `product_id`, `livemode`, `created_at`; (c) `user_id` pode passar de NULL para valor, nunca mudar depois, salvo `set local keytotwo.allow_reassign = 'on'` (atendimento, só sessão privilegiada); (d) `stripe_checkout_session_id` e `stripe_payment_intent_id` não mudam depois de preenchidos. |
| `private.assert_order_entitlement_consistency()` | `orders` e `entitlements` (trigger de restrição `DEFERRABLE INITIALLY DEFERRED`, AFTER INSERT/UPDATE) | Invariante I-5: existe direito `active` para o pedido **se e somente se** `orders.status = 'paid'`; pedido `refunded`/`disputed` com direito `active` é erro. Alterar a política P-1 = mudar só esta função e `private.access_effect`. |
| `private.guard_file_changes()` | `files` (BEFORE UPDATE) | `status` só avança: `draft→published→retired`. Depois de `draft`, `game_id`, `product_id`, `kind`, `access`, `version`, `filename`, `size_bytes` e `sha256` são imutáveis (conteúdo novo = versão nova). Preenche `published_at`/`retired_at` se vierem nulos. |
| `private.guard_file_object_changes()` | `file_objects` (BEFORE UPDATE/DELETE) | `bucket` e `object_key` imutáveis quando o arquivo não é `draft`. |
| `private.forbid_modification()` | `order_events`, `download_events`, `stripe_events` (BEFORE UPDATE/DELETE); `entitlement_games` (BEFORE UPDATE) | Append-only: levanta `KT008`. |
| `private.product_is_sellable(bigint)` | usada por `create_order` | `products.status='active'`, `stripe_price_id` e `games_expected` preenchidos, `count(product_games) = games_expected`, e cada jogo `published` com PDF `paid` `published`. |
| `private.access_effect(text)` | usada por `set_order_status` | Mapa estado do pedido → efeito no direito: `paid→active`, `refunded→revoked(refund)`, `disputed→revoked(dispute)`, demais→nenhum. **Proposta; confirmar em P-1.** |
| `private.normalize_email(text)` | RPCs | `lower(btrim(x))`; `NULL` se vazio. |
| `private.claimable_email(uuid)` | `claim_orders`, `get_order_status` | Regra **única** de vínculo: devolve o e-mail normalizado do usuário se ele existe, não está removido (`deleted_at`), tem e-mail e `email_confirmed_at` não nulo; senão `NULL`. |

## 3. Invariantes

| # | Garantia | Mecanismo |
| --- | --- | --- |
| I-1 | Um pedido tem um produto e gera no máximo um direito. | `orders.product_id NOT NULL`; `entitlements unique (order_id, product_id)` + FK composta |
| I-2 | Uma sessão ou intent da Stripe pertence a um único pedido. | `unique` em `stripe_checkout_session_id` e `stripe_payment_intent_id` |
| I-3 | Um evento Stripe tem efeito no máximo uma vez. | PK de `stripe_events` + checagem sob a trava do pedido |
| I-4 | No máximo um e-mail de acesso por pedido. | `unique (order_id, kind)` + `ON CONFLICT DO NOTHING` |
| I-5 | Direito `active` ⇔ pedido `paid`. Pagamento e acesso nunca divergem no commit. | Trigger de restrição diferido |
| I-6 | Transições de pedido só avançam pelas arestas da seção 4. | `guard_order_changes` (vale para RPC e SQL direto) |
| I-7 | Composição comprada não muda. | `entitlement_games` append-only, sem FK de volta para `product_games` |
| I-8 | Um arquivo publicado por (jogo, tipo, acesso) e por (pacote, tipo). No máximo um jogo grátis publicado. | Índices únicos parciais |
| I-9 | Arquivo herda o `access` do jogo; jogo grátis nunca entra em pacote. | FKs compostas `(game_id, access)` |
| I-10 | Chave do B2: sem URL, sem `..`, prefixo igual a `access`, única. | `file_objects_key_check`, `file_objects_location_key` |
| I-11 | Nenhuma coluna guarda URL (pública ou assinada). `download_events` não tem IP. | Revisão de schema + teste pgTAP T08 |
| I-12 | Logs de pedido/download/evento não se alteram. | `forbid_modification` |
| I-13 | Só se vende produto completo e publicado. | `product_is_sellable` em `create_order` |
| I-14 | E-mail armazenado sempre normalizado. | `CHECK` + `normalize_email` |

## 4. Estados e transições

### 4.1 Pedido (`orders.status`)

```
open            → pending_payment | paid | failed | expired
pending_payment → paid | failed
paid            → refunded | disputed
disputed        → paid | refunded
expired, failed, refunded: terminais
```

| De → Para | Quem aplica | Gatilho (Stripe / fluxo) | Efeito no direito | Observação |
| --- | --- | --- | --- | --- |
| (novo) → `open` | `create_order` | Clique em Comprar | nenhum | Sem e-mail para comprador anônimo; com e-mail se logado |
| `open` → `pending_payment` | `set_order_status` | `checkout.session.completed` com `payment_status='unpaid'` (método assíncrono) | nenhum | Exige e-mail e valor |
| `open` → `paid` | `fulfill_order` | `checkout.session.completed` com `payment_status='paid'`; ou retorno/order-status | **cria** direito `active` + fotografia + linha de e-mail | Único caminho para `paid` a partir de `open` |
| `pending_payment` → `paid` | `fulfill_order` | `checkout.session.async_payment_succeeded` | idem | |
| `pending_payment` → `failed` | `set_order_status` | `checkout.session.async_payment_failed` | nenhum | Terminal; nova tentativa = novo pedido |
| `open` → `failed` | `set_order_status` | `checkout.session.async_payment_failed` que chega antes do `completed` (a Stripe não garante a ordem) | nenhum | Terminal. Não exige e-mail (CHECK) |
| `open` → `expired` | `set_order_status` | `checkout.session.expired` | nenhum | Terminal |
| `paid` → `refunded` | `set_order_status` | `charge.refunded` (reembolso **total**) | `revoked (refund)` | P-1. Reembolso parcial não muda estado (P-7) |
| `paid` → `disputed` | `set_order_status` | `charge.dispute.created` (depois do P1) | `revoked (dispute)` | P-1 |
| `disputed` → `paid` | `set_order_status` | disputa vencida | **reativa** (`revoked`→`active`) | |
| `disputed` → `refunded` | `set_order_status` | disputa perdida / reembolso | permanece `revoked`, motivo vira `refund` | |

Qualquer outro par: via RPC o resultado é `outcome='ignored'` (nada muda, evento registrado); via SQL direto, `KT006`. `refunded`, `failed` e `expired` são terminais.

**Eventos fora de ordem.** `refunded` ou `disputed` com o pedido ainda `open` ou `pending_payment` (o evento de cobrança chegou antes da liberação) devolvem `outcome='deferred'`: nada muda e o evento **não** é gravado em `stripe_events`. A rota responde `500` e a Stripe reenvia; depois de `fulfill_order`, o mesmo evento é `applied`. Com o pedido `failed` ou `expired`, continua `ignored`. Se a ordem nunca se resolver, a Stripe desiste do reenvio e a reconciliação é manual (`p_source='reconcile'`).

Mapeamento estado do banco → resposta de `order-status` é do `api-contract.md` (Ferrolho).

### 4.2 Direito (`entitlements.status`)

| De → Para | Quem | Quando |
| --- | --- | --- |
| (nenhum) → `active` | `fulfill_order` | Pagamento confirmado |
| `active` → `revoked` | `set_order_status` | Reembolso total ou contestação (motivo `refund`/`dispute`) |
| `revoked` → `active` | `set_order_status` | Disputa vencida (`disputed→paid`) |
| qualquer → `revoked (manual)` / restauração manual | SQL de atendimento | Fora das RPCs no P1 (P-4 / atendimento) |

Direito nunca é apagado. Com `expires_at` preenchido (P-3), vale `expires_at > now()` além de `active`.

### 4.3 Outros estados

| Entidade | Estados | Regra |
| --- | --- | --- |
| `products.status` | `draft → active → archived` | `active` exige nome, `stripe_price_id` e `games_expected` (CHECK). Ativar em produção é ato manual do responsável. |
| `games.status` | `draft ↔ published` | Publicado só com ao menos um PDF `published` (verificado por `product_is_sellable` e pelos resolvers). |
| `files.status` | `draft → published → retired` | Avança só para frente (`guard_file_changes`). |
| `email_outbox.status` | `queued → sending → sent \| failed`; `failed → queued` (reenvio); `sending → queued` (resgate de travado) | O chamador que criou a linha envia após o commit; cron de reenvio fica fora deste ciclo (P-9). |

## 5. Matriz de acesso

**Papéis:** `anon` (sem sessão), `authenticated` (sessão), `service_role` (backend; ignora RLS). `postgres` é o dono e executa as RPCs `SECURITY DEFINER`.

### 5.1 Tabelas

| Tabela | anon | authenticated | service_role | RLS / policy |
| --- | --- | --- | --- | --- |
| `products`, `games`, `product_games`, `files`, `entitlement_games` | nada | nada | **nada** (só as RPCs leem) | RLS on; `deny_client_access` |
| `file_objects` | nada | nada | **nada** (só as RPCs `resolve_*` leem) | RLS on; `deny_client_access` |
| `orders`, `entitlements`, `order_events`, `stripe_events`, `download_events` | nada | nada | **nada** (só as RPCs leem) | RLS on; `deny_client_access` |
| `email_outbox` | nada | nada | `SELECT` + `UPDATE (status, attempts, last_error, provider_message_id, sent_at, updated_at)` | RLS on; `deny_client_access` |

- `INSERT`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` não são concedidos a ninguém além do dono.
- Sequências (`*_id_seq` das identidades): nenhum papel. As escritas passam por RPC `DEFINER`, que roda como dono.
- `service_role` só tem privilégio de tabela em `email_outbox` (`SELECT` e `UPDATE` das colunas de envio; `to_email` e `product_name` não são atualizáveis). As leituras passam por `get_library`, `get_account`, `get_order_status`, `create_order` (que devolve o `stripe_price_id`) e `resolve_*` (D-12). Suporte, diagnóstico e testes de API que contam linhas usam o dono (`postgres`, via `psql`/SQL Editor), não a chave secreta.
- `deny_client_access`: `for all to anon, authenticated using (false) with check (false)`. Redundante com a ausência de GRANT de propósito (defesa em profundidade, documenta a intenção e silencia o aviso `rls_enabled_no_policy`). `service_role` não precisa de policy.

```sql
-- @ddl
-- Modelo de migração: lista FIXA de tabelas (nunca "all tables in schema public": atingiria public.test).
do $$
declare t text;
begin
  foreach t in array array[
    'products','games','product_games','files','file_objects','orders','order_events',
    'entitlements','entitlement_games','stripe_events','email_outbox','download_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format($p$create policy deny_client_access on public.%I as permissive
                      for all to anon, authenticated using (false) with check (false)$p$, t);
  end loop;
end $$;

grant select on public.email_outbox to service_role;   -- única tabela com SELECT para a API (D-12)
grant update (status, attempts, last_error, provider_message_id, sent_at, updated_at)
  on public.email_outbox to service_role;

-- identidades (reverte o padrão da plataforma, caso o projeto ainda o aplique)
revoke all on sequence public.products_id_seq, public.games_id_seq,
                       public.order_events_id_seq, public.download_events_id_seq
  from public, anon, authenticated, service_role;
```

### 5.2 Funções

| Função | anon | authenticated | service_role |
| --- | --- | --- | --- |
| as 11 RPCs da seção 6 | nada | nada | `EXECUTE` |
| `private.*` | nada | nada | nada (só o dono) |

```sql
-- Modelo por RPC (repetir em toda migração que recriar a função). Exemplo:
revoke all on function public.fulfill_order(uuid, text, text, text, bigint, text, text, boolean, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.fulfill_order(uuid, text, text, text, bigint, text, text, boolean, text, text)
  to service_role;
```

Tipos das 11 assinaturas (para `REVOKE`/`GRANT` e para `has_function_privilege` nos testes):

```
fulfill_order(uuid, text, text, text, bigint, text, text, boolean, text, text)
set_order_status(uuid, text, text, text, text, text, bigint, text, text)
claim_orders(uuid)
create_order(text, boolean, uuid, text)
attach_checkout_session(uuid, text, timestamptz)
get_library(uuid)
get_account(uuid)
get_order_status(uuid, uuid)
resolve_download(uuid, uuid)
get_free_game()
resolve_free_download(uuid)
```

### 5.3 Regra da Data API (vale para tudo)

Desde 2026-10-30 tabelas novas em `public` não recebem GRANT automático. Este contrato **nunca depende do padrão da plataforma**: cada objeto novo recebe `REVOKE ALL` e os GRANTs da matriz. Funciona nos dois regimes (com ou sem GRANT automático). O padrão do projeto (Data API → "Automatically expose new tables") não foi lido; não é necessário. Se um dia o cliente precisar ler algo direto (P-6): `GRANT SELECT (colunas)` + policy `to authenticated using ((select auth.uid()) = user_id)` + índice em `user_id` (já existe em `orders`).

## 6. RPCs

Todas: `security definer`, `search_path=''`, `EXECUTE` só `service_role`, chamadas pelo backend com a chave secreta. O backend autentica o usuário (JWT) e passa o `user_id` já verificado; nenhuma RPC confia em dado do navegador.

### 6.1 Códigos de erro (`SQLSTATE`)

| Código | Nome | Quando | HTTP no PostgREST |
| --- | --- | --- | --- |
| `KT001` | `invalid_argument` | Argumento nulo, fora do formato ou valor desconhecido | 400 |
| `KT002` | `payment_not_confirmed` | `fulfill_order` com `p_payment_status <> 'paid'`, inclusive `no_payment_required` (cupom de 100%: não há pagamento a confirmar) | 400 |
| `KT003` | `product_unavailable` | `create_order` com produto não vendável; `fulfill_order` com produto sem jogos | 400 |
| `KT004` | `session_conflict` | Sessão/intent diferente da já associada ao pedido | 400 |
| `KT005` | `livemode_mismatch` | `p_livemode` ≠ `orders.livemode` (evento de teste em ambiente live, ou o inverso) | 400 |
| `KT006` | `invalid_transition` | Só via SQL direto (trigger). As RPCs devolvem `outcome='ignored'` (ou `'deferred'`) | 400 |
| `KT007` | `data_required` | Falta e-mail ou valor para o estado pedido | 400 |
| `KT008` | `append_only` | `UPDATE`/`DELETE` em tabela de log | 400 |

O backend lê `error.code`. Violação de unicidade (`23505`) de sessão/intent de outro pedido também chega como erro; tratar como `KT004`. No webhook, `KT002` é caso que reenvio não resolve (o pedido continua `open`): responder `200` com log, como `KT001`, `KT004`, `KT005` e `KT007`. A base não prevê cupom no P1; se vier a existir, `no_payment_required` precisa de decisão própria.

### 6.2 `fulfill_order`: pagamento confirmado → pedido `paid` + direito

```sql
create function public.fulfill_order(
  p_order_id            uuid,           -- orders.id (vem de client_reference_id da Stripe)
  p_checkout_session_id text,           -- cs_...
  p_payment_status      text,           -- valor lido da Stripe; precisa ser 'paid'
  p_email               text,           -- customer_details.email
  p_amount_total        bigint,         -- centavos, da sessão
  p_currency            text,           -- da sessão
  p_payment_intent_id   text,           -- pi_...; aceita NULL (nunca apaga nem sobrescreve o já gravado)
  p_livemode            boolean,
  p_source              text default 'webhook',   -- 'webhook' | 'return_page' | 'reconcile'
  p_stripe_event_id     text default null         -- evt_...; null fora do webhook
) returns table (
  outcome           text,      -- 'applied' | 'noop' | 'duplicate_event' | 'ignored' | 'not_found'
  order_id          uuid,
  order_status      text,
  entitlement_id    uuid,
  send_access_email boolean,   -- true SÓ para a chamada que criou a linha de e-mail
  outbox_id         uuid
);
```

**Algoritmo (uma transação):**

1. Validar argumentos (`KT001`; só `p_payment_intent_id` pode ser NULL); `p_payment_status = 'paid'` senão `KT002` (vale para `unpaid` e para `no_payment_required`).
2. `select ... from orders where id = p_order_id for update`. Não existe: `outcome='not_found'` (grava o evento, se houver, com `order_id` nulo).
3. `p_livemode` ≠ `orders.livemode`: `KT005`.
4. Se `p_stripe_event_id` já está em `stripe_events`: `outcome='duplicate_event'`, devolve o estado atual, **nada muda**.
5. Sessão: se o pedido não tem, grava; se tem e difere, `KT004`. Intent: idem, mas `NULL` é aceito e nunca apaga nem sobrescreve o valor gravado.
6. Estado: `paid` → `noop`; `open`/`pending_payment` → segue; `failed`/`expired`/`refunded`/`disputed` → `ignored`.
7. Produto sem jogos em `product_games`: `KT003`.
8. `orders`: `status='paid'`, `paid_at=now()`, `email`, `amount_total`, `currency` e, se informado, `stripe_payment_intent_id`.
9. `insert into entitlements ... on conflict (order_id, product_id) do nothing returning id`; se inseriu, copia `product_games` para `entitlement_games`.
10. `insert into email_outbox (order_id, kind, to_email, product_name) values (…, 'access', …) on conflict (order_id, kind) do nothing returning id` → `send_access_email := found`. `to_email` = `auth.users.email` do dono do pedido (comprador logado: o e-mail com que ele entra); sem dono, ou conta sem e-mail, vale o `email` do pedido. `product_name` = `coalesce(products.name, products.code)`, lido na mesma transação: a linha é uma fotografia, e renomear o produto depois não muda o e-mail pendente.
11. `insert into order_events`; `insert into stripe_events (outcome)` se houver evento. Retorna `applied`.

**Idempotência e concorrência**

| Situação | Resultado |
| --- | --- |
| Primeira chamada | `applied`: 1 pedido `paid`, 1 direito, N linhas de jogo, 1 e-mail `queued`, 1 `order_event`, 1 `stripe_event` |
| Mesmo evento reenviado | `duplicate_event`; contagens idênticas; `send_access_email=false` |
| Outro evento ou página de retorno para o mesmo pedido | `noop`; `send_access_email=false` |
| N chamadas simultâneas (webhook + order-status) | A trava `FOR UPDATE` serializa; a 2ª em diante relê o pedido já `paid` e devolve `noop`/`duplicate_event`. Exatamente uma `applied` e uma com `send_access_email=true` |
| Falha antes do commit | Nada gravado (inclusive o evento): a Stripe reenvia |

Ordem de travas: sempre a linha do pedido primeiro; demais tabelas só por `INSERT`. Não há ciclo possível com `set_order_status` nem com `claim_orders` (seção 6.4).

Exemplo (supabase-js, backend):

```ts
const { data, error } = await admin.rpc('fulfill_order', {
  p_order_id: session.client_reference_id,
  p_checkout_session_id: session.id,
  p_payment_status: session.payment_status,     // precisa ser 'paid'; 'no_payment_required' → KT002
  p_email: session.customer_details?.email,
  p_amount_total: session.amount_total,
  p_currency: session.currency,
  p_payment_intent_id: typeof session.payment_intent === 'string'    // NULL quando não há intent
    ? session.payment_intent
    : (session.payment_intent?.id ?? null),
  p_livemode: session.livemode,
  p_source: 'webhook',
  p_stripe_event_id: event.id,
});
// data[0] = { outcome: 'applied', order_id, order_status: 'paid', entitlement_id, send_access_email: true, outbox_id }
if (data[0].send_access_email) await sendAccessEmail(data[0].outbox_id);   // depois do commit
```

### 6.3 `set_order_status`: demais transições

```sql
create function public.set_order_status(
  p_order_id           uuid,
  p_new_status         text,     -- 'pending_payment' | 'failed' | 'expired' | 'refunded' | 'disputed' | 'paid' (só a partir de 'disputed')
  p_source             text default 'webhook',
  p_stripe_event_id    text default null,
  p_reason             text default null,   -- livre, sem dado pessoal, até 200 caracteres
  p_email              text default null,   -- 'pending_payment' (obrigatório se não gravado); opcional em 'failed'
  p_amount_total       bigint default null, -- para 'pending_payment'
  p_currency           text default null,
  p_payment_intent_id  text default null    -- para 'pending_payment'
) returns table (
  outcome            text,   -- 'applied' | 'noop' | 'duplicate_event' | 'ignored' | 'deferred' | 'not_found'
  order_id           uuid,
  previous_status    text,
  order_status       text,
  entitlement_status text    -- 'active' | 'revoked' | null
);
```

- O backend resolve o `order_id` antes, pelo `client_reference_id` da sessão. Nos eventos de cobrança (`charge.*`), que trazem o intent e não o pedido, a rota busca na Stripe a sessão do `payment_intent` e usa o `client_reference_id` dela, sem ler o banco.
- `p_new_status = 'open'`, ou `'paid'` a partir de `open`/`pending_payment` (use `fulfill_order`): `KT001`.
- Mesmo estado: `noop`. Aresta fora da seção 4.1: `ignored`. Ambos sem alterar nada; o evento é registrado com o `outcome`.
- **`deferred`:** `refunded` ou `disputed` com o pedido `open` ou `pending_payment`. Nada muda e o evento **não** é gravado, para o reenvio da Stripe ser avaliado de novo; a rota responde `500`.
- Ordem de avaliação: `not_found` → `duplicate_event` → `noop` (mesmo estado) → `deferred` → `ignored` (aresta inexistente) → `applied`.
- `open → failed` é aresta válida (`async_payment_failed` fora de ordem) e não exige e-mail.
- `pending_payment`: exige e-mail e valor (argumento ou já gravado), senão `KT007`.
- Efeito no direito vem de `private.access_effect` (P-1): `refunded` → `revoked(refund)` e `refunded_at`; `disputed` → `revoked(dispute)`; `disputed→paid` → `active`.
- Concorrência: mesma trava `FOR UPDATE` do pedido. Dois eventos para o mesmo pedido (`refunded` e `disputed`) serializam; o segundo cai em `ignored` se a aresta deixou de existir. Um reembolso que ganha a trava antes de `fulfill_order` devolve `deferred`; reenviado depois, vira `applied`.

### 6.4 `claim_orders`: vincular compra anônima ao usuário verificado

```sql
create function public.claim_orders(p_user_id uuid) returns integer;   -- nº de pedidos vinculados nesta chamada
```

1. `private.claimable_email(p_user_id)` lê `auth.users`. Se o usuário não existe, `deleted_at` não é nulo, `email` é nulo ou **`email_confirmed_at` é nulo**, devolve `NULL` e `claim_orders` retorna `0` sem mudar nada. É a mesma função que `get_order_status` usa para `claimable`.
2. `select id from orders where user_id is null and email = lower(btrim(<email do usuário>)) order by id for update` (ordem fixa por `id`: sem deadlock entre duas chamadas do mesmo usuário).
3. `update orders set user_id = p_user_id` nessas linhas. Retorna a contagem.

- **Nunca** toma pedido que já tem `user_id` (nem troca o dono quando o e-mail do pagamento difere do da conta).
- Idempotente: a 2ª chamada devolve `0`. Duas chamadas simultâneas somam exatamente os pedidos existentes.
- Considera qualquer estado do pedido com o e-mail igual (inclusive `pending_payment`, para o usuário ver "em processamento").
- A API chama `claim_orders(uid)` e depois `get_library(uid)` em `GET /library`.

### 6.5 RPCs auxiliares

Detalhes mínimos; a forma de resposta de cada rota HTTP é do `api-contract.md`.

```sql
create function public.create_order(
  p_product_code text,
  p_livemode     boolean,                 -- obrigatório, sem default: vem da chave da Stripe do ambiente
  p_user_id      uuid default null,       -- usuário da sessão validada; null = comprador anônimo
  p_email        text default null        -- e-mail da conta (auth.users.email) quando há sessão
) returns table (order_id uuid, product_id bigint, status text, stripe_price_id text);   -- status = 'open'
```
- `p_livemode` não tem default: chamada sem ele falha (função não encontrada) em vez de assumir teste. Os obrigatórios vêm primeiro porque o Postgres exige que os parâmetros com default sejam os últimos; o `supabase-js` chama por nome, então a ordem não afeta a rota.
- Devolve o `stripe_price_id` (Price do ambiente) para a rota criar a sessão sem ler `products`.
- `product_is_sellable` falso: `KT003`. `p_user_id` inexistente: `KT001`.
- Sem chave de idempotência: cada chamada cria um pedido `open` (cliques repetidos geram pedidos `open` inofensivos; a API pode reaproveitar um recente). Limitar abuso no API/CAPTCHA.

```sql
create function public.attach_checkout_session(p_order_id uuid, p_checkout_session_id text,
                                               p_expires_at timestamptz default null)
  returns text;   -- 'applied' | 'noop' | 'ignored' | 'not_found'
```
- Só com pedido `open`. Mesma sessão de novo: `noop`. Sessão diferente da já gravada: `KT004`. Sessão de outro pedido: `23505`.
- Fluxo: `create_order` → Stripe cria a sessão (chave de idempotência = `order_id`) → `attach_checkout_session`. Se o passo 3 falhar, `fulfill_order` ainda acha o pedido pelo `client_reference_id`.

```sql
create function public.get_library(p_user_id uuid) returns jsonb;
```
Agrega **por produto** (um item mesmo com mais de um pedido pago) e lista os pedidos em processamento. Forma:

```json
{ "products": [ { "code": "P001", "name": "…", "purchased_at": "…",
                  "games": [ { "code": "…", "name": "…",
                               "files": [ { "id": "…", "kind": "pdf", "version": "1.0", "size_bytes": 1234 } ] } ],
                  "bundle_file": null } ],
  "pending":  [ { "product_name": "…", "created_at": "…" } ] }
```
- `products`: direitos `active` e não vencidos de pedidos do usuário. Por produto: `purchased_at` = o menor `granted_at`; `games` = união dos jogos das fotografias, sem repetir, ordenados pela menor `position` e depois por `code`; `bundle_file` = ZIP publicado do pacote ou `null`.
- `files` traz só `published`. Jogo sem arquivo publicado aparece com `"files": []`: a compra é preservada e a UI mostra "indisponível".
- `pending`: pedidos do usuário em `pending_payment`, do mais recente ao mais antigo, só com `product_name` e `created_at`. Sem compras e sem pendentes: `{"products": [], "pending": []}`.
- `name` e `product_name` são `null` enquanto o nome comercial estiver pendente (P-13). Nunca inclui chave do B2, URL, e-mail nem ids de pedido ou de direito.

```sql
create function public.get_account(p_user_id uuid) returns jsonb;
```
Forma:

```json
{ "email": "…",
  "orders": [ { "ref": "A1B2C3D4", "product_name": "…", "created_at": "…", "paid_at": "…",
                "amount_total": 0, "currency": "brl", "status": "paid" } ] }
```
- `email`: `auth.users.email` do `p_user_id`. Usuário inexistente ou removido: `{"email": null, "orders": []}`.
- `orders`: pedidos com `user_id = p_user_id`, **sem** `open` e `expired`, do mais recente ao mais antigo (`created_at desc, id desc`). `ref` = 8 primeiros caracteres do id, em maiúsculas (seção 1). `paid_at` é `null` fora de `paid`/`refunded`/`disputed`. `status` ∈ `pending_payment`, `paid`, `failed`, `refunded`, `disputed`.
- Sem ids da Stripe nem URL (o comprovante, se adotado, a rota busca na Stripe). Não vincula pedidos: a rota chama `claim_orders` antes.

```sql
create function public.get_order_status(p_order_id uuid, p_user_id uuid default null)
  returns table (outcome text, status text, product_name text, relation text);
```
- `outcome`: `ok` | `not_found` (os demais campos vêm nulos). `status` é o `orders.status` (7 estados). A rota acha o pedido pelo `client_reference_id` da sessão da Stripe.
- `relation` descreve a sessão do usuário em relação ao pedido:

| `relation` | Quando |
| --- | --- |
| `anonymous` | `p_user_id` nulo (ou usuário inexistente/removido) |
| `owner` | `orders.user_id = p_user_id` |
| `claimable` | pedido sem dono e `private.claimable_email(p_user_id) = orders.email`: a **mesma** regra de `claim_orders` (e-mail confirmado) |
| `other` | qualquer outro caso: pedido de outra conta; sem dono com e-mail diferente; ou sem e-mail gravado ainda |

- Nunca devolve e-mail, id de usuário nem valores. Atenção: pedido anônimo ainda `open` (liberação em andamento) visto por quem já está logado dá `other`, porque o e-mail do pedido só é gravado na liberação. Para o estado `processing`, a rota não deve depender de `relation`.

```sql
create function public.resolve_download(p_user_id uuid, p_file_id uuid)
  returns table (outcome text, bucket text, object_key text, filename text,
                 content_type text, size_bytes bigint);
```
- `outcome`: `ok` | `not_found` | `not_entitled` | `unavailable`. Campos de localização só vêm preenchidos com `ok`. HTTP sugerido: 404 / 404 / 403 / 503.
- Avaliação, nesta ordem:
  1. Arquivo inexistente ou `access='free'`: `not_found`.
  2. Sem direito: `not_entitled` se o arquivo está `published`; `not_found` se não está.
  3. Com direito: `published` → `ok`. `retired` **com sucessor publicado** (mesmo jogo ou pacote, mesmo tipo e acesso) → `not_found`: o site recarrega a biblioteca e recebe o id novo. `draft`, ou `retired` sem sucessor → `unavailable`.
- Direito = pedido do `p_user_id` com direito `active` não vencido **e** o `game_id` do arquivo em `entitlement_games`, ou o `product_id` do arquivo igual ao do direito.
- Com `ok`, grava `download_events (kind='paid', user_id, file_id)` na mesma transação.
- `content_type`: `application/pdf` ou `application/zip`, derivado de `kind`.

```sql
create function public.get_free_game() returns jsonb;
-- {"available": false}
-- {"available": true, "game": {"code","name"}, "file": {"id","version","size_bytes","filename"}}
create function public.resolve_free_download(p_file_id uuid)
  returns table (outcome text, bucket text, object_key text, filename text,
                 content_type text, size_bytes bigint);   -- 'ok' | 'not_found'
```
- Disponível = jogo `access='free'` e `published` com PDF `free` `published`. Senão `available=false` (nenhum botão no site).
- `resolve_free_download`: `ok` só para `access='free'` e `published`; qualquer outro id (inclusive pago) é `not_found`. Grava `download_events (kind='free', user_id NULL)`. **Não captura e-mail nem contato** (condições do gratuito pendentes, P-10).

### 6.6 Rota → RPC (para o Ferrolho)

| Rota / evento | Chamadas ao banco |
| --- | --- |
| `POST /checkout` | `create_order` (devolve `stripe_price_id`) → Stripe (sessão) → `attach_checkout_session` |
| `GET /order-status` | Lê a sessão na Stripe (o pedido vem do `client_reference_id`); se preciso, `fulfill_order`/`set_order_status` com `p_source='return_page'`; depois `get_order_status(order_id, uid ou null)` |
| `GET /library` | `claim_orders(uid)` → `get_library(uid)` |
| `GET /account` | `claim_orders(uid)` → `get_account(uid)` |
| `POST /download-url` | `resolve_download(uid, file_id)` → assina a URL no B2 com `bucket`/`object_key` |
| `GET /free-game` | `get_free_game()` |
| `POST /free-download` | `resolve_free_download(file_id)` → assina a URL |
| `stripe-webhook` | `fulfill_order`/`set_order_status` com `p_stripe_event_id`; `deferred` → responde `500` (a Stripe reenvia); se `send_access_email`, envia e atualiza `email_outbox` |
| envio do e-mail | Lê da própria `email_outbox` (`to_email`, `product_name` e `order_id`; a referência do pedido é derivada do `order_id`), sem depender de outra tabela. `UPDATE email_outbox set status='sending' ... where id=$1 and status in ('queued','failed')` (compara-e-troca; 0 linhas = outro processo está enviando) → `sent` ou `failed` + `attempts` |

## 7. Arquivos do B2 (somente metadados)

- **O banco guarda:** `files` (tipo, versão, nome de exibição, `size_bytes`, `sha256`, estado) e `file_objects` (`bucket`, `object_key`, `b2_file_id` opcional). **Nunca:** URL pública ou assinada, token, chave de aplicação, parâmetro de assinatura. Teste T08 garante que nenhuma coluna se chama `*url*`.
- **Chave do objeto:** `{access}/{codigo}/{versao}/{codigo}-v{versao}.{kind}`, por exemplo `paid/TESTE-J01/1.0/TESTE-J01-v1.0.pdf`. Só `[A-Za-z0-9._/-]`. O nome mostrado ao usuário fica em `files.filename` (pode ter espaços e acentos; deve coincidir com o `Content-Disposition` gravado no upload).
- **Prefixo = acesso** permite duas chaves de aplicação no B2: a das funções restrita a leitura e, se quiserem, uma por prefixo (`free/` x `paid/`). Bucket privado.
- **Integridade:** `sha256` e `size_bytes` calculados por quem publica a partir do arquivo enviado. A API pode comparar `size_bytes` com o `HEAD` do B2 antes de assinar.
- **Ciclo de publicação (dados):**
  1. Enviar o objeto ao B2 (com `Content-Disposition`), calcular `sha256` e tamanho.
  2. Em uma transação: `insert into files` (`draft`) + `insert into file_objects`.
  3. Conferir o objeto (`HEAD`) e, se for PDF pago, abrir o PDF de teste.
  4. Em uma transação: `update files set status='retired'` no publicado anterior do mesmo (jogo, tipo, acesso) e `update files set status='published'` no novo. O índice único parcial garante que nunca existam dois publicados.
  - Conteúdo diferente = **versão nova**; `sha256`, tamanho, versão e nome não mudam depois de `draft`.
  - Quem executa o passo 4 (RPC administrativa `publish_file` ou SQL do operador) é decisão P-4; recomendo a RPC no I3.
- **Remoção:** `files` com `download_events` não pode ser apagado (FK). Retira-se (`retired`). A chave do B2 não é reutilizada para conteúdo diferente.
- **Versão servida a quem comprou:** a publicada vigente do jogo (D-6, P-2). `download_events.file_id` registra qual versão cada pessoa baixou.

## 8. Seed de teste

`supabase/seed.sql` (dono: Lastro; `[db.seed] sql_paths` no `config.toml` é do Ferrolho). Roda no `supabase start` e no `supabase db reset` **locais**. **Não é aplicado em remoto** sem autorização do orquestrador (conferir `supabase db push --help` antes). Tudo é fictício e rotulado `TESTE`; nada do que está aqui é decisão comercial.

| Dado | Conteúdo |
| --- | --- |
| Usuários (`auth.users`, confirmados) | `teste-a@keytotwo.test`, `teste-b@keytotwo.test`, com UUID fixos. Sem usuário para `teste-claim@keytotwo.test` (o login E2E o cria). Se o GoTrue local rejeitar o domínio `.test`, usar `example.com` (P-11). |
| Produto | `P001`, nome `[PENDENTE] Nome comercial do P001 [TESTE]`, `status='active'`, `stripe_price_id='price_TESTE_PLACEHOLDER'` (trocado no I4 pelo Price de teste real), `games_expected=5`. Sem preço. |
| Jogos do pacote | `TESTE-J01` Rabisque e Adivinhe [TESTE], `TESTE-J02` Hora dos Artistas [TESTE], `TESTE-J03` Boardgame (nome provisório) [TESTE], `TESTE-J04` Vaga 4 PENDENTE [TESTE], `TESTE-J05` Vaga 5 PENDENTE [TESTE]. Todos `published`, `access='paid'`. Os códigos são de teste (a base ainda não atribuiu J002 em diante). Vagas 4 e 5 não recebem título real. |
| Jogo gratuito | `TESTE-GRATIS` "Jogo gratuito fictício [TESTE]", `access='free'`, **`draft`** (estado padrão = sem jogo gratuito; os testes o publicam com `update`). |
| Arquivos | Um PDF `paid` `published` v1.0 por jogo (`TESTE-J0N-v1.0.pdf`, bucket `bucket-teste-pendente`, chave `paid/TESTE-J0N/1.0/...`), um PDF `free` `draft` v0.1 do gratuito, um ZIP do pacote `draft`. `sha256` = 64 zeros e tamanho 1024 como **placeholder**; o I3 troca por valores reais do bucket de teste. Não é o PDF real do J001. |
| Pedidos (ids fixos; criados `open` por INSERT e levados aos estados pelas RPCs) | **O1** usuário A, `teste-a@…`, `paid` com direito ativo (comprador logado). **O2** sem usuário, `teste-claim@…`, `paid` (vínculo na 1ª chamada de library). **O3** sem usuário, `teste-pendente@…`, `pending_payment`. **O4** usuário B, `refunded` com direito `revoked` (reembolso). **O5** `open` sem e-mail (checkout abandonado). |
| Ids Stripe | `cs_test_TESTE_O1…`, `pi_TESTE_O1…`, `evt_TESTE_O1…`. Nunca valores reais. |
| E-mail | Linhas `queued` para O1 e O2. Nenhum envio real. |

Como o seed usa `create_order`/`fulfill_order`/`set_order_status`, ele também é um teste de fumaça das RPCs (T85).

## 9. Plano de testes pgTAP

**Onde e como.** `supabase/tests/database/*.test.sql` (dono: Lastro). Rodam com `supabase test db` sobre o banco local já migrado e semeado. Cada arquivo: `begin; create extension if not exists pgtap with schema extensions; select plan(n); ...; select * from finish(); rollback;`, exceto o de concorrência. Papéis simulados com `set local role anon|authenticated|service_role`; como `anon`/`authenticated` não têm acesso algum, não dependemos de `request.jwt.claims`. Dados criados dentro do teste (usuários por função em `pg_temp`), nunca dependendo do seed, exceto o arquivo 09. Não usar `tables_are('public', ...)` (o schema `public` do remoto contém `public.test`, fora do contrato).

| Arquivo | Casos principais |
| --- | --- |
| `01_schema` | **T01** as 12 tabelas existem. **T02** colunas, tipos, `NOT NULL`. **T03** PK, FK, `unique`. **T04** nenhuma FK sem índice (consulta ao catálogo → 0 linhas). **T05** `CHECK`s rejeitam (23514): status inválido, `sha256` curto, `currency` maiúscula, e-mail fora do padrão, `size_bytes ≤ 0`, `filename` com `/`, `version 'v1'`, `paid` sem `paid_at`, `product_name` vazio ou nulo em `email_outbox`. **T06** FKs compostas (23503): arquivo `free` em jogo `paid`; jogo `free` em `product_games`; `file_objects.access ≠ files.access`. **T07** unicidade (23505): sessão, intent, `evt_`, direito `(order, product)`, e-mail `(order, kind)`, 2º publicado por (jogo, tipo, acesso), 2º jogo grátis publicado, `(bucket, object_key)`. **T08** nenhuma coluna `*url*` e nenhuma `ip`/`user_agent` em `public`. **T09** append-only: `UPDATE`/`DELETE` em `order_events`, `download_events`, `stripe_events` e `UPDATE` em `entitlement_games` falham (`KT008`). |
| `02_privileges_rls` | **T10** RLS ligada nas 12 tabelas. **T11** `deny_client_access` é a única policy de cada tabela. **T12** `anon`/`authenticated` sem nenhum privilégio de tabela, coluna ou sequência (`has_table_privilege`, `has_any_column_privilege`, `has_sequence_privilege`). **T13** `service_role` tem exatamente a matriz 5.1: `SELECT` e `UPDATE` por coluna só em `email_outbox` (`to_email` e `product_name` não são atualizáveis); nenhum privilégio de tabela nas outras 11 (inclusive `file_objects`); sem `INSERT`/`DELETE`. **T14** as 11 RPCs (inclui `get_account` e `get_order_status`): `EXECUTE` só para `service_role`; `private.*` para ninguém. **T15** comportamento: `SELECT` e `rpc` como `anon`/`authenticated` → `42501`; `SELECT` e `INSERT` direto em tabela de negócio como `service_role` → `42501` (só `email_outbox` é legível). **T16** as 11 RPCs são `SECURITY DEFINER` com `search_path` vazio (`proconfig @> array['search_path=""']`; comparar o texto de `proconfig` falha por causa do escape) e `proacl` exatamente `{postgres=X/postgres,service_role=X/postgres}`. |
| `03_state_machine` | **T20** matriz completa: dos 49 pares (de, para), `UPDATE` direto só passa nas 10 arestas da seção 4.1 (inclui `open→failed`); o resto levanta `KT006`. **T21** imutáveis (`product_id`, `livemode`, `created_at`); `user_id` não muda depois de preenchido (muda com `keytotwo.allow_reassign`); ids Stripe preenchidos não mudam. **T22** `CHECK`s de consistência (`paid_at`, `refunded_at`, valor/moeda em par); `failed` sem e-mail passa, `pending_payment` sem e-mail falha. **T23** trigger diferido (`set constraints all immediate`): `paid` sem direito ativo, `refunded` com direito ativo e direito ativo com pedido não `paid` falham. **T24** `files`: `draft→published→retired` passa; retornos e pulos falham; colunas de conteúdo imutáveis após `draft`. |
| `04_fulfill_order` | **T30** caminho feliz: `applied`; 1 pedido `paid`, 1 direito, 5 jogos na fotografia, 1 e-mail `queued` com `to_email` e `product_name` preenchidos, 1 `order_event`, 1 `stripe_event`, `send_access_email=true`. **T31** mesmo evento de novo: `duplicate_event`, contagens iguais, `send=false`. **T32** outro evento e `return_page`: `noop`. **T33** `payment_status` ≠ `paid` (`unpaid`, `no_payment_required`): `KT002`, nada gravado e o pedido segue `open`. **T34** `livemode` divergente `KT005`; sessão divergente `KT004`; sessão de outro pedido `23505`. **T35** pedido inexistente: `not_found`, sem exceção. **T36** `failed`/`expired`/`refunded`/`disputed`: `ignored`, sem direito novo. **T37** produto sem jogos: `KT003`. **T38** alterar `product_games` depois da compra não muda a fotografia. **T39** e-mail com maiúsculas/espaços vira minúsculo; `to_email` do e-mail de acesso = e-mail do pedido (anônimo) ou `auth.users.email` (comprador logado, mesmo quando o e-mail do pagamento difere); conta sem e-mail cai no e-mail do pedido. **T40** `pending_payment → paid`: `applied`. **T41** `p_payment_intent_id` NULL: `applied` sem gravar intent; intent já gravado não é apagado por NULL; intent diferente: `KT004`. **T42** `product_name` do e-mail = `products.name` no momento da compra; renomear o produto depois não altera a linha; produto sem nome usa o `code`. |
| `05_set_order_status` | **T45** cada uma das 10 arestas permitidas e seu efeito no direito: `open→failed` (sem e-mail) passa; reembolso e contestação revogam; `disputed→paid` reativa; `disputed→refunded` mantém revogado com motivo `refund`. **T46** mesmo estado `noop`; aresta inválida `ignored` sem `order_event`; `refunded`/`disputed` sobre pedido `failed`/`expired` também `ignored`. **T47** evento repetido `duplicate_event`. **T48** `pending_payment` sem e-mail/valor: `KT007`. **T49** `'open'`, ou `'paid'` fora de `disputed`: `KT001`. **T50** pedido inexistente: `not_found`. **T51** `deferred`: `refunded`/`disputed` com pedido `open` ou `pending_payment` devolvem `deferred`, sem `order_event`, sem `stripe_event` e sem alterar o pedido; reenviar o mesmo evento continua `deferred`; depois de `fulfill_order`, o mesmo evento é `applied`. |
| `06_claim_orders` | **T55** vincula pedido sem dono com o mesmo e-mail (sem diferenciar maiúsculas) para usuário confirmado; devolve a contagem. **T56** e-mail não confirmado → `0`, nada muda. **T57** pedido de outro `user_id` e de outro e-mail não são tocados. **T58** 2ª chamada → `0`. **T59** usuário inexistente ou removido → `0`. **T61** usuário A não vincula pedido de B. |
| `07_library_downloads` | **T65** `get_library` devolve `{products, pending}`: só direitos ativos do usuário; revogado some; pedido de outro não aparece; sem compra e sem pendente → `{"products": [], "pending": []}`. **T66** só arquivos `published`; jogo sem arquivo publicado aparece com `files=[]`; `bundle_file` só com ZIP publicado; dois pedidos pagos do mesmo produto → **um** item (`purchased_at` = o mais antigo, união dos jogos); `pending` lista só `pending_payment` do usuário, do mais recente ao mais antigo, com `product_name` e `created_at`; sem chave do B2, e-mail nem ids de pedido ou de direito. **T67** `resolve_download`: `ok` grava `download_events` (pago, `user_id`); `not_entitled` (outro usuário, pedido reembolsado); `not_found` (id inexistente, arquivo grátis); `unavailable` (direito ok, arquivo `draft` ou `retired` sem sucessor publicado); `not_found` também para arquivo `retired` **com** sucessor publicado, até para quem tem o direito. **T68** localização nula quando `outcome ≠ ok` e nenhum `download_events` gravado. **T69** `get_free_game`: `false` sem publicado ou com jogo/arquivo em `draft`; `true` com ambos publicados. **T70** `resolve_free_download`: `ok` só para `free`+`published`; id de arquivo pago → `not_found`; grava evento `free` com `user_id` nulo. |
| `08_b2_metadata` | **T75** `object_key` rejeita `https://…`, `..`, barra inicial, `?`, espaço e prefixo diferente de `access`; `bucket` fora do formato. **T76** `unique (bucket, object_key)`; `sha256`, `size_bytes`, extensão x `kind`. **T77** publicar novo exige aposentar o anterior (sequência na mesma transação passa). **T78** apagar arquivo com `download_events` falha (23503). **T79** `bucket`/`object_key` imutáveis depois de `draft`. |
| `09_seed_smoke` | **T85** após `db reset`: contagens da seção 8; todo nome, arquivo e e-mail com `TESTE`/`.test`; ids Stripe com `TESTE`; O1–O5 nos estados esperados; `create_order('P001')` funciona e falha (`KT003`) se um jogo voltar a `draft`. |
| `10_account_order_status` | **T100** `get_account`: `email` da conta e só os pedidos do usuário, sem `open` e `expired`, do mais recente ao mais antigo; campos `ref` (8 caracteres maiúsculos), `product_name`, `created_at`, `paid_at`, `amount_total`, `currency`, `status`; usuário inexistente ou removido → `{"email": null, "orders": []}`. **T101** não vaza pedido de outro usuário nem pedido sem dono; sem ids da Stripe nem URL. **T102** `get_order_status`: `owner`, `anonymous` (sem usuário), `other` (pedido de outra conta, ou sem dono com e-mail diferente), `claimable` (sem dono, e-mail igual e confirmado) e `not_found`; `claimable` falso com e-mail não confirmado. **T103** só devolve `outcome`, `status`, `product_name` e `relation` (sem e-mail, valores nem ids de usuário). **T104** coerência: para o mesmo par (usuário, pedido), `relation='claimable'` se e somente se `claim_orders` vincularia o pedido. |
| `90_concurrency` | Sem `begin/rollback` (precisa de commits visíveis a outras sessões); usa `dblink` (disponível na imagem) e `dblink_send_query` em N conexões; dados com prefixo `CONC-TESTE`, removidos no fim. **T90** N=10 `fulfill_order` simultâneos, mesmo pedido e evento: 1 `applied` + 9 `duplicate_event`/`noop`; contagens 1/1/1; um único `send_access_email=true`. **T91** N=10 com eventos distintos (webhook + `return_page`): 1 `applied`. **T92** `fulfill_order` ∥ `set_order_status(expired|refunded)`: qualquer ordem de serialização é aceita (o reembolso que ganha a trava devolve `deferred` e, reenviado depois, `applied`); o estado final cumpre I-5 e não há duplicata. **T93** `claim_orders` ∥ `claim_orders` do mesmo usuário: soma = nº de pedidos, sem deadlock. **T94** N `create_order` simultâneos: N pedidos `open` distintos. |

Observações do plano:

- O `dblink` com a trava de `FOR UPDATE` é a forma de provar concorrência sem script externo. A conexão do `dblink` dentro do contêiner local **não foi validada**: o I4 começa com um spike de 15 minutos; se falhar, o fallback é `psql` paralelo (N processos chamando a RPC) mais uma consulta de contagem, no mesmo diretório de testes (P-12).
- `get_advisors` (MCP) ou `supabase db advisors`: **zero ERROR** após as migrações. Avisos preexistentes e que não são nossos: `public.test` sem policy e `rls_auto_enable()` executável (seção 10).
- `supabase test db` roda no CI (Costura) com a CLI de versão fixa.
- Testes de API e E2E (Lupa) que contam linhas (idempotência, e-mails) leem o banco como dono (`psql`/`supabase db query`), não com a chave secreta (D-12).

**Cobertura dos aceites**

| Aceite | Testes |
| --- | --- |
| `Compra e acesso`: compra liberada uma única vez; eventos repetidos não duplicam compra, acesso ou mensagem | T30–T32, T40, T90, T91 |
| Pendente/recusado não libera arquivo | T36, T65, T67 |
| Pessoa não baixa arquivo de outro pedido | T57, T61, T67 |
| Reembolso refletido; e-mail que falha não apaga acesso | T45, T67 (e-mail só em `email_outbox`) |
| Biblioteca com 5 jogos, composição mantida | T38, T66 |
| Pagamento em processamento aparece para quem ainda não vê compra | T66 (`pending`) |
| Minha conta: pedidos do usuário, sem checkouts abandonados | T100, T101 |
| Pessoa autenticada em outra conta não vê dados do comprador | T102–T104 |
| Evento de cobrança antes da liberação não se perde | T51, T92 |
| Jogo grátis sem expor arquivos pagos | T07, T06, T69, T70 |
| I2: `anon` não lê pedidos/acessos; A não lê dados de B; nenhuma escrita por `anon`/`authenticated`; chave B2 ilegível; vínculo por e-mail | T12, T15, T55–T57, T61, T75 |
| I2: `get_advisors` sem ERROR | seção 9, observações |
| I3: sem direito 403; grátis 404 para id pago; `download_events` sem IP | T67, T70, T08 |
| I4: idempotência e concorrência (1 acesso, 1 e-mail); recusado não libera; reembolso total | T30–T40, T45, T90–T93 |

## 10. Proteção da `public.test` (keep-alive externo)

**Fato (inventário D1):** `public.test` existe só no remoto `keytotwo-print-db`, criada fora das migrações (`id bigint identity`, `created_at timestamptz`, `text`; RLS ligada; sem policies; 1 linha). Não existe no banco local. Uma automação externa a usa; **não sabemos como ela acessa** (REST com `anon`, SQL, outra). Este contrato nunca toca a tabela, as colunas, a RLS, as policies nem os grants.

**Regras para todas as migrações:**

1. Não mencionam `public.test`, `rls_auto_enable` nem `alter default privileges`.
2. Sem `grant|revoke ... on all (tables|sequences|functions) in schema public`: eles atingiriam `public.test`. Sempre lista nomeada.
3. Sem `drop schema public`, `drop table public.test` ou `create table public.test`. Não recriar a tabela localmente.
4. Nunca `supabase db reset --linked`. `supabase db pull` contra o remoto importaria `public.test` e `rls_auto_enable()`: usar `db pull --local` e revisar o diff. `supabase db push --dry-run` antes de qualquer push (que exige autorização, ajuste 4).
5. Antes de mexer em `rls_auto_enable()` ou em privilégios padrão: confirmar que a automação não é afetada; na dúvida, perguntar. Nada neste contrato precisa disso.
6. **Checagem de integridade** antes e depois de qualquer aplicação remota (somente leitura): colunas, `RLS` ligada, número de policies (0) e grants de `public.test` idênticos aos de antes; contagem de linhas ≥ 1.
7. **Lint no CI** (proposta, `supabase/tests/lint-migrations.*`): falha se `supabase/migrations/**` casar `public\.test\b`, `rls_auto_enable`, `alter\s+default\s+privileges` ou `in\s+schema\s+public` em `grant|revoke ... on all`.

Os avisos de segurança atuais (INFO `public.test` sem policy; WARN `rls_auto_enable()` executável por `anon`/`authenticated`) pertencem a esses objetos e **não são corrigidos por este trabalho**. Tratar a função só após o item 5.

## 11. Pontos em aberto

| # | Ponto | Decisor | Efeito se mudar |
| --- | --- | --- | --- |
| P-1 | Reembolso e contestação revogam o acesso? Proposta: reembolso total e contestação revogam; disputa vencida reativa. Reembolso parcial não revoga. | Responsável (bloqueia o aceite do I4) | Só `private.access_effect` e a função de consistência |
| P-2 | Atualizações: servir a versão publicada vigente (proposto) ou congelar a versão comprada? Hoje o banco registra só a versão baixada (`download_events`). | Responsável (ficha do P001: "direito a futuras versões") | Congelar exige tabela `entitlement_files` e ajuste em `resolve_download`/`get_library` |
| P-3 | Prazo de acesso. `entitlements.expires_at` existe, sempre NULL, e os resolvers já respeitam. Falta a regra de cálculo. | Responsável | `fulfill_order` passa a preencher |
| P-4 | Quem publica arquivo: RPC `publish_file` (recomendada, I3) ou SQL do operador. Reversão manual de acesso (`manual`) hoje é SQL de atendimento. | Orquestrador / Lastro | Nova RPC |
| P-5 | Origem do `stripe_price_id`: coluna preenchida por script do ambiente (proposto; migração não carrega valor de ambiente) ou variável de ambiente da função. | Orquestrador / Ferrolho | Coluna fica NULL e o gate muda |
| P-6 | Leitura direta pelo cliente (catálogo/pedidos pela Data API). Não adotada; reabrir só se surgir necessidade. | Orquestrador | Seção 5.3 |
| P-7 | Reembolso parcial não altera estado; hoje o evento seria ignorado pelo webhook (sem registro). | Responsável (política de reembolso) | Novo estado ou campo `amount_refunded` |
| P-8 | LGPD: retenção de `orders.email` e `download_events`; apagar conta zera `user_id` mas mantém o e-mail do pedido (registro de venda). Política de privacidade pendente. | Responsável / jurídico | Rotina de anonimização |
| P-9 | Reenvio automático de e-mail e resgate de `sending` travado: fora deste ciclo (cron). | Orquestrador | Job + RPC de resgate |
| P-10 | Jogo gratuito: no máximo um publicado (índice); conteúdo e condições (login/e-mail) pendentes. O contrato não captura contato. | Responsável | Remover índice se houver mais de um |
| P-11 | Domínio de e-mail de teste (`.test`) aceito pelo GoTrue local? | Lastro/Ferrolho (verificar no I0/I2) | Trocar o domínio do seed |
| P-12 | `dblink` no contêiner local para o teste de concorrência (spike no I4) | Lastro | Fallback `psql` paralelo |
| P-13 | Nome comercial, preço, moeda, modalidade e textos legais: **PENDENTES**. O banco não os decide: `products.name` e `stripe_price_id` ficam vazios/placeholder até o responsável aprovar. | Responsável | — |

## 12. Entregas derivadas deste contrato

| Incremento | Arquivos do Lastro |
| --- | --- |
| I2 | `supabase/migrations/<ts>_commerce_schema.sql` (seções 2 e 3), `<ts>_rls_grants.sql` (seção 5), RPCs de leitura e escrita (seção 6) em migração própria, `supabase/seed.sql`, `supabase/tests/database/01…10_*.test.sql`, lint de migrações (seção 10) |
| I3 | Metadados reais do bucket de teste no seed; `publish_file` se aprovado (P-4) |
| I4 | `<ts>_fulfillment_rpcs.sql` se separarmos as RPCs de escrita; `90_concurrency.test.sql` |

Criar cada migração com `supabase migration new <nome>` (nunca inventar o nome do arquivo).

## 13. Mudanças da v0.2

Revisão do Ferrolho sobre as seções 5 e 6; os 9 itens foram aprovados pelo orquestrador.

| # | Mudança | Onde |
| --- | --- | --- |
| 1 | Nova `get_account`; `/account` deixa de usar `SELECT` direto | 5.2, 6.5, 6.6, T14, T16, T100, T101 |
| 2 | Nova `get_order_status`, com `relation` (`owner`, `claimable`, `other`, `anonymous`); a regra de `claimable` é a de `claim_orders`, numa função única `private.claimable_email` | 2.7, 6.4, 6.5, T102–T104 |
| 3 | Outcome `deferred` (refund/dispute antes da liberação: não grava, rota responde 500); nova aresta `open → failed` (o `CHECK orders_email_required` aceita `failed` sem e-mail) | 2.4, 4.1, 6.3, T20, T22, T45, T46, T51 |
| 4 | `create_order`: `p_livemode` obrigatório, sem default (parâmetros reordenados) | 5.2, 6.5 |
| 5 | `create_order` devolve também `stripe_price_id` | 6.5 |
| 6 | `p_payment_intent_id` aceita NULL; exemplo corrigido; `no_payment_required` resulta em `KT002` | 6.1, 6.2, T33, T41 |
| 7 | Comprador logado: `to_email` do e-mail de acesso = `auth.users.email` | 6.2, T39 |
| 8 | `get_library` agrega por produto e devolve `{products, pending}` | 6.5, T65, T66 |
| 9 | `resolve_download`: arquivo `retired` com sucessor publicado devolve `not_found` | 6.5, T67 |

Pontos que a v0.2 deixa para o Ferrolho: `KT002` no webhook responde `200` com log (seção 6.1); `get_order_status` devolve uma coluna `outcome` (`ok`/`not_found`) além das três pedidas, para seguir a convenção das demais RPCs; em `get_library`, `files` não traz `filename` (o nome vem de `resolve_download`).

**v0.2.1 (mesmo dia).** O orquestrador aprovou o antigo P-14, hoje D-12: `service_role` perde o `SELECT` das 11 tabelas e fica só com `email_outbox` (seções 0 e 5.1, T13, T15). Quem precisar ler tabela na API, em testes ou no suporte, usa o dono ou pede uma RPC de leitura.

**v0.2.2 (mesmo dia).** O envio do e-mail de acesso passou a depender só de `email_outbox`: a tabela ganhou `product_name` (`NOT NULL`), gravado por `fulfill_order` junto de `to_email` (seções 2.6, 6.2, 6.6; T05, T13, T30, T42). O e-mail precisa apenas do nome do pacote, do destinatário (que é também o e-mail de entrada) e da referência do pedido, derivada do `order_id`. `receipt_url` não entra agora; se for adotado, `get_account` passará a devolver o intent. Um tipo novo de e-mail traz seus próprios campos de fotografia.
