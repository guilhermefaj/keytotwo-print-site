-- Aceite no pagamento (responsável, 2026-10-24): o formulário da Stripe aparece ao abrir o pagamento, travado até a
-- pessoa marcar o "Li e aceito", logo acima dele. O pedido (e a sessão da Stripe) nasce antes do aceite, com a versão
-- dos termos mostrada; o aceite é gravado quando a pessoa marca a caixa (accept_order_terms), antes de o formulário
-- destravar. O site anterior, que só cria o pedido depois do aceite, continua mandando terms_accepted = true.
-- Uma compra sem o aceite gravado só acontece se alguém destravar o formulário à mão: o pagamento é liberado mesmo
-- assim (o dinheiro já entrou), e o pedido fica sem o momento do aceite.

-- ===== 1. Compra sempre com a versão dos termos; o momento do aceite pode faltar até a pessoa marcar ===============
alter table public.orders drop constraint orders_terms_required;
alter table public.orders
  add constraint orders_terms_required check (kind = 'courtesy' or terms_version is not null);

-- ===== 2. O pedido nasce sem o aceite; com terms_accepted = true, já aceito (o site anterior) =======================
-- (o resto igual a 20261022120000_sacola_regras.sql)
create or replace function public.create_order_from_cart(
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
  v_ids      bigint[];
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
  v_terms := btrim(p_terms_version);

  -- trava o carrinho: serializa os checkouts do mesmo usuário (o 2º reaproveita o pedido do 1º)
  select c.version into v_version from public.carts c where c.user_id = p_user_id for update;
  v_ids := array(select ci.product_id from public.cart_items ci where ci.user_id = p_user_id order by ci.added_at, ci.product_id);
  if v_version is null or cardinality(v_ids) = 0 then
    return query select 'cart_empty'::text, null::uuid, null::text, null::text, null::jsonb, false, null::jsonb;
    return;
  end if;
  if v_version <> p_cart_version then
    return query select 'cart_changed'::text, null::uuid, null::text, null::text, null::jsonb, false,
                        jsonb_build_object('cart_version', v_version);
    return;
  end if;

  -- produto que deixou de ser vendável
  select jsonb_agg(l.code order by l.line) into v_bad from private.cart_lines(p_user_id, v_ids) l where l.status = 'unavailable';
  if v_bad is not null then
    return query select 'product_unavailable'::text, null::uuid, null::text, null::text, null::jsonb, false,
                        jsonb_build_object('product_codes', v_bad);
    return;
  end if;

  -- nada a pagar: tudo já é da pessoa (comprado em outra aba, por exemplo) ou já está num pacote da sacola
  select count(*) into v_n_items from private.cart_lines(p_user_id, v_ids) l where l.status = 'ok';
  if v_n_items = 0 then
    select jsonb_agg(l.code order by l.line) into v_bad from private.cart_lines(p_user_id, v_ids) l;
    return query select 'already_owned'::text, null::uuid, null::text, null::text, null::jsonb, false,
                        jsonb_build_object('product_codes', v_bad);
    return;
  end if;

  -- reaproveita o pedido open da mesma versão do carrinho, do mesmo ambiente e dos mesmos termos, com os mesmos
  -- itens e Prices de hoje, sessão ainda dentro do prazo e nenhum jogo ganho ou perdido desde a criação (o valor
  -- do pacote depende do que a pessoa já tem)
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
                       left join private.cart_lines(p_user_id, v_ids) l on l.product_id = oi.product_id and l.status = 'ok'
                      where oi.order_id = o.id
                        and (l.product_id is null or oi.stripe_price_id is distinct from l.stripe_price_id))
     and not exists (select 1 from public.entitlements e
                      where e.user_id = p_user_id and (e.granted_at > o.created_at or e.revoked_at > o.created_at))
   order by o.created_at desc, o.id desc
   limit 1;
  v_reused := v_order_id is not null;

  if not v_reused then
    insert into public.orders (user_id, email, cart_version, terms_version, terms_accepted_at, livemode)
    values (p_user_id, v_email, p_cart_version, v_terms, case when p_terms_accepted then now() end, p_livemode)
    returning id into v_order_id;

    insert into public.order_items (order_id, product_id, position, stripe_price_id)
    select v_order_id, l.product_id, (row_number() over (order by l.line))::smallint, l.stripe_price_id
      from private.cart_lines(p_user_id, v_ids) l
     where l.status = 'ok';

    insert into public.order_events (order_id, from_status, to_status, source)
    values (v_order_id, null, 'open', 'checkout');
    insert into public.funnel_events (user_id, type, order_id, cart_version)
    values (p_user_id, 'checkout_started', v_order_id, p_cart_version);
  end if;

  -- o site anterior manda o aceite junto (terms_accepted = true): vale também para o pedido reaproveitado
  if v_reused and p_terms_accepted then
    update public.orders o set terms_accepted_at = now() where o.id = v_order_id and o.terms_accepted_at is null;
  end if;

  select pf.stripe_customer_id into v_customer from public.profiles pf where pf.user_id = p_user_id;
  select jsonb_agg(jsonb_build_object('product_code', l.code, 'stripe_price_id', oi.stripe_price_id, 'kind', l.kind,
                                      'games', l.games, 'owned_games', l.owned_games) order by oi.position)
    into v_items
    from public.order_items oi
    join private.cart_lines(p_user_id, v_ids) l on l.product_id = oi.product_id
   where oi.order_id = v_order_id;

  return query select 'ok'::text, v_order_id, v_email, v_customer, v_items, v_reused, null::jsonb;
end $$;

-- ===== 3. O aceite marcado no pagamento ==========================================================================
-- Só no pedido de compra aberto da própria pessoa e na versão dos termos com que ele nasceu (mudou: terms_changed).
-- Marcar de novo não muda o momento gravado.
create function public.accept_order_terms(p_user_id uuid, p_order_id uuid, p_terms_version text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
begin
  if p_user_id is null or p_order_id is null or p_terms_version is null or btrim(p_terms_version) = '' then
    raise exception 'accept_order_terms: argumentos inválidos' using errcode = 'KT001';
  end if;
  select * into v_order from public.orders o
   where o.id = p_order_id and o.user_id = p_user_id and o.kind = 'purchase'
     for update;
  if not found or v_order.status <> 'open' then
    return 'not_found';
  end if;
  if v_order.terms_version is distinct from btrim(p_terms_version) then
    return 'terms_changed';
  end if;
  if v_order.terms_accepted_at is null then
    update public.orders o set terms_accepted_at = now() where o.id = p_order_id;
  end if;
  return 'ok';
end $$;

revoke all on function public.accept_order_terms(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.accept_order_terms(uuid, uuid, text) to service_role;
