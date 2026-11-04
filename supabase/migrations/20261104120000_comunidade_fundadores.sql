-- Comunidade dos Fundadores (2026-11-04): o grupo do WhatsApp é de quem comprou ao menos um jogo pago. get_library
-- ganha `founder`: algum direito ativo vindo de um pedido de compra (kind purchase). Presente do admin (courtesy) e
-- gratuitos não contam; reembolso e contestação revogam o direito e tiram o acesso. O link do grupo nunca passa pelo
-- banco: a api só o devolve (segredo WHATSAPP_COMMUNITY_URL) quando founder é true.
create or replace function public.get_library(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_confirmed_email(p_user_id);

  return (
    with ent as (
      select e.id, e.product_id, e.granted_at
      from public.entitlements e
      where e.user_id = p_user_id and e.status = 'active'
    ),
    owned as (
      select eg.game_id, ent.product_id, ent.granted_at, eg.position
      from ent
      join public.entitlement_games eg on eg.entitlement_id = ent.id
    ),
    per_game as (
      select o.game_id, min(o.granted_at) as acquired_at, min(o.position) as pos
      from owned o
      group by o.game_id
    )
    select jsonb_build_object(
      'games', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'code', g.code,
                   'name', g.name,
                   'acquired_at', pgm.acquired_at,
                   'products', (
                     select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name) order by p.code)
                     from public.products p
                     where p.id in (select o.product_id from owned o where o.game_id = pgm.game_id)),
                   'files', coalesce((
                     select jsonb_agg(
                              jsonb_build_object('id', f.id, 'kind', f.kind, 'version', f.version,
                                                 'size_bytes', f.size_bytes)
                              order by f.kind, f.version)
                     from public.files f
                     where f.game_id = g.id and f.access = 'paid' and f.status = 'published'), '[]'::jsonb))
                 order by pgm.acquired_at, pgm.pos, g.code)
        from per_game pgm
        join public.games g on g.id = pgm.game_id), '[]'::jsonb),
      'pending', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'ref', private.order_ref(o.id),
                   'created_at', o.created_at,
                   'products', (
                     select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name) order by i.position)
                     from public.order_items i
                     join public.products p on p.id = i.product_id
                     where i.order_id = o.id))
                 order by o.created_at desc, o.id desc)
        from public.orders o
        where o.user_id = p_user_id and o.status = 'pending_payment'), '[]'::jsonb),
      'founder', exists (
        select 1
        from public.entitlements e
        join public.orders o on o.id = e.order_id
        where e.user_id = p_user_id and e.status = 'active' and o.kind = 'purchase')
    )
  );
end $$;
