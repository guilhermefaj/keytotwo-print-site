-- 15_stripe_prices: os Prices da Stripe guardados no banco (docs/data-contract.md, seção 6.13). Roda com `supabase test db`
-- (pgTAP). Dados de teste só existem dentro da transação.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp): supabase/tests/database/helpers ===========
\ir helpers/base.psql

-- ===== guardar e ler ==============================================================================
select pg_temp.assert('remember_stripe_prices guarda dois Prices',
  (select public.remember_stripe_prices('[{"price_id": "price_PGTAP_A", "unit_amount": 2990, "currency": "brl", "product": "prod_PGTAP_A", "active": true},
                                          {"price_id": "price_PGTAP_B", "unit_amount": 990, "currency": "brl", "product": null, "active": false}]') = 2));
select pg_temp.assert('get_stripe_prices devolve só os pedidos que existem, com valor, moeda, produto e ativo',
  (select jsonb_agg(jsonb_build_object('id', g.price_id, 'amount', g.unit_amount, 'currency', g.currency, 'product', g.product, 'active', g.active) order by g.price_id)
     = '[{"id": "price_PGTAP_A", "amount": 2990, "currency": "brl", "product": "prod_PGTAP_A", "active": true},
         {"id": "price_PGTAP_B", "amount": 990, "currency": "brl", "product": null, "active": false}]'::jsonb
     from public.get_stripe_prices(array['price_PGTAP_A', 'price_PGTAP_B', 'price_PGTAP_NAO']) g));
update private.stripe_prices set fetched_at = now() - interval '2 hours' where price_id = 'price_PGTAP_A';
select pg_temp.assert('guardar de novo atualiza o mesmo Price (repetido na lista conta uma vez)',
  (select public.remember_stripe_prices('[{"price_id": "price_PGTAP_A", "unit_amount": 2990, "currency": "brl", "product": "prod_PGTAP_A", "active": true},
                                          {"price_id": "price_PGTAP_A", "unit_amount": 2990, "currency": "brl", "product": "prod_PGTAP_A", "active": false}]') = 1));
select pg_temp.assert('o repetido na lista vale o último, e a hora da conferência é renovada',
  (select not active and fetched_at > now() - interval '1 minute' from private.stripe_prices where price_id = 'price_PGTAP_A'));
select pg_temp.assert('lista vazia: nada muda', (select public.remember_stripe_prices('[]') = 0));

-- ===== validações ==================================================================================
select pg_temp.expect('remember: nulo', $q$select public.remember_stripe_prices(null)$q$, 'KT001');
select pg_temp.expect('remember: não é lista', $q$select public.remember_stripe_prices('{}')$q$, 'KT001');
select pg_temp.expect('remember: id fora do formato', $q$select public.remember_stripe_prices('[{"price_id": "x", "unit_amount": 1, "currency": "brl", "active": true}]')$q$, 'KT001');
select pg_temp.expect('remember: valor negativo', $q$select public.remember_stripe_prices('[{"price_id": "price_X", "unit_amount": -1, "currency": "brl", "active": true}]')$q$, 'KT001');
select pg_temp.expect('remember: moeda fora do formato', $q$select public.remember_stripe_prices('[{"price_id": "price_X", "unit_amount": 1, "currency": "BRL", "active": true}]')$q$, 'KT001');
select pg_temp.expect('remember: produto fora do formato', $q$select public.remember_stripe_prices('[{"price_id": "price_X", "unit_amount": 1, "currency": "brl", "product": "x", "active": true}]')$q$, 'KT001');
select pg_temp.expect('remember: ativo que não é booleano', $q$select public.remember_stripe_prices('[{"price_id": "price_X", "unit_amount": 1, "currency": "brl", "active": "sim"}]')$q$, 'KT001');
select pg_temp.expect('get: nulo', $q$select * from public.get_stripe_prices(null)$q$, 'KT001');
select pg_temp.expect('get: mais de 100 ids', $q$select * from public.get_stripe_prices(array(select 'price_' || g from generate_series(1, 101) g))$q$, 'KT001');

-- ===== quem enxerga ================================================================================
select pg_temp.assert('tabela em private, sem privilégio para os papéis da API',
  not has_table_privilege('anon', 'private.stripe_prices', 'SELECT') and not has_table_privilege('authenticated', 'private.stripe_prices', 'SELECT')
  and not has_table_privilege('service_role', 'private.stripe_prices', 'SELECT,INSERT,UPDATE,DELETE'));
select pg_temp.expect_as('anon não chama get_stripe_prices', 'anon', $q$select * from public.get_stripe_prices(array['price_PGTAP_A'])$q$, '42501');
select pg_temp.expect_as('authenticated não chama remember_stripe_prices', 'authenticated', $q$select public.remember_stripe_prices('[]')$q$, '42501');
select pg_temp.expect_as('service_role chama as duas', 'service_role', $q$select public.remember_stripe_prices('[]'), (select count(*) from public.get_stripe_prices(array['price_PGTAP_A']))$q$, 'OK');

select * from finish();
rollback;
