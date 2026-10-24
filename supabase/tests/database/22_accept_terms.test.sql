-- 22_accept_terms: o aceite no pagamento (migração 20261024230000): o pedido nasce sem o aceite quando o formulário
-- abre, e accept_order_terms grava o momento quando a pessoa marca a caixa. O site anterior (terms_accepted = true)
-- continua criando o pedido já aceito.
-- Roda com `supabase test db` (pgTAP). Dados de teste só existem dentro da transação (rollback no fim). Cada RPC roda
-- numa instrução própria (res): a conferência na mesma instrução não veria o que ela gravou.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp): supabase/tests/database/helpers ===========
\ir helpers/base.psql
\ir helpers/fixtures.psql
\ir helpers/checkout.psql

create temp table res (k text primary key, j jsonb);
create function pg_temp.out(p_key text) returns text language sql as $$ select j #>> '{}' from pg_temp.res where k = p_key $$;
create function pg_temp.ord(p_user text) returns public.orders language sql as $$
  select o from public.orders o where o.user_id = pg_temp.uid(p_user) order by o.created_at desc limit 1 $$;

do $fx$
begin
  perform pg_temp.mk_product('TA1', 'single', 1);
  perform pg_temp.mk_product('TA2', 'single', 1);
  perform pg_temp.mk_user('tana'); perform pg_temp.mk_user('tbia'); perform pg_temp.mk_user('told');
  perform pg_temp.fill_cart(pg_temp.uid('tana'), array['TA1']);
  perform pg_temp.fill_cart(pg_temp.uid('told'), array['TA2']);
end $fx$;

-- ===== o formulário abre: o pedido nasce com a versão dos termos e sem o aceite ======================================
insert into pg_temp.res select 'abre', to_jsonb(c.outcome) from public.create_order_from_cart(pg_temp.uid('tana'), false, 1, 'termos-v1', false) c;
select pg_temp.assert('pedido sem o aceite: nasce com a versão e sem o momento',
  pg_temp.out('abre') = 'ok' and (pg_temp.ord('tana')).terms_version = 'termos-v1' and (pg_temp.ord('tana')).terms_accepted_at is null);
insert into pg_temp.res select 'abre de novo', to_jsonb(c.reused) from public.create_order_from_cart(pg_temp.uid('tana'), false, 1, 'termos-v1', null) c;
select pg_temp.assert('abrir de novo reaproveita o pedido, ainda sem o aceite',
  pg_temp.out('abre de novo') = 'true' and (select count(*) = 1 from public.orders where user_id = pg_temp.uid('tana')) and (pg_temp.ord('tana')).terms_accepted_at is null);

-- ===== marcar a caixa =============================================================================================
select pg_temp.expect('aceite: argumentos nulos', format($q$select public.accept_order_terms(%L, null, 'termos-v1')$q$, pg_temp.uid('tana')), 'KT001');
select pg_temp.assert('aceite: pedido de outra pessoa = not_found',
  public.accept_order_terms(pg_temp.uid('tbia'), (pg_temp.ord('tana')).id, 'termos-v1') = 'not_found');
select pg_temp.assert('aceite: os termos mudaram = terms_changed',
  public.accept_order_terms(pg_temp.uid('tana'), (pg_temp.ord('tana')).id, 'termos-v2') = 'terms_changed');
select pg_temp.assert('aceite recusado não grava nada', (pg_temp.ord('tana')).terms_accepted_at is null);
insert into pg_temp.res select 'aceita', to_jsonb(public.accept_order_terms(pg_temp.uid('tana'), (pg_temp.ord('tana')).id, ' termos-v1 '));
select pg_temp.assert('aceite: ok grava o momento', pg_temp.out('aceita') = 'ok' and (pg_temp.ord('tana')).terms_accepted_at is not null);
insert into pg_temp.res select 'antes', to_jsonb((pg_temp.ord('tana')).terms_accepted_at);
insert into pg_temp.res select 'aceita de novo', to_jsonb(public.accept_order_terms(pg_temp.uid('tana'), (pg_temp.ord('tana')).id, 'termos-v1'));
select pg_temp.assert('aceite de novo: ok sem mudar o momento',
  pg_temp.out('aceita de novo') = 'ok' and to_jsonb((pg_temp.ord('tana')).terms_accepted_at) = (select j from pg_temp.res where k = 'antes'));
do $s$ begin perform pg_temp.mv((pg_temp.ord('tana')).id, 'expired'); end $s$;
select pg_temp.assert('aceite: pedido que não está aberto = not_found',
  public.accept_order_terms(pg_temp.uid('tana'), (pg_temp.ord('tana')).id, 'termos-v1') = 'not_found');

-- ===== o site anterior: o aceite vem junto ========================================================================
insert into pg_temp.res select 'antigo', to_jsonb(c.outcome) from public.create_order_from_cart(pg_temp.uid('told'), false, 1, 'termos-v1', true) c;
select pg_temp.assert('terms_accepted = true: o pedido nasce aceito',
  pg_temp.out('antigo') = 'ok' and (pg_temp.ord('told')).terms_accepted_at is not null);

-- ===== a restrição ================================================================================================
select pg_temp.expect('compra sem a versão dos termos continua recusada',
  format($q$insert into public.orders (user_id, email, cart_version, livemode) values (%L, 'tbia@pgtap.test', 0, false)$q$, pg_temp.uid('tbia')), '23514');
select pg_temp.assert('compra com a versão e sem o momento do aceite é aceita pela restrição',
  (select count(*) = 1 from public.orders where user_id = pg_temp.uid('tana') and terms_version is not null));

select * from finish();
rollback;
