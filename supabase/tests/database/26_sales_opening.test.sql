-- 26_sales_opening: a prévia do lançamento (migração 20261027120000): get_sales_opening devolve a hora da abertura das
-- vendas enquanto ela não chega e null depois, ou sem a linha; a versão do catálogo muda com ela, para o vigia
-- reconstruir os sites na hora marcada. A linha é uma só.
-- Roda com `supabase test db` (pgTAP). Dados de teste só existem dentro da transação (rollback no fim). Dentro da
-- transação o now() não anda: as horas entram relativas a ele.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp): supabase/tests/database/helpers ===========
\ir helpers/base.psql

delete from private.sales_opening;
create temp table versions as select 'aberta'::text as label, public.get_catalog_version() as version;
select pg_temp.assert('sem a linha: a loja está aberta', public.get_sales_opening() is null);

insert into private.sales_opening (opens_at) values (now() + interval '1 day');
insert into versions select 'prévia', public.get_catalog_version();
select pg_temp.assert('abertura no futuro: get_sales_opening devolve a hora, e a versão do catálogo muda',
  public.get_sales_opening() = now() + interval '1 day'
  and (select version from versions where label = 'prévia') <> (select version from versions where label = 'aberta'));

select pg_temp.expect('uma linha só', $q$insert into private.sales_opening (opens_at) values (now())$q$, '23505');
select pg_temp.expect('a linha é a de id true', $q$insert into private.sales_opening (id, opens_at) values (false, now())$q$, '23514');

update private.sales_opening set opens_at = now();
select pg_temp.assert('na hora marcada: abre, e a versão volta à da loja aberta',
  public.get_sales_opening() is null and public.get_catalog_version() = (select version from versions where label = 'aberta'));

update private.sales_opening set opens_at = now() - interval '1 minute';
select pg_temp.assert('depois da abertura: null', public.get_sales_opening() is null);

select * from finish();
rollback;
