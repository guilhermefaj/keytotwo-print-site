-- 23_security: a revisão de segurança de 2026-10-25 (migração 20261025120000): o pacote de "completar a coleção" sem os
-- jogos descontados no direito, a cotação pública sem rascunho, o alerta de pago sem o aceite e o que nasce em public.
-- Roda com `supabase test db` (pgTAP). Dados de teste só existem dentro da transação (rollback no fim).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp): supabase/tests/database/helpers ===========
\ir helpers/base.psql
\ir helpers/fixtures.psql
\ir helpers/checkout.psql

create function pg_temp.file_of(p_game text) returns uuid language sql as $$
  select f.id from public.files f join public.games g on g.id = f.game_id where g.code = p_game $$;
create function pg_temp.game_id(p_game text) returns bigint language sql as $$ select id from public.games where code = p_game $$;

do $fx$
declare v_single bigint;
begin
  perform pg_temp.mk_product('SP1', 'bundle', 3);
  -- SA1: o avulso do primeiro jogo do pacote SP1
  insert into public.products (code, slug, kind, name, status, stripe_price_id, games_expected)
  values ('SA1', 'sa1', 'single', 'Avulso SA1 [TESTE]', 'active', 'price_PGTAP_SA1', 1) returning id into v_single;
  insert into public.product_games (product_id, game_id, position) values (v_single, pg_temp.game_id('GM-SP1-1'), 1);
  perform pg_temp.mk_product('SA2', 'single', 1);
  perform pg_temp.mk_product('SD1', 'single', 1);
  update public.products set status = 'draft' where code = 'SD1';
  perform pg_temp.mk_user('scol'); perform pg_temp.mk_user('sterm');
end $fx$;

-- ===== completar a coleção: o jogo descontado não entra no direito do pacote =========================================
do $c$
declare o uuid;
begin
  o := pg_temp.buy(pg_temp.uid('scol'), array['SA1'], array[990]); insert into pg_temp.oids values ('avulso', o);
  o := pg_temp.open_order(pg_temp.uid('scol'), array['SP1']); insert into pg_temp.oids values ('pacote', o);
end $c$;
select pg_temp.assert('o item do pacote guarda o jogo que a pessoa já tinha e que saiu do preço',
  (select credited_game_ids = array[pg_temp.game_id('GM-SP1-1')] from public.order_items where order_id = pg_temp.oid('pacote')));
select pg_temp.assert('o avulso não tem jogo descontado',
  (select credited_game_ids = '{}' from public.order_items where order_id = pg_temp.oid('avulso')));
select pg_temp.expect('os jogos descontados não mudam depois',
  format($q$update public.order_items set credited_game_ids = '{}' where order_id = %L$q$, pg_temp.oid('pacote')), 'KT010');
do $c$ begin perform * from pg_temp.fulfill(pg_temp.oid('pacote'), array[1320]); end $c$;
select pg_temp.assert('o direito do pacote leva só os dois jogos que faltavam',
  (select array_agg(g.code order by g.code) = array['GM-SP1-2', 'GM-SP1-3']
     from public.entitlements e join public.entitlement_games eg on eg.entitlement_id = e.id join public.games g on g.id = eg.game_id
    where e.order_id = pg_temp.oid('pacote')));
select pg_temp.assert('o jogo descontado continua baixando pelo avulso',
  (select outcome = 'ok' from public.resolve_download(pg_temp.uid('scol'), pg_temp.file_of('GM-SP1-1'))));
do $c$ begin perform * from pg_temp.setst(pg_temp.oid('avulso'), 'refunded', '{"reason": "manual_refund"}'); end $c$;
select pg_temp.assert('reembolsado o avulso, o jogo dele não baixa mais pelo pacote',
  (select outcome = 'not_entitled' from public.resolve_download(pg_temp.uid('scol'), pg_temp.file_of('GM-SP1-1'))));
select pg_temp.assert('... e os jogos pagos no pacote continuam',
  (select outcome = 'ok' from public.resolve_download(pg_temp.uid('scol'), pg_temp.file_of('GM-SP1-2'))));
select pg_temp.i5('o pedido do pacote segue com direito por item (I-5)');

-- ===== a cotação pública não mostra rascunho ======================================================================
select pg_temp.assert('cotação: produto em rascunho conta como inexistente',
  (select jsonb_path_query_array(q->'items', '$[*].code') = '["SA2"]'::jsonb and q->'unknown' = '["SD1"]'::jsonb
     from (select public.quote_cart(array['SD1', 'SA2']) as q) x));

-- ===== pago sem o aceite dos termos: alerta para o admin ============================================================
do $c$
declare v integer; o uuid;
begin
  v := pg_temp.fill_cart(pg_temp.uid('sterm'), array['SA2']);
  select c.order_id into o from public.create_order_from_cart(pg_temp.uid('sterm'), false, v, 'v-pgtap', false) c;
  perform public.attach_checkout_session(o, 'cs_test_PGTAP_' || replace(o::text, '-', ''));
  insert into pg_temp.oids values ('sem aceite', o);
end $c$;
do $c$ begin perform * from pg_temp.fulfill(pg_temp.oid('sem aceite'), array[990]); perform private.scan_admin_alerts(); end $c$;
select pg_temp.assert('pago sem o aceite gravado abre o alerta terms_missing',
  exists (select 1 from private.admin_alerts where kind = 'terms_missing' and order_id = pg_temp.oid('sem aceite') and resolved_at is null));
select pg_temp.assert('pago com o aceite não abre',
  not exists (select 1 from private.admin_alerts where kind = 'terms_missing' and order_id in (pg_temp.oid('avulso'), pg_temp.oid('pacote'))));
do $c$ begin perform private.scan_admin_alerts(); end $c$;
select pg_temp.assert('o alerta não fecha sozinho na próxima varredura',
  (select resolved_at is null from private.admin_alerts where kind = 'terms_missing' and order_id = pg_temp.oid('sem aceite')));

-- ===== o que nasce em public fora das migrações fica fechado; o backup lê ==========================================
create table public.pgtap_nova (id integer);
create function public.pgtap_nova_fn() returns integer language sql as $$ select 1 $$;
select pg_temp.assert('tabela nova em public: anon e authenticated não leem; o backup lê',
  not has_table_privilege('anon', 'public.pgtap_nova', 'SELECT') and not has_table_privilege('authenticated', 'public.pgtap_nova', 'SELECT')
  and has_table_privilege('backup_ro', 'public.pgtap_nova', 'SELECT'));
select pg_temp.assert('função nova em public: anon e authenticated não executam',
  not has_function_privilege('anon', 'public.pgtap_nova_fn()', 'EXECUTE') and not has_function_privilege('authenticated', 'public.pgtap_nova_fn()', 'EXECUTE'));

select * from finish();
rollback;
