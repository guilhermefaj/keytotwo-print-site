-- Admin: equipe, presente de vários jogos e acompanhamento (2026-10-23, pedido do responsável), depois de
-- 20261023200000_admin_usuarios.sql.
-- 1. Equipe: o admin promove outra conta a admin ou tira o admin dela (admin_set_admin). Ninguém tira o próprio admin,
--    a equipe nunca fica vazia e só vira admin conta com e-mail confirmado e sem bloqueio. O admin é app_metadata.admin
--    no Auth (raw_app_meta_data), o mesmo campo que private.is_admin lê: vale no banco na hora e no token da pessoa na
--    próxima renovação (até 1 hora). Lista da equipe: filtro 'admins' em admin_list_users.
-- 2. Presente de vários jogos: admin_gift_products (no lugar de admin_gift_product) dá até 10 produtos num só pedido
--    de cortesia e num só e-mail. Recusa produto fora da venda, produto que a pessoa já tem inteiro e produtos com jogo
--    em comum (um pacote e um jogo que já vem nele).
-- 3. Acompanhamento: admin_follow_up lista quem precisa de atenção: sacola esquecida há mais de 1 dia, compra paga há
--    2 dias ou mais sem download, entrega com problema (e-mail de acesso que falhou e nunca saiu, ou endereço bloqueado
--    por devolução ou spam) e conta que nunca confirmou o e-mail.
-- Migração nova: troca uma função, cria três e aceita as ações novas no histórico; nenhum dado é alterado.

alter table private.admin_events drop constraint admin_events_action_check;
alter table private.admin_events add constraint admin_events_action_check check (action in (
  'blog_create', 'blog_update', 'blog_publish', 'blog_unpublish', 'blog_delete', 'blog_image', 'blog_image_delete',
  'user_gift', 'user_revoke', 'user_resend', 'user_newsletter_off', 'user_block', 'user_unblock', 'user_export', 'user_delete',
  'user_admin_grant', 'user_admin_revoke'));

-- ===== 1. Lista com o filtro da equipe (o resto igual a 20261023200000) ===========================
create or replace function public.admin_list_users(p_user_id uuid, p_query text, p_filter text, p_offset integer)
  returns table (outcome text, result jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_query text := nullif(lower(btrim(coalesce(p_query, ''))), '');
begin
  if p_user_id is null or p_filter is null or p_filter not in ('all', 'buyers', 'newsletter', 'blocked', 'admins')
     or p_offset is null or p_offset not between 0 and 1000000 or char_length(coalesce(p_query, '')) > 200 then
    raise exception 'admin_list_users: argumentos inválidos' using errcode = 'KT001';
  end if;
  perform private.require_confirmed_email(p_user_id);
  if not private.is_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;

  return query
  with people as (
    select u.id, u.email, u.created_at, u.last_sign_in_at, u.email_confirmed_at,
           coalesce(u.banned_until > now(), false) as blocked,
           coalesce(u.raw_app_meta_data -> 'admin' = 'true'::jsonb, false) as is_admin,
           coalesce(u.raw_app_meta_data -> 'providers', jsonb_build_array(u.raw_app_meta_data ->> 'provider')) as providers,
           coalesce(pf.marketing_opt_in, false) as newsletter,
           (select count(*) from public.orders o where o.user_id = u.id and o.kind = 'purchase' and o.paid_at is not null) as purchases,
           (select count(distinct eg.game_id) from public.entitlements e
              join public.entitlement_games eg on eg.entitlement_id = e.id
             where e.user_id = u.id and e.status = 'active') as games
      from auth.users u
      left join public.profiles pf on pf.user_id = u.id
     where u.deleted_at is null and not coalesce(u.is_anonymous, false)
       and (v_query is null or position(v_query in lower(coalesce(u.email, ''))) > 0)
  ), chosen as (
    select * from people p
     where case p_filter when 'buyers' then p.purchases > 0 when 'newsletter' then p.newsletter
                         when 'blocked' then p.blocked when 'admins' then p.is_admin else true end
  )
  select 'ok'::text, jsonb_build_object(
    'total', (select count(*) from chosen),
    'offset', p_offset,
    'limit', 50,
    'users', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'email', c.email, 'created_at', c.created_at, 'last_sign_in_at', c.last_sign_in_at,
        'confirmed', c.email_confirmed_at is not null, 'blocked', c.blocked, 'admin', c.is_admin,
        'providers', c.providers, 'newsletter', c.newsletter, 'purchases', c.purchases, 'games', c.games)
        order by c.created_at desc, c.id)
      from (select * from chosen order by created_at desc, id limit 50 offset p_offset) c), '[]'::jsonb));
end $$;

-- ===== 2. Equipe ===================================================================================
-- ok | forbidden | not_found | unchanged (já está assim) | self (tirar o próprio admin) | last_admin |
-- not_confirmed | blocked (promover conta sem confirmação ou bloqueada).
create function public.admin_set_admin(p_user_id uuid, p_target uuid, p_admin boolean, p_reason text) returns table (outcome text)
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_user   auth.users%rowtype;
  v_is     boolean;
begin
  if p_user_id is null or p_target is null or p_admin is null then
    raise exception 'admin_set_admin: argumentos obrigatórios' using errcode = 'KT001';
  end if;
  v_reason := private.admin_reason(p_reason);
  perform private.require_confirmed_email(p_user_id);
  if not private.is_admin(p_user_id) then
    return query select 'forbidden'::text;
    return;
  end if;
  -- uma mudança de equipe por vez: dois admins tirando o admin um do outro ao mesmo tempo não esvaziam a equipe
  perform 1 from auth.users u where u.raw_app_meta_data -> 'admin' = 'true'::jsonb and u.deleted_at is null for update;
  select * into v_user from auth.users u where u.id = p_target and u.deleted_at is null for update;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;
  v_is := coalesce(v_user.raw_app_meta_data -> 'admin' = 'true'::jsonb, false);
  if v_is = p_admin then
    return query select 'unchanged'::text;
    return;
  end if;
  if p_admin then
    if v_user.email_confirmed_at is null then
      return query select 'not_confirmed'::text;
      return;
    end if;
    if coalesce(v_user.banned_until > now(), false) then
      return query select 'blocked'::text;
      return;
    end if;
  else
    if p_target = p_user_id then
      return query select 'self'::text;
      return;
    end if;
    if (select count(*) from auth.users u where u.raw_app_meta_data -> 'admin' = 'true'::jsonb and u.deleted_at is null) <= 1 then
      return query select 'last_admin'::text;
      return;
    end if;
  end if;
  update auth.users u
     set raw_app_meta_data = case when p_admin then coalesce(u.raw_app_meta_data, '{}'::jsonb) || '{"admin": true}'::jsonb
                                  else coalesce(u.raw_app_meta_data, '{}'::jsonb) - 'admin' end
   where u.id = p_target;
  insert into private.admin_events (user_id, action, target_id, details)
  values (p_user_id, case when p_admin then 'user_admin_grant' else 'user_admin_revoke' end, p_target, jsonb_build_object('reason', v_reason));
  return query select 'ok'::text;
end $$;

-- ===== 3. Presente de vários jogos ================================================================
-- ok | forbidden | not_found | product_unavailable | already_owned | overlap; em products, os códigos que causaram a
-- recusa (ou, no ok, os dados de presente, na ordem escolhida).
drop function public.admin_gift_product(uuid, uuid, text, text, boolean, boolean);

create function public.admin_gift_products(p_user_id uuid, p_target uuid, p_product_codes text[], p_reason text,
                                           p_notify boolean, p_livemode boolean)
  returns table (outcome text, order_id uuid, outbox_id uuid, products text[])
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_email  text;
  v_codes  text[];
  v_bad    text[];
  v_order  uuid;
  v_ent    uuid;
  v_outbox uuid;
  v_rows   integer;
  r        record;
begin
  if p_user_id is null or p_target is null or p_product_codes is null or p_notify is null or p_livemode is null
     or cardinality(p_product_codes) not between 1 and 10
     or (select count(distinct c) from unnest(p_product_codes) c) <> cardinality(p_product_codes)
     or exists (select 1 from unnest(p_product_codes) c where c is null) then
    raise exception 'admin_gift_products: de 1 a 10 produtos, sem repetir' using errcode = 'KT001';
  end if;
  v_codes := p_product_codes;
  v_reason := private.admin_reason(p_reason);
  perform private.require_confirmed_email(p_user_id);
  if not private.is_admin(p_user_id) then
    return query select 'forbidden'::text, null::uuid, null::uuid, null::text[];
    return;
  end if;
  select private.normalize_email(u.email) into v_email from auth.users u where u.id = p_target and u.deleted_at is null;
  if not found or v_email is null then
    return query select 'not_found'::text, null::uuid, null::uuid, null::text[];
    return;
  end if;

  select array_agg(c order by c) into v_bad from unnest(v_codes) c
   where not exists (select 1 from public.products p where p.code = c and p.status = 'active');
  if v_bad is not null then
    return query select 'product_unavailable'::text, null::uuid, null::uuid, v_bad;
    return;
  end if;
  -- produto que a pessoa já tem inteiro (todos os jogos com acesso)
  select array_agg(p.code order by p.code) into v_bad from public.products p
   where p.code = any(v_codes)
     and not exists (select 1 from public.product_games pg
                      where pg.product_id = p.id
                        and not exists (select 1 from public.entitlements e
                                          join public.entitlement_games eg on eg.entitlement_id = e.id
                                         where e.user_id = p_target and e.status = 'active' and eg.game_id = pg.game_id));
  if v_bad is not null then
    return query select 'already_owned'::text, null::uuid, null::uuid, v_bad;
    return;
  end if;
  -- dois produtos com o mesmo jogo (o pacote e um jogo dele): um só basta
  select array_agg(distinct p.code order by p.code) into v_bad
    from public.products p join public.product_games pg on pg.product_id = p.id
   where p.code = any(v_codes)
     and pg.game_id in (select pg2.game_id from public.product_games pg2 join public.products p2 on p2.id = pg2.product_id
                         where p2.code = any(v_codes) group by pg2.game_id having count(*) > 1);
  if v_bad is not null then
    return query select 'overlap'::text, null::uuid, null::uuid, v_bad;
    return;
  end if;

  -- itens só entram em pedido open; depois o pedido passa a paid, como na compra
  insert into public.orders (user_id, email, kind, cart_version, livemode, amount_subtotal, amount_discount, amount_total, currency)
  values (p_target, v_email, 'courtesy', 0, p_livemode, 0, 0, 0, 'brl')
  returning id into v_order;
  insert into public.order_items (order_id, product_id, position, stripe_price_id, unit_amount, currency)
  select v_order, p.id, c.position::smallint, p.stripe_price_id, 0, 'brl'
    from unnest(v_codes) with ordinality as c(code, position)
    join public.products p on p.code = c.code;
  insert into public.order_events (order_id, from_status, to_status, source) values (v_order, null, 'open', 'admin');
  update public.orders o set status = 'paid', paid_at = now() where o.id = v_order;
  insert into public.order_events (order_id, from_status, to_status, source) values (v_order, 'open', 'paid', 'admin');

  for r in select oi.product_id, p.code from public.order_items oi join public.products p on p.id = oi.product_id
            where oi.order_id = v_order order by oi.position loop
    insert into public.entitlements (order_id, product_id, user_id) values (v_order, r.product_id, p_target) returning id into v_ent;
    insert into public.entitlement_games (entitlement_id, game_id, position)
    select v_ent, pg.game_id, pg.position from public.product_games pg where pg.product_id = r.product_id;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'admin_gift_products: o produto % não tem jogos na composição', r.code using errcode = 'KT003';
    end if;
  end loop;

  -- sacola: os produtos dados saem e a versão sobe (como depois da compra)
  perform 1 from public.carts c where c.user_id = p_target for update;
  if found then
    delete from public.cart_items ci
     where ci.user_id = p_target and ci.product_id in (select oi.product_id from public.order_items oi where oi.order_id = v_order);
    update public.carts c set version = c.version + 1 where c.user_id = p_target;
  end if;

  if p_notify then
    insert into public.email_outbox (user_id, order_id, kind, category, to_email, payload, dedupe_key)
    values (p_target, v_order, 'gift', 'transactional', v_email, private.delivery_payload(v_order), 'gift:' || v_order::text)
    returning id into v_outbox;
  end if;

  insert into private.admin_events (user_id, action, target_id, details)
  values (p_user_id, 'user_gift', p_target,
          jsonb_build_object('order_id', v_order, 'products', to_jsonb(v_codes), 'reason', v_reason, 'notify', p_notify));
  return query select 'ok'::text, v_order, v_outbox, v_codes;
end $$;

-- ===== 4. Acompanhamento ==========================================================================
-- Quem precisa de atenção agora, em quatro listas (até 100 cada, com o total): cart (sacola esquecida), no_download
-- (comprou e não baixou), delivery (entrega com problema) e unconfirmed (conta sem confirmação). Contas apagadas ou
-- bloqueadas ficam fora.
create function public.admin_follow_up(p_user_id uuid) returns table (outcome text, result jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_user_id is null then
    raise exception 'admin_follow_up: p_user_id é obrigatório' using errcode = 'KT001';
  end if;
  perform private.require_confirmed_email(p_user_id);
  if not private.is_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;

  return query
  with people as (
    select u.id, u.email, u.created_at, u.email_confirmed_at, private.normalize_email(u.email) as normalized
      from auth.users u
     where u.deleted_at is null and not coalesce(u.is_anonymous, false) and not coalesce(u.banned_until > now(), false)
  ), cart as (
    -- a última coisa posta na sacola tem mais de 1 dia
    select pe.id, pe.email, min(ci.added_at) as since, max(ci.added_at) as last_added,
           jsonb_agg(coalesce(p.name, p.code) order by ci.added_at) as items,
           exists (select 1 from public.email_outbox x where x.user_id = pe.id and x.kind = 'cart_reminder' and x.status = 'sent'
                    and x.sent_at >= min(ci.added_at)) as reminded
      from people pe
      join public.cart_items ci on ci.user_id = pe.id
      join public.products p on p.id = ci.product_id
     group by pe.id, pe.email
    having max(ci.added_at) <= now() - interval '1 day'
  ), no_download as (
    -- pedido pago (compra ou presente) há 2 dias ou mais, nos últimos 90 dias, sem download nenhum depois do pagamento
    select pe.id, pe.email, o.id as order_id, upper(left(replace(o.id::text, '-', ''), 8)) as order_ref, o.kind, o.paid_at,
           (select jsonb_agg(coalesce(p.name, p.code) order by i.position) from public.order_items i
              join public.products p on p.id = i.product_id where i.order_id = o.id) as items
      from people pe
      join public.orders o on o.user_id = pe.id
     where o.status = 'paid' and o.paid_at <= now() - interval '2 days' and o.paid_at > now() - interval '90 days'
       and not exists (select 1 from public.entitlements e where e.order_id = o.id and e.status <> 'active')
       and not exists (select 1 from public.download_events d where d.user_id = pe.id and d.created_at >= o.paid_at)
  ), delivery as (
    -- e-mail de acesso que falhou e nunca saiu para o pedido pago
    select pe.id, pe.email, o.id as order_id, upper(left(replace(o.id::text, '-', ''), 8)) as order_ref,
           'failed'::text as problem, null::text as reason, max(x.updated_at) as at
      from people pe
      join public.orders o on o.user_id = pe.id and o.status = 'paid'
      join public.email_outbox x on x.order_id = o.id and x.kind in ('delivery', 'gift') and x.status = 'failed'
     where not exists (select 1 from public.email_outbox s where s.order_id = o.id and s.kind in ('delivery', 'gift')
                                                              and s.status in ('sent', 'queued', 'sending'))
     group by pe.id, pe.email, o.id
    union all
    -- endereço que a Brevo bloqueou (devolução permanente ou spam) numa conta que tem jogos
    select pe.id, pe.email, null::uuid, null::text, 'suppressed'::text, s.reason, s.occurred_at
      from people pe
      join public.email_suppressions s on s.email = pe.normalized and s.reason in ('hard_bounce', 'complaint')
     where exists (select 1 from public.entitlements e where e.user_id = pe.id and e.status = 'active')
  ), unconfirmed as (
    select pe.id, pe.email, pe.created_at from people pe
     where pe.email_confirmed_at is null and pe.created_at <= now() - interval '1 hour'
  )
  select 'ok'::text, jsonb_build_object(
    'cart', jsonb_build_object('total', (select count(*) from cart), 'items', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', c.id, 'email', c.email, 'since', c.since, 'last_added', c.last_added, 'items', c.items, 'reminded', c.reminded)
        order by c.last_added desc) from (select * from cart order by last_added desc limit 100) c), '[]'::jsonb)),
    'no_download', jsonb_build_object('total', (select count(*) from no_download), 'items', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', n.id, 'email', n.email, 'order_id', n.order_id, 'order_ref', n.order_ref, 'order_kind', n.kind,
        'paid_at', n.paid_at, 'items', n.items)
        order by n.paid_at desc) from (select * from no_download order by paid_at desc limit 100) n), '[]'::jsonb)),
    'delivery', jsonb_build_object('total', (select count(*) from delivery), 'items', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', d.id, 'email', d.email, 'order_id', d.order_id, 'order_ref', d.order_ref, 'problem', d.problem,
        'reason', d.reason, 'at', d.at)
        order by d.at desc) from (select * from delivery order by at desc limit 100) d), '[]'::jsonb)),
    'unconfirmed', jsonb_build_object('total', (select count(*) from unconfirmed), 'items', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', u.id, 'email', u.email, 'created_at', u.created_at)
        order by u.created_at desc) from (select * from unconfirmed order by created_at desc limit 100) u), '[]'::jsonb)));
end $$;

-- ===== EXECUTE só para service_role ================================================================
revoke all on function public.admin_set_admin(uuid, uuid, boolean, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_admin(uuid, uuid, boolean, text) to service_role;
revoke all on function public.admin_gift_products(uuid, uuid, text[], text, boolean, boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_gift_products(uuid, uuid, text[], text, boolean, boolean) to service_role;
revoke all on function public.admin_follow_up(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_follow_up(uuid) to service_role;
