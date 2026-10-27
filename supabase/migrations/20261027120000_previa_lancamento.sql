-- Prévia do lançamento (2026-10-27): a loja abre em 9 de novembro de 2026, às 19h de Brasília. Até lá, o GET /catalog
-- leva a data (o site mostra o cronômetro no lugar da compra) e o POST /checkout recusa. A data entra na versão do
-- catálogo: na hora marcada a versão muda e o vigia da VPS reconstrói os sites já sem a prévia.
--   1. private.sales_opening: uma linha só, com a hora da abertura; sem linha (o seed local e o do CI apagam), a loja
--      está aberta. Mudar a data é um update nesta linha;
--   2. get_sales_opening(): a hora enquanto ela não chega, depois null (a api; só service_role);
--   3. get_catalog_version() passa a cobrir a abertura.
create table private.sales_opening (
  id       boolean primary key default true,
  opens_at timestamptz not null,
  constraint sales_opening_single_check check (id)
);
revoke all on table private.sales_opening from public, anon, authenticated, service_role;
insert into private.sales_opening (opens_at) values ('2026-11-09 19:00:00-03');

create function public.get_sales_opening() returns timestamptz
language sql stable security definer set search_path = '' as $$
  select s.opens_at from private.sales_opening s where s.opens_at > now()
$$;
revoke all on function public.get_sales_opening() from public, anon, authenticated, service_role;
grant execute on function public.get_sales_opening() to service_role;

-- O instante em segundos, para a versão não depender do fuso da sessão.
create or replace function public.get_catalog_version() returns text
language sql stable security definer set search_path = '' as $$
  select md5(public.get_catalog()::text || coalesce(public.get_promo_banner()::text, '')
    || coalesce(extract(epoch from public.get_sales_opening())::text, ''))
$$;
