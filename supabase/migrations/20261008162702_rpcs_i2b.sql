-- RPCs do I2b (docs/data-contract.md v0.3.2, seção 6): catálogo, carrinho, biblioteca, conta, consentimento e convite de marketing.
-- Todas SECURITY DEFINER com search_path vazio e EXECUTE só para service_role (o backend valida o JWT e passa o user_id).
-- Com p_user_id, exigem e-mail confirmado (KT009), exceto unsubscribe.
-- NÃO estão aqui, de propósito (sem stub): create_order_from_cart, attach_checkout_session, fulfill_order,
-- set_order_status, get_order_status (I3); resolve_download, resolve_delivery, get_free_game,
-- resolve_free_download, claim_email_batch, mark_email_result (I4); record_email_event e private.enqueue_followups (I5).

-- Cancela o marketing ainda na fila de um usuário (descadastro, revogação do consentimento).
create function private.cancel_queued_marketing(p_user_id uuid) returns integer
language plpgsql set search_path = '' as $$
declare v_count integer;
begin
  update public.email_outbox
     set status = 'canceled', skip_reason = 'no_opt_in'
   where user_id = p_user_id and category = 'marketing' and status = 'queued';
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function private.cancel_queued_marketing(uuid) from public, anon, authenticated, service_role;

-- ===== get_catalog ================================================================================
create function public.get_catalog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'code', p.code,
             'kind', p.kind,
             'name', p.name,
             'stripe_price_id', p.stripe_price_id,
             'games', coalesce((
               select jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name) order by pg.position)
               from public.product_games pg
               join public.games g on g.id = pg.game_id
               where pg.product_id = p.id), '[]'::jsonb))
           order by p.id), '[]'::jsonb)
  from public.products p
  where p.status = 'active' and private.product_is_sellable(p.id)
$$;

-- ===== get_cart ===================================================================================
create function public.get_cart(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_confirmed_email(p_user_id);

  return jsonb_build_object(
    'version', coalesce((select c.version from public.carts c where c.user_id = p_user_id), 0),
    'items', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'code', p.code,
                 'kind', p.kind,
                 'name', p.name,
                 'stripe_price_id', p.stripe_price_id,
                 'games', coalesce((
                   select jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name) order by pg.position)
                   from public.product_games pg
                   join public.games g on g.id = pg.game_id
                   where pg.product_id = p.id), '[]'::jsonb),
                 'available', (st.status = 'ok'),
                 'status', st.status,
                 'owned_games', coalesce((
                   select jsonb_agg(g.code order by pg.position)
                   from public.product_games pg
                   join public.games g on g.id = pg.game_id
                   where pg.product_id = p.id
                     and pg.game_id in (select o from private.owned_game_ids(p_user_id) o)), '[]'::jsonb),
                 'shared_with', coalesce((
                   select jsonb_agg(distinct p2.code order by p2.code)
                   from public.cart_items ci2
                   join public.products p2 on p2.id = ci2.product_id
                   where ci2.user_id = p_user_id
                     and p2.id <> p.id
                     and exists (select 1
                                 from public.product_games pg2
                                 join public.product_games pg3 on pg3.game_id = pg2.game_id
                                 where pg2.product_id = p.id and pg3.product_id = p2.id)), '[]'::jsonb))
               order by ci.added_at, p.id)
      from public.cart_items ci
      join public.products p on p.id = ci.product_id
      cross join lateral (
        select case
                 when not private.product_is_sellable(p.id) then 'unavailable'
                 when exists (select 1 from public.product_games pg where pg.product_id = p.id)
                      and not exists (select 1 from public.product_games pg
                                      where pg.product_id = p.id
                                        and pg.game_id not in (select o from private.owned_game_ids(p_user_id) o))
                   then 'already_owned'
                 else 'ok'
               end as status) st
      where ci.user_id = p_user_id), '[]'::jsonb));
end $$;

-- ===== cart_add ===================================================================================
create function public.cart_add(p_user_id uuid, p_product_code text)
  returns table (outcome text, cart_version integer, owned_games jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  v_product_id bigint;
  v_version    integer;
  v_total      integer;
  v_owned      integer;
  v_codes      jsonb;
  v_inserted   integer;
begin
  perform private.require_confirmed_email(p_user_id);
  if p_product_code is null or btrim(p_product_code) = '' then
    raise exception 'cart_add: p_product_code é obrigatório' using errcode = 'KT001';
  end if;

  -- cria o carrinho se não existe e trava (serializa as mudanças do mesmo usuário)
  insert into public.carts (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select c.version into v_version from public.carts c where c.user_id = p_user_id for update;

  select p.id into v_product_id from public.products p where p.code = p_product_code;
  if v_product_id is null or not private.product_is_sellable(v_product_id) then
    return query select 'product_unavailable'::text, v_version, '[]'::jsonb;
    return;
  end if;

  select count(*), count(*) filter (where pg.game_id in (select o from private.owned_game_ids(p_user_id) o)),
         coalesce(jsonb_agg(g.code order by pg.position)
                  filter (where pg.game_id in (select o from private.owned_game_ids(p_user_id) o)), '[]'::jsonb)
    into v_total, v_owned, v_codes
    from public.product_games pg
    join public.games g on g.id = pg.game_id
   where pg.product_id = v_product_id;

  if v_total > 0 and v_owned = v_total then
    return query select 'already_owned'::text, v_version, v_codes;
    return;
  end if;

  insert into public.cart_items (user_id, product_id) values (p_user_id, v_product_id)
  on conflict (user_id, product_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return query select 'noop'::text, v_version, v_codes;
    return;
  end if;

  update public.carts c set version = c.version + 1 where c.user_id = p_user_id returning c.version into v_version;
  insert into public.funnel_events (user_id, type, product_id, cart_version)
  values (p_user_id, 'cart_item_added', v_product_id, v_version);

  return query select 'added'::text, v_version, v_codes;
end $$;

-- ===== cart_remove ================================================================================
create function public.cart_remove(p_user_id uuid, p_product_code text)
  returns table (outcome text, cart_version integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_product_id bigint;
  v_version    integer;
  v_deleted    integer;
begin
  perform private.require_confirmed_email(p_user_id);
  if p_product_code is null or btrim(p_product_code) = '' then
    raise exception 'cart_remove: p_product_code é obrigatório' using errcode = 'KT001';
  end if;

  select c.version into v_version from public.carts c where c.user_id = p_user_id for update;
  if not found then
    return query select 'noop'::text, 0;
    return;
  end if;

  select p.id into v_product_id from public.products p where p.code = p_product_code;
  if v_product_id is null then
    return query select 'noop'::text, v_version;
    return;
  end if;

  delete from public.cart_items ci where ci.user_id = p_user_id and ci.product_id = v_product_id;
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    return query select 'noop'::text, v_version;
    return;
  end if;

  update public.carts c set version = c.version + 1 where c.user_id = p_user_id returning c.version into v_version;
  insert into public.funnel_events (user_id, type, product_id, cart_version)
  values (p_user_id, 'cart_item_removed', v_product_id, v_version);

  return query select 'removed'::text, v_version;
end $$;

-- ===== get_library: Meus jogos (por jogo) + pedidos em processamento ===============================
create function public.get_library(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_confirmed_email(p_user_id);

  return (
    with ent as (
      select e.id, e.product_id, e.granted_at
      from public.entitlements e
      where e.user_id = p_user_id and e.status = 'active'
    ),
    owned as (
      select eg.game_id, ent.product_id, ent.granted_at, eg.position
      from ent
      join public.entitlement_games eg on eg.entitlement_id = ent.id
    ),
    per_game as (
      select o.game_id, min(o.granted_at) as acquired_at, min(o.position) as pos
      from owned o
      group by o.game_id
    )
    select jsonb_build_object(
      'games', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'code', g.code,
                   'name', g.name,
                   'acquired_at', pgm.acquired_at,
                   'products', (
                     select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name) order by p.code)
                     from public.products p
                     where p.id in (select o.product_id from owned o where o.game_id = pgm.game_id)),
                   'files', coalesce((
                     select jsonb_agg(
                              jsonb_build_object('id', f.id, 'kind', f.kind, 'version', f.version,
                                                 'size_bytes', f.size_bytes)
                              order by f.kind, f.version)
                     from public.files f
                     where f.game_id = g.id and f.access = 'paid' and f.status = 'published'), '[]'::jsonb))
                 order by pgm.acquired_at, pgm.pos, g.code)
        from per_game pgm
        join public.games g on g.id = pgm.game_id), '[]'::jsonb),
      'pending', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'ref', upper(left(replace(o.id::text, '-', ''), 8)),
                   'created_at', o.created_at,
                   'products', (
                     select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name) order by i.position)
                     from public.order_items i
                     join public.products p on p.id = i.product_id
                     where i.order_id = o.id))
                 order by o.created_at desc, o.id desc)
        from public.orders o
        where o.user_id = p_user_id and o.status = 'pending_payment'), '[]'::jsonb)
    )
  );
end $$;

-- ===== get_account: Minha conta ====================================================================
create function public.get_account(p_user_id uuid) returns jsonb
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
                 'amount_total', o.amount_total,
                 'currency', o.currency,
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

-- ===== set_marketing_consent ======================================================================
create function public.set_marketing_consent(p_user_id uuid, p_granted boolean, p_source text,
                                             p_text_version text default null)
  returns table (outcome text, opted_in boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_email   text;
  v_current boolean;
begin
  v_email := private.require_confirmed_email(p_user_id);
  if p_granted is null or p_source is null or p_source not in ('signup_prompt', 'account', 'cart') then
    raise exception 'set_marketing_consent: argumentos inválidos' using errcode = 'KT001';
  end if;
  if p_granted and (p_text_version is null or btrim(p_text_version) = '') then
    raise exception 'set_marketing_consent: conceder exige a versão do texto' using errcode = 'KT001';
  end if;
  if not p_granted and p_source in ('signup_prompt', 'cart') then
    raise exception 'set_marketing_consent: a origem % só concede', p_source using errcode = 'KT001';
  end if;

  select p.marketing_opt_in into v_current from public.profiles p where p.user_id = p_user_id for update;
  if not found then
    raise exception 'set_marketing_consent: usuário sem perfil' using errcode = 'KT001';
  end if;

  -- O convite foi exibido: registra a 1ª vez (vale entre aparelhos). Ver ou dispensar o convite NÃO é consentimento.
  if p_source = 'signup_prompt' then
    update public.profiles p set marketing_prompted_at = now()
     where p.user_id = p_user_id and p.marketing_prompted_at is null;
  end if;

  -- mesmo estado: nada novo no histórico
  if v_current = p_granted then
    return query select 'noop'::text, v_current;
    return;
  end if;

  insert into public.marketing_consents (user_id, email, action, source, text_version)
  values (p_user_id, v_email, case when p_granted then 'granted' else 'revoked' end, p_source,
          case when p_granted then p_text_version end);   -- a trigger atualiza profiles

  if not p_granted then
    perform private.cancel_queued_marketing(p_user_id);
  end if;
  return query select 'applied'::text, p_granted;
end $$;

-- ===== mark_marketing_prompt: o convite de marketing foi exibido (NÃO é consentimento) =============
-- Idempotente: grava now() se ainda nulo e devolve o valor gravado. Nada entra em marketing_consents.
create function public.mark_marketing_prompt(p_user_id uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_prompted timestamptz;
begin
  perform private.require_confirmed_email(p_user_id);

  update public.profiles p set marketing_prompted_at = now()
   where p.user_id = p_user_id and p.marketing_prompted_at is null;
  select p.marketing_prompted_at into v_prompted from public.profiles p where p.user_id = p_user_id;
  if not found then
    raise exception 'mark_marketing_prompt: usuário sem perfil' using errcode = 'KT001';
  end if;
  return v_prompted;
end $$;

-- ===== unsubscribe: descadastro em 1 clique (não exige e-mail confirmado) ==========================
create function public.unsubscribe(p_user_id uuid, p_source text default 'unsubscribe_link')
  returns table (outcome text, opted_in boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_email   text;
  v_current boolean;
begin
  if p_user_id is null or p_source is null or p_source not in ('unsubscribe_link', 'support') then
    raise exception 'unsubscribe: argumentos inválidos' using errcode = 'KT001';
  end if;
  select private.normalize_email(u.email) into v_email from auth.users u where u.id = p_user_id and u.deleted_at is null;
  if v_email is null then
    raise exception 'unsubscribe: usuário sem e-mail' using errcode = 'KT001';
  end if;

  select p.marketing_opt_in into v_current from public.profiles p where p.user_id = p_user_id for update;
  if not found then
    raise exception 'unsubscribe: usuário sem perfil' using errcode = 'KT001';
  end if;

  -- o efeito é imediato: o marketing que sobrou na fila sai mesmo que o estado já fosse "sem opt-in"
  perform private.cancel_queued_marketing(p_user_id);
  if not v_current then
    return query select 'noop'::text, false;
    return;
  end if;

  insert into public.marketing_consents (user_id, email, action, source)
  values (p_user_id, v_email, 'revoked', p_source);
  return query select 'applied'::text, false;
end $$;

-- ===== set_stripe_customer: devolve o cliente vigente, sem sobrescrever ============================
create function public.set_stripe_customer(p_user_id uuid, p_stripe_customer_id text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_current text;
begin
  perform private.require_confirmed_email(p_user_id);
  if p_stripe_customer_id is null or p_stripe_customer_id !~ '^cus_[A-Za-z0-9_]+$' then
    raise exception 'set_stripe_customer: cliente da Stripe inválido' using errcode = 'KT001';
  end if;

  update public.profiles p set stripe_customer_id = p_stripe_customer_id
   where p.user_id = p_user_id and p.stripe_customer_id is null;
  select p.stripe_customer_id into v_current from public.profiles p where p.user_id = p_user_id;
  if not found then
    raise exception 'set_stripe_customer: usuário sem perfil' using errcode = 'KT001';
  end if;
  return v_current;
end $$;

-- ===== EXECUTE só para service_role (repetir se a função for recriada) =============================
do $$
declare sig text;
begin
  foreach sig in array array[
    'get_catalog()', 'get_cart(uuid)', 'cart_add(uuid, text)', 'cart_remove(uuid, text)',
    'get_library(uuid)', 'get_account(uuid)', 'set_marketing_consent(uuid, boolean, text, text)',
    'mark_marketing_prompt(uuid)', 'unsubscribe(uuid, text)', 'set_stripe_customer(uuid, text)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', sig);
    execute format('grant execute on function public.%s to service_role', sig);
  end loop;
end $$;
