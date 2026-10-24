-- 07_library_status: get_library por jogo e get_order_status (docs/data-contract.md v0.3.3, seção 6.6).
-- Roda com `supabase test db` (pgTAP). Dados de teste só existem dentro da transação (rollback no fim).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp): supabase/tests/database/helpers ===========
\ir helpers/base.psql
\ir helpers/fixtures.psql

do $fx$
declare v_pk bigint; v_sg1 bigint; v_ov bigint; la uuid; o uuid;
begin
  v_pk  := pg_temp.mk_product('PK1', 'bundle', 3);   -- jogos GM-PK1-1..3
  v_sg1 := pg_temp.mk_product('SG1', 'single', 1);
  -- OV1: avulso com o jogo 1 do PK1 (o mesmo jogo chega por dois produtos)
  insert into public.products (code, slug, kind, name, status, stripe_price_id, games_expected)
  values ('OV1', 'ov1', 'single', 'Avulso OV1 [TESTE]', 'active', 'price_PGTAP_OV1', 1) returning id into v_ov;
  insert into public.product_games (product_id, game_id, position) select v_ov, id, 1 from public.games where code = 'GM-PK1-1';

  la := pg_temp.mk_user('la');          -- possui o PK1 e o OV1
  perform pg_temp.mk_user('lb');        -- nada
  perform pg_temp.mk_user('lc');        -- PK1 revogado
  perform pg_temp.mk_user('ld');        -- só pedidos em processamento
  perform pg_temp.mk_user('le', false); -- não confirmado

  o := pg_temp.mk_order(la, 'paid', array[v_pk], 'LA1'); perform pg_temp.mk_ents(o);
  update public.entitlements set granted_at = now() - interval '5 days' where order_id = o;
  o := pg_temp.mk_order(la, 'paid', array[v_ov], 'LA2'); perform pg_temp.mk_ents(o);
  update public.entitlements set granted_at = now() - interval '2 days' where order_id = o;
  o := pg_temp.mk_order(pg_temp.uid('lc'), 'refunded', array[v_pk], 'LC1'); perform pg_temp.mk_ents(o, 'revoked', 'refund');
  perform pg_temp.mk_order(pg_temp.uid('ld'), 'pending_payment', array[v_sg1], 'LD1', now() - interval '2 days');
  perform pg_temp.mk_order(pg_temp.uid('ld'), 'pending_payment', array[v_pk, v_sg1], 'LD2', now() - interval '1 day');
  perform pg_temp.mk_order(pg_temp.uid('ld'), 'open', array[v_sg1], 'LD3');
  perform pg_temp.mk_order(pg_temp.uid('ld'), 'expired', array[v_sg1], 'LD4');
end $fx$;

-- ===== por jogo, sem repetir, com os produtos de origem ============================================
select pg_temp.assert('sem compras e sem pendentes: {"games": [], "pending": []}', (select public.get_library(pg_temp.uid('lb')) = '{"games": [], "pending": []}'::jsonb));
select pg_temp.assert('os 3 jogos do PK1, sem repetir o jogo que o OV1 também entrega', (select jsonb_array_length(public.get_library(pg_temp.uid('la'))->'games') = 3));
select pg_temp.assert('ordem: acquired_at, menor position, code', (select jsonb_agg(g->>'code') = '["GM-PK1-1","GM-PK1-2","GM-PK1-3"]'::jsonb from jsonb_array_elements(public.get_library(pg_temp.uid('la'))->'games') g));
select pg_temp.assert('o jogo que vem por dois produtos lista os dois (por code)',
  (select g->'products' = '[{"code":"OV1","name":"Avulso OV1 [TESTE]"},{"code":"PK1","name":"Produto PK1 [TESTE]"}]'::jsonb
   from jsonb_array_elements(public.get_library(pg_temp.uid('la'))->'games') g where g->>'code' = 'GM-PK1-1'));
select pg_temp.assert('jogo que vem de um produto só lista um', (select jsonb_array_length(g->'products') = 1
   from jsonb_array_elements(public.get_library(pg_temp.uid('la'))->'games') g where g->>'code' = 'GM-PK1-2'));
select pg_temp.assert('acquired_at = o menor granted_at (o mais antigo)', (select (g->>'acquired_at')::timestamptz < now() - interval '4 days'
   from jsonb_array_elements(public.get_library(pg_temp.uid('la'))->'games') g where g->>'code' = 'GM-PK1-1'));
select pg_temp.assert('files: id, kind, version e size_bytes (sem filename, sem chave do B2)',
  (select g->'files'->0 ?& array['id','kind','version','size_bytes'] and not (g->'files'->0 ? 'filename') and not (g->'files'->0 ? 'object_key')
   from jsonb_array_elements(public.get_library(pg_temp.uid('la'))->'games') g where g->>'code' = 'GM-PK1-1'));
select pg_temp.assert('sem vazamento: chave do B2, bucket, e-mail, ids de pedido ou de direito, Stripe',
  (select public.get_library(pg_temp.uid('la'))::text !~ '(object_key|bucket|@|cs_test|pi_PGTAP|cus_|https?:|order_id|entitlement)'));

-- ===== só direitos ativos do usuário ================================================================
select pg_temp.assert('direito revogado some', (select public.get_library(pg_temp.uid('lc')) = '{"games": [], "pending": []}'::jsonb));
select pg_temp.assert('outro usuário não vê os jogos de la', (select jsonb_array_length(public.get_library(pg_temp.uid('lb'))->'games') = 0));

-- ===== arquivos: só publicados; a compra é preservada ==============================================
update public.files set status = 'retired' where filename = 'GM-PK1-2-v1.0.pdf';
select pg_temp.assert('jogo sem arquivo publicado aparece com files = []', (select g->'files' = '[]'::jsonb
   from jsonb_array_elements(public.get_library(pg_temp.uid('la'))->'games') g where g->>'code' = 'GM-PK1-2'));
update public.games set status = 'draft' where code = 'GM-PK1-3';
select pg_temp.assert('jogo despublicado depois da compra continua na biblioteca', (select count(*) = 1
   from jsonb_array_elements(public.get_library(pg_temp.uid('la'))->'games') g where g->>'code' = 'GM-PK1-3'));
update public.games set status = 'published' where code = 'GM-PK1-3';

-- ===== a composição comprada não muda ===============================================================
do $snap$
declare v_gid bigint;
begin
  insert into public.games (code, slug, name, status) values ('GM-PK1-4', 'gm-pk1-4', 'Jogo novo do pacote [TESTE]', 'published') returning id into v_gid;
  insert into public.product_games (product_id, game_id, position) select id, v_gid, 4 from public.products where code = 'PK1';
end $snap$;
select pg_temp.assert('jogo acrescentado ao pacote depois da compra não aparece (fotografia)', (select jsonb_array_length(public.get_library(pg_temp.uid('la'))->'games') = 3));

-- ===== pedidos em processamento =====================================================================
select pg_temp.assert('pending: só pending_payment do usuário, do mais recente ao mais antigo (open e expired ficam de fora)',
  (select jsonb_array_length(p) = 2 and p->0->'products'->0->>'code' = 'PK1' and p->1->'products'->0->>'code' = 'SG1'
   from (select public.get_library(pg_temp.uid('ld'))->'pending' p) x));
select pg_temp.assert('pending: ref de 8 caracteres e produtos por position', (select p->0->>'ref' ~ '^[0-9A-F]{8}$' and jsonb_array_length(p->0->'products') = 2 and p->0->'products'->1->>'code' = 'SG1'
   from (select public.get_library(pg_temp.uid('ld'))->'pending' p) x));
select pg_temp.assert('pending não traz valor, e-mail nem ids', (select (public.get_library(pg_temp.uid('ld'))->'pending')::text !~ '(amount|unit_amount|@|cs_test|order_id)'));
select pg_temp.assert('quem só tem pedido em processamento não tem jogos', (select jsonb_array_length(public.get_library(pg_temp.uid('ld'))->'games') = 0));

-- ===== e-mail confirmado e papel da API ===========================================================
select pg_temp.expect('get_library: usuário não confirmado', format($q$select public.get_library(%L)$q$, pg_temp.uid('le')), 'KT009');
select pg_temp.expect('get_library: usuário inexistente', $q$select public.get_library(gen_random_uuid())$q$, 'KT009');
select pg_temp.expect('get_library: p_user_id nulo', $q$select public.get_library(null)$q$, 'KT001');
select pg_temp.expect_as('service_role executa get_library', 'service_role', format($q$select public.get_library(%L)$q$, pg_temp.uid('la')), 'OK');

-- ===== get_order_status (T72) ======================================================================
select pg_temp.assert('get_order_status: o dono vê estado, itens e relation owner',
  (select outcome = 'ok' and status = 'paid' and relation = 'owner' and items = '[{"code": "PK1", "name": "Produto PK1 [TESTE]"}]'::jsonb
   from public.get_order_status((select id from public.orders where stripe_checkout_session_id = 'cs_test_PGTAP_LA1'), pg_temp.uid('la'))));
select pg_temp.assert('get_order_status: pedido em processamento traz os itens por position',
  (select outcome = 'ok' and status = 'pending_payment' and relation = 'owner' and jsonb_array_length(items) = 2 and items->0->>'code' = 'PK1'
   from public.get_order_status((select id from public.orders where stripe_checkout_session_id = 'cs_test_PGTAP_LD2'), pg_temp.uid('ld'))));
select pg_temp.assert('get_order_status: outra conta vê só o estado (relation other), sem itens',
  (select outcome = 'ok' and status = 'paid' and relation = 'other' and items is null
   from public.get_order_status((select id from public.orders where stripe_checkout_session_id = 'cs_test_PGTAP_LA1'), pg_temp.uid('lb'))));
select pg_temp.assert('get_order_status: pedido inexistente = not_found com os campos nulos',
  (select outcome = 'not_found' and status is null and items is null and relation is null from public.get_order_status(gen_random_uuid(), pg_temp.uid('la'))));
select pg_temp.assert('get_order_status: só devolve outcome, status, items e relation',
  (select p.proargnames[3:] = array['outcome', 'status', 'items', 'relation'] from pg_proc p where p.proname = 'get_order_status' and p.pronamespace = 'public'::regnamespace));
select pg_temp.assert('get_order_status: sem e-mail, valores, ids de usuário nem da Stripe',
  (select to_jsonb(r)::text !~ '(@|amount|user_id|cs_test|pi_|cus_|pgtap)' from public.get_order_status((select id from public.orders where stripe_checkout_session_id = 'cs_test_PGTAP_LA1'), pg_temp.uid('lb')) r));
select pg_temp.expect('get_order_status: usuário não confirmado', format($q$select * from public.get_order_status(gen_random_uuid(), %L)$q$, pg_temp.uid('le')), 'KT009');
select pg_temp.expect('get_order_status: usuário inexistente', $q$select * from public.get_order_status(gen_random_uuid(), gen_random_uuid())$q$, 'KT009');
select pg_temp.expect('get_order_status: pedido nulo', format($q$select * from public.get_order_status(null, %L)$q$, pg_temp.uid('la')), 'KT001');
select pg_temp.expect('get_order_status: usuário nulo', $q$select * from public.get_order_status(gen_random_uuid(), null)$q$, 'KT001');
select pg_temp.expect_as('service_role executa get_order_status', 'service_role', format($q$select * from public.get_order_status(gen_random_uuid(), %L)$q$, pg_temp.uid('la')), 'OK');
select pg_temp.expect_as('authenticated não executa get_order_status', 'authenticated', format($q$select * from public.get_order_status(gen_random_uuid(), %L)$q$, pg_temp.uid('la')), '42501');

select * from finish();
rollback;
