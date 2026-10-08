-- 01_schema: as 19 tabelas, tipos novos, constraints, unicidades, FKs compostas e índices (docs/data-contract.md v0.3.2, seções 2 e 3).
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

-- ===== fixtures ==================================================================================
do $fx$
declare v_pk bigint; v_s1 bigint; v_s2 bigint; u1 uuid; u2 uuid; o1 uuid; o2 uuid;
begin
  v_pk := pg_temp.mk_product('PK1', 'bundle', 3);
  v_s1 := pg_temp.mk_product('SG1', 'single', 1);
  v_s2 := pg_temp.mk_product('SG2', 'single', 1);
  insert into public.games (code, slug, name, access, status) values ('PG-FREE', 'pg-free', 'Grátis [TESTE]', 'free', 'draft');
  u1 := pg_temp.mk_user('u1');
  u2 := pg_temp.mk_user('u2');
  perform pg_temp.mk_user('unconf', false, 'hash-do-atacante');
  o1 := pg_temp.mk_order(u1, 'paid', array[v_pk, v_s1], 'FX1');
  perform pg_temp.mk_ents(o1);
  o2 := pg_temp.mk_order(u2, 'open', array[v_s2], 'FX2');
  insert into public.carts (user_id) values (u1);
  insert into public.cart_items (user_id, product_id) values (u1, v_s2);
  insert into public.email_outbox (user_id, order_id, kind, category, to_email, dedupe_key, payload)
  values (u1, o1, 'delivery', 'transactional', 'u1@pgtap.test', 'delivery:' || o1, '{}');
  insert into public.stripe_events (id, type, livemode, outcome, order_id) values ('evt_PGTAP_FX1', 'checkout.session.completed', false, 'applied', o1);
  insert into public.order_events (order_id, to_status, source) values (o1, 'paid', 'webhook');
  insert into public.download_events (user_id, file_id, kind) select u1, f.id, 'paid' from public.files f limit 1;
  insert into public.funnel_events (user_id, type, order_id) values (u1, 'order_paid', o1);
end $fx$;

-- ===== estrutura =================================================================================
select pg_temp.assert('as 19 tabelas existem', (select count(*) = 19 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  and c.relname in ('products','games','product_games','files','file_objects','profiles','marketing_consents','email_suppressions','carts','cart_items','orders','order_items','order_events','entitlements','entitlement_games','stripe_events','funnel_events','download_events','email_outbox')));
select pg_temp.assert('toda FK tem índice com a 1ª coluna na frente',
  not exists (select 1 from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace
    and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indisvalid and (i.indkey::int2[])[0] = c.conkey[1])));
select pg_temp.assert('nenhuma coluna url/uri/ip/user_agent (I-11)',
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name not in ('test')
    and (column_name ~* '(^|_)(url|uri)(_|$)' or column_name ~* '^(ip|ip_address|user_agent)$')));
select pg_temp.assert('v0.3.2: sem entitlements.expires_at, orders.product_id e email_outbox.product_name',
  not exists (select 1 from information_schema.columns where table_schema = 'public' and
    ((table_name = 'entitlements' and column_name = 'expires_at') or (table_name = 'orders' and column_name = 'product_id')
     or (table_name = 'email_outbox' and column_name = 'product_name'))));
select pg_temp.assert('orders.user_id e orders.terms_accepted_at são NOT NULL',
  (select count(*) = 2 from information_schema.columns where table_schema = 'public' and table_name = 'orders'
     and column_name in ('user_id','terms_accepted_at') and is_nullable = 'NO'));
select pg_temp.assert('triggers em auth.users existem (2) e são os nossos',
  (select count(*) = 2 from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal and tgname in ('on_auth_user_created','on_auth_user_confirmed')));

-- ===== catálogo ===================================================================================
select pg_temp.expect('products: kind inválido', $q$insert into public.products (code,slug,kind) values ('ZZ1','zz1','combo')$q$, '23514');
select pg_temp.expect('products: avulso com 2 jogos', $q$insert into public.products (code,slug,kind,games_expected) values ('ZZ2','zz2','single',2)$q$, '23514');
select pg_temp.expect('products: code minúsculo', $q$insert into public.products (code,slug,kind) values ('zz3','zz3','single')$q$, '23514');
select pg_temp.expect('products: ativo sem dados', $q$insert into public.products (code,slug,kind,status) values ('ZZ4','zz4','single','active')$q$, '23514');
select pg_temp.expect('games: access inválido', $q$insert into public.games (code,slug,name,access) values ('PG-X1','pg-x1','x','secret')$q$, '23514');
select pg_temp.expect('product_games: jogo grátis em produto (FK composta)', $q$insert into public.product_games (product_id, game_id, position) select p.id, g.id, 9 from public.products p, public.games g where p.code='PK1' and g.code='PG-FREE'$q$, '23503');
select pg_temp.expect('product_games: posição repetida', $q$update public.product_games set position = 1 where game_id = (select id from public.games where code='GM-PK1-2')$q$, '23505');

-- ===== conta, carrinho ============================================================================
select pg_temp.expect('carts: version negativa', format($q$insert into public.carts (user_id, version) values (%L, -1)$q$, pg_temp.uid('u2')), '23514');
select pg_temp.expect('cart_items: sem carrinho', format($q$insert into public.cart_items (user_id, product_id) select %L, id from public.products where code='SG1'$q$, pg_temp.uid('u2')), '23503');
select pg_temp.expect('cart_items: item repetido (PK)', format($q$insert into public.cart_items (user_id, product_id) select %L, id from public.products where code='SG2'$q$, pg_temp.uid('u1')), '23505');
select pg_temp.expect('profiles: opt-in sem data', format($q$update public.profiles set marketing_opt_in = true where user_id = %L$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('profiles: cliente Stripe inválido', format($q$update public.profiles set stripe_customer_id = 'x' where user_id = %L$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('profiles: cliente Stripe repetido', format($q$update public.profiles set stripe_customer_id = 'cus_PGTAP1' where user_id in (%L, %L)$q$, pg_temp.uid('u1'), pg_temp.uid('u2')), '23505');
select pg_temp.expect('consent: conceder sem versão', format($q$insert into public.marketing_consents (user_id,email,action,source) values (%L,'u2@pgtap.test','granted','account')$q$, pg_temp.uid('u2')), '23514');
select pg_temp.expect('consent: signup_prompt revogando', format($q$insert into public.marketing_consents (user_id,email,action,source) values (%L,'u2@pgtap.test','revoked','signup_prompt')$q$, pg_temp.uid('u2')), '23514');
select pg_temp.expect('consent: unsubscribe_link concedendo', format($q$insert into public.marketing_consents (user_id,email,action,source,text_version) values (%L,'u2@pgtap.test','granted','unsubscribe_link','v1')$q$, pg_temp.uid('u2')), '23514');
select pg_temp.expect('consent: e-mail maiúsculo', format($q$insert into public.marketing_consents (user_id,email,action,source,text_version) values (%L,'U2@pgtap.test','granted','account','v1')$q$, pg_temp.uid('u2')), '23514');
select pg_temp.expect('suppression: motivo inválido', $q$insert into public.email_suppressions (email,reason,source) values ('x@pgtap.test','spam','brevo_webhook')$q$, '23514');
select pg_temp.expect('suppression: repetida (e-mail, motivo)', $q$insert into public.email_suppressions (email,reason,source) values ('y@pgtap.test','hard_bounce','brevo_webhook'), ('y@pgtap.test','hard_bounce','support')$q$, '23505');

-- ===== pedidos e itens ============================================================================
select pg_temp.expect('orders: user_id nulo', $q$insert into public.orders (email,cart_version,terms_version,terms_accepted_at,livemode) values ('a@b.test',0,'v',now(),false)$q$, '23502');
select pg_temp.expect('orders: sem aceite dos termos (terms_accepted_at NOT NULL)', format($q$insert into public.orders (user_id,email,cart_version,terms_version,livemode) values (%L,'a@b.test',0,'v',false)$q$, pg_temp.uid('u1')), '23502');
select pg_temp.expect('orders: e-mail maiúsculo', format($q$insert into public.orders (user_id,email,cart_version,terms_version,terms_accepted_at,livemode) values (%L,'A@b.test',0,'v',now(),false)$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: terms_version vazio', format($q$insert into public.orders (user_id,email,cart_version,terms_version,terms_accepted_at,livemode) values (%L,'a@b.test',0,'  ',now(),false)$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: dispute_lost sem paid_at', format($q$insert into public.orders (user_id,email,status,cart_version,terms_version,terms_accepted_at,livemode,amount_total,currency) values (%L,'a@b.test','dispute_lost',0,'v',now(),false,0,'brl')$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: refunded sem refunded_at', format($q$insert into public.orders (user_id,email,status,cart_version,terms_version,terms_accepted_at,livemode,amount_total,currency,paid_at) values (%L,'a@b.test','refunded',0,'v',now(),false,0,'brl',now())$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: estado desconhecido', format($q$insert into public.orders (user_id,email,status,cart_version,terms_version,terms_accepted_at,livemode) values (%L,'a@b.test','zzz',0,'v',now(),false)$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: valor sem moeda', format($q$insert into public.orders (user_id,email,cart_version,terms_version,terms_accepted_at,livemode,amount_total) values (%L,'a@b.test',0,'v',now(),false,5)$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: sessão repetida', format($q$insert into public.orders (user_id,email,cart_version,terms_version,terms_accepted_at,livemode,stripe_checkout_session_id) values (%L,'a@b.test',0,'v',now(),false,'cs_test_PGTAP_FX1')$q$, pg_temp.uid('u1')), '23505');
select pg_temp.expect('orders: user_id inexistente', $q$insert into public.orders (user_id,email,cart_version,terms_version,terms_accepted_at,livemode) values (gen_random_uuid(),'a@b.test',0,'v',now(),false)$q$, '23503');
select pg_temp.expect('order_items: posição repetida', $q$insert into public.order_items (order_id,product_id,position,stripe_price_id) select o.id, p.id, 1, p.stripe_price_id from public.orders o, public.products p where o.stripe_checkout_session_id='cs_test_PGTAP_FX2' and p.code='SG2'$q$, '23505');
select pg_temp.expect('order_items: valor sem moeda', $q$update public.order_items set unit_amount = 5 where order_id = (select id from public.orders where stripe_checkout_session_id='cs_test_PGTAP_FX2')$q$, '23514');

-- ===== direitos ====================================================================================
select pg_temp.expect('entitlements: item inexistente', format($q$insert into public.entitlements (order_id,product_id,user_id) select o.id, p.id, %L from public.orders o, public.products p where o.stripe_checkout_session_id='cs_test_PGTAP_FX1' and p.code='SG2'$q$, pg_temp.uid('u1')), '23503');
select pg_temp.expect('entitlements: user_id diferente do dono do pedido', format($q$insert into public.entitlements (order_id,product_id,user_id) select o.id, i.product_id, %L from public.orders o join public.order_items i on i.order_id=o.id where o.stripe_checkout_session_id='cs_test_PGTAP_FX2'$q$, pg_temp.uid('u1')), '23503');
select pg_temp.expect('entitlements: direito repetido por item', $q$insert into public.entitlements (order_id,product_id,user_id) select e.order_id, e.product_id, e.user_id from public.entitlements e limit 1$q$, '23505');
select pg_temp.expect('entitlements: revogado sem motivo', $q$update public.entitlements set status='revoked' where id = (select id from public.entitlements limit 1)$q$, '23514');
select pg_temp.expect('entitlements: motivo inválido', $q$update public.entitlements set status='revoked', revoked_at=now(), revoke_reason='x' where id = (select id from public.entitlements limit 1)$q$, '23514');

-- ===== funil e fila ===============================================================================
select pg_temp.expect('funnel: cart_item_added sem cart_version', format($q$insert into public.funnel_events (user_id,type,product_id) select %L,'cart_item_added',id from public.products limit 1$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('funnel: order_paid sem pedido', format($q$insert into public.funnel_events (user_id,type) values (%L,'order_paid')$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('funnel: tipo desconhecido', format($q$insert into public.funnel_events (user_id,type) values (%L,'visita')$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('funnel: order_paid repetido no pedido', $q$insert into public.funnel_events (user_id,type,order_id) select user_id,'order_paid',id from public.orders where stripe_checkout_session_id='cs_test_PGTAP_FX1'$q$, '23505');
select pg_temp.expect('funnel: account_confirmed repetido', format($q$insert into public.funnel_events (user_id,type) values (%L,'account_confirmed')$q$, pg_temp.uid('u1')), '23505');
select pg_temp.expect('stripe_events: id repetido', $q$insert into public.stripe_events (id,type,livemode,outcome) values ('evt_PGTAP_FX1','t',false,'applied')$q$, '23505');
select pg_temp.expect('stripe_events: id inválido', $q$insert into public.stripe_events (id,type,livemode,outcome) values ('x','t',false,'applied')$q$, '23514');
select pg_temp.expect('order_events: origem inválida', $q$insert into public.order_events (order_id,to_status,source) select id,'paid','x' from public.orders limit 1$q$, '23514');
select pg_temp.expect('download_events: kind inválido', $q$insert into public.download_events (file_id,kind) select id,'x' from public.files limit 1$q$, '23514');
select pg_temp.expect('outbox: kind × category', format($q$insert into public.email_outbox (user_id,kind,category,to_email,dedupe_key) values (%L,'cart_reminder','transactional','a@b.test','k:1')$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('outbox: delivery sem pedido', format($q$insert into public.email_outbox (user_id,kind,category,to_email,dedupe_key) values (%L,'delivery','transactional','a@b.test','k:2')$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('outbox: dedupe_key repetida', $q$insert into public.email_outbox (user_id,order_id,kind,category,to_email,dedupe_key) select user_id,order_id,kind,category,to_email,dedupe_key from public.email_outbox limit 1$q$, '23505');
select pg_temp.expect('outbox: dedupe_key com espaço', format($q$insert into public.email_outbox (user_id,kind,category,to_email,dedupe_key) values (%L,'cart_reminder','marketing','a@b.test','k 3')$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('outbox: payload que não é objeto', format($q$insert into public.email_outbox (user_id,kind,category,to_email,dedupe_key,payload) values (%L,'cart_reminder','marketing','a@b.test','k:4','[]')$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('outbox: skipped sem motivo', format($q$insert into public.email_outbox (user_id,kind,category,to_email,dedupe_key,status) values (%L,'cart_reminder','marketing','a@b.test','k:5','skipped')$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('outbox: motivo desconhecido', format($q$insert into public.email_outbox (user_id,kind,category,to_email,dedupe_key,status,skip_reason) values (%L,'cart_reminder','marketing','a@b.test','k:6','skipped','porque_sim')$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('outbox: sending sem locked_at', format($q$insert into public.email_outbox (user_id,kind,category,to_email,dedupe_key,status) values (%L,'cart_reminder','marketing','a@b.test','k:7','sending')$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('outbox: sent sem sent_at', format($q$insert into public.email_outbox (user_id,kind,category,to_email,dedupe_key,status) values (%L,'cart_reminder','marketing','a@b.test','k:8','sent')$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('outbox: skipped com motivo válido passa', format($q$insert into public.email_outbox (user_id,kind,category,to_email,dedupe_key,status,skip_reason) values (%L,'cart_reminder','marketing','a@b.test','k:9','skipped','no_opt_in')$q$, pg_temp.uid('u1')), 'OK');

select * from finish();
rollback;
