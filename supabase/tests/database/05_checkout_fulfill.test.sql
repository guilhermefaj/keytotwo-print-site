-- 05_checkout_fulfill: create_order_from_cart, attach_checkout_session, fulfill_order (2 itens, cupom, idempotência),
-- Roda com `supabase test db` (pgTAP). Dados de teste só existem dentro da transação (rollback no fim).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp) ============================================
-- expect: executa o SQL e compara o SQLSTATE obtido ('OK' = sem erro) com o esperado.
create function pg_temp.expect(p_label text, p_sql text, p_state text) returns text language plpgsql as $$
declare st text := 'OK';
begin
  begin execute p_sql; exception when others then get stacked diagnostics st = returned_sqlstate; end;
  return extensions.is(st, p_state, p_label);
end $$;

-- expect_as: o mesmo, mas com o papel trocado (o pgTAP roda de volta como dono).
create function pg_temp.expect_as(p_label text, p_role text, p_sql text, p_state text) returns text language plpgsql as $$
declare st text := 'OK';
begin
  execute format('set local role %I', p_role);
  begin execute p_sql; exception when others then get stacked diagnostics st = returned_sqlstate; end;
  reset role;
  return extensions.is(st, p_state, p_label);
end $$;

create function pg_temp.assert(p_label text, p_cond boolean) returns text language sql as $$
  select extensions.ok(coalesce(p_cond, false), p_label)
$$;

create temp table ids (name text primary key, id uuid);
create function pg_temp.uid(p_name text) returns uuid language sql as $$ select id from pg_temp.ids where name = p_name $$;

-- usuário do Auth (as triggers criam o perfil e o account_confirmed)
create function pg_temp.mk_user(p_name text, p_confirmed boolean default true, p_password text default null) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_name || '@pgtap.test', p_password,
          case when p_confirmed then now() end, '', '', '', '', now(), now());
  insert into pg_temp.ids values (p_name, v_id);
  return v_id;
end $$;

-- produto ativo com N jogos publicados (PDF pago publicado + objeto no B2)
create function pg_temp.mk_product(p_code text, p_kind text, p_games int) returns bigint
language plpgsql as $$
declare v_pid bigint; v_gid bigint; v_fid uuid; i int; v_gcode text;
begin
  insert into public.products (code, slug, kind, name, status, stripe_price_id, games_expected)
  values (p_code, lower(p_code), p_kind, 'Produto ' || p_code || ' [TESTE]', 'active', 'price_PGTAP_' || p_code, p_games)
  returning id into v_pid;
  for i in 1..p_games loop
    v_gcode := 'GM-' || p_code || '-' || i;
    insert into public.games (code, slug, name, status) values (v_gcode, lower(v_gcode), 'Jogo ' || v_gcode || ' [TESTE]', 'published')
    returning id into v_gid;
    insert into public.product_games (product_id, game_id, position) values (v_pid, v_gid, i);
    insert into public.files (game_id, kind, access, version, filename, size_bytes, sha256, status, published_at)
    values (v_gid, 'pdf', 'paid', '1.0', v_gcode || '-v1.0.pdf', 1000 + i, repeat('0', 64), 'published', now())
    returning id into v_fid;
    insert into public.file_objects (file_id, access, bucket, object_key)
    values (v_fid, 'paid', 'bucket-pgtap-teste', 'paid/' || v_gcode || '/1.0/' || v_gcode || '-v1.0.pdf');
  end loop;
  return v_pid;
end $$;

-- um passo da máquina de estados do pedido, com os campos que o estado exige
create function pg_temp.mv(p_order uuid, p_to text) returns void language plpgsql as $$
declare v_paid boolean := p_to in ('paid','disputed','dispute_lost','refunded');
        v_money boolean := p_to in ('pending_payment','paid','disputed','dispute_lost','refunded');
begin
  if p_to in ('pending_payment', 'paid') then
    update public.order_items set unit_amount = 0, currency = 'brl' where order_id = p_order and unit_amount is null;
  end if;
  update public.orders o set
     status = p_to,
     amount_total = case when v_money then 0 else o.amount_total end,
     amount_subtotal = case when v_money then 0 else o.amount_subtotal end,
     amount_discount = case when v_money then 0 else o.amount_discount end,
     currency = case when v_money then 'brl' else o.currency end,
     paid_at = case when v_paid then coalesce(o.paid_at, now()) else o.paid_at end,
     stripe_payment_intent_id = case when v_paid then coalesce(o.stripe_payment_intent_id, 'pi_PGTAP_' || replace(o.id::text, '-', '')) else o.stripe_payment_intent_id end,
     refunded_at = case when p_to = 'refunded' then now() else o.refunded_at end
   where o.id = p_order;
end $$;

-- pedido no estado alvo, chegando por arestas legais
create function pg_temp.mk_order(p_user uuid, p_status text, p_products bigint[], p_tag text, p_created timestamptz default now()) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid(); i int; v_path text[];
begin
  insert into public.orders (id, user_id, email, status, cart_version, terms_version, terms_accepted_at,
                             stripe_checkout_session_id, livemode, created_at)
  values (v_id, p_user, (select lower(email) from auth.users where id = p_user), 'open', 0, 'v-pgtap', now(),
          'cs_test_PGTAP_' || p_tag, false, p_created);
  for i in 1..cardinality(p_products) loop
    insert into public.order_items (order_id, product_id, position, stripe_price_id)
    select v_id, p.id, i, p.stripe_price_id from public.products p where p.id = p_products[i];
  end loop;
  v_path := case p_status
    when 'open' then '{}' when 'pending_payment' then '{pending_payment}' when 'paid' then '{paid}'
    when 'failed' then '{failed}' when 'expired' then '{expired}'
    when 'disputed' then '{paid,disputed}' when 'dispute_lost' then '{paid,disputed,dispute_lost}'
    when 'refunded' then '{paid,refunded}' end::text[];
  for i in 1..coalesce(cardinality(v_path), 0) loop
    perform pg_temp.mv(v_id, v_path[i]);
  end loop;
  return v_id;
end $$;

-- direitos (um por item) com a fotografia da composição
create function pg_temp.mk_ents(p_order uuid, p_status text default 'active', p_reason text default null) returns void
language plpgsql as $$
declare r record; v_ent uuid;
begin
  for r in select i.product_id, o.user_id from public.order_items i join public.orders o on o.id = i.order_id
           where i.order_id = p_order order by i.position loop
    insert into public.entitlements (order_id, product_id, user_id, status, revoked_at, revoke_reason)
    values (p_order, r.product_id, r.user_id, p_status, case when p_status = 'revoked' then now() end, p_reason)
    returning id into v_ent;
    insert into public.entitlement_games (entitlement_id, game_id, position)
    select v_ent, pg.game_id, pg.position from public.product_games pg where pg.product_id = r.product_id;
  end loop;
end $$;

-- ===== ajudantes do checkout (05_checkout_fulfill e 90_concurrency) =================================
create temp table oids (name text primary key, id uuid);
create function pg_temp.oid(p_name text) returns uuid language sql as $$ select id from pg_temp.oids where name = p_name $$;

-- preenche o carrinho pelas RPCs e devolve a version
create function pg_temp.fill_cart(p_user uuid, p_codes text[]) returns integer language plpgsql as $$
declare c text;
begin
  foreach c in array p_codes loop perform public.cart_add(p_user, c); end loop;
  return coalesce((select ca.version from public.carts ca where ca.user_id = p_user), 0);
end $$;

-- pedido open pelas RPCs (carrinho -> create_order_from_cart -> attach_checkout_session)
create function pg_temp.open_order(p_user uuid, p_codes text[], p_attach boolean default true) returns uuid language plpgsql as $$
declare v_ver integer; v_order uuid;
begin
  v_ver := pg_temp.fill_cart(p_user, p_codes);
  select c.order_id into v_order from public.create_order_from_cart(p_user, false, v_ver, 'v-pgtap', true) c;
  if p_attach then
    perform public.attach_checkout_session(v_order, 'cs_test_PGTAP_' || replace(v_order::text, '-', ''));
  end if;
  return v_order;
end $$;

-- line_items da sessão para os itens do pedido (preço cheio por position)
create function pg_temp.sess_items(p_order uuid, p_amounts bigint[]) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('stripe_price_id', oi.stripe_price_id, 'quantity', 1,
                                      'unit_amount', p_amounts[oi.position], 'currency', 'brl') order by oi.position)
  from public.order_items oi where oi.order_id = p_order
$$;

-- fulfill_order com valores coerentes por padrão; p_over troca campos: discount, subtotal, total, code, intent, customer,
-- event, event_type, status, session, source, livemode, currency, items
create function pg_temp.fulfill(p_order uuid, p_amounts bigint[], p_over jsonb default '{}'::jsonb)
returns table (outcome text, order_id uuid, order_status text, entitlement_count integer, outbox_id uuid, send_delivery boolean)
language plpgsql as $$
declare
  v_sub  bigint := coalesce((select sum(a) from unnest(p_amounts) a), 0);
  v_disc bigint := coalesce((p_over->>'discount')::bigint, 0);
begin
  return query select * from public.fulfill_order(
    p_order_id => p_order,
    p_checkout_session_id => coalesce(p_over->>'session', 'cs_test_PGTAP_' || replace(p_order::text, '-', '')),
    p_payment_status => coalesce(p_over->>'status', 'paid'),
    p_amount_subtotal => coalesce((p_over->>'subtotal')::bigint, v_sub),
    p_amount_discount => v_disc,
    p_amount_total => coalesce((p_over->>'total')::bigint, v_sub - v_disc),
    p_currency => coalesce(p_over->>'currency', 'brl'),
    p_promotion_code => p_over->>'code',
    p_payment_intent_id => case when p_over ? 'intent' then p_over->>'intent' else 'pi_PGTAP_' || replace(p_order::text, '-', '') end,
    p_customer_id => p_over->>'customer',
    p_livemode => coalesce((p_over->>'livemode')::boolean, false),
    p_items => coalesce(p_over->'items', pg_temp.sess_items(p_order, p_amounts)),
    p_source => coalesce(p_over->>'source', 'webhook'),
    p_stripe_event_id => p_over->>'event',
    p_event_type => p_over->>'event_type');
end $$;

-- set_order_status: p_over troca: event, event_type, reason, source, subtotal, discount, total, currency, code, intent
create function pg_temp.setst(p_order uuid, p_new text, p_over jsonb default '{}'::jsonb)
returns table (outcome text, order_id uuid, previous_status text, order_status text, entitlement_status text)
language plpgsql as $$
begin
  return query select * from public.set_order_status(
    p_order_id => p_order, p_new_status => p_new,
    p_source => coalesce(p_over->>'source', 'webhook'),
    p_stripe_event_id => p_over->>'event',
    p_reason => p_over->>'reason',
    p_amount_total => (p_over->>'total')::bigint,
    p_currency => p_over->>'currency',
    p_payment_intent_id => p_over->>'intent',
    p_amount_subtotal => (p_over->>'subtotal')::bigint,
    p_amount_discount => (p_over->>'discount')::bigint,
    p_promotion_code => p_over->>'code',
    p_event_type => p_over->>'event_type');
end $$;

-- compra completa pelas RPCs; devolve o pedido
create function pg_temp.buy(p_user uuid, p_codes text[], p_amounts bigint[], p_over jsonb default '{}'::jsonb) returns uuid language plpgsql as $$
declare v_order uuid;
begin
  v_order := pg_temp.open_order(p_user, p_codes);
  perform * from pg_temp.fulfill(v_order, p_amounts, p_over);
  return v_order;
end $$;

-- I-5 no estado atual: dispara os gatilhos diferidos agora e volta ao modo diferido
create function pg_temp.i5(p_label text) returns text language plpgsql as $$
declare st text := 'OK';
begin
  begin set constraints all immediate; exception when others then get stacked diagnostics st = returned_sqlstate; end;
  set constraints all deferred;
  return extensions.is(st, 'OK', p_label);
end $$;

-- contagens de um pedido, para provar que nada mudou
create function pg_temp.footprint(p_order uuid) returns text language sql as $$
  select concat_ws('|',
    (select count(*) from public.entitlements where order_id = p_order),
    (select count(*) from public.entitlement_games eg join public.entitlements e on e.id = eg.entitlement_id where e.order_id = p_order),
    (select count(*) from public.email_outbox where order_id = p_order),
    (select count(*) from public.order_events where order_id = p_order),
    (select count(*) from public.funnel_events where order_id = p_order),
    (select count(*) from public.stripe_events where order_id = p_order),
    (select status from public.orders where id = p_order))
$$;

-- set_order_status (contestação aberta, vencida e perdida; reembolso manual; deferred) e I-5 por item
-- (docs/data-contract.md v0.3.3, seções 6.3 a 6.5, D-24 e D-25).
-- A concorrência (webhook e retorno) está em 90_concurrency. Valores em centavos são só de teste.

-- (ajudantes do checkout: _helpers_checkout.sql, incluídos antes deste corpo)
create temp table res (k text primary key, j jsonb);

-- ===== fixtures ====================================================================================
do $fx$
begin
  perform pg_temp.mk_product('CP1', 'bundle', 3);
  perform pg_temp.mk_product('CS1', 'single', 1);
  perform pg_temp.mk_product('CS2', 'single', 1);
  perform pg_temp.mk_product('CS3', 'single', 1);
  perform pg_temp.mk_product('CS4', 'single', 1);
  perform pg_temp.mk_user('kunconf', false);
  perform pg_temp.mk_user('kempty'); perform pg_temp.mk_user('kchg'); perform pg_temp.mk_user('kunav'); perform pg_temp.mk_user('kown');
  perform pg_temp.mk_user('khap'); perform pg_temp.mk_user('kreu'); perform pg_temp.mk_user('katt'); perform pg_temp.mk_user('katt2');
  perform pg_temp.mk_user('kful'); perform pg_temp.mk_user('kcup'); perform pg_temp.mk_user('knoc'); perform pg_temp.mk_user('kfull');
  perform pg_temp.mk_user('kpend'); perform pg_temp.mk_user('kmis'); perform pg_temp.mk_user('kerr'); perform pg_temp.mk_user('knf');
  perform pg_temp.mk_user('kdis'); perform pg_temp.mk_user('kman'); perform pg_temp.mk_user('klost'); perform pg_temp.mk_user('kref');
  perform pg_temp.mk_user('kref2'); perform pg_temp.mk_user('kdef'); perform pg_temp.mk_user('kst'); perform pg_temp.mk_user('kcomp');
  perform pg_temp.mk_user('kimm'); perform pg_temp.mk_user('kign'); perform pg_temp.mk_user('kfin');
end $fx$;

-- ===== T40 create_order_from_cart: recusas =========================================================
select pg_temp.expect('checkout: usuário não confirmado', format($q$select * from public.create_order_from_cart(%L, false, 0, 'v1', true)$q$, pg_temp.uid('kunconf')), 'KT009');
select pg_temp.expect('checkout: usuário inexistente', $q$select * from public.create_order_from_cart(gen_random_uuid(), false, 0, 'v1', true)$q$, 'KT009');
select pg_temp.expect('checkout: p_user_id nulo', $q$select * from public.create_order_from_cart(null, false, 0, 'v1', true)$q$, 'KT001');
select pg_temp.expect('checkout: p_livemode nulo', format($q$select * from public.create_order_from_cart(%L, null, 0, 'v1', true)$q$, pg_temp.uid('kempty')), 'KT001');
select pg_temp.expect('checkout: versão do carrinho nula', format($q$select * from public.create_order_from_cart(%L, false, null, 'v1', true)$q$, pg_temp.uid('kempty')), 'KT001');
select pg_temp.expect('checkout: versão do carrinho negativa', format($q$select * from public.create_order_from_cart(%L, false, -1, 'v1', true)$q$, pg_temp.uid('kempty')), 'KT001');
select pg_temp.expect('checkout: versão dos termos em branco', format($q$select * from public.create_order_from_cart(%L, false, 0, '  ', true)$q$, pg_temp.uid('kempty')), 'KT001');
select pg_temp.expect('checkout: sem o aceite dos termos (false) é KT007', format($q$select * from public.create_order_from_cart(%L, false, 0, 'v1', false)$q$, pg_temp.uid('kempty')), 'KT007');
select pg_temp.expect('checkout: sem o aceite dos termos (nulo) é KT007', format($q$select * from public.create_order_from_cart(%L, false, 0, 'v1', null)$q$, pg_temp.uid('kempty')), 'KT007');
select pg_temp.assert('checkout: KT007 não grava nada', (select count(*) = 0 from public.orders where user_id = pg_temp.uid('kempty')));
select pg_temp.assert('checkout: sem carrinho = cart_empty', (select outcome = 'cart_empty' and order_id is null and email is null and items is null and not reused
  from public.create_order_from_cart(pg_temp.uid('kempty'), false, 0, 'v1', true)));
do $c$ begin
  perform public.cart_add(pg_temp.uid('kempty'), 'CS1'); perform public.cart_remove(pg_temp.uid('kempty'), 'CS1');
end $c$;
select pg_temp.assert('checkout: carrinho com a version alta e vazio = cart_empty', (select outcome = 'cart_empty' from public.create_order_from_cart(pg_temp.uid('kempty'), false, 2, 'v1', true)));
select pg_temp.assert('checkout: cart_empty não grava pedido, evento nem funil', (select count(*) = 0 from public.orders where user_id = pg_temp.uid('kempty'))
  and (select count(*) = 0 from public.funnel_events where user_id = pg_temp.uid('kempty') and type = 'checkout_started'));

do $c$ begin perform pg_temp.fill_cart(pg_temp.uid('kchg'), array['CS1', 'CS2']); end $c$;
select pg_temp.assert('checkout: versão diferente = cart_changed, com a versão atual em detail',
  (select outcome = 'cart_changed' and detail = '{"cart_version": 2}'::jsonb and order_id is null from public.create_order_from_cart(pg_temp.uid('kchg'), false, 1, 'v1', true)));
select pg_temp.assert('checkout: cart_changed não grava pedido', (select count(*) = 0 from public.orders where user_id = pg_temp.uid('kchg')));

do $c$ begin
  perform pg_temp.fill_cart(pg_temp.uid('kunav'), array['CS3', 'CS4']);
  update public.products set status = 'draft' where code = 'CS4';
end $c$;
select pg_temp.assert('checkout: produto que deixou de ser vendável = product_unavailable, com os códigos',
  (select outcome = 'product_unavailable' and detail = '{"product_codes": ["CS4"]}'::jsonb and order_id is null from public.create_order_from_cart(pg_temp.uid('kunav'), false, 2, 'v1', true)));
do $c$ begin update public.products set status = 'active' where code = 'CS4'; end $c$;

do $c$
declare o uuid;
begin
  perform pg_temp.fill_cart(pg_temp.uid('kown'), array['CS1', 'CS2']);
  o := pg_temp.mk_order(pg_temp.uid('kown'), 'paid', array[(select id from public.products where code = 'CS1')], 'OWN1');
  perform pg_temp.mk_ents(o);   -- comprado em outra aba, depois de pôr no carrinho
end $c$;
select pg_temp.assert('checkout: produto já possuído por inteiro = already_owned, com os códigos',
  (select outcome = 'already_owned' and detail = '{"product_codes": ["CS1"]}'::jsonb and order_id is null from public.create_order_from_cart(pg_temp.uid('kown'), false, 2, 'v1', true)));
do $c$ begin
  update public.products set status = 'draft' where code = 'CS1';
end $c$;
select pg_temp.assert('checkout: product_unavailable vem antes de already_owned', (select outcome = 'product_unavailable' and detail = '{"product_codes": ["CS1"]}'::jsonb
  from public.create_order_from_cart(pg_temp.uid('kown'), false, 2, 'v1', true)));
do $c$ begin update public.products set status = 'active' where code = 'CS1'; end $c$;

-- ===== T41 create_order_from_cart: caminho feliz e reaproveitamento ================================
do $c$
begin
  perform pg_temp.fill_cart(pg_temp.uid('khap'), array['CS1', 'CS2']);
  -- a ordem por added_at manda na position (e não a do produto): CS2 entrou antes
  update public.cart_items set added_at = now() - interval '1 hour' where user_id = pg_temp.uid('khap') and product_id = (select id from public.products where code = 'CS2');
end $c$;
select pg_temp.assert('checkout: ok com e-mail da conta, itens por position e sem cliente da Stripe ainda',
  (select outcome = 'ok' and email = 'khap@pgtap.test' and stripe_customer_id is null and not reused and detail is null
      and items = '[{"product_code": "CS2", "stripe_price_id": "price_PGTAP_CS2"}, {"product_code": "CS1", "stripe_price_id": "price_PGTAP_CS1"}]'::jsonb
   from public.create_order_from_cart(pg_temp.uid('khap'), false, 2, 'termos-v1', true)));
insert into pg_temp.oids select 'khap', id from public.orders where user_id = pg_temp.uid('khap');
select pg_temp.assert('checkout: 1 pedido open com cart_version, termos, aceite gravado na criação e ambiente',
  (select count(*) = 1 and bool_and(status = 'open' and cart_version = 2 and terms_version = 'termos-v1' and terms_accepted_at is not null
          and terms_accepted_at >= now() - interval '1 minute' and not livemode and email = 'khap@pgtap.test'
          and amount_total is null and amount_subtotal is null and amount_discount is null and promotion_code is null
          and stripe_checkout_session_id is null)
   from public.orders where user_id = pg_temp.uid('khap')));
select pg_temp.assert('checkout: itens com position pela ordem de added_at e o Price de hoje',
  (select array_agg(p.code || ':' || oi.position || ':' || oi.stripe_price_id order by oi.position) = array['CS2:1:price_PGTAP_CS2', 'CS1:2:price_PGTAP_CS1']
   from public.order_items oi join public.products p on p.id = oi.product_id where oi.order_id = pg_temp.oid('khap'))
  and (select bool_and(unit_amount is null and currency is null) from public.order_items where order_id = pg_temp.oid('khap')));
select pg_temp.assert('checkout: trilha (null -> open, checkout) e funil checkout_started com a versão',
  (select count(*) = 1 and bool_and(from_status is null and to_status = 'open' and source = 'checkout') from public.order_events where order_id = pg_temp.oid('khap'))
  and (select count(*) = 1 and bool_and(cart_version = 2 and user_id = pg_temp.uid('khap')) from public.funnel_events where order_id = pg_temp.oid('khap') and type = 'checkout_started'));
select pg_temp.assert('checkout: o carrinho não é mexido', (select count(*) = 2 from public.cart_items where user_id = pg_temp.uid('khap'))
  and (select version = 2 from public.carts where user_id = pg_temp.uid('khap')));

select pg_temp.assert('checkout: chamar de novo reaproveita o pedido (reused) com os mesmos itens',
  (select outcome = 'ok' and reused and order_id = pg_temp.oid('khap') and jsonb_array_length(items) = 2 from public.create_order_from_cart(pg_temp.uid('khap'), false, 2, 'termos-v1', true)));
select pg_temp.assert('checkout: ... sem pedido, item, trilha nem funil a mais', (select count(*) = 1 from public.orders where user_id = pg_temp.uid('khap'))
  and (select count(*) = 2 from public.order_items where order_id = pg_temp.oid('khap'))
  and (select count(*) = 1 from public.order_events where order_id = pg_temp.oid('khap'))
  and (select count(*) = 1 from public.funnel_events where order_id = pg_temp.oid('khap') and type = 'checkout_started'));
select pg_temp.assert('checkout: outra versão dos termos cria pedido novo, com novo aceite', (select not reused and order_id <> pg_temp.oid('khap') from public.create_order_from_cart(pg_temp.uid('khap'), false, 2, 'termos-v2', true)));
select pg_temp.assert('checkout: outro ambiente (livemode) cria pedido novo', (select not reused from public.create_order_from_cart(pg_temp.uid('khap'), true, 2, 'termos-v1', true)));
select pg_temp.assert('checkout: ... ficaram 3 pedidos open do usuário', (select count(*) = 3 from public.orders where user_id = pg_temp.uid('khap') and status = 'open'));
select pg_temp.assert('checkout: voltando aos termos e ao ambiente de antes, reaproveita o 1º pedido', (select reused and order_id = pg_temp.oid('khap') from public.create_order_from_cart(pg_temp.uid('khap'), false, 2, 'termos-v1', true)));

-- reaproveitamento: prazo da sessão, mudança do Price e do carrinho
do $c$
declare o uuid;
begin
  perform pg_temp.fill_cart(pg_temp.uid('kreu'), array['CS1']);
  select c.order_id into o from public.create_order_from_cart(pg_temp.uid('kreu'), false, 1, 'v1', true) c;
  insert into pg_temp.oids values ('kreu1', o);
  perform public.attach_checkout_session(o, 'cs_test_PGTAP_' || replace(o::text, '-', ''), now() + interval '1 hour');
end $c$;
select pg_temp.assert('checkout: sessão ainda no prazo = reaproveita', (select reused and order_id = pg_temp.oid('kreu1') from public.create_order_from_cart(pg_temp.uid('kreu'), false, 1, 'v1', true)));
update public.orders set checkout_expires_at = now() - interval '1 minute' where id = pg_temp.oid('kreu1');
select pg_temp.assert('checkout: sessão vencida = pedido novo', (select not reused and order_id <> pg_temp.oid('kreu1') from public.create_order_from_cart(pg_temp.uid('kreu'), false, 1, 'v1', true)));
update public.orders set checkout_expires_at = null where id = pg_temp.oid('kreu1');
update public.products set stripe_price_id = 'price_PGTAP_CS1_NOVO' where code = 'CS1';
select pg_temp.assert('checkout: Price do produto mudou = pedido novo (não reaproveita o Price antigo)', (select not reused and order_id <> pg_temp.oid('kreu1')
  and items = '[{"product_code": "CS1", "stripe_price_id": "price_PGTAP_CS1_NOVO"}]'::jsonb from public.create_order_from_cart(pg_temp.uid('kreu'), false, 1, 'v1', true)));
update public.products set stripe_price_id = 'price_PGTAP_CS1' where code = 'CS1';
do $c$ begin perform public.cart_add(pg_temp.uid('kreu'), 'CS2'); end $c$;
select pg_temp.assert('checkout: carrinho mudou (nova versão) = pedido novo; o antigo segue open',
  (select not reused and jsonb_array_length(items) = 2 from public.create_order_from_cart(pg_temp.uid('kreu'), false, 2, 'v1', true))
  and (select status = 'open' from public.orders where id = pg_temp.oid('kreu1')));
select pg_temp.assert('checkout: cliente da Stripe do perfil volta no resultado', (select public.set_stripe_customer(pg_temp.uid('kreu'), 'cus_PGTAP_KREU') = 'cus_PGTAP_KREU')
  and (select stripe_customer_id = 'cus_PGTAP_KREU' from public.create_order_from_cart(pg_temp.uid('kreu'), false, 2, 'v1', true)));
select pg_temp.expect_as('checkout: service_role executa', 'service_role', format($q$select * from public.create_order_from_cart(%L, false, 2, 'v1', true)$q$, pg_temp.uid('kreu')), 'OK');
select pg_temp.expect_as('checkout: anon não executa', 'anon', format($q$select * from public.create_order_from_cart(%L, false, 2, 'v1', true)$q$, pg_temp.uid('kreu')), '42501');

-- ===== T43 attach_checkout_session ==================================================================
do $c$
declare o uuid;
begin
  perform pg_temp.fill_cart(pg_temp.uid('katt'), array['CS1']);
  select c.order_id into o from public.create_order_from_cart(pg_temp.uid('katt'), false, 1, 'v1', true) c;
  insert into pg_temp.oids values ('katt', o);
  perform pg_temp.fill_cart(pg_temp.uid('katt2'), array['CS2']);
  select c.order_id into o from public.create_order_from_cart(pg_temp.uid('katt2'), false, 1, 'v1', true) c;
  insert into pg_temp.oids values ('katt2', o);
end $c$;
select pg_temp.expect('attach: pedido nulo', $q$select public.attach_checkout_session(null, 'cs_test_x')$q$, 'KT001');
select pg_temp.expect('attach: sessão nula', format($q$select public.attach_checkout_session(%L, null)$q$, pg_temp.oid('katt')), 'KT001');
select pg_temp.expect('attach: sessão fora do formato', format($q$select public.attach_checkout_session(%L, 'sess_123')$q$, pg_temp.oid('katt')), 'KT001');
select pg_temp.assert('attach: pedido inexistente = not_found', (select public.attach_checkout_session(gen_random_uuid(), 'cs_test_PGTAP_NF') = 'not_found'));
select pg_temp.expect('attach: sessão live em pedido de teste é KT005', format($q$select public.attach_checkout_session(%L, 'cs_live_PGTAP_A1')$q$, pg_temp.oid('katt')), 'KT005');
select pg_temp.assert('attach: 1ª vez = applied', (select public.attach_checkout_session(pg_temp.oid('katt'), 'cs_test_PGTAP_ATT1', now() + interval '23 hours') = 'applied'));
select pg_temp.assert('attach: ... grava a sessão e o prazo', (select stripe_checkout_session_id = 'cs_test_PGTAP_ATT1' and checkout_expires_at > now() + interval '22 hours' from public.orders where id = pg_temp.oid('katt')));
select pg_temp.assert('attach: a mesma sessão de novo = noop', (select public.attach_checkout_session(pg_temp.oid('katt'), 'cs_test_PGTAP_ATT1', now() + interval '30 hours') = 'noop'));
select pg_temp.assert('attach: ... e o prazo não muda', (select checkout_expires_at < now() + interval '24 hours' from public.orders where id = pg_temp.oid('katt')));
select pg_temp.expect('attach: outra sessão no mesmo pedido é KT004', format($q$select public.attach_checkout_session(%L, 'cs_test_PGTAP_ATT2')$q$, pg_temp.oid('katt')), 'KT004');
select pg_temp.expect('attach: sessão já usada por outro pedido é 23505', format($q$select public.attach_checkout_session(%L, 'cs_test_PGTAP_ATT1')$q$, pg_temp.oid('katt2')), '23505');
select pg_temp.assert('attach: sessão no segundo pedido', (select public.attach_checkout_session(pg_temp.oid('katt2'), 'cs_test_PGTAP_ATT3') = 'applied'));
do $c$
declare o uuid;
begin
  perform pg_temp.fill_cart(pg_temp.uid('kign'), array['CS1']);
  select c.order_id into o from public.create_order_from_cart(pg_temp.uid('kign'), false, 1, 'v1', true) c;
  insert into pg_temp.oids values ('kign', o);
  perform public.set_order_status(o, 'failed');
end $c$;
select pg_temp.assert('attach: pedido que não está open (failed) e sem sessão = ignored, sem gravar a sessão',
  (select public.attach_checkout_session(pg_temp.oid('kign'), 'cs_test_PGTAP_ATT4') = 'ignored')
  and (select stripe_checkout_session_id is null and checkout_expires_at is null from public.orders where id = pg_temp.oid('kign')));
select pg_temp.expect_as('attach: service_role executa', 'service_role', format($q$select public.attach_checkout_session(%L, 'cs_test_PGTAP_ATT3')$q$, pg_temp.oid('katt2')), 'OK');
select pg_temp.expect_as('attach: authenticated não executa', 'authenticated', format($q$select public.attach_checkout_session(%L, 'cs_test_PGTAP_ATT3')$q$, pg_temp.oid('katt2')), '42501');

-- ===== T44 fulfill_order com 2 itens, sem cupom ====================================================
do $fx2$
begin
  perform pg_temp.mk_product('CPX', 'bundle', 2);
  perform pg_temp.mk_product('CPY', 'single', 1);
  perform pg_temp.mk_user('kerr2'); perform pg_temp.mk_user('kerr3'); perform pg_temp.mk_user('kdef2');
  perform pg_temp.mk_user('kst2'); perform pg_temp.mk_user('kst3'); perform pg_temp.mk_user('kst4');
end $fx2$;

do $c$
declare o uuid;
begin
  o := pg_temp.open_order(pg_temp.uid('kful'), array['CP1', 'CS1']);           -- carrinho em version 2
  insert into pg_temp.oids values ('kful', o);
  perform pg_temp.fill_cart(pg_temp.uid('kful'), array['CS3']);                -- depois do pedido: version 3
  insert into public.email_outbox (user_id, kind, category, to_email, dedupe_key, payload)
  values (pg_temp.uid('kful'), 'cart_reminder', 'marketing', 'kful@pgtap.test', 'cart_reminder:kful:3', '{}');
  insert into res select 'f1', to_jsonb(r) from pg_temp.fulfill(o, array[3000, 1000],
    '{"event": "evt_PGTAP_F1", "event_type": "checkout.session.completed", "customer": "cus_PGTAP_KFUL"}') r;
end $c$;
select pg_temp.assert('fulfill: 1ª chamada = applied, pedido paid, 2 direitos, entrega criada',
  (select j->>'outcome' = 'applied' and j->>'order_status' = 'paid' and (j->>'entitlement_count')::int = 2
          and j->>'outbox_id' is not null and (j->>'send_delivery')::boolean from res where k = 'f1'));
select pg_temp.assert('fulfill: pedido com valores, moeda, sessão e intent; o aceite dos termos veio da criação',
  (select status = 'paid' and paid_at is not null and amount_subtotal = 4000 and amount_discount = 0 and amount_total = 4000 and currency = 'brl'
          and promotion_code is null and stripe_checkout_session_id = 'cs_test_PGTAP_' || replace(id::text, '-', '')
          and stripe_payment_intent_id = 'pi_PGTAP_' || replace(id::text, '-', '')
          and terms_accepted_at is not null and terms_version = 'v-pgtap'
   from public.orders where id = pg_temp.oid('kful')));
select pg_temp.assert('fulfill: itens com o preço cheio e a moeda',
  (select array_agg(unit_amount order by position) = array[3000, 1000]::bigint[] and bool_and(currency = 'brl') from public.order_items where order_id = pg_temp.oid('kful')));
select pg_temp.assert('fulfill: um direito active por item, do dono, e a fotografia (3 jogos + 1)',
  (select count(*) = 2 and bool_and(status = 'active' and user_id = pg_temp.uid('kful') and revoked_at is null) from public.entitlements where order_id = pg_temp.oid('kful'))
  and (select count(*) = 4 from public.entitlement_games eg join public.entitlements e on e.id = eg.entitlement_id where e.order_id = pg_temp.oid('kful')));
select pg_temp.assert('fulfill: carrinho sem os itens pagos (fica o CS3) e version +1',
  (select array_agg(p.code) = array['CS3'] from public.cart_items ci join public.products p on p.id = ci.product_id where ci.user_id = pg_temp.uid('kful'))
  and (select version = 4 from public.carts where user_id = pg_temp.uid('kful')));
select pg_temp.assert('fulfill: lembrete de carrinho na fila cancelado (already_purchased)',
  (select status = 'canceled' and skip_reason = 'already_purchased' from public.email_outbox where dedupe_key = 'cart_reminder:kful:3'));
select pg_temp.assert('fulfill: 1 entrega queued, transacional, para o e-mail da conta, com a chave do pedido',
  (select count(*) = 1 and bool_and(kind = 'delivery' and category = 'transactional' and status = 'queued' and to_email = 'kful@pgtap.test'
          and dedupe_key = 'delivery:' || order_id::text and user_id = pg_temp.uid('kful'))
   from public.email_outbox where order_id = pg_temp.oid('kful')));
select pg_temp.assert('fulfill: payload da entrega com ref, itens e um jogo por direito, sem token nem URL',
  (select payload->>'order_ref' = upper(left(replace(pg_temp.oid('kful')::text, '-', ''), 8))
      and jsonb_array_length(payload->'items') = 2 and jsonb_array_length(payload->'games') = 4
      and payload::text !~ '(token|https?:)'
      and (payload->'games'->0 ?& array['entitlement_id', 'game_id', 'code', 'name'])
      and (select count(distinct g->>'game_id') = 4 from jsonb_array_elements(payload->'games') g)
   from public.email_outbox where order_id = pg_temp.oid('kful')));
select pg_temp.assert('fulfill: trilha (checkout, webhook com o evento) e funil (checkout_started, order_paid)',
  (select array_agg(source || ':' || coalesce(stripe_event_id, '-') order by id) = array['checkout:-', 'webhook:evt_PGTAP_F1'] from public.order_events where order_id = pg_temp.oid('kful'))
  and (select array_agg(type order by type) = array['checkout_started', 'order_paid'] from public.funnel_events where order_id = pg_temp.oid('kful')));
select pg_temp.assert('fulfill: livro-razão do evento (tipo, ambiente, sessão, pedido, applied)',
  (select count(*) = 1 and bool_and(type = 'checkout.session.completed' and not livemode and outcome = 'applied' and order_id = pg_temp.oid('kful')
          and stripe_object_id = 'cs_test_PGTAP_' || replace(order_id::text, '-', '')) from public.stripe_events where id = 'evt_PGTAP_F1'));
select pg_temp.assert('fulfill: cliente da Stripe gravado no perfil', (select stripe_customer_id = 'cus_PGTAP_KFUL' from public.profiles where user_id = pg_temp.uid('kful')));
select pg_temp.i5('fulfill: I-5 vale (pedido paid com um direito por item)');

-- ===== T45 idempotência ============================================================================
do $c$
begin
  insert into res select 'f1_fp', to_jsonb(pg_temp.footprint(pg_temp.oid('kful')));
  insert into res select 'f1_dup', to_jsonb(r) from pg_temp.fulfill(pg_temp.oid('kful'), array[3000, 1000], '{"event": "evt_PGTAP_F1", "customer": "cus_PGTAP_KFUL"}') r;
  insert into res select 'f1_noop', to_jsonb(r) from pg_temp.fulfill(pg_temp.oid('kful'), array[3000, 1000], '{"event": "evt_PGTAP_F2", "customer": "cus_PGTAP_KFUL"}') r;
  insert into res select 'f1_ret', to_jsonb(r) from pg_temp.fulfill(pg_temp.oid('kful'), array[3000, 1000], '{"source": "return_page", "customer": "cus_PGTAP_KFUL"}') r;
  insert into res select 'f1_dup2', to_jsonb(r) from pg_temp.fulfill(pg_temp.oid('kful'), array[3000, 1000], '{"event": "evt_PGTAP_F2"}') r;
end $c$;
select pg_temp.assert('idempotência: mesmo evento = duplicate_event, sem entrega nova',
  (select j->>'outcome' = 'duplicate_event' and j->>'order_status' = 'paid' and (j->>'entitlement_count')::int = 2 and not (j->>'send_delivery')::boolean
          and j->>'outbox_id' = (select j->>'outbox_id' from res where k = 'f1') from res where k = 'f1_dup'));
select pg_temp.assert('idempotência: outro evento no pedido pago = noop, devolve a entrega existente sem reenviar',
  (select j->>'outcome' = 'noop' and not (j->>'send_delivery')::boolean and j->>'outbox_id' = (select j->>'outbox_id' from res where k = 'f1') from res where k = 'f1_noop'));
select pg_temp.assert('idempotência: página de retorno (sem evento) = noop', (select j->>'outcome' = 'noop' and not (j->>'send_delivery')::boolean from res where k = 'f1_ret'));
select pg_temp.assert('idempotência: o evento noop também fica no livro-razão e repetido vira duplicate_event',
  (select outcome = 'noop' from public.stripe_events where id = 'evt_PGTAP_F2') and (select j->>'outcome' = 'duplicate_event' from res where k = 'f1_dup2'));
select pg_temp.assert('idempotência: antes dos reenvios o estado era 2 direitos, 4 fotografias, 1 entrega, 2 trilhas, 2 funis, 1 evento, paid',
  (select j #>> '{}' = '2|4|1|2|2|1|paid' from res where k = 'f1_fp'));
select pg_temp.assert('idempotência: depois dos reenvios só o evento noop foi acrescentado ao livro-razão',
  pg_temp.footprint(pg_temp.oid('kful')) = '2|4|1|2|2|2|paid');
select pg_temp.assert('idempotência: carrinho não é mexido de novo (version segue 4)', (select version = 4 from public.carts where user_id = pg_temp.uid('kful')));

-- ===== T46 recusas de fulfill_order ================================================================
do $c$
declare o uuid;
begin
  o := pg_temp.open_order(pg_temp.uid('kerr'), array['CS1', 'CS2']); insert into pg_temp.oids values ('kerr', o);
  o := pg_temp.open_order(pg_temp.uid('kerr2'), array['CS1']);       insert into pg_temp.oids values ('kerr2', o);
  o := pg_temp.open_order(pg_temp.uid('kerr3'), array['CS2']);       insert into pg_temp.oids values ('kerr3', o);
  insert into res select 'kerr_fp', to_jsonb(pg_temp.footprint(pg_temp.oid('kerr')));
end $c$;
select pg_temp.expect('fulfill: pagamento unpaid é KT002', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"status": "unpaid"}')$q$, pg_temp.oid('kerr')), 'KT002');
select pg_temp.expect('fulfill: no_payment_required com total > 0 é KT002', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"status": "no_payment_required", "discount": 100}')$q$, pg_temp.oid('kerr')), 'KT002');
select pg_temp.expect('fulfill: no_payment_required sem desconto é KT002', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"status": "no_payment_required"}')$q$, pg_temp.oid('kerr')), 'KT002');
select pg_temp.expect('fulfill: payment_status nulo é KT001', format($q$select * from public.fulfill_order(%L, 'cs_test_PGTAP_X1', null, 3000, 0, 3000, 'brl', null, null, null, false, '[{}]'::jsonb)$q$, pg_temp.oid('kerr')), 'KT001');
select pg_temp.expect('fulfill: pedido nulo é KT001', $q$select * from pg_temp.fulfill(null, array[1000], '{"session": "cs_test_PGTAP_X2"}')$q$, 'KT001');
select pg_temp.expect('fulfill: sessão fora do formato é KT001', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"session": "sess_1"}')$q$, pg_temp.oid('kerr')), 'KT001');
select pg_temp.expect('fulfill: moeda em maiúscula é KT001', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"currency": "BRL"}')$q$, pg_temp.oid('kerr')), 'KT001');
select pg_temp.expect('fulfill: valor negativo é KT001', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"subtotal": -1}')$q$, pg_temp.oid('kerr')), 'KT001');
select pg_temp.expect('fulfill: itens vazios são KT001', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"items": []}')$q$, pg_temp.oid('kerr')), 'KT001');
select pg_temp.expect('fulfill: itens que não são uma lista são KT001', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"items": {"a": 1}}')$q$, pg_temp.oid('kerr')), 'KT001');
select pg_temp.expect('fulfill: origem inválida é KT001', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"source": "checkout"}')$q$, pg_temp.oid('kerr')), 'KT001');
select pg_temp.expect('fulfill: evento fora do formato é KT001', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"event": "abc"}')$q$, pg_temp.oid('kerr')), 'KT001');
select pg_temp.expect('fulfill: intent fora do formato é KT001', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"intent": "xx"}')$q$, pg_temp.oid('kerr')), 'KT001');
select pg_temp.expect('fulfill: cliente fora do formato é KT001', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"customer": "xx"}')$q$, pg_temp.oid('kerr')), 'KT001');
select pg_temp.expect('fulfill: ambiente do evento diferente do pedido é KT005', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"livemode": true}')$q$, pg_temp.oid('kerr')), 'KT005');
select pg_temp.expect('fulfill: sessão live em pedido de teste é KT005', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"session": "cs_live_PGTAP_Z"}')$q$, pg_temp.oid('kerr')), 'KT005');
select pg_temp.expect('fulfill: outra sessão no pedido é KT004', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"session": "cs_test_PGTAP_OUTRA"}')$q$, pg_temp.oid('kerr')), 'KT004');
do $c$ begin perform public.set_stripe_customer(pg_temp.uid('kerr3'), 'cus_PGTAP_E3'); end $c$;
select pg_temp.expect('fulfill: outro cliente da Stripe no perfil é KT004', format($q$select * from pg_temp.fulfill(%L, array[2000], '{"customer": "cus_PGTAP_E3OUTRO"}')$q$, pg_temp.oid('kerr3')), 'KT004');
do $c$
begin
  perform pg_temp.setst(pg_temp.oid('kerr2'), 'pending_payment', '{"subtotal": 1000, "discount": 0, "total": 1000, "currency": "brl", "intent": "pi_PGTAP_E2A"}');
end $c$;
select pg_temp.expect('fulfill: outro payment_intent no pedido é KT004', format($q$select * from pg_temp.fulfill(%L, array[1000], '{"intent": "pi_PGTAP_E2B"}')$q$, pg_temp.oid('kerr2')), 'KT004');
select pg_temp.assert('fulfill: nenhuma recusa deixou rastro (estado, direitos, e-mails, trilha, funil, eventos)',
  (select j #>> '{}' = pg_temp.footprint(pg_temp.oid('kerr')) from res where k = 'kerr_fp')
  and (select count(*) = 0 from public.stripe_events where order_id in (pg_temp.oid('kerr'), pg_temp.oid('kerr3')))
  and (select bool_and(unit_amount is null) from public.order_items where order_id = pg_temp.oid('kerr')));
select pg_temp.assert('fulfill: payment_intent NULL é aceito e não apaga o gravado (pedido sem intent fica sem)',
  (select outcome = 'applied' from pg_temp.fulfill(pg_temp.oid('kerr3'), array[2000], '{"intent": null, "customer": "cus_PGTAP_E3"}')));
select pg_temp.assert('fulfill: ... pedido pago sem intent', (select status = 'paid' and stripe_payment_intent_id is null from public.orders where id = pg_temp.oid('kerr3')));

-- ===== T46b itens e valores da sessão que não batem (KT012) ========================================
do $c$ begin insert into res select 'kmis_fp', to_jsonb(pg_temp.footprint(pg_temp.oid('kerr'))); end $c$;
select pg_temp.expect('fulfill: subtotal diferente da soma dos itens é KT012', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"subtotal": 3500, "total": 3500}')$q$, pg_temp.oid('kerr')), 'KT012');
select pg_temp.expect('fulfill: total diferente de subtotal - desconto é KT012', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"discount": 300, "total": 2800}')$q$, pg_temp.oid('kerr')), 'KT012');
select pg_temp.expect('fulfill: desconto maior que o subtotal é KT012', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"discount": 3500, "total": 0}')$q$, pg_temp.oid('kerr')), 'KT012');
select pg_temp.expect('fulfill: quantidade 2 é KT012', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"items": [{"stripe_price_id": "price_PGTAP_CS1", "quantity": 2, "unit_amount": 1000, "currency": "brl"}, {"stripe_price_id": "price_PGTAP_CS2", "quantity": 1, "unit_amount": 2000, "currency": "brl"}]}')$q$, pg_temp.oid('kerr')), 'KT012');
select pg_temp.expect('fulfill: moeda do item diferente da sessão é KT012', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"items": [{"stripe_price_id": "price_PGTAP_CS1", "quantity": 1, "unit_amount": 1000, "currency": "usd"}, {"stripe_price_id": "price_PGTAP_CS2", "quantity": 1, "unit_amount": 2000, "currency": "brl"}]}')$q$, pg_temp.oid('kerr')), 'KT012');
select pg_temp.expect('fulfill: item a menos é KT012', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"subtotal": 1000, "total": 1000, "items": [{"stripe_price_id": "price_PGTAP_CS1", "quantity": 1, "unit_amount": 1000, "currency": "brl"}]}')$q$, pg_temp.oid('kerr')), 'KT012');
select pg_temp.expect('fulfill: item a mais é KT012', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"subtotal": 3500, "total": 3500, "items": [{"stripe_price_id": "price_PGTAP_CS1", "quantity": 1, "unit_amount": 1000, "currency": "brl"}, {"stripe_price_id": "price_PGTAP_CS2", "quantity": 1, "unit_amount": 2000, "currency": "brl"}, {"stripe_price_id": "price_PGTAP_CS3", "quantity": 1, "unit_amount": 500, "currency": "brl"}]}')$q$, pg_temp.oid('kerr')), 'KT012');
select pg_temp.expect('fulfill: Price repetido é KT012', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"subtotal": 2000, "total": 2000, "items": [{"stripe_price_id": "price_PGTAP_CS1", "quantity": 1, "unit_amount": 1000, "currency": "brl"}, {"stripe_price_id": "price_PGTAP_CS1", "quantity": 1, "unit_amount": 1000, "currency": "brl"}]}')$q$, pg_temp.oid('kerr')), 'KT012');
select pg_temp.expect('fulfill: Price que não é do pedido é KT012', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"items": [{"stripe_price_id": "price_PGTAP_CS1", "quantity": 1, "unit_amount": 1000, "currency": "brl"}, {"stripe_price_id": "price_PGTAP_OUTRO", "quantity": 1, "unit_amount": 2000, "currency": "brl"}]}')$q$, pg_temp.oid('kerr')), 'KT012');
select pg_temp.expect('fulfill: item que não é objeto é KT012', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"items": [1, 2]}')$q$, pg_temp.oid('kerr')), 'KT012');
select pg_temp.expect('fulfill: unit_amount nulo é KT012', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"items": [{"stripe_price_id": "price_PGTAP_CS1", "quantity": 1, "unit_amount": null, "currency": "brl"}, {"stripe_price_id": "price_PGTAP_CS2", "quantity": 1, "unit_amount": 2000, "currency": "brl"}]}')$q$, pg_temp.oid('kerr')), 'KT012');
select pg_temp.expect('fulfill: unit_amount negativo é KT012', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"items": [{"stripe_price_id": "price_PGTAP_CS1", "quantity": 1, "unit_amount": -5, "currency": "brl"}, {"stripe_price_id": "price_PGTAP_CS2", "quantity": 1, "unit_amount": 2000, "currency": "brl"}]}')$q$, pg_temp.oid('kerr')), 'KT012');
select pg_temp.assert('fulfill: as recusas de KT012 também não deixam rastro', (select j #>> '{}' = pg_temp.footprint(pg_temp.oid('kerr')) from res where k = 'kmis_fp')
  and (select bool_and(unit_amount is null) from public.order_items where order_id = pg_temp.oid('kerr')));
select pg_temp.assert('fulfill: depois das recusas, a chamada certa funciona (applied)', (select outcome = 'applied' and send_delivery from pg_temp.fulfill(pg_temp.oid('kerr'), array[1000, 2000])));

-- ===== T47 pedido inexistente =====================================================================
do $c$
begin
  insert into res select 'nf1', to_jsonb(r) from public.fulfill_order(gen_random_uuid(), 'cs_test_PGTAP_NF1', 'paid', 1000, 0, 1000, 'brl', null, null, null, false,
    '[{"stripe_price_id": "price_PGTAP_CS1", "quantity": 1, "unit_amount": 1000, "currency": "brl"}]'::jsonb, 'webhook', 'evt_PGTAP_NF1', 'checkout.session.completed') r;
  insert into res select 'nf2', to_jsonb(r) from public.fulfill_order(gen_random_uuid(), 'cs_test_PGTAP_NF1', 'paid', 1000, 0, 1000, 'brl', null, null, null, false,
    '[{"stripe_price_id": "price_PGTAP_CS1", "quantity": 1, "unit_amount": 1000, "currency": "brl"}]'::jsonb, 'webhook', 'evt_PGTAP_NF1', 'checkout.session.completed') r;
end $c$;
select pg_temp.assert('fulfill: pedido inexistente = not_found, sem direito nem entrega', (select j->>'outcome' = 'not_found' and j->>'order_id' is null and not (j->>'send_delivery')::boolean from res where k = 'nf1'));
select pg_temp.assert('fulfill: ... o evento fica no livro-razão sem pedido', (select outcome = 'not_found' and order_id is null from public.stripe_events where id = 'evt_PGTAP_NF1'));
select pg_temp.assert('fulfill: ... e reenviado é duplicate_event', (select j->>'outcome' = 'duplicate_event' from res where k = 'nf2'));

-- ===== T48 compra só dos itens pagos (já em T44: o CS3 ficou) ======================================
-- ===== T49 fotografia imutável =====================================================================
do $c$
declare o uuid;
begin
  o := pg_temp.buy(pg_temp.uid('kcomp'), array['CPX'], array[2500]);
  insert into pg_temp.oids values ('kcomp', o);
  delete from public.product_games where product_id = (select id from public.products where code = 'CPX') and position = 2;
end $c$;
select pg_temp.assert('fotografia: mudar a composição do produto depois da compra não muda o direito', (select count(*) = 2 from public.entitlement_games eg join public.entitlements e on e.id = eg.entitlement_id where e.order_id = pg_temp.oid('kcomp')));
select pg_temp.assert('fotografia: a biblioteca segue com os 2 jogos comprados', (select jsonb_array_length(public.get_library(pg_temp.uid('kcomp'))->'games') = 2));

-- produto sem jogos na hora da liberação: KT003, nada gravado
do $c$
declare o uuid;
begin
  o := pg_temp.open_order(pg_temp.uid('kfin'), array['CPY']); insert into pg_temp.oids values ('kfin', o);
  delete from public.product_games where product_id = (select id from public.products where code = 'CPY');
  insert into res select 'kfin_fp', to_jsonb(pg_temp.footprint(o));
end $c$;
select pg_temp.expect('fulfill: produto sem jogos na composição é KT003', format($q$select * from pg_temp.fulfill(%L, array[700])$q$, pg_temp.oid('kfin')), 'KT003');
select pg_temp.assert('fulfill: ... e o pedido segue open, sem direito', (select j #>> '{}' = pg_temp.footprint(pg_temp.oid('kfin')) from res where k = 'kfin_fp')
  and (select status = 'open' from public.orders where id = pg_temp.oid('kfin')));

-- ===== T53 cupom (D-24): subtotal, desconto, total e código no pedido; preço cheio nos itens ========
do $c$
begin
  insert into pg_temp.oids values ('kcup', pg_temp.buy(pg_temp.uid('kcup'), array['CS1', 'CS2'], array[1000, 2000],
    '{"discount": 300, "code": "TESTE10", "event": "evt_PGTAP_C1"}'));
end $c$;
select pg_temp.assert('cupom: pedido com subtotal, desconto, total e código promocional',
  (select status = 'paid' and amount_subtotal = 3000 and amount_discount = 300 and amount_total = 2700 and currency = 'brl' and promotion_code = 'TESTE10'
   from public.orders where id = pg_temp.oid('kcup')));
select pg_temp.assert('cupom: os itens guardam o PREÇO CHEIO (o desconto fica só no pedido)',
  (select array_agg(unit_amount order by position) = array[1000, 2000]::bigint[] and bool_and(currency = 'brl') from public.order_items where order_id = pg_temp.oid('kcup')));
select pg_temp.assert('cupom: os direitos não dependem do desconto (2 ativos)', (select count(*) = 2 and bool_and(status = 'active') from public.entitlements where order_id = pg_temp.oid('kcup')));
select pg_temp.assert('cupom: sem p_event_type o livro-razão guarda "unspecified"', (select type = 'unspecified' and outcome = 'applied' from public.stripe_events where id = 'evt_PGTAP_C1'));
select pg_temp.assert('cupom: get_account mostra subtotal, desconto, total, código e o preço cheio dos itens',
  (select (o->>'amount_subtotal')::int = 3000 and (o->>'amount_discount')::int = 300 and (o->>'amount_total')::int = 2700 and o->>'promotion_code' = 'TESTE10'
          and (o->'items'->0->>'unit_amount')::int = 1000 and (o->'items'->1->>'unit_amount')::int = 2000
   from jsonb_array_elements(public.get_account(pg_temp.uid('kcup'))->'orders') o limit 1));
select pg_temp.assert('cupom: get_account de pedido sem cupom traz desconto 0 e código nulo',
  (select (o->>'amount_discount')::int = 0 and (o->'promotion_code') = 'null'::jsonb
   from jsonb_array_elements(public.get_account(pg_temp.uid('kful'))->'orders') o where o->>'status' = 'paid' limit 1));
select pg_temp.i5('cupom: I-5 vale');

do $c$
begin
  insert into pg_temp.oids values ('knoc', pg_temp.buy(pg_temp.uid('knoc'), array['CS1'], array[1000], '{"discount": 100, "code": "   "}'));
end $c$;
select pg_temp.assert('cupom: desconto sem código (cupom aplicado pela API, ou código em branco) grava código nulo',
  (select amount_subtotal = 1000 and amount_discount = 100 and amount_total = 900 and promotion_code is null from public.orders where id = pg_temp.oid('knoc')));
select pg_temp.expect('cupom: o código nulo pode ser preenchido uma vez (atendimento)', format($q$update public.orders set promotion_code = 'ATRASADO' where id = %L$q$, pg_temp.oid('knoc')), 'OK');
select pg_temp.expect('cupom: ... e depois não muda', format($q$update public.orders set promotion_code = 'OUTRO' where id = %L$q$, pg_temp.oid('knoc')), 'KT010');

-- cupom de 100% (D-25): no_payment_required com total 0 e desconto > 0 libera como pago
do $c$
declare o uuid;
begin
  o := pg_temp.open_order(pg_temp.uid('kfull'), array['CS3']); insert into pg_temp.oids values ('kfull', o);
  insert into res select 'full', to_jsonb(r) from pg_temp.fulfill(o, array[500],
    '{"status": "no_payment_required", "discount": 500, "total": 0, "intent": null, "code": "GRATIS100", "event": "evt_PGTAP_FULL"}') r;
end $c$;
select pg_temp.assert('cupom 100%: applied, pedido paid com total 0, direito e entrega',
  (select j->>'outcome' = 'applied' and j->>'order_status' = 'paid' and (j->>'entitlement_count')::int = 1 and (j->>'send_delivery')::boolean from res where k = 'full'));
select pg_temp.assert('cupom 100%: subtotal 500, desconto 500, total 0, sem intent, código gravado, item com o preço cheio',
  (select amount_subtotal = 500 and amount_discount = 500 and amount_total = 0 and stripe_payment_intent_id is null and promotion_code = 'GRATIS100' and status = 'paid'
   from public.orders where id = pg_temp.oid('kfull'))
  and (select unit_amount = 500 from public.order_items where order_id = pg_temp.oid('kfull')));
select pg_temp.assert('cupom 100%: o direito é ativo e a biblioteca mostra o jogo', (select count(*) = 1 and bool_and(status = 'active') from public.entitlements where order_id = pg_temp.oid('kfull'))
  and (select jsonb_array_length(public.get_library(pg_temp.uid('kfull'))->'games') = 1));
select pg_temp.i5('cupom 100%: I-5 vale');

-- ===== pending_payment com cupom, depois a liberação ==============================================
do $c$
declare o uuid;
begin
  o := pg_temp.open_order(pg_temp.uid('kpend'), array['CS1', 'CS2']); insert into pg_temp.oids values ('kpend', o);
  insert into res select 'p1', to_jsonb(r) from pg_temp.setst(o, 'pending_payment',
    '{"subtotal": 3000, "discount": 300, "total": 2700, "currency": "brl", "code": "TESTE10", "intent": "pi_PGTAP_PEND", "event": "evt_PGTAP_P1", "event_type": "checkout.session.completed"}') r;
end $c$;
select pg_temp.assert('pending_payment: applied, com valores, código e intent gravados',
  (select j->>'outcome' = 'applied' and j->>'previous_status' = 'open' and j->>'order_status' = 'pending_payment' and j->'entitlement_status' = 'null'::jsonb from res where k = 'p1')
  and (select status = 'pending_payment' and amount_subtotal = 3000 and amount_discount = 300 and amount_total = 2700 and currency = 'brl'
          and promotion_code = 'TESTE10' and stripe_payment_intent_id = 'pi_PGTAP_PEND' from public.orders where id = pg_temp.oid('kpend')));
select pg_temp.assert('pending_payment: sem direito ainda; a biblioteca lista o pedido em processamento',
  (select count(*) = 0 from public.entitlements where order_id = pg_temp.oid('kpend'))
  and (select jsonb_array_length(public.get_library(pg_temp.uid('kpend'))->'pending') = 1 and jsonb_array_length(public.get_library(pg_temp.uid('kpend'))->'games') = 0));
select pg_temp.expect('pending_payment -> paid: total diferente do gravado é KT012', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"intent": "pi_PGTAP_PEND"}')$q$, pg_temp.oid('kpend')), 'KT012');
select pg_temp.expect('pending_payment -> paid: outro código promocional é KT012', format($q$select * from pg_temp.fulfill(%L, array[1000, 2000], '{"discount": 300, "code": "OUTRO", "intent": "pi_PGTAP_PEND"}')$q$, pg_temp.oid('kpend')), 'KT012');
select pg_temp.assert('pending_payment: as recusas não mudaram o pedido', (select status = 'pending_payment' from public.orders where id = pg_temp.oid('kpend'))
  and (select count(*) = 0 from public.entitlements where order_id = pg_temp.oid('kpend')));
select pg_temp.assert('pending_payment -> paid: com os mesmos valores e sem o código na sessão, mantém o código gravado',
  (select outcome = 'applied' and send_delivery from pg_temp.fulfill(pg_temp.oid('kpend'), array[1000, 2000], '{"discount": 300, "event": "evt_PGTAP_P2", "intent": "pi_PGTAP_PEND"}')));
select pg_temp.assert('pending_payment -> paid: pedido paid com o código TESTE10 e os itens com preço cheio',
  (select status = 'paid' and promotion_code = 'TESTE10' and amount_total = 2700 from public.orders where id = pg_temp.oid('kpend'))
  and (select array_agg(unit_amount order by position) = array[1000, 2000]::bigint[] from public.order_items where order_id = pg_temp.oid('kpend')));
select pg_temp.assert('pending_payment -> paid: trilha open -> pending_payment -> paid',
  (select array_agg(coalesce(from_status, '-') || '>' || to_status order by id) = array['->open', 'open>pending_payment', 'pending_payment>paid'] from public.order_events where order_id = pg_temp.oid('kpend')));
select pg_temp.i5('pending_payment -> paid: I-5 vale');

-- o que foi cobrado não muda depois de gravado (D-24; vale para SQL direto)
select pg_temp.expect('valores: amount_total não muda', format($q$update public.orders set amount_total = 1, amount_subtotal = 1, amount_discount = 0 where id = %L$q$, pg_temp.oid('kpend')), 'KT010');
select pg_temp.expect('valores: amount_discount não muda', format($q$update public.orders set amount_discount = 0, amount_subtotal = 2700 where id = %L$q$, pg_temp.oid('kpend')), 'KT010');
select pg_temp.expect('valores: moeda não muda', format($q$update public.orders set currency = 'usd' where id = %L$q$, pg_temp.oid('kpend')), 'KT010');
select pg_temp.expect('valores: código promocional não muda', format($q$update public.orders set promotion_code = 'OUTRO' where id = %L$q$, pg_temp.oid('kpend')), 'KT010');
select pg_temp.expect('valores: gravar o mesmo valor de novo passa', format($q$update public.orders set amount_total = 2700, promotion_code = 'TESTE10' where id = %L$q$, pg_temp.oid('kpend')), 'OK');

-- ===== T50 contestação aberta, vencida e perdida ====================================================
do $c$
begin
  insert into pg_temp.oids values ('kdis', pg_temp.buy(pg_temp.uid('kdis'), array['CP1', 'CS1'], array[3000, 1000]));
end $c$;
select pg_temp.assert('contestação: antes, 2 direitos ativos e 4 jogos na biblioteca', (select count(*) = 2 and bool_and(status = 'active') from public.entitlements where order_id = pg_temp.oid('kdis'))
  and (select jsonb_array_length(public.get_library(pg_temp.uid('kdis'))->'games') = 4));
do $c$
begin
  insert into res select 'd1', to_jsonb(r) from pg_temp.setst(pg_temp.oid('kdis'), 'disputed',
    '{"event": "evt_PGTAP_D1", "event_type": "charge.dispute.created", "reason": "fraudulent"}') r;
  insert into res select 'd1_fp', to_jsonb(pg_temp.footprint(pg_temp.oid('kdis')));
  insert into res select 'd1_dup', to_jsonb(r) from pg_temp.setst(pg_temp.oid('kdis'), 'disputed', '{"event": "evt_PGTAP_D1"}') r;
  insert into res select 'd1_noop', to_jsonb(r) from pg_temp.setst(pg_temp.oid('kdis'), 'disputed', '{"event": "evt_PGTAP_D1B"}') r;
end $c$;
select pg_temp.assert('contestação aberta: applied (paid -> disputed), direitos revogados',
  (select j->>'outcome' = 'applied' and j->>'previous_status' = 'paid' and j->>'order_status' = 'disputed' and j->>'entitlement_status' = 'revoked' from res where k = 'd1'));
select pg_temp.assert('contestação aberta: TODOS os direitos revogados por dispute, com data',
  (select count(*) = 2 and bool_and(status = 'revoked' and revoke_reason = 'dispute' and revoked_at is not null) from public.entitlements where order_id = pg_temp.oid('kdis')));
select pg_temp.assert('contestação aberta: pedido disputed mantém paid_at; trilha com a razão; livro-razão com o tipo',
  (select status = 'disputed' and paid_at is not null and refunded_at is null from public.orders where id = pg_temp.oid('kdis'))
  and (select from_status = 'paid' and to_status = 'disputed' and reason = 'fraudulent' and stripe_event_id = 'evt_PGTAP_D1' from public.order_events where order_id = pg_temp.oid('kdis') order by id desc limit 1)
  and (select type = 'charge.dispute.created' and outcome = 'applied' from public.stripe_events where id = 'evt_PGTAP_D1'));
select pg_temp.assert('contestação aberta: a entrega na fila é cancelada (entitlement_revoked) e o funil registra dispute_opened',
  (select status = 'canceled' and skip_reason = 'entitlement_revoked' from public.email_outbox where order_id = pg_temp.oid('kdis'))
  and (select count(*) = 1 from public.funnel_events where order_id = pg_temp.oid('kdis') and type = 'dispute_opened'));
select pg_temp.assert('contestação aberta: a biblioteca fica vazia', (select public.get_library(pg_temp.uid('kdis'))->'games' = '[]'::jsonb));
select pg_temp.i5('contestação aberta: I-5 vale (todos revogados)');
select pg_temp.assert('contestação aberta: evento repetido = duplicate_event e nada muda', (select j->>'outcome' = 'duplicate_event' from res where k = 'd1_dup')
  and (select j #>> '{}' = '2|4|1|3|3|1|disputed' from res where k = 'd1_fp'));
select pg_temp.assert('contestação aberta: outro evento no mesmo estado = noop, gravado no livro-razão', (select j->>'outcome' = 'noop' from res where k = 'd1_noop')
  and (select outcome = 'noop' from public.stripe_events where id = 'evt_PGTAP_D1B'));

do $c$
begin
  insert into res select 'd2', to_jsonb(r) from pg_temp.setst(pg_temp.oid('kdis'), 'paid', '{"event": "evt_PGTAP_D2", "event_type": "charge.dispute.closed", "reason": "won"}') r;
end $c$;
select pg_temp.assert('contestação vencida: applied (disputed -> paid) e direitos ativos de volta',
  (select j->>'outcome' = 'applied' and j->>'previous_status' = 'disputed' and j->>'order_status' = 'paid' and j->>'entitlement_status' = 'active' from res where k = 'd2'));
select pg_temp.assert('contestação vencida: direitos active, sem data nem motivo de revogação',
  (select count(*) = 2 and bool_and(status = 'active' and revoked_at is null and revoke_reason is null) from public.entitlements where order_id = pg_temp.oid('kdis')));
select pg_temp.assert('contestação vencida: não reenvia a entrega (continua 1 linha, cancelada) e funil dispute_closed',
  (select count(*) = 1 and bool_and(status = 'canceled') from public.email_outbox where order_id = pg_temp.oid('kdis'))
  and (select count(*) = 1 from public.funnel_events where order_id = pg_temp.oid('kdis') and type = 'dispute_closed'));
select pg_temp.assert('contestação vencida: a biblioteca devolve os 4 jogos', (select jsonb_array_length(public.get_library(pg_temp.uid('kdis'))->'games') = 4));
select pg_temp.i5('contestação vencida: I-5 vale (pedido paid com direitos ativos)');

do $c$
begin
  perform pg_temp.setst(pg_temp.oid('kdis'), 'disputed', '{"event": "evt_PGTAP_D3"}');
  insert into res select 'd4', to_jsonb(r) from pg_temp.setst(pg_temp.oid('kdis'), 'dispute_lost', '{"event": "evt_PGTAP_D4", "event_type": "charge.dispute.closed", "reason": "lost"}') r;
  insert into res select 'd4_fp', to_jsonb(pg_temp.footprint(pg_temp.oid('kdis')));
  insert into res select 'd5', to_jsonb(r) from pg_temp.setst(pg_temp.oid('kdis'), 'paid', '{"event": "evt_PGTAP_D5"}') r;
  insert into res select 'd6', to_jsonb(r) from pg_temp.setst(pg_temp.oid('kdis'), 'refunded', '{"event": "evt_PGTAP_D6"}') r;
  insert into res select 'd7', to_jsonb(r) from pg_temp.setst(pg_temp.oid('kdis'), 'failed', '{"event": "evt_PGTAP_D7"}') r;
  insert into res select 'd8', to_jsonb(r) from pg_temp.fulfill(pg_temp.oid('kdis'), array[3000, 1000], '{"event": "evt_PGTAP_D8"}') r;
end $c$;
select pg_temp.assert('contestação perdida: applied (disputed -> dispute_lost) e os direitos seguem revogados por dispute',
  (select j->>'outcome' = 'applied' and j->>'previous_status' = 'disputed' and j->>'order_status' = 'dispute_lost' and j->>'entitlement_status' = 'revoked' from res where k = 'd4')
  and (select count(*) = 2 and bool_and(status = 'revoked' and revoke_reason = 'dispute') from public.entitlements where order_id = pg_temp.oid('kdis')));
select pg_temp.assert('contestação perdida: 2 aberturas e 2 fechamentos no funil',
  (select count(*) filter (where type = 'dispute_opened') = 2 and count(*) filter (where type = 'dispute_closed') = 2 from public.funnel_events where order_id = pg_temp.oid('kdis')));
select pg_temp.i5('contestação perdida: I-5 vale');
select pg_temp.assert('contestação perdida é terminal: pagar, reembolsar, falhar e liberar viram ignored',
  (select (select j->>'outcome' from res where k = 'd5') = 'ignored' and (select j->>'outcome' from res where k = 'd6') = 'ignored'
      and (select j->>'outcome' from res where k = 'd7') = 'ignored' and (select j->>'outcome' from res where k = 'd8') = 'ignored'));
select pg_temp.assert('contestação perdida: o ignorado não muda o pedido (só entra no livro-razão como ignored)',
  (select pg_temp.footprint(pg_temp.oid('kdis')) = '2|4|1|6|6|9|dispute_lost' and (select count(*) = 4 from public.stripe_events where order_id = pg_temp.oid('kdis') and outcome = 'ignored')));

-- direito revogado à mão (atendimento) convive com a contestação
do $c$
declare o uuid;
begin
  o := pg_temp.buy(pg_temp.uid('kman'), array['CS1', 'CS2'], array[1000, 2000]); insert into pg_temp.oids values ('kman', o);
  update public.entitlements set status = 'revoked', revoked_at = now(), revoke_reason = 'manual'
   where order_id = o and product_id = (select id from public.products where code = 'CS2');
end $c$;
select pg_temp.i5('revogação manual: I-5 aceita pedido paid com 1 direito revogado à mão');
select pg_temp.assert('revogação manual: a biblioteca mostra só o jogo do direito ativo', (select jsonb_array_length(public.get_library(pg_temp.uid('kman'))->'games') = 1));
do $c$
begin
  insert into res select 'm1', to_jsonb(r) from pg_temp.setst(pg_temp.oid('kman'), 'disputed') r;
end $c$;
select pg_temp.assert('contestação sobre revogação manual: o ativo vira dispute e o manual segue manual',
  (select array_agg(p.code || ':' || e.revoke_reason order by p.code) = array['CS1:dispute', 'CS2:manual']
   from public.entitlements e join public.products p on p.id = e.product_id where e.order_id = pg_temp.oid('kman')));
do $c$
begin
  insert into res select 'm2', to_jsonb(r) from pg_temp.setst(pg_temp.oid('kman'), 'paid') r;
end $c$;
select pg_temp.assert('contestação vencida: reativa só o que a contestação revogou; o manual continua revogado',
  (select array_agg(p.code || ':' || e.status order by p.code) = array['CS1:active', 'CS2:revoked']
   from public.entitlements e join public.products p on p.id = e.product_id where e.order_id = pg_temp.oid('kman'))
  and (select j->>'entitlement_status' = 'active' from res where k = 'm2'));
select pg_temp.i5('contestação vencida com revogação manual: I-5 vale');

-- ===== reembolso manual (excepcional): pedido inteiro ================================================
do $c$
declare o uuid;
begin
  o := pg_temp.buy(pg_temp.uid('kref'), array['CS1'], array[1000]); insert into pg_temp.oids values ('kref', o);
  insert into res select 'r1', to_jsonb(r) from pg_temp.setst(o, 'refunded', '{"event": "evt_PGTAP_R1", "event_type": "charge.refunded", "source": "reconcile", "reason": "reembolso manual"}') r;
  insert into res select 'r2', to_jsonb(r) from pg_temp.setst(o, 'paid', '{"event": "evt_PGTAP_R2"}') r;
  insert into res select 'r3', to_jsonb(r) from pg_temp.setst(o, 'disputed', '{"event": "evt_PGTAP_R3"}') r;
  insert into res select 'r4', to_jsonb(r) from pg_temp.fulfill(o, array[1000], '{"event": "evt_PGTAP_R4"}') r;
end $c$;
select pg_temp.assert('reembolso: applied, direitos revogados por refund, refunded_at gravado',
  (select j->>'outcome' = 'applied' and j->>'order_status' = 'refunded' and j->>'entitlement_status' = 'revoked' from res where k = 'r1')
  and (select count(*) = 1 and bool_and(status = 'revoked' and revoke_reason = 'refund' and revoked_at is not null) from public.entitlements where order_id = pg_temp.oid('kref'))
  and (select status = 'refunded' and refunded_at is not null and paid_at is not null from public.orders where id = pg_temp.oid('kref'))
  and (select source = 'reconcile' and reason = 'reembolso manual' from public.order_events where order_id = pg_temp.oid('kref') order by id desc limit 1));
select pg_temp.assert('reembolso: cancela a entrega da fila e a biblioteca fica vazia', (select status = 'canceled' and skip_reason = 'entitlement_revoked' from public.email_outbox where order_id = pg_temp.oid('kref'))
  and (select public.get_library(pg_temp.uid('kref'))->'games' = '[]'::jsonb));
select pg_temp.assert('reembolso é terminal: pagar, contestar e liberar viram ignored',
  (select (select j->>'outcome' from res where k = 'r2') = 'ignored' and (select j->>'outcome' from res where k = 'r3') = 'ignored' and (select j->>'outcome' from res where k = 'r4') = 'ignored'));
select pg_temp.i5('reembolso: I-5 vale');

do $c$
declare o uuid;
begin
  o := pg_temp.buy(pg_temp.uid('kref2'), array['CS2'], array[2000]); insert into pg_temp.oids values ('kref2', o);
  perform pg_temp.setst(o, 'disputed');
  insert into res select 'rr1', to_jsonb(r) from pg_temp.setst(o, 'refunded') r;
end $c$;
select pg_temp.assert('reembolso depois da contestação: applied e o motivo dos direitos passa a refund',
  (select j->>'outcome' = 'applied' and j->>'previous_status' = 'disputed' from res where k = 'rr1')
  and (select count(*) = 1 and bool_and(status = 'revoked' and revoke_reason = 'refund') from public.entitlements where order_id = pg_temp.oid('kref2'))
  and (select refunded_at is not null from public.orders where id = pg_temp.oid('kref2')));
select pg_temp.i5('reembolso depois da contestação: I-5 vale');

-- ===== T51 deferred: o evento de cobrança chegou antes da liberação ================================
do $c$
declare o uuid;
begin
  o := pg_temp.open_order(pg_temp.uid('kdef'), array['CS1']); insert into pg_temp.oids values ('kdef', o);
  insert into res select 'df_fp', to_jsonb(pg_temp.footprint(o));
  insert into res select 'df1', to_jsonb(r) from pg_temp.setst(o, 'disputed', '{"event": "evt_PGTAP_DF1"}') r;
  insert into res select 'df2', to_jsonb(r) from pg_temp.setst(o, 'refunded', '{"event": "evt_PGTAP_DF2"}') r;
  insert into res select 'df3', to_jsonb(r) from pg_temp.setst(o, 'dispute_lost', '{"event": "evt_PGTAP_DF3"}') r;
end $c$;
select pg_temp.assert('deferred: contestação, reembolso e perda com o pedido open devolvem deferred',
  (select (select j->>'outcome' from res where k = 'df1') = 'deferred' and (select j->>'outcome' from res where k = 'df2') = 'deferred' and (select j->>'outcome' from res where k = 'df3') = 'deferred'));
select pg_temp.assert('deferred: nada muda e nenhum evento é gravado', (select j #>> '{}' = pg_temp.footprint(pg_temp.oid('kdef')) from res where k = 'df_fp')
  and (select count(*) = 0 from public.stripe_events where id in ('evt_PGTAP_DF1', 'evt_PGTAP_DF2', 'evt_PGTAP_DF3')));
do $c$
begin
  perform pg_temp.setst(pg_temp.oid('kdef'), 'pending_payment', '{"subtotal": 1000, "discount": 0, "total": 1000, "currency": "brl"}');
  insert into res select 'df4', to_jsonb(r) from pg_temp.setst(pg_temp.oid('kdef'), 'disputed', '{"event": "evt_PGTAP_DF1"}') r;
  perform pg_temp.fulfill(pg_temp.oid('kdef'), array[1000]);
  insert into res select 'df5', to_jsonb(r) from pg_temp.setst(pg_temp.oid('kdef'), 'disputed', '{"event": "evt_PGTAP_DF1"}') r;
end $c$;
select pg_temp.assert('deferred: também com pending_payment', (select j->>'outcome' = 'deferred' from res where k = 'df4'));
select pg_temp.assert('deferred: depois da liberação o MESMO evento é applied (não era duplicado) e revoga',
  (select j->>'outcome' = 'applied' and j->>'order_status' = 'disputed' from res where k = 'df5')
  and (select outcome = 'applied' from public.stripe_events where id = 'evt_PGTAP_DF1')
  and (select count(*) = 1 and bool_and(status = 'revoked') from public.entitlements where order_id = pg_temp.oid('kdef')));
select pg_temp.i5('deferred: I-5 vale');

do $c$
declare o uuid;
begin
  o := pg_temp.buy(pg_temp.uid('kdef2'), array['CS2'], array[2000]); insert into pg_temp.oids values ('kdef2', o);
  insert into res select 'dg1', to_jsonb(r) from pg_temp.setst(o, 'dispute_lost', '{"event": "evt_PGTAP_DG1"}') r;
  perform pg_temp.setst(o, 'disputed', '{"event": "evt_PGTAP_DG2"}');
  insert into res select 'dg2', to_jsonb(r) from pg_temp.setst(o, 'dispute_lost', '{"event": "evt_PGTAP_DG1"}') r;
end $c$;
select pg_temp.assert('deferred: dispute_lost com o pedido ainda paid (a abertura não chegou) é deferred, sem evento e sem mudar o direito',
  (select j->>'outcome' = 'deferred' and j->>'order_status' = 'paid' from res where k = 'dg1'));
select pg_temp.assert('deferred: depois da abertura, a perda (mesmo evento) é applied', (select j->>'outcome' = 'applied' and j->>'order_status' = 'dispute_lost' from res where k = 'dg2'));
select pg_temp.i5('deferred: I-5 vale depois da perda');

-- ===== T52 set_order_status: validações e estados simples ============================================
do $c$
declare p bigint := (select id from public.products where code = 'CS1');
begin
  insert into pg_temp.oids values ('s_open', pg_temp.mk_order(pg_temp.uid('kst'), 'open', array[p], 'ST1'));
  insert into pg_temp.oids values ('s_open2', pg_temp.mk_order(pg_temp.uid('kst2'), 'open', array[p], 'ST2'));
  insert into pg_temp.oids values ('s_open3', pg_temp.mk_order(pg_temp.uid('kst3'), 'open', array[p], 'ST3'));
  insert into pg_temp.oids values ('s_pend', pg_temp.mk_order(pg_temp.uid('kst4'), 'pending_payment', array[p], 'ST4'));
end $c$;
select pg_temp.assert('status: pedido inexistente = not_found, sem gravar o evento', (select outcome = 'not_found' and order_id is null from public.set_order_status(gen_random_uuid(), 'failed', 'webhook', 'evt_PGTAP_NF2')));
select pg_temp.assert('status: ... o evento não entrou no livro-razão (sem pedido não há ambiente)', (select count(*) = 0 from public.stripe_events where id = 'evt_PGTAP_NF2'));
select pg_temp.expect('status: pedido nulo', $q$select * from public.set_order_status(null, 'failed')$q$, 'KT001');
select pg_temp.expect('status: estado nulo', format($q$select * from public.set_order_status(%L, null)$q$, pg_temp.oid('s_open')), 'KT001');
select pg_temp.expect('status: estado open não existe como destino', format($q$select * from public.set_order_status(%L, 'open')$q$, pg_temp.oid('s_open')), 'KT001');
select pg_temp.expect('status: estado desconhecido', format($q$select * from public.set_order_status(%L, 'bogus')$q$, pg_temp.oid('s_open')), 'KT001');
select pg_temp.expect('status: origem inválida', format($q$select * from public.set_order_status(%L, 'failed', 'checkout')$q$, pg_temp.oid('s_open')), 'KT001');
select pg_temp.expect('status: motivo com mais de 200 caracteres', format($q$select * from public.set_order_status(%L, 'failed', 'webhook', null, repeat('x', 201))$q$, pg_temp.oid('s_open')), 'KT001');
select pg_temp.expect('status: evento fora do formato', format($q$select * from public.set_order_status(%L, 'failed', 'webhook', 'abc')$q$, pg_temp.oid('s_open')), 'KT001');
select pg_temp.expect('status: intent fora do formato', format($q$select * from public.set_order_status(%L, 'failed', 'webhook', null, null, null, null, 'xx')$q$, pg_temp.oid('s_open')), 'KT001');
select pg_temp.expect('status: moeda em maiúscula', format($q$select * from public.set_order_status(%L, 'failed', 'webhook', null, null, null, 'BRL')$q$, pg_temp.oid('s_open')), 'KT001');
select pg_temp.expect('status: valor negativo', format($q$select * from public.set_order_status(%L, 'failed', 'webhook', null, null, -1)$q$, pg_temp.oid('s_open')), 'KT001');
select pg_temp.expect('status: pagar um pedido open é com fulfill_order (KT001)', format($q$select * from public.set_order_status(%L, 'paid')$q$, pg_temp.oid('s_open')), 'KT001');
select pg_temp.expect('status: pagar um pedido pending_payment é com fulfill_order (KT001)', format($q$select * from public.set_order_status(%L, 'paid')$q$, pg_temp.oid('s_pend')), 'KT001');
select pg_temp.expect('status: pending_payment sem subtotal e desconto é KT007', format($q$select * from pg_temp.setst(%L, 'pending_payment', '{"total": 1000, "currency": "brl"}')$q$, pg_temp.oid('s_open')), 'KT007');
select pg_temp.expect('status: pending_payment sem total é KT007', format($q$select * from pg_temp.setst(%L, 'pending_payment', '{"subtotal": 1000, "discount": 0, "currency": "brl"}')$q$, pg_temp.oid('s_open')), 'KT007');
select pg_temp.expect('status: pending_payment sem moeda é KT007', format($q$select * from pg_temp.setst(%L, 'pending_payment', '{"subtotal": 1000, "discount": 0, "total": 1000}')$q$, pg_temp.oid('s_open')), 'KT007');
select pg_temp.expect('status: pending_payment com valores que não fecham é KT012', format($q$select * from pg_temp.setst(%L, 'pending_payment', '{"subtotal": 1000, "discount": 100, "total": 1000, "currency": "brl"}')$q$, pg_temp.oid('s_open')), 'KT012');
select pg_temp.expect('status: pending_payment com desconto maior que o subtotal é KT012', format($q$select * from pg_temp.setst(%L, 'pending_payment', '{"subtotal": 100, "discount": 200, "total": 0, "currency": "brl"}')$q$, pg_temp.oid('s_open')), 'KT012');
select pg_temp.assert('status: as recusas não mudaram o pedido', (select status = 'open' and amount_total is null from public.orders where id = pg_temp.oid('s_open')));

do $c$
begin
  insert into res select 'sf1', to_jsonb(r) from pg_temp.setst(pg_temp.oid('s_open'), 'failed', '{"event": "evt_PGTAP_SF1", "event_type": "checkout.session.async_payment_failed"}') r;
  insert into res select 'sf2', to_jsonb(r) from pg_temp.setst(pg_temp.oid('s_open'), 'expired', '{"event": "evt_PGTAP_SF2"}') r;
  insert into res select 'sf3', to_jsonb(r) from pg_temp.setst(pg_temp.oid('s_open'), 'disputed', '{"event": "evt_PGTAP_SF3"}') r;
  insert into res select 'sf4', to_jsonb(r) from pg_temp.setst(pg_temp.oid('s_open'), 'paid', '{"event": "evt_PGTAP_SF4"}') r;
  insert into res select 'se1', to_jsonb(r) from pg_temp.setst(pg_temp.oid('s_open2'), 'expired', '{"event": "evt_PGTAP_SE1", "event_type": "checkout.session.expired"}') r;
  insert into res select 'se2', to_jsonb(r) from pg_temp.setst(pg_temp.oid('s_open2'), 'failed', '{"event": "evt_PGTAP_SE2"}') r;
  insert into res select 'sp1', to_jsonb(r) from pg_temp.setst(pg_temp.oid('s_pend'), 'expired', '{"event": "evt_PGTAP_SP1"}') r;
  insert into res select 'sp2', to_jsonb(r) from pg_temp.setst(pg_temp.oid('s_pend'), 'failed', '{"event": "evt_PGTAP_SP2"}') r;
end $c$;
select pg_temp.assert('status: open -> failed passa sem valores (applied)', (select j->>'outcome' = 'applied' and j->>'previous_status' = 'open' and j->>'order_status' = 'failed' and j->'entitlement_status' = 'null'::jsonb from res where k = 'sf1')
  and (select status = 'failed' from public.orders where id = pg_temp.oid('s_open')));
select pg_temp.assert('status: failed é terminal: expired, disputed e paid viram ignored (disputed não é deferred em failed)',
  (select (select j->>'outcome' from res where k = 'sf2') = 'ignored' and (select j->>'outcome' from res where k = 'sf3') = 'ignored' and (select j->>'outcome' from res where k = 'sf4') = 'ignored'));
select pg_temp.assert('status: open -> expired passa e o funil registra checkout_expired', (select j->>'outcome' = 'applied' and j->>'order_status' = 'expired' from res where k = 'se1')
  and (select count(*) = 1 from public.funnel_events where order_id = pg_temp.oid('s_open2') and type = 'checkout_expired'));
select pg_temp.assert('status: expired é terminal (failed vira ignored)', (select j->>'outcome' = 'ignored' from res where k = 'se2'));
select pg_temp.assert('status: pending_payment -> expired não é aresta (ignored); -> failed passa',
  (select j->>'outcome' = 'ignored' from res where k = 'sp1') and (select j->>'outcome' = 'applied' and j->>'order_status' = 'failed' from res where k = 'sp2'));
select pg_temp.assert('status: o ignorado só entra no livro-razão como ignored e não deixa trilha',
  (select outcome = 'ignored' from public.stripe_events where id = 'evt_PGTAP_SF2')
  and (select count(*) = 1 from public.order_events where order_id = pg_temp.oid('s_open')));
select pg_temp.expect_as('status: service_role executa', 'service_role', format($q$select * from public.set_order_status(%L, 'failed')$q$, pg_temp.oid('s_open3')), 'OK');
select pg_temp.expect_as('status: anon não executa', 'anon', format($q$select * from public.set_order_status(%L, 'failed')$q$, pg_temp.oid('s_open3')), '42501');
select pg_temp.expect_as('fulfill: service_role executa (chega à regra de negócio: unpaid é KT002)', 'service_role', format($q$select * from public.fulfill_order(%L, 'cs_test_PGTAP_ST3', 'unpaid', 1000, 0, 1000, 'brl', null, null, null, false, '[{}]'::jsonb)$q$, pg_temp.oid('s_open3')), 'KT002');
select pg_temp.assert('fulfill: pedido open passa a ser pago só depois do pagamento (estado final de todo o arquivo coerente)',
  (select count(*) = 0 from public.orders o where o.user_id in (select id from pg_temp.ids where name like 'k%') and o.status = 'paid'
     and (select count(*) from public.entitlements e where e.order_id = o.id) <> (select count(*) from public.order_items i where i.order_id = o.id)));

-- ===== T130 o COMMIT roda como service_role (D-12): os gatilhos diferidos da I-5 não podem depender de SELECT nas tabelas =====
-- Os gatilhos diferidos disparam no COMMIT, FORA da RPC SECURITY DEFINER, com o papel da sessão (service_role pela API). Aqui a RPC roda como
-- service_role e "set constraints all immediate" antecipa o COMMIT ainda como service_role. Rodar como dono (postgres) esconderia o defeito.
create function pg_temp.as_api(p_label text, p_sql text) returns text language plpgsql as $$
declare st text := 'OK';
begin
  set local role service_role;
  begin
    execute p_sql;
    set constraints all immediate;
  exception when others then get stacked diagnostics st = returned_sqlstate; end;
  set constraints all deferred;
  reset role;
  return extensions.is(st, 'OK', p_label);
end $$;

do $c$
begin
  perform pg_temp.mk_user('kapi'); perform pg_temp.mk_user('kapi2');
  perform pg_temp.fill_cart(pg_temp.uid('kapi'), array['CP1', 'CS1']);   -- version 2
  perform pg_temp.fill_cart(pg_temp.uid('kapi2'), array['CS2']);         -- version 1
end $c$;
select pg_temp.as_api('API: create_order_from_cart insere o pedido e o COMMIT passa', format($q$select * from public.create_order_from_cart(%L, false, 2, 'v-pgtap', true)$q$, pg_temp.uid('kapi')));
select pg_temp.as_api('API: create_order_from_cart do segundo usuário', format($q$select * from public.create_order_from_cart(%L, false, 1, 'v-pgtap', true)$q$, pg_temp.uid('kapi2')));
do $c$
begin
  insert into pg_temp.oids select 'kapi', id from public.orders where user_id = pg_temp.uid('kapi');
  insert into pg_temp.oids select 'kapi2', id from public.orders where user_id = pg_temp.uid('kapi2');
end $c$;
select pg_temp.as_api('API: attach_checkout_session grava a sessão e o COMMIT passa',
  format($q$select public.attach_checkout_session(%L, %L)$q$, pg_temp.oid('kapi'), 'cs_test_PGTAP_' || replace(pg_temp.oid('kapi')::text, '-', '')));
select pg_temp.as_api('API: fulfill_order com cupom cria os direitos e o COMMIT passa (I-5 como service_role)',
  format($q$select * from public.fulfill_order(%L, %L, 'paid', 4000, 400, 3600, 'brl', 'TESTE10', %L, null, false, %L::jsonb, 'webhook', 'evt_PGTAP_API1', 'checkout.session.completed')$q$,
    pg_temp.oid('kapi'), 'cs_test_PGTAP_' || replace(pg_temp.oid('kapi')::text, '-', ''), 'pi_PGTAP_API1', pg_temp.sess_items(pg_temp.oid('kapi'), array[3000, 1000])::text));
select pg_temp.assert('API: o pedido ficou paid, com o desconto, 2 direitos ativos e 1 entrega',
  (select status = 'paid' and amount_subtotal = 4000 and amount_discount = 400 and amount_total = 3600 and promotion_code = 'TESTE10' from public.orders where id = pg_temp.oid('kapi'))
  and (select count(*) = 2 and bool_and(status = 'active') from public.entitlements where order_id = pg_temp.oid('kapi'))
  and (select count(*) = 1 from public.email_outbox where order_id = pg_temp.oid('kapi')));
select pg_temp.as_api('API: set_order_status disputed revoga e o COMMIT passa',
  format($q$select * from public.set_order_status(%L, 'disputed', 'webhook', 'evt_PGTAP_API2', 'fraudulent')$q$, pg_temp.oid('kapi')));
select pg_temp.assert('API: contestação aberta revogou os 2 direitos', (select count(*) = 2 and bool_and(status = 'revoked' and revoke_reason = 'dispute') from public.entitlements where order_id = pg_temp.oid('kapi')));
select pg_temp.as_api('API: set_order_status paid (contestação vencida) reativa e o COMMIT passa',
  format($q$select * from public.set_order_status(%L, 'paid', 'webhook', 'evt_PGTAP_API3')$q$, pg_temp.oid('kapi')));
select pg_temp.assert('API: contestação vencida reativou os 2 direitos', (select count(*) = 2 and bool_and(status = 'active') from public.entitlements where order_id = pg_temp.oid('kapi')));
select pg_temp.as_api('API: set_order_status disputed de novo', format($q$select * from public.set_order_status(%L, 'disputed', 'webhook', 'evt_PGTAP_API4')$q$, pg_temp.oid('kapi')));
select pg_temp.as_api('API: set_order_status dispute_lost mantém revogado e o COMMIT passa', format($q$select * from public.set_order_status(%L, 'dispute_lost', 'webhook', 'evt_PGTAP_API5')$q$, pg_temp.oid('kapi')));
select pg_temp.as_api('API: set_order_status pending_payment (assíncrono) grava os valores e o COMMIT passa',
  format($q$select * from public.set_order_status(%L, 'pending_payment', 'webhook', 'evt_PGTAP_API6', null, 1000, 'brl', null, 1000, 0, null, 'checkout.session.completed')$q$, pg_temp.oid('kapi2')));
select pg_temp.as_api('API: fulfill_order a partir de pending_payment e o COMMIT passa',
  format($q$select * from public.fulfill_order(%L, %L, 'paid', 1000, 0, 1000, 'brl', null, %L, null, false, %L::jsonb, 'webhook', 'evt_PGTAP_API7', 'checkout.session.async_payment_succeeded')$q$,
    pg_temp.oid('kapi2'), 'cs_test_PGTAP_' || replace(pg_temp.oid('kapi2')::text, '-', ''), 'pi_PGTAP_API7', pg_temp.sess_items(pg_temp.oid('kapi2'), array[1000])::text));
select pg_temp.as_api('API: set_order_status refunded revoga e o COMMIT passa', format($q$select * from public.set_order_status(%L, 'refunded', 'reconcile', 'evt_PGTAP_API8')$q$, pg_temp.oid('kapi2')));
select pg_temp.assert('API: estados finais (dispute_lost e refunded) com os direitos revogados',
  (select status = 'dispute_lost' from public.orders where id = pg_temp.oid('kapi'))
  and (select status = 'refunded' and refunded_at is not null from public.orders where id = pg_temp.oid('kapi2'))
  and (select count(*) = 3 and bool_and(status = 'revoked') from public.entitlements where order_id in (pg_temp.oid('kapi'), pg_temp.oid('kapi2'))));

-- as RPCs de escrita do I2b também terminam sem erro no COMMIT como service_role
do $c$ begin perform pg_temp.mk_user('kapi3'); end $c$;
select pg_temp.as_api('API: cart_add', format($q$select * from public.cart_add(%L, 'CS3')$q$, pg_temp.uid('kapi3')));
select pg_temp.as_api('API: cart_remove', format($q$select * from public.cart_remove(%L, 'CS3')$q$, pg_temp.uid('kapi3')));
select pg_temp.as_api('API: set_marketing_consent (conceder)', format($q$select * from public.set_marketing_consent(%L, true, 'signup_prompt', 'v1-pgtap')$q$, pg_temp.uid('kapi3')));
select pg_temp.as_api('API: mark_marketing_prompt', format($q$select public.mark_marketing_prompt(%L)$q$, pg_temp.uid('kapi3')));
select pg_temp.as_api('API: set_stripe_customer', format($q$select public.set_stripe_customer(%L, 'cus_PGTAP_KAPI3')$q$, pg_temp.uid('kapi3')));
select pg_temp.as_api('API: unsubscribe (revogar)', format($q$select * from public.unsubscribe(%L)$q$, pg_temp.uid('kapi3')));
select pg_temp.as_api('API: leituras (get_cart, get_library, get_account, get_order_status, get_catalog)',
  format($q$select public.get_cart(%1$L), public.get_library(%1$L), public.get_account(%1$L), public.get_catalog(), (select count(*) from public.get_order_status(%2$L, %1$L))$q$, pg_temp.uid('kapi3'), pg_temp.oid('kapi')));

-- ===== controle negativo: o i5 enxerga pedido paid sem direito (senão os "I-5 vale" acima não provariam nada) =====
do $c$ begin perform pg_temp.mk_order(pg_temp.uid('kfin'), 'paid', array[(select id from public.products where code = 'CS2')], 'CTRL1'); end $c$;
select pg_temp.expect('controle: pedido paid sem direito é recusado pelo I-5 (KT011) ao antecipar o gatilho diferido', 'set constraints all immediate', 'KT011');
set constraints all deferred;
select pg_temp.expect_as('controle: o I-5 também detecta (KT011) quando dispara como service_role', 'service_role', 'set constraints all immediate', 'KT011');
set constraints all deferred;

select * from finish();
rollback;
