-- 01_schema: as 19 tabelas, tipos novos, constraints, unicidades, FKs compostas e índices (docs/data-contract.md v0.3.3, seções 2 e 3).
-- Roda com `supabase test db` (pgTAP). Dados de teste só existem dentro da transação (rollback no fim).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp): supabase/tests/database/helpers ===========
\ir helpers/base.psql
\ir helpers/fixtures.psql

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
select pg_temp.assert('sem o ZIP do pacote (2026-10-24): files sem product_id, todo arquivo de um jogo',
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'files' and column_name = 'product_id')
  and (select is_nullable = 'NO' from information_schema.columns where table_schema = 'public' and table_name = 'files' and column_name = 'game_id'));
-- Desde 20261023200000 a compra tem os termos por CHECK; o presente (kind courtesy) não passa por eles. Desde
-- 20261024230000 a compra nasce com a versão e o momento do aceite chega quando a pessoa marca a caixa.
select pg_temp.assert('compra exige a versão dos termos (orders_terms_required); user_id e email só ficam nulos com anonymized_at (D-28)',
  exists (select 1 from pg_constraint where conname = 'orders_terms_required' and conrelid = 'public.orders'::regclass)
  and exists (select 1 from pg_constraint where conname = 'orders_anonymized_check' and conrelid = 'public.orders'::regclass));
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
select pg_temp.expect('suppression: repetida (e-mail, motivo)', $q$insert into public.email_suppressions (email,reason,source) values ('y@pgtap.test','hard_bounce','brevo_webhook'), ('y@pgtap.test','hard_bounce','brevo_webhook')$q$, '23505');
select pg_temp.expect('suppression: origem que não seja a Brevo', $q$insert into public.email_suppressions (email,reason,source) values ('z@pgtap.test','hard_bounce','support')$q$, '23514');

-- ===== pedidos e itens ============================================================================
select pg_temp.expect('orders: user_id nulo sem anonimização (D-28)', $q$insert into public.orders (email,cart_version,terms_version,terms_accepted_at,livemode) values ('a@b.test',0,'v',now(),false)$q$, '23514');
select pg_temp.expect('orders: e-mail nulo sem anonimização (D-28)', format($q$insert into public.orders (user_id,cart_version,terms_version,terms_accepted_at,livemode) values (%L,0,'v',now(),false)$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: compra sem a versão dos termos (orders_terms_required)', format($q$insert into public.orders (user_id,email,cart_version,livemode) values (%L,'a@b.test',0,false)$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: e-mail maiúsculo', format($q$insert into public.orders (user_id,email,cart_version,terms_version,terms_accepted_at,livemode) values (%L,'A@b.test',0,'v',now(),false)$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: terms_version vazio', format($q$insert into public.orders (user_id,email,cart_version,terms_version,terms_accepted_at,livemode) values (%L,'a@b.test',0,'  ',now(),false)$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: dispute_lost sem paid_at', format($q$insert into public.orders (user_id,email,status,cart_version,terms_version,terms_accepted_at,livemode,amount_total,currency) values (%L,'a@b.test','dispute_lost',0,'v',now(),false,0,'brl')$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: refunded sem refunded_at', format($q$insert into public.orders (user_id,email,status,cart_version,terms_version,terms_accepted_at,livemode,amount_total,currency,paid_at) values (%L,'a@b.test','refunded',0,'v',now(),false,0,'brl',now())$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: estado desconhecido', format($q$insert into public.orders (user_id,email,status,cart_version,terms_version,terms_accepted_at,livemode) values (%L,'a@b.test','zzz',0,'v',now(),false)$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: valor sem moeda', format($q$insert into public.orders (user_id,email,cart_version,terms_version,terms_accepted_at,livemode,amount_total) values (%L,'a@b.test',0,'v',now(),false,5)$q$, pg_temp.uid('u1')), '23514');
-- D-24: subtotal, desconto, total e código promocional
select pg_temp.expect('orders: subtotal sem desconto (par)', format($q$insert into public.orders (user_id,email,cart_version,terms_version,terms_accepted_at,livemode,amount_total,currency,amount_subtotal) values (%L,'a@b.test',0,'v',now(),false,5,'brl',5)$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: desconto sem subtotal (par)', format($q$insert into public.orders (user_id,email,cart_version,terms_version,terms_accepted_at,livemode,amount_total,currency,amount_discount) values (%L,'a@b.test',0,'v',now(),false,5,'brl',0)$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: subtotal sem total', format($q$insert into public.orders (user_id,email,cart_version,terms_version,terms_accepted_at,livemode,amount_subtotal,amount_discount) values (%L,'a@b.test',0,'v',now(),false,10,0)$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: desconto maior que o subtotal', format($q$insert into public.orders (user_id,email,cart_version,terms_version,terms_accepted_at,livemode,amount_total,currency,amount_subtotal,amount_discount) values (%L,'a@b.test',0,'v',now(),false,0,'brl',5,9)$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: total diferente de subtotal - desconto', format($q$insert into public.orders (user_id,email,cart_version,terms_version,terms_accepted_at,livemode,amount_total,currency,amount_subtotal,amount_discount) values (%L,'a@b.test',0,'v',now(),false,8,'brl',10,3)$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: desconto negativo', format($q$insert into public.orders (user_id,email,cart_version,terms_version,terms_accepted_at,livemode,amount_total,currency,amount_subtotal,amount_discount) values (%L,'a@b.test',0,'v',now(),false,11,'brl',10,-1)$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: subtotal negativo', format($q$insert into public.orders (user_id,email,cart_version,terms_version,terms_accepted_at,livemode,amount_total,currency,amount_subtotal,amount_discount) values (%L,'a@b.test',0,'v',now(),false,-5,'brl',-5,0)$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: paid exige o subtotal (além do total)', format($q$insert into public.orders (user_id,email,status,cart_version,terms_version,terms_accepted_at,livemode,amount_total,currency,paid_at) values (%L,'a@b.test','paid',0,'v',now(),false,5,'brl',now())$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: pending_payment exige o subtotal', format($q$insert into public.orders (user_id,email,status,cart_version,terms_version,terms_accepted_at,livemode,amount_total,currency) values (%L,'a@b.test','pending_payment',0,'v',now(),false,5,'brl')$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: código promocional em branco', format($q$insert into public.orders (user_id,email,cart_version,terms_version,terms_accepted_at,livemode,promotion_code) values (%L,'a@b.test',0,'v',now(),false,'')$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: código promocional com espaços nas pontas', format($q$insert into public.orders (user_id,email,cart_version,terms_version,terms_accepted_at,livemode,promotion_code) values (%L,'a@b.test',0,'v',now(),false,' TESTE10 ')$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: código promocional com mais de 200 caracteres', format($q$insert into public.orders (user_id,email,cart_version,terms_version,terms_accepted_at,livemode,promotion_code) values (%L,'a@b.test',0,'v',now(),false,repeat('x', 201))$q$, pg_temp.uid('u1')), '23514');
select pg_temp.expect('orders: valores coerentes com cupom passam', format($q$insert into public.orders (user_id,email,cart_version,terms_version,terms_accepted_at,livemode,amount_total,currency,amount_subtotal,amount_discount,promotion_code) values (%L,'a@b.test',0,'v',now(),false,7,'brl',10,3,'TESTE10')$q$, pg_temp.uid('u1')), 'OK');
select pg_temp.expect('orders: cupom de 100% (total 0) passa', format($q$insert into public.orders (user_id,email,cart_version,terms_version,terms_accepted_at,livemode,amount_total,currency,amount_subtotal,amount_discount) values (%L,'a@b.test',0,'v',now(),false,0,'brl',10,10)$q$, pg_temp.uid('u1')), 'OK');
select pg_temp.expect('orders: sessão repetida', format($q$insert into public.orders (user_id,email,cart_version,terms_version,terms_accepted_at,livemode,stripe_checkout_session_id) values (%L,'a@b.test',0,'v',now(),false,'cs_test_PGTAP_FX1')$q$, pg_temp.uid('u1')), '23505');
select pg_temp.expect('orders: user_id inexistente', $q$insert into public.orders (user_id,email,cart_version,terms_version,terms_accepted_at,livemode) values (gen_random_uuid(),'a@b.test',0,'v',now(),false)$q$, '23503');
select pg_temp.expect('order_items: posição repetida', $q$insert into public.order_items (order_id,product_id,position,stripe_price_id) select o.id, p.id, 1, p.stripe_price_id from public.orders o, public.products p where o.stripe_checkout_session_id='cs_test_PGTAP_FX2' and p.code='SG2'$q$, '23505');
select pg_temp.expect('order_items: valor sem moeda', $q$update public.order_items set unit_amount = 5 where order_id = (select id from public.orders where stripe_checkout_session_id='cs_test_PGTAP_FX2')$q$, '23514');

-- ===== direitos ====================================================================================
select pg_temp.expect('entitlements: item inexistente', format($q$insert into public.entitlements (order_id,product_id,user_id) select o.id, p.id, %L from public.orders o, public.products p where o.stripe_checkout_session_id='cs_test_PGTAP_FX1' and p.code='SG2'$q$, pg_temp.uid('u1')), '23503');
select pg_temp.expect('entitlements: user_id diferente do dono do pedido', format($q$insert into public.entitlements (order_id,product_id,user_id) select o.id, i.product_id, %L from public.orders o join public.order_items i on i.order_id=o.id where o.stripe_checkout_session_id='cs_test_PGTAP_FX2'$q$, pg_temp.uid('u1')), '23503');
select pg_temp.expect('entitlements: direito repetido por item', $q$insert into public.entitlements (order_id,product_id,user_id) select e.order_id, e.product_id, e.user_id from public.entitlements e limit 1$q$, '23505');
select pg_temp.expect('entitlements: revogado sem motivo', $q$update public.entitlements set status='revoked' where id = (select id from public.entitlements where status = 'active' order by id limit 1)$q$, '23514');
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
