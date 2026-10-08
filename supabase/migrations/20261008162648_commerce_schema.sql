-- Schema comercial do KeyToTwo Print (docs/data-contract.md v0.3.2, seções 2 e 3).
-- Catálogo, arquivos (metadados do B2), conta, carrinho, pedidos e itens, direitos, eventos, funil e fila de e-mail,
-- mais as funções internas (schema private) e os triggers que sustentam as invariantes.
-- Gerado a partir dos blocos @ddl do contrato. Não toca em public.test (keep-alive externo) nem em privilégios padrão.
-- RLS e GRANT: migração rls_grants. Triggers em auth.users: migração auth_triggers.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

create table public.products (
  id              bigint generated always as identity primary key,
  code            text not null unique,
  slug            text not null unique,
  kind            text not null,             -- bundle | single
  name            text,                      -- nome comercial: PENDENTE até decisão do responsável
  status          text not null default 'draft',
  stripe_price_id text unique,               -- por ambiente (P-5); nunca é preço de vitrine
  games_expected  smallint,                  -- trava de completude; avulso = 1
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint products_code_check   check (code ~ '^[A-Z][A-Z0-9-]{1,23}$'),
  constraint products_slug_check   check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint products_kind_check   check (kind in ('bundle', 'single')),
  constraint products_name_check   check (name is null or btrim(name) <> ''),
  constraint products_status_check check (status in ('draft', 'active', 'archived')),
  constraint products_price_check  check (stripe_price_id is null or stripe_price_id ~ '^price_[A-Za-z0-9_]+$'),
  constraint products_games_expected_check check (games_expected is null or games_expected > 0),
  constraint products_single_check check (kind <> 'single' or games_expected is null or games_expected = 1),
  constraint products_active_requires_data check (
    status <> 'active' or (name is not null and stripe_price_id is not null and games_expected is not null))
);

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
-- no máximo UM jogo gratuito publicado (P-10)
create unique index games_one_published_free on public.games ((true))
  where access = 'free' and status = 'published';

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

create table public.profiles (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id  text unique,                 -- criado no 1º checkout (set_stripe_customer)
  marketing_opt_in    boolean not null default false,
  marketing_opt_in_at timestamptz,                 -- quando o opt-in vigente foi dado; NULL sem opt-in
  marketing_prompted_at timestamptz,               -- quando o convite de marketing foi exibido pela 1ª vez; ver ou dispensar NÃO é consentimento
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint profiles_customer_check check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9_]+$'),
  constraint profiles_opt_in_check   check (marketing_opt_in = (marketing_opt_in_at is not null))
);

-- Histórico do consentimento (LGPD). SÓ INSERÇÃO. Sem IP e sem user agent (P-6/D6). O e-mail é fotografia.
create table public.marketing_consents (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users (id),
  email        text not null,
  action       text not null,
  source       text not null,
  text_version text,                               -- versão do texto mostrado; obrigatória ao conceder
  occurred_at  timestamptz not null default now(),
  constraint marketing_consents_email_check  check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint marketing_consents_action_check check (action in ('granted', 'revoked')),
  constraint marketing_consents_source_check check (source in
    ('signup_prompt', 'account', 'cart', 'unsubscribe_link', 'brevo_webhook', 'support')),
  constraint marketing_consents_text_check   check (action <> 'granted' or text_version is not null),
  constraint marketing_consents_version_check check (text_version is null or text_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  -- origens que só concedem ou só revogam
  constraint marketing_consents_source_action_check check (
    (source in ('signup_prompt', 'cart') and action = 'granted')
    or (source in ('unsubscribe_link', 'brevo_webhook') and action = 'revoked')
    or source in ('account', 'support'))
);
create index marketing_consents_user_idx on public.marketing_consents (user_id, occurred_at desc, id desc);

-- Supressões vindas da Brevo (bounce, reclamação, descadastro). Consultada antes de QUALQUER envio de marketing.
create table public.email_suppressions (
  email               text not null,
  reason              text not null,
  source              text not null,
  provider_message_id text,
  occurred_at         timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  primary key (email, reason),
  constraint email_suppressions_email_check  check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint email_suppressions_reason_check check (reason in ('hard_bounce', 'complaint', 'unsubscribe_all')),
  constraint email_suppressions_source_check check (source in ('brevo_webhook', 'unsubscribe_link', 'support'))
);

create table public.carts (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  version    integer not null default 0,           -- sobe a cada mudança; chave anti-duplicidade do lembrete
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),   -- "última mudança" (lembrete 3 h depois)
  constraint carts_version_check check (version >= 0)
);

create table public.cart_items (
  user_id    uuid   not null references public.carts (user_id) on delete cascade,
  product_id bigint not null references public.products (id),
  added_at   timestamptz not null default now(),
  primary key (user_id, product_id)
);
create index cart_items_product_id_idx on public.cart_items (product_id);

create table public.orders (
  id                         uuid primary key default gen_random_uuid(),   -- client_reference_id e chave de idempotência da Stripe
  user_id                    uuid not null references auth.users (id),     -- dono, sempre; não muda
  email                      text not null,                                -- fotografia do e-mail da conta
  status                     text not null default 'open',
  cart_version               integer not null,                             -- versão do carrinho que originou o pedido
  terms_version              text not null,                                -- versão dos termos mostrada na página do site
  terms_accepted_at          timestamptz not null,                         -- aceite na página do site, antes do formulário; gravado na criação
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
  constraint orders_id_user_key unique (id, user_id),     -- alvo da FK composta de entitlements
  constraint orders_status_check check (status in
    ('open', 'pending_payment', 'paid', 'failed', 'expired', 'disputed', 'dispute_lost', 'refunded')),
  constraint orders_email_check check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint orders_cart_version_check check (cart_version >= 0),
  constraint orders_terms_version_check check (btrim(terms_version) <> ''),
  constraint orders_money_pair     check ((amount_total is null) = (currency is null)),
  constraint orders_amount_check   check (amount_total is null or amount_total >= 0),
  constraint orders_currency_check check (currency is null or currency ~ '^[a-z]{3}$'),
  constraint orders_session_check  check (stripe_checkout_session_id is null or stripe_checkout_session_id ~ '^cs_(test|live)_[A-Za-z0-9_]+$'),
  constraint orders_intent_check   check (stripe_payment_intent_id is null or stripe_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
  constraint orders_amount_required check (
    status not in ('pending_payment', 'paid', 'disputed', 'dispute_lost', 'refunded') or amount_total is not null),
  constraint orders_paid_at_check     check ((status in ('paid', 'disputed', 'dispute_lost', 'refunded')) = (paid_at is not null)),
  constraint orders_refunded_at_check check ((status = 'refunded') = (refunded_at is not null))
);
create index orders_user_idx  on public.orders (user_id, created_at desc);
create index orders_stale_idx on public.orders (created_at) where status in ('open', 'pending_payment');
create index orders_paid_followup_idx on public.orders (paid_at) where status = 'paid';

create table public.order_items (
  order_id        uuid     not null references public.orders (id),
  product_id      bigint   not null references public.products (id),
  position        smallint not null,
  stripe_price_id text     not null,         -- Price enviado ao Checkout (fotografia na criação do pedido)
  unit_amount     bigint,                    -- cobrado, das line_items; preenchido na liberação
  currency        text,
  primary key (order_id, product_id),
  constraint order_items_position_check check (position >= 1),
  constraint order_items_position_key   unique (order_id, position),
  constraint order_items_price_check    check (stripe_price_id ~ '^price_[A-Za-z0-9_]+$'),
  constraint order_items_amount_check   check (unit_amount is null or unit_amount >= 0),
  constraint order_items_currency_check check (currency is null or currency ~ '^[a-z]{3}$'),
  constraint order_items_money_pair     check ((unit_amount is null) = (currency is null))
);
create index order_items_product_id_idx on public.order_items (product_id);

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

create table public.entitlements (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid   not null,
  product_id    bigint not null,
  user_id       uuid   not null,
  status        text   not null default 'active',
  granted_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  revoke_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint entitlements_item_fkey       foreign key (order_id, product_id) references public.order_items (order_id, product_id),
  constraint entitlements_order_user_fkey foreign key (order_id, user_id)    references public.orders (id, user_id),
  constraint entitlements_order_product_key unique (order_id, product_id),
  constraint entitlements_status_check check (status in ('active', 'revoked')),
  constraint entitlements_reason_check check (revoke_reason is null or revoke_reason in ('refund', 'dispute', 'manual')),
  constraint entitlements_state_check check (
    (status = 'active'  and revoked_at is null     and revoke_reason is null) or
    (status = 'revoked' and revoked_at is not null and revoke_reason is not null))
);
create index entitlements_user_active_idx on public.entitlements (user_id) where status = 'active';
create index entitlements_product_id_idx  on public.entitlements (product_id);

-- Fotografia da composição do produto na compra. Imutável.
create table public.entitlement_games (
  entitlement_id uuid     not null references public.entitlements (id),
  game_id        bigint   not null references public.games (id),
  position       smallint not null,
  primary key (entitlement_id, game_id),
  constraint entitlement_games_position_check check (position >= 1)
);
create index entitlement_games_game_id_idx on public.entitlement_games (game_id);

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

-- Funil: SÓ INSERÇÃO, escrito só pelas RPCs e triggers, sem dado pessoal além do user_id (SET NULL se a conta for apagada).
-- O primeiro download sai de download_events (não duplica aqui).
create table public.funnel_events (
  id           bigint generated always as identity primary key,
  user_id      uuid references auth.users (id) on delete set null,
  type         text not null,
  order_id     uuid references public.orders (id),
  product_id   bigint references public.products (id),
  cart_version integer,
  occurred_at  timestamptz not null default now(),
  constraint funnel_events_type_check check (type in ('account_confirmed', 'cart_item_added', 'cart_item_removed',
    'checkout_started', 'checkout_expired', 'order_paid', 'delivery_sent', 'dispute_opened', 'dispute_closed')),
  constraint funnel_events_shape_check check (
    case type
      when 'account_confirmed' then true
      when 'cart_item_added'   then product_id is not null and cart_version is not null
      when 'cart_item_removed' then product_id is not null and cart_version is not null
      else order_id is not null
    end)
);
create unique index funnel_events_account_confirmed_key on public.funnel_events (user_id)
  where type = 'account_confirmed' and user_id is not null;
create unique index funnel_events_once_per_order_key on public.funnel_events (order_id, type)
  where type in ('checkout_started', 'checkout_expired', 'order_paid', 'delivery_sent');
create index funnel_events_type_idx    on public.funnel_events (type, occurred_at);
create index funnel_events_user_idx    on public.funnel_events (user_id, occurred_at) where user_id is not null;
create index funnel_events_order_idx   on public.funnel_events (order_id) where order_id is not null;
create index funnel_events_product_idx on public.funnel_events (product_id) where product_id is not null;

-- Sem IP, sem user agent. Escrito só por resolve_download/resolve_delivery/resolve_free_download (append-only).
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

create table public.email_outbox (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id),
  order_id            uuid references public.orders (id),         -- NULL em e-mail que não é de um pedido
  kind                text not null,                              -- delivery | cart_reminder | post_purchase
  category            text not null,                              -- transactional | marketing
  to_email            text not null,
  payload             jsonb not null default '{}'::jsonb,         -- fotografia: nomes, ref, ids; SEM token
  scheduled_at        timestamptz not null default now(),
  dedupe_key          text not null unique,
  status              text not null default 'queued',
  skip_reason         text,
  attempts            integer not null default 0,
  last_error          text,                                       -- código/mensagem curta; sem e-mail nem token
  provider_message_id text,
  locked_at           timestamptz,                                -- preenchido enquanto status = sending
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  updated_at          timestamptz not null default now(),
  constraint email_outbox_kind_check     check (kind in ('delivery', 'cart_reminder', 'post_purchase')),
  constraint email_outbox_category_check check (category in ('transactional', 'marketing')),
  constraint email_outbox_kind_category_check check ((kind = 'delivery') = (category = 'transactional')),
  constraint email_outbox_delivery_order_check check (kind <> 'delivery' or order_id is not null),
  constraint email_outbox_to_check       check (to_email = lower(btrim(to_email)) and to_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint email_outbox_payload_check  check (jsonb_typeof(payload) = 'object'),
  constraint email_outbox_dedupe_check   check (dedupe_key ~ '^[A-Za-z0-9:._-]{3,200}$'),
  constraint email_outbox_status_check   check (status in ('queued', 'sending', 'sent', 'failed', 'skipped', 'canceled')),
  constraint email_outbox_skip_check     check (
    (status in ('skipped', 'canceled')) = (skip_reason is not null)),
  constraint email_outbox_skip_reason_check check (skip_reason is null or skip_reason in
    ('no_opt_in', 'suppressed', 'already_purchased', 'cart_changed', 'cart_empty', 'order_not_paid',
     'entitlement_revoked', 'email_not_confirmed')),
  constraint email_outbox_attempts_check check (attempts >= 0),
  constraint email_outbox_error_check    check (last_error is null or char_length(last_error) <= 500),
  constraint email_outbox_sent_check     check ((status = 'sent') = (sent_at is not null)),
  constraint email_outbox_lock_check     check ((status = 'sending') = (locked_at is not null))
);
create index email_outbox_due_idx   on public.email_outbox (scheduled_at) where status in ('queued', 'sending');
create index email_outbox_user_idx  on public.email_outbox (user_id, kind, status);
create index email_outbox_order_idx on public.email_outbox (order_id) where order_id is not null;

create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create function private.normalize_email(p_email text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select nullif(lower(btrim(p_email)), '')
$$;

-- E-mail normalizado do usuário, só se ele existe, não foi removido e CONFIRMOU o e-mail.
-- Vale para os três métodos de login (código, senha com confirmação, Google): o Auth só preenche
-- email_confirmed_at depois de o e-mail ser verificado.
create function private.confirmed_email(p_user_id uuid) returns text
language sql stable set search_path = '' as $$
  select private.normalize_email(u.email)
  from auth.users u
  where u.id = p_user_id
    and u.deleted_at is null
    and u.email_confirmed_at is not null
$$;

-- Usada por toda RPC com p_user_id (exceto unsubscribe): KT009 sem e-mail confirmado. Devolve o e-mail.
create function private.require_confirmed_email(p_user_id uuid) returns text
language plpgsql stable set search_path = '' as $$
declare v_email text;
begin
  if p_user_id is null then
    raise exception 'p_user_id é obrigatório' using errcode = 'KT001';
  end if;
  v_email := private.confirmed_email(p_user_id);
  if v_email is null then
    raise exception 'usuário sem e-mail confirmado' using errcode = 'KT009';
  end if;
  return v_email;
end $$;

create function private.order_transition_allowed(p_from text, p_to text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_from
    when 'open'            then p_to in ('pending_payment', 'paid', 'failed', 'expired')
    when 'pending_payment' then p_to in ('paid', 'failed')
    when 'paid'            then p_to in ('disputed', 'refunded')
    when 'disputed'        then p_to in ('paid', 'dispute_lost', 'refunded')
    else false
  end
$$;

-- Jogos que o usuário já possui (direito ativo).
create function private.owned_game_ids(p_user_id uuid) returns setof bigint
language sql stable set search_path = '' as $$
  select distinct eg.game_id
  from public.entitlements e
  join public.entitlement_games eg on eg.entitlement_id = e.id
  where e.user_id = p_user_id and e.status = 'active'
$$;

-- Gate de venda (D-9): ativo, com preço, composição completa e todo jogo publicado com PDF pago publicado.
create function private.product_is_sellable(p_product_id bigint) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1
    from public.products p
    where p.id = p_product_id
      and p.status = 'active'
      and p.stripe_price_id is not null
      and p.games_expected is not null
      and (select count(*) from public.product_games pg where pg.product_id = p.id) = p.games_expected
      and not exists (
        select 1
        from public.product_games pg
        join public.games g on g.id = pg.game_id
        where pg.product_id = p.id
          and (g.status <> 'published'
               or not exists (select 1 from public.files f
                              where f.game_id = g.id and f.kind = 'pdf' and f.access = 'paid' and f.status = 'published')))
  )
$$;

-- Pode receber marketing agora? Opt-in vigente, e-mail confirmado, sem supressão (bounce/reclamação)
-- e sem descadastro geral posterior ao opt-in.
create function private.marketing_allowed(p_user_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce((
    select p.marketing_opt_in
       and u.email_confirmed_at is not null
       and u.deleted_at is null
       and not exists (
         select 1 from public.email_suppressions s
         where s.email = private.normalize_email(u.email)
           and (s.reason in ('hard_bounce', 'complaint')
                or (s.reason = 'unsubscribe_all' and s.created_at > p.marketing_opt_in_at)))
    from public.profiles p
    join auth.users u on u.id = p.user_id
    where p.user_id = p_user_id
  ), false)
$$;

-- I-5 (checada no commit), por item. paid: todo item tem direito, ativo ou revogado manualmente (atendimento).
-- disputed, dispute_lost e refunded: todo item tem direito e todos revogados. Demais estados: nenhum direito.
create function private.assert_order_entitlement_consistency() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_order_id uuid;
  v_status   text;
  v_items    integer;
  v_ents     integer;
  v_active   integer;
  v_revoked  integer;
  v_manual   integer;
begin
  -- if/else (e não CASE): cada tabela tem só um dos campos de "new".
  if tg_table_name = 'orders' then
    v_order_id := new.id;
  else
    v_order_id := new.order_id;
  end if;

  select o.status into v_status from public.orders o where o.id = v_order_id;
  if not found then
    return null;
  end if;

  select count(*) into v_items from public.order_items i where i.order_id = v_order_id;
  select count(*),
         count(*) filter (where e.status = 'active'),
         count(*) filter (where e.status = 'revoked'),
         count(*) filter (where e.status = 'revoked' and e.revoke_reason = 'manual')
    into v_ents, v_active, v_revoked, v_manual
    from public.entitlements e
   where e.order_id = v_order_id;

  if v_status = 'paid' then
    if v_items < 1 or v_ents <> v_items or v_revoked <> v_manual then
      raise exception 'pedido % paid: itens=%, direitos=%, revogados fora do atendimento=%',
        v_order_id, v_items, v_ents, v_revoked - v_manual using errcode = 'KT011';
    end if;
  elsif v_status in ('disputed', 'dispute_lost', 'refunded') then
    if v_items < 1 or v_ents <> v_items or v_active > 0 then
      raise exception 'pedido % (%): itens=%, direitos=%, ativos=% (todos devem estar revogados)',
        v_order_id, v_status, v_items, v_ents, v_active using errcode = 'KT011';
    end if;
  elsif v_ents > 0 then
    raise exception 'pedido % (%) não pode ter direito', v_order_id, v_status using errcode = 'KT011';
  end if;
  return null;
end $$;

-- Tabelas de log: só inserção.
create function private.forbid_modification() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% é só inserção (% não permitido)', tg_table_name, tg_op using errcode = 'KT008';
end $$;

-- download_events e funnel_events: só inserção, exceto o SET NULL de auth.users (conta anonimizada).
create function private.guard_user_nulling() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and old.user_id is not null and new.user_id is null
     and (to_jsonb(new) - 'user_id') = (to_jsonb(old) - 'user_id') then
    return new;
  end if;
  raise exception '% é só inserção (% não permitido)', tg_table_name, tg_op using errcode = 'KT008';
end $$;

-- O estado atual do consentimento (profiles) acompanha a última linha do histórico, na mesma transação.
create function private.sync_profile_consent() returns trigger
language plpgsql set search_path = '' as $$
begin
  update public.profiles p
     set marketing_opt_in    = (new.action = 'granted'),
         marketing_opt_in_at = case when new.action = 'granted' then new.occurred_at end
   where p.user_id = new.user_id;
  if not found then
    raise exception 'usuário % sem perfil', new.user_id using errcode = 'KT001';
  end if;
  return null;
end $$;

-- orders: transições só pelas arestas da seção 4.1; colunas imutáveis; dono e ids da Stripe não mudam.
create function private.guard_order_changes() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id
     or new.livemode is distinct from old.livemode
     or new.created_at is distinct from old.created_at
     or new.cart_version is distinct from old.cart_version
     or new.terms_version is distinct from old.terms_version then
    raise exception 'orders: id, livemode, created_at, cart_version e terms_version são imutáveis' using errcode = 'KT010';
  end if;
  -- o dono nunca muda (atendimento: set local keytotwo.allow_reassign = 'on')
  if new.user_id is distinct from old.user_id
     and coalesce(current_setting('keytotwo.allow_reassign', true), 'off') <> 'on' then
    raise exception 'orders: o dono do pedido não muda' using errcode = 'KT010';
  end if;
  if old.stripe_checkout_session_id is not null
     and new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id then
    raise exception 'orders: stripe_checkout_session_id não muda depois de gravado' using errcode = 'KT010';
  end if;
  if old.stripe_payment_intent_id is not null
     and new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id then
    raise exception 'orders: stripe_payment_intent_id não muda depois de gravado' using errcode = 'KT010';
  end if;
  if old.terms_accepted_at is not null and new.terms_accepted_at is distinct from old.terms_accepted_at then
    raise exception 'orders: terms_accepted_at não muda depois de gravado' using errcode = 'KT010';
  end if;
  if new.status is distinct from old.status and not private.order_transition_allowed(old.status, new.status) then
    raise exception 'orders: transição % -> % não permitida', old.status, new.status using errcode = 'KT006';
  end if;
  return new;
end $$;

-- order_items: só se inserem e se apagam com o pedido open; o valor cobrado entra uma vez (open ou pending_payment).
create function private.guard_order_item_changes() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_status text;
begin
  select o.status into v_status from public.orders o where o.id = coalesce(new.order_id, old.order_id);

  if tg_op = 'INSERT' then
    if v_status is distinct from 'open' then
      raise exception 'order_items: só se inserem itens em pedido open' using errcode = 'KT010';
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if v_status is not null and v_status <> 'open' then
      raise exception 'order_items: só se apagam itens de pedido open' using errcode = 'KT010';
    end if;
    return old;
  end if;

  if new.order_id is distinct from old.order_id
     or new.product_id is distinct from old.product_id
     or new.position is distinct from old.position
     or new.stripe_price_id is distinct from old.stripe_price_id then
    raise exception 'order_items: pedido, produto, posição e Price são imutáveis' using errcode = 'KT010';
  end if;
  if new.unit_amount is distinct from old.unit_amount or new.currency is distinct from old.currency then
    if old.unit_amount is not null or v_status not in ('open', 'pending_payment') then
      raise exception 'order_items: o valor cobrado entra uma vez, com o pedido open ou pending_payment' using errcode = 'KT010';
    end if;
  end if;
  return new;
end $$;

-- ===== triggers de public ========================================================================
create trigger products_set_updated_at     before update on public.products     for each row execute function private.set_updated_at();
create trigger games_set_updated_at        before update on public.games        for each row execute function private.set_updated_at();
create trigger files_set_updated_at        before update on public.files        for each row execute function private.set_updated_at();
create trigger carts_set_updated_at        before update on public.carts        for each row execute function private.set_updated_at();
create trigger profiles_set_updated_at     before update on public.profiles     for each row execute function private.set_updated_at();
create trigger orders_set_updated_at       before update on public.orders       for each row execute function private.set_updated_at();
create trigger entitlements_set_updated_at before update on public.entitlements for each row execute function private.set_updated_at();
create trigger email_outbox_set_updated_at before update on public.email_outbox for each row execute function private.set_updated_at();

create trigger order_events_forbid_modification       before update or delete on public.order_events       for each row execute function private.forbid_modification();
create trigger stripe_events_forbid_modification      before update or delete on public.stripe_events      for each row execute function private.forbid_modification();
create trigger entitlement_games_forbid_modification before update or delete on public.entitlement_games for each row execute function private.forbid_modification();
create trigger marketing_consents_forbid_modification before update or delete on public.marketing_consents for each row execute function private.forbid_modification();
create trigger email_suppressions_forbid_modification before update or delete on public.email_suppressions for each row execute function private.forbid_modification();
create trigger download_events_guard before update or delete on public.download_events for each row execute function private.guard_user_nulling();
create trigger funnel_events_guard   before update or delete on public.funnel_events   for each row execute function private.guard_user_nulling();

create trigger marketing_consents_sync after insert on public.marketing_consents
  for each row execute function private.sync_profile_consent();

create trigger orders_guard_changes      before update on public.orders
  for each row execute function private.guard_order_changes();
create trigger order_items_guard_changes before insert or update or delete on public.order_items
  for each row execute function private.guard_order_item_changes();

create constraint trigger orders_consistency       after insert or update on public.orders
  deferrable initially deferred for each row execute function private.assert_order_entitlement_consistency();
create constraint trigger entitlements_consistency after insert or update on public.entitlements
  deferrable initially deferred for each row execute function private.assert_order_entitlement_consistency();

-- ===== files / file_objects: status só avança, conteúdo imutável depois de draft, só rascunho se apaga ============
create function private.guard_file_changes() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'files: só rascunho pode ser apagado; use retired' using errcode = 'KT010';
    end if;
    return old;
  end if;

  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status = 'published')
         or (old.status = 'published' and new.status = 'retired')) then
      raise exception 'files: transição % -> % não permitida', old.status, new.status using errcode = 'KT006';
    end if;
    if new.status = 'published' then
      new.published_at := coalesce(new.published_at, now());
    elsif new.status = 'retired' then
      new.retired_at := coalesce(new.retired_at, now());
    end if;
  end if;

  if old.status <> 'draft' and (
       new.game_id    is distinct from old.game_id
    or new.product_id is distinct from old.product_id
    or new.kind       is distinct from old.kind
    or new.access     is distinct from old.access
    or new.version    is distinct from old.version
    or new.filename   is distinct from old.filename
    or new.size_bytes is distinct from old.size_bytes
    or new.sha256     is distinct from old.sha256
    or new.published_at is distinct from old.published_at) then
    raise exception 'files: conteúdo imutável depois de draft (conteúdo novo = versão nova)' using errcode = 'KT010';
  end if;
  return new;
end $$;

create function private.guard_file_object_changes() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_status text;
begin
  -- arquivo já apagado (cascata a partir de um rascunho) conta como rascunho
  select f.status into v_status from public.files f where f.id = old.file_id;
  if coalesce(v_status, 'draft') <> 'draft' and (
       tg_op = 'DELETE'
    or new.file_id    is distinct from old.file_id
    or new.access     is distinct from old.access
    or new.bucket     is distinct from old.bucket
    or new.object_key is distinct from old.object_key) then
    raise exception 'file_objects: bucket e object_key são imutáveis depois de draft' using errcode = 'KT010';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

-- Nomes escolhidos para que o guard dispare antes do set_updated_at (ordem alfabética).
create trigger files_guard_changes        before update or delete on public.files        for each row execute function private.guard_file_changes();
create trigger file_objects_guard_changes before update or delete on public.file_objects for each row execute function private.guard_file_object_changes();
