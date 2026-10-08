-- I3: checkout e liberação do pedido, com cupom (docs/data-contract.md v0.3.3, seções 2.6, 6.3 a 6.6, D-24 e D-25).
-- Migração nova: não altera as do I2b, só acrescenta (alter table, create or replace e funções novas).
-- RPCs: create_order_from_cart, attach_checkout_session, fulfill_order, set_order_status, get_order_status
-- (e get_account recriada com os campos do desconto). Todas SECURITY DEFINER, search_path vazio, EXECUTE só para service_role.
-- Fora desta migração, de propósito (sem stub): resolve_download, resolve_delivery, get_free_game, resolve_free_download,
-- claim_email_batch, mark_email_result (I4); record_email_event e private.enqueue_followups (I5).
-- Ordem de travas: pedido, depois carrinho (create_order_from_cart só trava o carrinho; nunca o pedido).

-- ===== 1. orders: subtotal, desconto e código promocional (D-24) ====================================
alter table public.orders
  add column amount_subtotal bigint,   -- soma dos preços cheios (da sessão), antes do desconto
  add column amount_discount bigint,   -- desconto do cupom (da sessão); 0 sem cupom
  add column promotion_code  text;     -- texto do código promocional digitado; NULL sem código

-- Dados que já existem (banco local e seed do I2b): sem desconto, subtotal igual ao total.
-- O UPDATE enfileira o gatilho diferido da I-5; sem antecipá-lo, o ALTER TABLE seguinte falha ("pending trigger events").
set constraints all immediate;
update public.orders set amount_subtotal = amount_total, amount_discount = 0 where amount_total is not null;
set constraints all deferred;

alter table public.orders drop constraint orders_amount_required;
alter table public.orders
  add constraint orders_discount_pair check ((amount_subtotal is null) = (amount_discount is null)),
  add constraint orders_discount_range check (
    amount_subtotal is null
    or (amount_total is not null and amount_subtotal >= 0 and amount_discount >= 0
        and amount_discount <= amount_subtotal and amount_total = amount_subtotal - amount_discount)),
  add constraint orders_promotion_code_check check (
    promotion_code is null or (promotion_code = btrim(promotion_code) and char_length(promotion_code) between 1 and 200)),
  add constraint orders_amount_required check (
    status not in ('pending_payment', 'paid', 'disputed', 'dispute_lost', 'refunded')
    or (amount_total is not null and amount_subtotal is not null));

comment on column public.orders.amount_subtotal is 'Soma dos preços cheios dos itens, antes do cupom. Vem da sessão da Stripe; gravado uma vez.';
comment on column public.orders.amount_discount is 'Desconto do cupom (centavos). 0 sem cupom. amount_total = amount_subtotal - amount_discount (sem imposto).';
comment on column public.order_items.unit_amount is 'Preço cheio do item (antes do cupom), das line_items da sessão. O desconto fica só no pedido.';

-- ===== 2. guard_order_changes: valores e código promocional não mudam depois de gravados ============
create or replace function private.guard_order_changes() returns trigger
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
  -- D-24: o que foi cobrado (e o cupom) é gravado uma vez
  if (old.amount_total is not null and new.amount_total is distinct from old.amount_total)
     or (old.amount_subtotal is not null and new.amount_subtotal is distinct from old.amount_subtotal)
     or (old.amount_discount is not null and new.amount_discount is distinct from old.amount_discount)
     or (old.currency is not null and new.currency is distinct from old.currency)
     or (old.promotion_code is not null and new.promotion_code is distinct from old.promotion_code) then
    raise exception 'orders: valores e código promocional não mudam depois de gravados' using errcode = 'KT010';
  end if;
  if new.status is distinct from old.status and not private.order_transition_allowed(old.status, new.status) then
    raise exception 'orders: transição % -> % não permitida', old.status, new.status using errcode = 'KT006';
  end if;
  return new;
end $$;

-- ===== 2b. a I-5 diferida roda no COMMIT, fora da RPC: precisa ser SECURITY DEFINER (D-12) ===========
-- Os gatilhos orders_consistency e entitlements_consistency são DEFERRABLE INITIALLY DEFERRED: disparam no COMMIT, depois que a RPC
-- SECURITY DEFINER já terminou, com o papel da sessão (service_role pela API), que não tem SELECT em tabela alguma. Como SECURITY INVOKER
-- a função falhava com 42501 (permission denied for table orders) em toda gravação de pedido ou direito feita pela API.
-- Só ganha SECURITY DEFINER (dono postgres, search_path vazio); nenhum papel de API recebe EXECUTE (a checagem de EXECUTE de
-- gatilho é feita só ao criá-lo). As demais funções de gatilho disparam dentro de statements executados por RPC SECURITY DEFINER.
create or replace function private.assert_order_entitlement_consistency() returns trigger
language plpgsql security definer set search_path = '' as $$
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
revoke all on function private.assert_order_entitlement_consistency() from public, anon, authenticated, service_role;

-- ===== 3. funções internas ==========================================================================
-- Motivo da revogação que cada estado impõe aos direitos do pedido (NULL: o estado não revoga).
create function private.access_effect(p_status text) returns text
language sql immutable set search_path = '' as $$
  select case p_status
           when 'disputed'     then 'dispute'
           when 'dispute_lost' then 'dispute'
           when 'refunded'     then 'refund'
         end
$$;

-- Tira da fila os e-mails ainda não enviados de um pedido (contestação, reembolso).
create function private.cancel_order_emails(p_order_id uuid, p_reason text) returns integer
language plpgsql set search_path = '' as $$
declare v_count integer;
begin
  update public.email_outbox x
     set status = 'canceled', skip_reason = p_reason
   where x.order_id = p_order_id and x.status = 'queued';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function private.access_effect(text) from public, anon, authenticated, service_role;
revoke all on function private.cancel_order_emails(uuid, text) from public, anon, authenticated, service_role;

-- ===== 4. create_order_from_cart ====================================================================
create function public.create_order_from_cart(
  p_user_id        uuid,
  p_livemode       boolean,
  p_cart_version   integer,
  p_terms_version  text,
  p_terms_accepted boolean
) returns table (
  outcome            text,
  order_id           uuid,
  email              text,
  stripe_customer_id text,
  items              jsonb,
  reused             boolean,
  detail             jsonb
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_email    text;
  v_terms    text;
  v_version  integer;
  v_n_items  integer;
  v_bad      jsonb;
  v_order_id uuid;
  v_reused   boolean;
  v_customer text;
  v_items    jsonb;
begin
  v_email := private.require_confirmed_email(p_user_id);
  if p_livemode is null or p_cart_version is null or p_cart_version < 0
     or p_terms_version is null or btrim(p_terms_version) = '' then
    raise exception 'create_order_from_cart: argumentos inválidos' using errcode = 'KT001';
  end if;
  if p_terms_accepted is distinct from true then
    raise exception 'create_order_from_cart: o aceite dos termos é obrigatório' using errcode = 'KT007';
  end if;
  v_terms := btrim(p_terms_version);

  -- trava o carrinho: serializa os checkouts do mesmo usuário (o 2º reaproveita o pedido do 1º)
  select c.version into v_version from public.carts c where c.user_id = p_user_id for update;
  select count(*) into v_n_items from public.cart_items ci where ci.user_id = p_user_id;
  if v_version is null or v_n_items = 0 then
    return query select 'cart_empty'::text, null::uuid, null::text, null::text, null::jsonb, false, null::jsonb;
    return;
  end if;
  if v_version <> p_cart_version then
    return query select 'cart_changed'::text, null::uuid, null::text, null::text, null::jsonb, false,
                        jsonb_build_object('cart_version', v_version);
    return;
  end if;

  -- produto que deixou de ser vendável
  select jsonb_agg(p.code order by ci.added_at, p.id) into v_bad
    from public.cart_items ci
    join public.products p on p.id = ci.product_id
   where ci.user_id = p_user_id and not private.product_is_sellable(p.id);
  if v_bad is not null then
    return query select 'product_unavailable'::text, null::uuid, null::text, null::text, null::jsonb, false,
                        jsonb_build_object('product_codes', v_bad);
    return;
  end if;

  -- produto cujos jogos o usuário já tem todos (comprado em outra aba)
  select jsonb_agg(p.code order by ci.added_at, p.id) into v_bad
    from public.cart_items ci
    join public.products p on p.id = ci.product_id
   where ci.user_id = p_user_id
     and exists (select 1 from public.product_games pg where pg.product_id = p.id)
     and not exists (select 1 from public.product_games pg
                      where pg.product_id = p.id
                        and pg.game_id not in (select o from private.owned_game_ids(p_user_id) o));
  if v_bad is not null then
    return query select 'already_owned'::text, null::uuid, null::text, null::text, null::jsonb, false,
                        jsonb_build_object('product_codes', v_bad);
    return;
  end if;

  -- reaproveita o pedido open da mesma versão do carrinho, do mesmo ambiente e dos mesmos termos, com os
  -- mesmos Prices de hoje e sessão ainda dentro do prazo (a trava do pedido não é tomada aqui: ver cabeçalho)
  select o.id into v_order_id
    from public.orders o
   where o.user_id = p_user_id
     and o.status = 'open'
     and o.cart_version = p_cart_version
     and o.livemode = p_livemode
     and o.terms_version = v_terms
     and (o.checkout_expires_at is null or o.checkout_expires_at > now())
     and (select count(*) from public.order_items oi where oi.order_id = o.id) = v_n_items
     and not exists (select 1
                       from public.order_items oi
                       left join public.cart_items ci on ci.user_id = p_user_id and ci.product_id = oi.product_id
                       left join public.products p on p.id = oi.product_id
                      where oi.order_id = o.id
                        and (ci.product_id is null or oi.stripe_price_id is distinct from p.stripe_price_id))
   order by o.created_at desc, o.id desc
   limit 1;
  v_reused := v_order_id is not null;

  if not v_reused then
    insert into public.orders (user_id, email, cart_version, terms_version, terms_accepted_at, livemode)
    values (p_user_id, v_email, p_cart_version, v_terms, now(), p_livemode)
    returning id into v_order_id;

    insert into public.order_items (order_id, product_id, position, stripe_price_id)
    select v_order_id, p.id, (row_number() over (order by ci.added_at, p.id))::smallint, p.stripe_price_id
      from public.cart_items ci
      join public.products p on p.id = ci.product_id
     where ci.user_id = p_user_id;

    insert into public.order_events (order_id, from_status, to_status, source)
    values (v_order_id, null, 'open', 'checkout');
    insert into public.funnel_events (user_id, type, order_id, cart_version)
    values (p_user_id, 'checkout_started', v_order_id, p_cart_version);
  end if;

  select pf.stripe_customer_id into v_customer from public.profiles pf where pf.user_id = p_user_id;
  select jsonb_agg(jsonb_build_object('product_code', pr.code, 'stripe_price_id', oi.stripe_price_id) order by oi.position)
    into v_items
    from public.order_items oi
    join public.products pr on pr.id = oi.product_id
   where oi.order_id = v_order_id;

  return query select 'ok'::text, v_order_id, v_email, v_customer, v_items, v_reused, null::jsonb;
end $$;

-- ===== 5. attach_checkout_session ===================================================================
create function public.attach_checkout_session(
  p_order_id            uuid,
  p_checkout_session_id text,
  p_expires_at          timestamptz default null
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders%rowtype;
begin
  if p_order_id is null or p_checkout_session_id is null
     or p_checkout_session_id !~ '^cs_(test|live)_[A-Za-z0-9_]+$' then
    raise exception 'attach_checkout_session: argumentos inválidos' using errcode = 'KT001';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    return 'not_found';
  end if;
  if (left(p_checkout_session_id, 8) = 'cs_live_') is distinct from v_order.livemode then
    raise exception 'attach_checkout_session: sessão % de outro ambiente (livemode do pedido: %)',
      left(p_checkout_session_id, 8), v_order.livemode using errcode = 'KT005';
  end if;
  if v_order.stripe_checkout_session_id is not null then
    if v_order.stripe_checkout_session_id = p_checkout_session_id then
      return 'noop';
    end if;
    raise exception 'attach_checkout_session: o pedido já tem outra sessão' using errcode = 'KT004';
  end if;
  if v_order.status <> 'open' then
    return 'ignored';
  end if;

  update public.orders o
     set stripe_checkout_session_id = p_checkout_session_id, checkout_expires_at = p_expires_at
   where o.id = p_order_id;
  return 'applied';
end $$;

-- ===== 6. fulfill_order: pagamento confirmado -> pedido paid + um direito por item ===================
create function public.fulfill_order(
  p_order_id            uuid,
  p_checkout_session_id text,
  p_payment_status      text,      -- 'paid'; 'no_payment_required' só com total 0 e desconto > 0 (cupom de 100%, D-25)
  p_amount_subtotal     bigint,    -- da sessão, antes do desconto
  p_amount_discount     bigint,    -- total_details.amount_discount da sessão (0 sem cupom)
  p_amount_total        bigint,
  p_currency            text,
  p_promotion_code      text,      -- texto do código promocional; NULL sem código
  p_payment_intent_id   text,      -- NULL permitido (cupom de 100% não tem intent); nunca apaga nem sobrescreve o gravado
  p_customer_id         text,
  p_livemode            boolean,
  p_items               jsonb,     -- [ { "stripe_price_id", "quantity", "unit_amount" (preço cheio), "currency" } ]
  p_source              text default 'webhook',
  p_stripe_event_id     text default null,
  p_event_type          text default null
) returns table (
  outcome           text,
  order_id          uuid,
  order_status      text,
  entitlement_count integer,
  outbox_id         uuid,
  send_delivery     boolean
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_order      public.orders%rowtype;
  v_code       text := nullif(btrim(p_promotion_code), '');
  v_event_type text := coalesce(nullif(btrim(p_event_type), ''), 'unspecified');
  v_outcome    text;
  v_customer   text;
  v_count      integer;
  v_outbox_id  uuid;
  v_send       boolean := false;
  v_rows       integer;
  v_item_count integer;
  v_sum        bigint;
  v_ent        uuid;
  v_to_email   text;
  v_payload    jsonb;
  r            record;
begin
  -- 1. argumentos
  if p_order_id is null or p_checkout_session_id is null or p_checkout_session_id !~ '^cs_(test|live)_[A-Za-z0-9_]+$'
     or p_payment_status is null
     or p_amount_subtotal is null or p_amount_discount is null or p_amount_total is null
     or p_amount_subtotal < 0 or p_amount_discount < 0 or p_amount_total < 0
     or p_currency is null or p_currency !~ '^[a-z]{3}$'
     or p_livemode is null
     or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
     or p_source is null or p_source not in ('webhook', 'return_page', 'reconcile')
     or (p_stripe_event_id is not null and p_stripe_event_id !~ '^evt_[A-Za-z0-9_]+$')
     or (p_payment_intent_id is not null and p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$')
     or (p_customer_id is not null and p_customer_id !~ '^cus_[A-Za-z0-9_]+$')
     or (v_code is not null and char_length(v_code) > 200)
     or char_length(v_event_type) > 100 then
    raise exception 'fulfill_order: argumentos inválidos' using errcode = 'KT001';
  end if;
  if p_payment_status not in ('paid', 'no_payment_required')
     or (p_payment_status = 'no_payment_required' and not (p_amount_total = 0 and p_amount_discount > 0)) then
    raise exception 'fulfill_order: pagamento não confirmado (payment_status=%, total=%, desconto=%)',
      p_payment_status, p_amount_total, p_amount_discount using errcode = 'KT002';
  end if;

  -- 2. trava o pedido
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    if p_stripe_event_id is not null then
      insert into public.stripe_events (id, type, livemode, stripe_object_id, order_id, outcome)
      values (p_stripe_event_id, v_event_type, p_livemode, p_checkout_session_id, null, 'not_found')
      on conflict (id) do nothing;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        return query select 'duplicate_event'::text, null::uuid, null::text, null::integer, null::uuid, false;
        return;
      end if;
    end if;
    return query select 'not_found'::text, null::uuid, null::text, null::integer, null::uuid, false;
    return;
  end if;

  -- 3. ambiente
  if v_order.livemode is distinct from p_livemode
     or (left(p_checkout_session_id, 8) = 'cs_live_') is distinct from v_order.livemode then
    raise exception 'fulfill_order: livemode do pedido (%) diferente do evento (%)', v_order.livemode, p_livemode
      using errcode = 'KT005';
  end if;

  select count(*)::integer into v_count from public.entitlements e where e.order_id = p_order_id;
  select x.id into v_outbox_id from public.email_outbox x where x.dedupe_key = 'delivery:' || p_order_id::text;

  -- 4. evento repetido: nada muda
  if p_stripe_event_id is not null and exists (select 1 from public.stripe_events e where e.id = p_stripe_event_id) then
    return query select 'duplicate_event'::text, p_order_id, v_order.status, v_count, v_outbox_id, false;
    return;
  end if;

  -- 5. sessão, intent e cliente têm de ser os já associados ao pedido
  if v_order.stripe_checkout_session_id is not null and v_order.stripe_checkout_session_id <> p_checkout_session_id then
    raise exception 'fulfill_order: o pedido já está associado a outra sessão' using errcode = 'KT004';
  end if;
  if p_payment_intent_id is not null and v_order.stripe_payment_intent_id is not null
     and v_order.stripe_payment_intent_id <> p_payment_intent_id then
    raise exception 'fulfill_order: o pedido já está associado a outro payment_intent' using errcode = 'KT004';
  end if;
  if p_customer_id is not null then
    select pf.stripe_customer_id into v_customer from public.profiles pf where pf.user_id = v_order.user_id;
    if v_customer is not null and v_customer <> p_customer_id then
      raise exception 'fulfill_order: o perfil já está associado a outro cliente da Stripe' using errcode = 'KT004';
    end if;
  end if;

  -- 6. estado: paid = noop; open e pending_payment seguem; os demais são ignorados
  if v_order.status not in ('open', 'pending_payment') then
    v_outcome := case when v_order.status = 'paid' then 'noop' else 'ignored' end;
    if p_stripe_event_id is not null then
      insert into public.stripe_events (id, type, livemode, stripe_object_id, order_id, outcome)
      values (p_stripe_event_id, v_event_type, p_livemode, p_checkout_session_id, p_order_id, v_outcome);
    end if;
    return query select v_outcome, p_order_id, v_order.status, v_count, v_outbox_id, false;
    return;
  end if;

  -- 7. itens da sessão = itens do pedido; valores fecham (D-24)
  select count(*)::integer into v_item_count from public.order_items oi where oi.order_id = p_order_id;
  if (select count(*) from jsonb_array_elements(p_items)) <> v_item_count
     or (select count(distinct e->>'stripe_price_id') from jsonb_array_elements(p_items) e) <> v_item_count
     or exists (select 1 from jsonb_array_elements(p_items) e
                 where jsonb_typeof(e) <> 'object'
                    or e->>'stripe_price_id' is null
                    or (e->>'quantity') is distinct from '1'
                    or coalesce(e->>'unit_amount', '') !~ '^[0-9]{1,15}$'
                    or (e->>'currency') is distinct from p_currency)
     or exists (select 1 from public.order_items oi
                 where oi.order_id = p_order_id
                   and not exists (select 1 from jsonb_array_elements(p_items) e
                                    where e->>'stripe_price_id' = oi.stripe_price_id)) then
    raise exception 'fulfill_order: as line_items da sessão não batem com os itens do pedido' using errcode = 'KT012';
  end if;
  select sum((e->>'unit_amount')::bigint) into v_sum from jsonb_array_elements(p_items) e;
  if v_sum <> p_amount_subtotal or p_amount_discount > p_amount_subtotal
     or p_amount_subtotal - p_amount_discount <> p_amount_total then
    raise exception 'fulfill_order: valores da sessão não fecham (itens=%, subtotal=%, desconto=%, total=%)',
      v_sum, p_amount_subtotal, p_amount_discount, p_amount_total using errcode = 'KT012';
  end if;
  -- valores já gravados em pending_payment não mudam
  if (v_order.amount_total is not null
      and (v_order.amount_total <> p_amount_total
           or v_order.amount_subtotal is distinct from p_amount_subtotal
           or v_order.amount_discount is distinct from p_amount_discount
           or v_order.currency is distinct from p_currency))
     or (v_order.promotion_code is not null and v_code is not null and v_order.promotion_code <> v_code) then
    raise exception 'fulfill_order: valores da sessão diferentes dos já gravados no pedido' using errcode = 'KT012';
  end if;

  update public.order_items oi
     set unit_amount = (e.val->>'unit_amount')::bigint, currency = p_currency
    from jsonb_array_elements(p_items) as e(val)
   where oi.order_id = p_order_id and oi.stripe_price_id = e.val->>'stripe_price_id';

  -- 8. pedido
  update public.orders o
     set status = 'paid',
         paid_at = now(),
         amount_subtotal = p_amount_subtotal,
         amount_discount = p_amount_discount,
         amount_total = p_amount_total,
         currency = p_currency,
         promotion_code = coalesce(o.promotion_code, v_code),
         stripe_checkout_session_id = coalesce(o.stripe_checkout_session_id, p_checkout_session_id),
         stripe_payment_intent_id = coalesce(o.stripe_payment_intent_id, p_payment_intent_id)
   where o.id = p_order_id;
  if p_customer_id is not null then
    update public.profiles pf set stripe_customer_id = p_customer_id
     where pf.user_id = v_order.user_id and pf.stripe_customer_id is null;
  end if;

  -- 9. um direito por item, com a fotografia da composição
  for r in select oi.product_id from public.order_items oi where oi.order_id = p_order_id order by oi.position loop
    v_ent := null;
    insert into public.entitlements (order_id, product_id, user_id)
    values (p_order_id, r.product_id, v_order.user_id)
    on conflict (order_id, product_id) do nothing
    returning id into v_ent;
    if v_ent is not null then
      insert into public.entitlement_games (entitlement_id, game_id, position)
      select v_ent, pg.game_id, pg.position from public.product_games pg where pg.product_id = r.product_id;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        raise exception 'fulfill_order: o produto % não tem jogos na composição', r.product_id using errcode = 'KT003';
      end if;
    end if;
  end loop;
  select count(*)::integer into v_count from public.entitlements e where e.order_id = p_order_id;

  -- 10. carrinho: tira os produtos pagos e sobe a version (trava o carrinho depois do pedido)
  perform 1 from public.carts c where c.user_id = v_order.user_id for update;
  if found then
    delete from public.cart_items ci
     where ci.user_id = v_order.user_id
       and ci.product_id in (select oi.product_id from public.order_items oi where oi.order_id = p_order_id);
    update public.carts c set version = c.version + 1 where c.user_id = v_order.user_id;
  end if;
  update public.email_outbox x
     set status = 'canceled', skip_reason = 'already_purchased'
   where x.user_id = v_order.user_id and x.kind = 'cart_reminder' and x.status = 'queued';

  -- 11. entrega: uma por pedido (dedupe_key), com um jogo por direito, sem token
  select coalesce(private.normalize_email(u.email), v_order.email) into v_to_email
    from auth.users u where u.id = v_order.user_id;
  v_to_email := coalesce(v_to_email, v_order.email);
  select jsonb_build_object(
           'order_ref', upper(left(replace(p_order_id::text, '-', ''), 8)),
           'items', coalesce((select jsonb_agg(jsonb_build_object('code', pr.code, 'name', pr.name) order by oi.position)
                                from public.order_items oi
                                join public.products pr on pr.id = oi.product_id
                               where oi.order_id = p_order_id), '[]'::jsonb),
           'games', coalesce((select jsonb_agg(jsonb_build_object('entitlement_id', t.entitlement_id, 'game_id', t.game_id,
                                                                  'code', t.code, 'name', t.name)
                                               order by t.item_position, t.game_position, t.game_id)
                                from (select distinct on (g.id)
                                             e.id as entitlement_id, g.id as game_id, g.code, g.name,
                                             oi.position as item_position, eg.position as game_position
                                        from public.entitlements e
                                        join public.order_items oi on oi.order_id = e.order_id and oi.product_id = e.product_id
                                        join public.entitlement_games eg on eg.entitlement_id = e.id
                                        join public.games g on g.id = eg.game_id
                                       where e.order_id = p_order_id
                                       order by g.id, oi.position) t), '[]'::jsonb))
    into v_payload;

  v_outbox_id := null;
  insert into public.email_outbox (user_id, order_id, kind, category, to_email, payload, dedupe_key)
  values (v_order.user_id, p_order_id, 'delivery', 'transactional', v_to_email, v_payload, 'delivery:' || p_order_id::text)
  on conflict (dedupe_key) do nothing
  returning id into v_outbox_id;
  v_send := v_outbox_id is not null;
  if not v_send then
    select x.id into v_outbox_id from public.email_outbox x where x.dedupe_key = 'delivery:' || p_order_id::text;
  end if;

  -- 12. trilha, funil e livro-razão do evento (na mesma transação)
  insert into public.order_events (order_id, from_status, to_status, source, stripe_event_id)
  values (p_order_id, v_order.status, 'paid', p_source, p_stripe_event_id);
  insert into public.funnel_events (user_id, type, order_id) values (v_order.user_id, 'order_paid', p_order_id);
  if p_stripe_event_id is not null then
    insert into public.stripe_events (id, type, livemode, stripe_object_id, order_id, outcome)
    values (p_stripe_event_id, v_event_type, p_livemode, p_checkout_session_id, p_order_id, 'applied');
  end if;

  return query select 'applied'::text, p_order_id, 'paid'::text, v_count, v_outbox_id, v_send;
end $$;

-- ===== 7. set_order_status: demais transições ========================================================
create function public.set_order_status(
  p_order_id          uuid,
  p_new_status        text,
  p_source            text default 'webhook',
  p_stripe_event_id   text default null,
  p_reason            text default null,
  p_amount_total      bigint default null,
  p_currency          text default null,
  p_payment_intent_id text default null,
  p_amount_subtotal   bigint default null,
  p_amount_discount   bigint default null,
  p_promotion_code    text default null,
  p_event_type        text default null
) returns table (
  outcome            text,
  order_id           uuid,
  previous_status    text,
  order_status       text,
  entitlement_status text
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_order      public.orders%rowtype;
  v_code       text := nullif(btrim(p_promotion_code), '');
  v_event_type text := coalesce(nullif(btrim(p_event_type), ''), 'unspecified');
  v_outcome    text;
  v_ent_status text;
begin
  if p_order_id is null or p_new_status is null
     or p_new_status not in ('pending_payment', 'failed', 'expired', 'disputed', 'dispute_lost', 'refunded', 'paid')
     or p_source is null or p_source not in ('webhook', 'return_page', 'reconcile')
     or (p_stripe_event_id is not null and p_stripe_event_id !~ '^evt_[A-Za-z0-9_]+$')
     or (p_reason is not null and char_length(p_reason) > 200)
     or (p_payment_intent_id is not null and p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$')
     or (p_currency is not null and p_currency !~ '^[a-z]{3}$')
     or p_amount_total < 0 or p_amount_subtotal < 0 or p_amount_discount < 0
     or (v_code is not null and char_length(v_code) > 200)
     or char_length(v_event_type) > 100 then
    raise exception 'set_order_status: argumentos inválidos' using errcode = 'KT001';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    -- sem o pedido não há livemode para o livro-razão: o evento não é gravado; a rota registra no log
    return query select 'not_found'::text, null::uuid, null::text, null::text, null::text;
    return;
  end if;

  select case when count(*) = 0 then null
              when count(*) filter (where e.status = 'active') > 0 then 'active'
              else 'revoked' end
    into v_ent_status from public.entitlements e where e.order_id = p_order_id;

  -- evento repetido
  if p_stripe_event_id is not null and exists (select 1 from public.stripe_events e where e.id = p_stripe_event_id) then
    return query select 'duplicate_event'::text, p_order_id, v_order.status, v_order.status, v_ent_status;
    return;
  end if;

  -- mesmo estado
  if v_order.status = p_new_status then
    if p_stripe_event_id is not null then
      insert into public.stripe_events (id, type, livemode, stripe_object_id, order_id, outcome)
      values (p_stripe_event_id, v_event_type, v_order.livemode, v_order.stripe_checkout_session_id, p_order_id, 'noop');
    end if;
    return query select 'noop'::text, p_order_id, v_order.status, v_order.status, v_ent_status;
    return;
  end if;

  -- 'paid' a partir de open/pending_payment é da fulfill_order (cria os direitos)
  if p_new_status = 'paid' and v_order.status in ('open', 'pending_payment') then
    raise exception 'set_order_status: use fulfill_order para pagar um pedido %', v_order.status using errcode = 'KT001';
  end if;

  -- o evento de cobrança chegou antes da liberação: a Stripe reenvia (não grava o evento)
  if (p_new_status in ('disputed', 'dispute_lost', 'refunded') and v_order.status in ('open', 'pending_payment'))
     or (p_new_status = 'dispute_lost' and v_order.status = 'paid') then
    return query select 'deferred'::text, p_order_id, v_order.status, v_order.status, v_ent_status;
    return;
  end if;

  -- aresta inexistente
  if not private.order_transition_allowed(v_order.status, p_new_status) then
    if p_stripe_event_id is not null then
      insert into public.stripe_events (id, type, livemode, stripe_object_id, order_id, outcome)
      values (p_stripe_event_id, v_event_type, v_order.livemode, v_order.stripe_checkout_session_id, p_order_id, 'ignored');
    end if;
    return query select 'ignored'::text, p_order_id, v_order.status, v_order.status, v_ent_status;
    return;
  end if;

  -- aplicar
  if p_new_status = 'pending_payment' then
    if p_amount_total is null or p_amount_subtotal is null or p_amount_discount is null or p_currency is null then
      raise exception 'set_order_status: pending_payment exige subtotal, desconto, total e moeda' using errcode = 'KT007';
    end if;
    if p_amount_discount > p_amount_subtotal or p_amount_subtotal - p_amount_discount <> p_amount_total then
      raise exception 'set_order_status: valores da sessão não fecham (subtotal=%, desconto=%, total=%)',
        p_amount_subtotal, p_amount_discount, p_amount_total using errcode = 'KT012';
    end if;
    update public.orders o
       set status = 'pending_payment', amount_subtotal = p_amount_subtotal, amount_discount = p_amount_discount,
           amount_total = p_amount_total, currency = p_currency, promotion_code = v_code,
           stripe_payment_intent_id = coalesce(o.stripe_payment_intent_id, p_payment_intent_id)
     where o.id = p_order_id;

  elsif p_new_status = 'failed' then
    update public.orders o set status = 'failed' where o.id = p_order_id;

  elsif p_new_status = 'expired' then
    update public.orders o set status = 'expired' where o.id = p_order_id;
    insert into public.funnel_events (user_id, type, order_id) values (v_order.user_id, 'checkout_expired', p_order_id);

  elsif p_new_status = 'disputed' then
    update public.orders o set status = 'disputed' where o.id = p_order_id;
    update public.entitlements e
       set status = 'revoked', revoked_at = now(), revoke_reason = private.access_effect('disputed')
     where e.order_id = p_order_id and e.status = 'active';
    perform private.cancel_order_emails(p_order_id, 'entitlement_revoked');
    insert into public.funnel_events (user_id, type, order_id) values (v_order.user_id, 'dispute_opened', p_order_id);

  elsif p_new_status = 'paid' then   -- disputed -> paid: reativa só o que a contestação revogou
    update public.orders o set status = 'paid' where o.id = p_order_id;
    update public.entitlements e
       set status = 'active', revoked_at = null, revoke_reason = null
     where e.order_id = p_order_id and e.status = 'revoked' and e.revoke_reason = private.access_effect('disputed');
    insert into public.funnel_events (user_id, type, order_id) values (v_order.user_id, 'dispute_closed', p_order_id);

  elsif p_new_status = 'dispute_lost' then   -- os direitos seguem revogados (dispute)
    update public.orders o set status = 'dispute_lost' where o.id = p_order_id;
    insert into public.funnel_events (user_id, type, order_id) values (v_order.user_id, 'dispute_closed', p_order_id);

  elsif p_new_status = 'refunded' then
    update public.orders o set status = 'refunded', refunded_at = now() where o.id = p_order_id;
    update public.entitlements e
       set status = 'revoked', revoked_at = coalesce(e.revoked_at, now()), revoke_reason = private.access_effect('refunded')
     where e.order_id = p_order_id and (e.status = 'active' or e.revoke_reason = private.access_effect('disputed'));
    perform private.cancel_order_emails(p_order_id, 'entitlement_revoked');
  end if;

  insert into public.order_events (order_id, from_status, to_status, source, stripe_event_id, reason)
  values (p_order_id, v_order.status, p_new_status, p_source, p_stripe_event_id, p_reason);
  if p_stripe_event_id is not null then
    insert into public.stripe_events (id, type, livemode, stripe_object_id, order_id, outcome)
    values (p_stripe_event_id, v_event_type, v_order.livemode, v_order.stripe_checkout_session_id, p_order_id, 'applied');
  end if;

  select case when count(*) = 0 then null
              when count(*) filter (where e.status = 'active') > 0 then 'active'
              else 'revoked' end
    into v_ent_status from public.entitlements e where e.order_id = p_order_id;
  v_outcome := 'applied';
  return query select v_outcome, p_order_id, v_order.status, p_new_status, v_ent_status;
end $$;

-- ===== 8. get_order_status: estado do pedido para a página de retorno ===============================
create function public.get_order_status(p_order_id uuid, p_user_id uuid)
  returns table (outcome text, status text, items jsonb, relation text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_status text;
  v_owner  uuid;
begin
  perform private.require_confirmed_email(p_user_id);
  if p_order_id is null then
    raise exception 'get_order_status: p_order_id é obrigatório' using errcode = 'KT001';
  end if;

  select o.status, o.user_id into v_status, v_owner from public.orders o where o.id = p_order_id;
  if not found then
    return query select 'not_found'::text, null::text, null::jsonb, null::text;
    return;
  end if;

  if v_owner = p_user_id then
    return query
      select 'ok'::text, v_status,
             coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name) order by oi.position)
                         from public.order_items oi
                         join public.products p on p.id = oi.product_id
                        where oi.order_id = p_order_id), '[]'::jsonb),
             'owner'::text;
  else
    -- de outro usuário: só o estado; sem itens, valores nem identificação
    return query select 'ok'::text, v_status, null::jsonb, 'other'::text;
  end if;
end $$;

-- ===== 9. get_account: pedidos com subtotal, desconto e código promocional ==========================
create or replace function public.get_account(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_confirmed_email(p_user_id);

  return jsonb_build_object(
    'email', (select u.email from auth.users u where u.id = p_user_id),
    'marketing', coalesce((
      select jsonb_build_object(
               'opted_in', p.marketing_opt_in,
               'updated_at', (select c.occurred_at from public.marketing_consents c
                              where c.user_id = p_user_id order by c.occurred_at desc, c.id desc limit 1),
               'text_version', case when p.marketing_opt_in then
                                 (select c.text_version from public.marketing_consents c
                                  where c.user_id = p_user_id and c.action = 'granted'
                                  order by c.occurred_at desc, c.id desc limit 1)
                               end,
               'prompted_at', p.marketing_prompted_at)
      from public.profiles p where p.user_id = p_user_id),
      jsonb_build_object('opted_in', false, 'updated_at', null, 'text_version', null, 'prompted_at', null)),
    'orders', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'ref', upper(left(replace(o.id::text, '-', ''), 8)),
                 'created_at', o.created_at,
                 'paid_at', o.paid_at,
                 'status', o.status,
                 'amount_subtotal', o.amount_subtotal,
                 'amount_discount', o.amount_discount,
                 'amount_total', o.amount_total,
                 'currency', o.currency,
                 'promotion_code', o.promotion_code,
                 'items', coalesce((
                   select jsonb_agg(
                            jsonb_build_object('code', p.code, 'name', p.name,
                                               'unit_amount', i.unit_amount, 'currency', i.currency)
                            order by i.position)
                   from public.order_items i
                   join public.products p on p.id = i.product_id
                   where i.order_id = o.id), '[]'::jsonb))
               order by o.created_at desc, o.id desc)
      from public.orders o
      where o.user_id = p_user_id and o.status not in ('open', 'expired')), '[]'::jsonb));
end $$;

-- ===== EXECUTE só para service_role (repetir se a função for recriada) ===============================
do $$
declare sig text;
begin
  foreach sig in array array[
    'create_order_from_cart(uuid, boolean, integer, text, boolean)',
    'attach_checkout_session(uuid, text, timestamptz)',
    'fulfill_order(uuid, text, text, bigint, bigint, bigint, text, text, text, text, boolean, jsonb, text, text, text)',
    'set_order_status(uuid, text, text, text, text, bigint, text, text, bigint, bigint, text, text)',
    'get_order_status(uuid, uuid)',
    'get_account(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', sig);
    execute format('grant execute on function public.%s to service_role', sig);
  end loop;
end $$;
