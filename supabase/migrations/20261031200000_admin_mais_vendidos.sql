-- Mais vendidos nas Métricas do admin (2026-10-31, revisão de UX do admin): por produto, em quantos pedidos pagos do
-- período ele entrou (compras, não presentes; os mesmos dias de Brasília e o mesmo modo da Stripe do
-- get_admin_metrics e do admin_marketing_metrics) e quanto esses itens somaram pelo preço de cada item no pedido.
-- Só os produtos que venderam, do que mais vendeu ao que menos.
create function public.admin_product_sales(p_user_id uuid, p_days integer, p_livemode boolean) returns table (outcome text, result jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_since timestamptz;
begin
  if p_user_id is null or p_days is null or p_days not in (7, 30) or p_livemode is null then
    raise exception 'admin_product_sales: argumentos inválidos' using errcode = 'KT001';
  end if;
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  v_since := ((now() at time zone 'America/Sao_Paulo')::date - (p_days - 1))::timestamp at time zone 'America/Sao_Paulo';
  return query
    select 'ok'::text, coalesce((
      select jsonb_agg(s order by (s->>'orders')::int desc, s->>'code')
        from (select jsonb_build_object('code', p.code, 'name', p.name, 'kind', p.kind,
                                        'orders', count(distinct x.order_id), 'amount', coalesce(sum(i.unit_amount), 0)) as s
                from private.paid_purchases(p_livemode) x
                join public.order_items i on i.order_id = x.order_id
                join public.products p on p.id = i.product_id
               where x.paid_at >= v_since
               group by p.code, p.name, p.kind) sales), '[]'::jsonb);
end $$;

revoke all on function public.admin_product_sales(uuid, integer, boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_product_sales(uuid, integer, boolean) to service_role;
