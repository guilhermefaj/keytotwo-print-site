-- Admin: gestão de usuários (2026-10-23, Fase 4 do admin; pedido do responsável), depois de
-- 20261023180000_blog_apagar_imagem.sql. Buscar contas, ver a ficha de cada pessoa (conta, jogos, pedidos, e-mails,
-- novidades, histórico do admin) e agir: dar um jogo de presente, retirar um jogo, reenviar o e-mail de acesso, tirar
-- das novidades, bloquear ou desbloquear o login (Auth, pela API), exportar os dados e excluir a conta a pedido (LGPD).
-- Toda ação confere o admin no banco e fica em private.admin_events, com o motivo. Bloquear, excluir e retirar jogo não
-- valem para a própria conta nem para a de outro admin: ninguém se tranca fora.
-- Presente = pedido de cortesia: o acesso a um jogo sempre nasce de um pedido (entitlements → order_items). O presente é
-- um pedido kind = 'courtesy' de R$ 0, sem Stripe nem aceite de termos, pago na criação; fica fora das vendas e da
-- receita das métricas e aparece em Minha conta como presente.
-- Migração nova: colunas e restrições novas, funções novas e três reescritas (guard_order_changes, get_admin_metrics,
-- get_account). Os pedidos que existem ficam kind = 'purchase' (o padrão); nenhum outro dado muda.

-- ===== 1. Pedido de cortesia =====================================================================
alter table public.orders add column kind text not null default 'purchase';
alter table public.orders alter column terms_version drop not null, alter column terms_accepted_at drop not null;
alter table public.orders
  add constraint orders_kind_check check (kind in ('purchase', 'courtesy')),
  -- compra sempre tem o aceite dos termos; presente não passa pelo pagamento, então não tem
  add constraint orders_terms_required check (kind = 'courtesy' or (terms_version is not null and terms_accepted_at is not null)),
  add constraint orders_courtesy_check check (kind <> 'courtesy' or (
    stripe_checkout_session_id is null and stripe_payment_intent_id is null and promotion_code is null
    and checkout_expires_at is null and amount_total = 0 and amount_subtotal = 0 and amount_discount = 0));
comment on column public.orders.kind is 'purchase: compra pela Stripe. courtesy: presente dado pelo admin (R$ 0, sem Stripe nem termos), fora das vendas.';

-- O tipo também é imutável (o resto igual a 20261019120000_lgpd_direitos_titular.sql).
create or replace function private.guard_order_changes() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id
     or new.livemode is distinct from old.livemode
     or new.created_at is distinct from old.created_at
     or new.cart_version is distinct from old.cart_version
     or new.terms_version is distinct from old.terms_version
     or new.kind is distinct from old.kind then
    raise exception 'orders: id, livemode, created_at, cart_version, terms_version e kind são imutáveis' using errcode = 'KT010';
  end if;
  -- D-28: a anonimização só acontece dentro de delete_account_data, e um pedido anonimizado não volta a ter dono nem e-mail
  if old.anonymized_at is not null then
    if new.anonymized_at is distinct from old.anonymized_at or new.user_id is not null or new.email is not null then
      raise exception 'orders: pedido anonimizado não volta a ter dono nem e-mail' using errcode = 'KT010';
    end if;
  elsif new.anonymized_at is not null
        and coalesce(current_setting('keytotwo.account_erasure', true), 'off') <> 'on' then
    raise exception 'orders: anonimização só pela exclusão de conta' using errcode = 'KT010';
  end if;
  -- o dono nunca muda (atendimento: set local keytotwo.allow_reassign = 'on'); na anonimização ele sai (o CHECK exige)
  if new.user_id is distinct from old.user_id
     and not (old.anonymized_at is null and new.anonymized_at is not null)
     and coalesce(current_setting('keytotwo.allow_reassign', true), 'off') <> 'on' then
    raise exception 'orders: o dono do pedido não muda' using errcode = 'KT010';
  end if;
  if old.stripe_checkout_session_id is not null
     and new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id then
    raise exception 'orders: stripe_checkout_session_id não muda depois de gravado' using errcode = 'KT010';
  end if;
  if old.stripe_payment_intent_id is not null
     and new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id then
    raise exception 'orders: stripe_payment_intent_id não muda depois de gravado' using errcode = 'KT010';
  end if;
  if old.terms_accepted_at is not null and new.terms_accepted_at is distinct from old.terms_accepted_at then
    raise exception 'orders: terms_accepted_at não muda depois de gravado' using errcode = 'KT010';
  end if;
  -- D-24: o que foi cobrado (e o cupom) é gravado uma vez
  if (old.amount_total is not null and new.amount_total is distinct from old.amount_total)
     or (old.amount_subtotal is not null and new.amount_subtotal is distinct from old.amount_subtotal)
     or (old.amount_discount is not null and new.amount_discount is distinct from old.amount_discount)
     or (old.currency is not null and new.currency is distinct from old.currency)
     or (old.promotion_code is not null and new.promotion_code is distinct from old.promotion_code) then
    raise exception 'orders: valores e código promocional não mudam depois de gravados' using errcode = 'KT010';
  end if;
  if new.status is distinct from old.status and not private.order_transition_allowed(old.status, new.status) then
    raise exception 'orders: transição % -> % não permitida', old.status, new.status using errcode = 'KT006';
  end if;
  return new;
end $$;

-- O admin entra como origem das transições do pedido de cortesia.
alter table public.order_events drop constraint order_events_source_check;
alter table public.order_events
  add constraint order_events_source_check check (source in ('checkout', 'webhook', 'return_page', 'reconcile', 'system', 'admin'));

-- E-mail do presente: transacional, como a entrega, e sempre de um pedido.
alter table public.email_outbox
  drop constraint email_outbox_kind_check,
  drop constraint email_outbox_kind_category_check,
  drop constraint email_outbox_delivery_order_check;
alter table public.email_outbox
  add constraint email_outbox_kind_check check (kind in ('delivery', 'gift', 'cart_reminder', 'post_purchase')),
  add constraint email_outbox_kind_category_check check ((kind in ('delivery', 'gift')) = (category = 'transactional')),
  add constraint email_outbox_delivery_order_check check (kind not in ('delivery', 'gift') or order_id is not null);

-- Histórico do admin: as ações sobre contas, com a pessoa em target_id.
alter table private.admin_events drop constraint admin_events_action_check;
alter table private.admin_events add constraint admin_events_action_check check (action in (
  'blog_create', 'blog_update', 'blog_publish', 'blog_unpublish', 'blog_delete', 'blog_image', 'blog_image_delete',
  'user_gift', 'user_revoke', 'user_resend', 'user_newsletter_off', 'user_block', 'user_unblock', 'user_export', 'user_delete'));
create index admin_events_target_idx on private.admin_events (target_id, created_at desc);

-- ===== 2. Ajudantes ==============================================================================
-- O conteúdo do e-mail de entrega de um pedido (o mesmo de fulfill_order): ref, itens e um jogo por direito, sem token.
create function private.delivery_payload(p_order_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'order_ref', upper(left(replace(p_order_id::text, '-', ''), 8)),
    'items', coalesce((select jsonb_agg(jsonb_build_object('code', pr.code, 'name', pr.name) order by oi.position)
                         from public.order_items oi
                         join public.products pr on pr.id = oi.product_id
                        where oi.order_id = p_order_id), '[]'::jsonb),
    'games', coalesce((select jsonb_agg(jsonb_build_object('entitlement_id', t.entitlement_id, 'game_id', t.game_id,
                                                           'code', t.code, 'name', t.name)
                                        order by t.item_position, t.game_position, t.game_id)
                         from (select distinct on (g.id)
                                      e.id as entitlement_id, g.id as game_id, g.code, g.name,
                                      oi.position as item_position, eg.position as game_position
                                 from public.entitlements e
                                 join public.order_items oi on oi.order_id = e.order_id and oi.product_id = e.product_id
                                 join public.entitlement_games eg on eg.entitlement_id = e.id
                                 join public.games g on g.id = eg.game_id
                                where e.order_id = p_order_id
                                order by g.id, oi.position) t), '[]'::jsonb))
$$;
revoke all on function private.delivery_payload(uuid) from public, anon, authenticated, service_role;

-- A conta existe (e não foi apagada) e pode receber ação que tranca ou tira algo: não é a do próprio admin nem a de
-- outro admin. ok | not_found | protected.
create function private.admin_target(p_user_id uuid, p_target uuid, p_protect boolean) returns text
language sql stable set search_path = '' as $$
  select case
    when not exists (select 1 from auth.users u where u.id = p_target and u.deleted_at is null) then 'not_found'
    when p_protect and (p_target = p_user_id or private.is_admin(p_target)) then 'protected'
    else 'ok' end
$$;
revoke all on function private.admin_target(uuid, uuid, boolean) from public, anon, authenticated, service_role;

-- Motivo das ações: obrigatório, de 3 a 300 caracteres.
create function private.admin_reason(p_reason text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 300 then
    raise exception 'motivo obrigatório, de 3 a 300 caracteres' using errcode = 'KT001';
  end if;
  return btrim(p_reason);
end $$;
revoke all on function private.admin_reason(text) from public, anon, authenticated, service_role;

-- ===== 3. Lista e ficha ==========================================================================
-- Contas do Auth (sem as apagadas), da mais nova à mais antiga, 50 por vez. p_query procura no e-mail; p_filter:
-- all | buyers (alguma compra paga) | newsletter (novidades ligadas) | blocked (login bloqueado agora).
create function public.admin_list_users(p_user_id uuid, p_query text, p_filter text, p_offset integer)
  returns table (outcome text, result jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_query text := nullif(lower(btrim(coalesce(p_query, ''))), '');
begin
  if p_user_id is null or p_filter is null or p_filter not in ('all', 'buyers', 'newsletter', 'blocked')
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
                         when 'blocked' then p.blocked else true end
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

-- A ficha de uma pessoa: conta, novidades, jogos, pedidos, e-mails, supressões, downloads, histórico do admin e o que
-- dá para dar de presente (produtos à venda, com "owned" quando a pessoa já tem todos os jogos dele).
create function public.admin_get_user(p_user_id uuid, p_target uuid) returns table (outcome text, result jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user  auth.users%rowtype;
  v_email text;
begin
  if p_user_id is null or p_target is null then
    raise exception 'admin_get_user: p_user_id e p_target são obrigatórios' using errcode = 'KT001';
  end if;
  perform private.require_confirmed_email(p_user_id);
  if not private.is_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  select * into v_user from auth.users u where u.id = p_target and u.deleted_at is null;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  v_email := private.normalize_email(v_user.email);

  return query select 'ok'::text, jsonb_build_object(
    'account', jsonb_build_object(
      'id', v_user.id, 'email', v_user.email, 'created_at', v_user.created_at,
      'confirmed_at', v_user.email_confirmed_at, 'last_sign_in_at', v_user.last_sign_in_at,
      'providers', coalesce(v_user.raw_app_meta_data -> 'providers', jsonb_build_array(v_user.raw_app_meta_data ->> 'provider')),
      'name', coalesce(v_user.raw_user_meta_data ->> 'full_name', v_user.raw_user_meta_data ->> 'name'),
      'blocked', coalesce(v_user.banned_until > now(), false), 'banned_until', v_user.banned_until,
      'admin', coalesce(v_user.raw_app_meta_data -> 'admin' = 'true'::jsonb, false),
      'self', p_target = p_user_id,
      'stripe_customer_id', (select pf.stripe_customer_id from public.profiles pf where pf.user_id = p_target)),
    'newsletter', jsonb_build_object(
      'opted_in', coalesce((select pf.marketing_opt_in from public.profiles pf where pf.user_id = p_target), false),
      'opted_in_at', (select pf.marketing_opt_in_at from public.profiles pf where pf.user_id = p_target),
      'history', coalesce((select jsonb_agg(jsonb_build_object('action', c.action, 'source', c.source, 'occurred_at', c.occurred_at)
                                            order by c.occurred_at desc, c.id desc)
                             from (select * from public.marketing_consents c where c.user_id = p_target
                                    order by c.occurred_at desc, c.id desc limit 20) c), '[]'::jsonb)),
    'library', coalesce((select jsonb_agg(jsonb_build_object(
        'entitlement_id', e.id, 'status', e.status, 'revoke_reason', e.revoke_reason,
        'granted_at', e.granted_at, 'revoked_at', e.revoked_at,
        'product', jsonb_build_object('code', p.code, 'name', p.name, 'kind', p.kind),
        'order', jsonb_build_object('id', o.id, 'ref', upper(left(replace(o.id::text, '-', ''), 8)), 'kind', o.kind),
        'games', coalesce((select jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name) order by eg.position)
                             from public.entitlement_games eg join public.games g on g.id = eg.game_id
                            where eg.entitlement_id = e.id), '[]'::jsonb))
        order by e.granted_at desc, e.id)
      from public.entitlements e
      join public.products p on p.id = e.product_id
      join public.orders o on o.id = e.order_id
     where e.user_id = p_target), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'ref', upper(left(replace(o.id::text, '-', ''), 8)), 'kind', o.kind, 'status', o.status,
        'created_at', o.created_at, 'paid_at', o.paid_at, 'refunded_at', o.refunded_at,
        'amount_total', o.amount_total, 'amount_discount', o.amount_discount, 'currency', o.currency,
        'promotion_code', o.promotion_code, 'livemode', o.livemode,
        'deliverable', o.status = 'paid'
                       and not exists (select 1 from public.entitlements x where x.order_id = o.id and x.status <> 'active'),
        'items', coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'unit_amount', i.unit_amount)
                                            order by i.position)
                             from public.order_items i join public.products p on p.id = i.product_id
                            where i.order_id = o.id), '[]'::jsonb))
        order by o.created_at desc, o.id)
      from public.orders o where o.user_id = p_target), '[]'::jsonb),
    'emails', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', x.kind, 'status', x.status, 'skip_reason', x.skip_reason, 'created_at', x.created_at, 'sent_at', x.sent_at,
        'order_ref', case when x.order_id is not null then upper(left(replace(x.order_id::text, '-', ''), 8)) end)
        order by x.created_at desc, x.id)
      from (select * from public.email_outbox x where x.user_id = p_target order by x.created_at desc, x.id limit 20) x), '[]'::jsonb),
    'suppressions', coalesce((select jsonb_agg(jsonb_build_object('reason', s.reason, 'source', s.source, 'occurred_at', s.occurred_at)
                                               order by s.occurred_at desc)
                                from public.email_suppressions s where s.email = v_email), '[]'::jsonb),
    'downloads', jsonb_build_object(
      'count', (select count(*) from public.download_events d where d.user_id = p_target),
      'last_at', (select max(d.created_at) from public.download_events d where d.user_id = p_target)),
    'history', coalesce((select jsonb_agg(jsonb_build_object(
        'action', a.action, 'created_at', a.created_at, 'details', a.details,
        'by', (select u.email from auth.users u where u.id = a.user_id))
        order by a.created_at desc, a.id desc)
      from (select * from private.admin_events a where a.target_id = p_target order by a.created_at desc, a.id desc limit 50) a), '[]'::jsonb),
    'giftable', coalesce((select jsonb_agg(jsonb_build_object(
        'code', p.code, 'name', p.name, 'kind', p.kind,
        'owned', not exists (select 1 from public.product_games pg
                              where pg.product_id = p.id
                                and not exists (select 1 from public.entitlements e
                                                  join public.entitlement_games eg on eg.entitlement_id = e.id
                                                 where e.user_id = p_target and e.status = 'active' and eg.game_id = pg.game_id)))
        order by p.kind, p.code)
      from public.products p where p.status = 'active'), '[]'::jsonb));
end $$;

-- ===== 4. Ações ==================================================================================
-- Presente: pedido de cortesia pago na hora, um direito com os jogos do produto, o produto sai da sacola e, com
-- p_notify, o e-mail do presente (transacional, com os links de baixar). ok | forbidden | not_found |
-- product_unavailable (não está à venda) | already_owned (a pessoa já tem todos os jogos dele).
create function public.admin_gift_product(p_user_id uuid, p_target uuid, p_product_code text, p_reason text,
                                          p_notify boolean, p_livemode boolean)
  returns table (outcome text, order_id uuid, outbox_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_reason  text;
  v_product public.products%rowtype;
  v_email   text;
  v_order   uuid;
  v_ent     uuid;
  v_outbox  uuid;
  v_rows    integer;
begin
  if p_user_id is null or p_target is null or p_product_code is null or p_notify is null or p_livemode is null then
    raise exception 'admin_gift_product: argumentos obrigatórios' using errcode = 'KT001';
  end if;
  v_reason := private.admin_reason(p_reason);
  perform private.require_confirmed_email(p_user_id);
  if not private.is_admin(p_user_id) then
    return query select 'forbidden'::text, null::uuid, null::uuid;
    return;
  end if;
  select private.normalize_email(u.email) into v_email from auth.users u where u.id = p_target and u.deleted_at is null;
  if not found or v_email is null then
    return query select 'not_found'::text, null::uuid, null::uuid;
    return;
  end if;
  select * into v_product from public.products p where p.code = p_product_code and p.status = 'active';
  if not found then
    return query select 'product_unavailable'::text, null::uuid, null::uuid;
    return;
  end if;
  if not exists (select 1 from public.product_games pg
                  where pg.product_id = v_product.id
                    and not exists (select 1 from public.entitlements e
                                      join public.entitlement_games eg on eg.entitlement_id = e.id
                                     where e.user_id = p_target and e.status = 'active' and eg.game_id = pg.game_id)) then
    return query select 'already_owned'::text, null::uuid, null::uuid;
    return;
  end if;

  -- itens só entram em pedido open; depois o pedido passa a paid, como na compra
  insert into public.orders (user_id, email, kind, cart_version, livemode, amount_subtotal, amount_discount, amount_total, currency)
  values (p_target, v_email, 'courtesy', 0, p_livemode, 0, 0, 0, 'brl')
  returning id into v_order;
  insert into public.order_items (order_id, product_id, position, stripe_price_id, unit_amount, currency)
  values (v_order, v_product.id, 1, v_product.stripe_price_id, 0, 'brl');
  insert into public.order_events (order_id, from_status, to_status, source) values (v_order, null, 'open', 'admin');
  update public.orders o set status = 'paid', paid_at = now() where o.id = v_order;
  insert into public.order_events (order_id, from_status, to_status, source) values (v_order, 'open', 'paid', 'admin');

  insert into public.entitlements (order_id, product_id, user_id) values (v_order, v_product.id, p_target) returning id into v_ent;
  insert into public.entitlement_games (entitlement_id, game_id, position)
  select v_ent, pg.game_id, pg.position from public.product_games pg where pg.product_id = v_product.id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'admin_gift_product: o produto % não tem jogos na composição', v_product.code using errcode = 'KT003';
  end if;

  -- sacola: o produto dado sai e a versão sobe (como depois da compra)
  perform 1 from public.carts c where c.user_id = p_target for update;
  if found then
    delete from public.cart_items ci where ci.user_id = p_target and ci.product_id = v_product.id;
    update public.carts c set version = c.version + 1 where c.user_id = p_target;
  end if;

  if p_notify then
    insert into public.email_outbox (user_id, order_id, kind, category, to_email, payload, dedupe_key)
    values (p_target, v_order, 'gift', 'transactional', v_email, private.delivery_payload(v_order), 'gift:' || v_order::text)
    returning id into v_outbox;
  end if;

  insert into private.admin_events (user_id, action, target_id, details)
  values (p_user_id, 'user_gift', p_target,
          jsonb_build_object('order_id', v_order, 'product', v_product.code, 'reason', v_reason, 'notify', p_notify));
  return query select 'ok'::text, v_order, v_outbox;
end $$;

-- Retirar um jogo: o direito fica revogado com motivo manual; o pedido não muda (dinheiro de volta é reembolso).
-- ok | forbidden | not_found | protected | not_active (já estava retirado).
create function public.admin_revoke_entitlement(p_user_id uuid, p_target uuid, p_entitlement_id uuid, p_reason text)
  returns table (outcome text)
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_target text;
  v_ent    public.entitlements%rowtype;
begin
  if p_user_id is null or p_target is null or p_entitlement_id is null then
    raise exception 'admin_revoke_entitlement: argumentos obrigatórios' using errcode = 'KT001';
  end if;
  v_reason := private.admin_reason(p_reason);
  perform private.require_confirmed_email(p_user_id);
  if not private.is_admin(p_user_id) then
    return query select 'forbidden'::text;
    return;
  end if;
  v_target := private.admin_target(p_user_id, p_target, true);
  if v_target <> 'ok' then
    return query select v_target;
    return;
  end if;
  select * into v_ent from public.entitlements e where e.id = p_entitlement_id and e.user_id = p_target for update;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;
  if v_ent.status <> 'active' then
    return query select 'not_active'::text;
    return;
  end if;
  update public.entitlements e set status = 'revoked', revoke_reason = 'manual', revoked_at = now() where e.id = v_ent.id;
  insert into private.admin_events (user_id, action, target_id, details)
  values (p_user_id, 'user_revoke', p_target, jsonb_build_object(
    'entitlement_id', v_ent.id, 'order_id', v_ent.order_id,
    'product', (select p.code from public.products p where p.id = v_ent.product_id), 'reason', v_reason));
  return query select 'ok'::text;
end $$;

-- Reenviar o e-mail de acesso de um pedido pago com todos os jogos ativos (presente reenvia o e-mail do presente), para o
-- e-mail atual da conta. ok | forbidden | not_found | not_deliverable | already_queued (um envio ainda na fila).
create function public.admin_resend_delivery(p_user_id uuid, p_target uuid, p_order_id uuid)
  returns table (outcome text, outbox_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_order  public.orders%rowtype;
  v_email  text;
  v_outbox uuid;
begin
  if p_user_id is null or p_target is null or p_order_id is null then
    raise exception 'admin_resend_delivery: argumentos obrigatórios' using errcode = 'KT001';
  end if;
  perform private.require_confirmed_email(p_user_id);
  if not private.is_admin(p_user_id) then
    return query select 'forbidden'::text, null::uuid;
    return;
  end if;
  select * into v_order from public.orders o where o.id = p_order_id and o.user_id = p_target for update;
  select private.normalize_email(u.email) into v_email from auth.users u where u.id = p_target and u.deleted_at is null;
  if v_order.id is null or v_email is null then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  if v_order.status <> 'paid' or exists (select 1 from public.entitlements e where e.order_id = p_order_id and e.status <> 'active') then
    return query select 'not_deliverable'::text, null::uuid;
    return;
  end if;
  if exists (select 1 from public.email_outbox x
              where x.order_id = p_order_id and x.kind in ('delivery', 'gift') and x.status in ('queued', 'sending')) then
    return query select 'already_queued'::text, null::uuid;
    return;
  end if;
  insert into public.email_outbox (user_id, order_id, kind, category, to_email, payload, dedupe_key)
  values (p_target, p_order_id, case v_order.kind when 'courtesy' then 'gift' else 'delivery' end, 'transactional', v_email,
          private.delivery_payload(p_order_id),
          'resend:' || p_order_id::text || ':' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text)
  returning id into v_outbox;
  insert into private.admin_events (user_id, action, target_id, details)
  values (p_user_id, 'user_resend', p_target, jsonb_build_object('order_id', p_order_id, 'outbox_id', v_outbox));
  return query select 'ok'::text, v_outbox;
end $$;

-- Tirar das novidades a pedido: o mesmo descadastro de set_marketing_consent (que não aceita a origem support), com
-- origem support: histórico, perfil (pela trigger) e os e-mails de marketing na fila cancelados. ok | forbidden |
-- not_found | not_subscribed.
create function public.admin_newsletter_off(p_user_id uuid, p_target uuid, p_reason text) returns table (outcome text)
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_target text;
  v_opted  boolean;
begin
  if p_user_id is null or p_target is null then
    raise exception 'admin_newsletter_off: argumentos obrigatórios' using errcode = 'KT001';
  end if;
  v_reason := private.admin_reason(p_reason);
  perform private.require_confirmed_email(p_user_id);
  if not private.is_admin(p_user_id) then
    return query select 'forbidden'::text;
    return;
  end if;
  v_target := private.admin_target(p_user_id, p_target, false);
  if v_target <> 'ok' then
    return query select v_target;
    return;
  end if;
  select pf.marketing_opt_in into v_opted from public.profiles pf where pf.user_id = p_target for update;
  if not coalesce(v_opted, false) then
    return query select 'not_subscribed'::text;
    return;
  end if;
  insert into public.marketing_consents (user_id, email, action, source, text_version)
  select p_target, private.normalize_email(u.email), 'revoked', 'support', null from auth.users u where u.id = p_target;
  perform private.cancel_queued_marketing(p_target);
  insert into private.admin_events (user_id, action, target_id, details)
  values (p_user_id, 'user_newsletter_off', p_target, jsonb_build_object('reason', v_reason));
  return query select 'ok'::text;
end $$;

-- Bloquear ou desbloquear o login: a API confere aqui antes (check), troca o bloqueio no Auth e registra depois (log).
-- check → ok | forbidden | not_found | protected, com o estado atual em blocked.
create function public.admin_check_user_block(p_user_id uuid, p_target uuid) returns table (outcome text, blocked boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_target text;
begin
  if p_user_id is null or p_target is null then
    raise exception 'admin_check_user_block: argumentos obrigatórios' using errcode = 'KT001';
  end if;
  perform private.require_confirmed_email(p_user_id);
  if not private.is_admin(p_user_id) then
    return query select 'forbidden'::text, null::boolean;
    return;
  end if;
  v_target := private.admin_target(p_user_id, p_target, true);
  return query select v_target,
    case when v_target = 'ok' then coalesce((select u.banned_until > now() from auth.users u where u.id = p_target), false) end;
end $$;

create function public.admin_log_user_block(p_user_id uuid, p_target uuid, p_blocked boolean, p_reason text)
  returns table (outcome text)
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
begin
  if p_user_id is null or p_target is null or p_blocked is null then
    raise exception 'admin_log_user_block: argumentos obrigatórios' using errcode = 'KT001';
  end if;
  v_reason := private.admin_reason(p_reason);
  perform private.require_confirmed_email(p_user_id);
  if not private.is_admin(p_user_id) then
    return query select 'forbidden'::text;
    return;
  end if;
  insert into private.admin_events (user_id, action, target_id, details)
  values (p_user_id, case when p_blocked then 'user_block' else 'user_unblock' end, p_target, jsonb_build_object('reason', v_reason));
  return query select 'ok'::text;
end $$;

-- Exportar os dados (LGPD): a mesma cópia que a pessoa baixa em Minha conta. ok | forbidden | not_found |
-- not_confirmed (conta que nunca confirmou o e-mail não tem o que exportar pela regra de export_account_data).
create function public.admin_export_user(p_user_id uuid, p_target uuid) returns table (outcome text, data jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  v_target text;
begin
  if p_user_id is null or p_target is null then
    raise exception 'admin_export_user: argumentos obrigatórios' using errcode = 'KT001';
  end if;
  perform private.require_confirmed_email(p_user_id);
  if not private.is_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  v_target := private.admin_target(p_user_id, p_target, false);
  if v_target <> 'ok' then
    return query select v_target, null::jsonb;
    return;
  end if;
  if private.confirmed_email(p_target) is null then
    return query select 'not_confirmed'::text, null::jsonb;
    return;
  end if;
  insert into private.admin_events (user_id, action, target_id) values (p_user_id, 'user_export', p_target);
  return query select 'ok'::text, public.export_account_data(p_target);
end $$;

-- Excluir a conta a pedido (LGPD): o mesmo delete_account_data da exclusão pela própria pessoa (a API apaga no Auth em
-- seguida). p_confirm_email tem de ser o e-mail da conta. O histórico guarda só o motivo e quantos pedidos ficaram
-- anonimizados, sem o e-mail: a conta deixa de existir. deleted | forbidden | not_found | protected |
-- confirmation_mismatch | not_confirmed | blocked (com o motivo de delete_account_data).
create function public.admin_delete_user(p_user_id uuid, p_target uuid, p_reason text, p_confirm_email text)
  returns table (outcome text, reason text, orders_anonymized integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_target text;
  r        record;
begin
  if p_user_id is null or p_target is null then
    raise exception 'admin_delete_user: argumentos obrigatórios' using errcode = 'KT001';
  end if;
  v_reason := private.admin_reason(p_reason);
  perform private.require_confirmed_email(p_user_id);
  if not private.is_admin(p_user_id) then
    return query select 'forbidden'::text, null::text, null::integer;
    return;
  end if;
  v_target := private.admin_target(p_user_id, p_target, true);
  if v_target <> 'ok' then
    return query select v_target, null::text, null::integer;
    return;
  end if;
  if private.normalize_email(p_confirm_email) is distinct from
     (select private.normalize_email(u.email) from auth.users u where u.id = p_target) then
    return query select 'confirmation_mismatch'::text, null::text, null::integer;
    return;
  end if;
  if private.confirmed_email(p_target) is null then
    return query select 'not_confirmed'::text, null::text, null::integer;
    return;
  end if;
  select * into r from public.delete_account_data(p_target);
  if r.outcome <> 'deleted' then
    return query select r.outcome, r.reason, null::integer;
    return;
  end if;
  insert into private.admin_events (user_id, action, target_id, details)
  values (p_user_id, 'user_delete', p_target, jsonb_build_object('reason', v_reason, 'orders_anonymized', r.orders_anonymized));
  return query select 'deleted'::text, null::text, r.orders_anonymized;
end $$;

-- ===== 5. Presente fora das vendas e marcado em Minha conta ======================================
-- get_admin_metrics: igual a 20261021120000_painel_admin.sql, com as vendas só de compras (kind = 'purchase').
create or replace function public.get_admin_metrics(p_user_id uuid, p_days integer, p_livemode boolean)
  returns table (outcome text, metrics jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_first date;
  v_since timestamptz;
begin
  if p_user_id is null or p_days is null or p_days not between 1 and 366 or p_livemode is null then
    raise exception 'get_admin_metrics: p_user_id, p_days (1 a 366) e p_livemode são obrigatórios' using errcode = 'KT001';
  end if;
  perform private.require_confirmed_email(p_user_id);
  if not private.is_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  v_first := v_today - (p_days - 1);
  v_since := v_first::timestamp at time zone 'America/Sao_Paulo';

  return query
  with sales as (
    select o.user_id, o.amount_total, (o.paid_at at time zone 'America/Sao_Paulo')::date as day
      from public.orders o
     where o.paid_at >= v_since and o.livemode = p_livemode and o.currency = 'brl' and o.status in ('paid', 'disputed')
       and o.kind = 'purchase'
  ), accounts as (
    select (e.occurred_at at time zone 'America/Sao_Paulo')::date as day
      from public.funnel_events e
     where e.type = 'account_confirmed' and e.occurred_at >= v_since
  ), days as (
    select d::date as day from generate_series(v_first::timestamp, v_today::timestamp, interval '1 day') d
  )
  select 'ok'::text, jsonb_build_object(
    'days', p_days,
    'since', v_first,
    'until', v_today,
    'livemode', p_livemode,
    'sales', jsonb_build_object(
      'orders', (select count(*) from sales),
      'revenue', (select coalesce(sum(s.amount_total), 0) from sales s),
      'currency', 'brl'),
    'accounts', (select count(*) from accounts),
    'funnel', jsonb_build_object(
      'cart', (select count(distinct e.user_id) from public.funnel_events e where e.type = 'cart_item_added' and e.occurred_at >= v_since),
      'checkout', (select count(distinct e.user_id) from public.funnel_events e where e.type = 'checkout_started' and e.occurred_at >= v_since),
      'paid', (select count(distinct s.user_id) from sales s)),
    'downloads', jsonb_build_object(
      'paid', (select count(*) from public.download_events d where d.kind = 'paid' and d.created_at >= v_since),
      'free', (select count(*) from public.download_events d where d.kind = 'free' and d.created_at >= v_since)),
    'free_unlocks', (select count(*) from (
      select c.user_id from public.marketing_consents c where c.action = 'granted'
       group by c.user_id having min(c.occurred_at) >= v_since) f),
    'newsletter', jsonb_build_object('subscribed', (select count(*) from public.profiles p where p.marketing_opt_in)),
    'daily', (select jsonb_agg(jsonb_build_object(
        'date', d.day,
        'orders', (select count(*) from sales s where s.day = d.day),
        'revenue', (select coalesce(sum(s.amount_total), 0) from sales s where s.day = d.day),
        'accounts', (select count(*) from accounts a where a.day = d.day)) order by d.day)
      from days d));
end $$;

-- get_account: igual a 20261020150000_gratuitos.sql, com o tipo de cada pedido (o site mostra o presente como presente).
create or replace function public.get_account(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_confirmed_email(p_user_id);

  return jsonb_build_object(
    'email', (select u.email from auth.users u where u.id = p_user_id),
    'marketing', coalesce((
      select jsonb_build_object(
               'opted_in', p.marketing_opt_in,
               'updated_at', (select c.occurred_at from public.marketing_consents c
                              where c.user_id = p_user_id order by c.occurred_at desc, c.id desc limit 1),
               'text_version', case when p.marketing_opt_in then
                                 (select c.text_version from public.marketing_consents c
                                  where c.user_id = p_user_id and c.action = 'granted'
                                  order by c.occurred_at desc, c.id desc limit 1)
                               end,
               'prompted_at', p.marketing_prompted_at)
      from public.profiles p where p.user_id = p_user_id),
      jsonb_build_object('opted_in', false, 'updated_at', null, 'text_version', null, 'prompted_at', null)),
    'free_games_unlocked', private.free_games_unlocked(p_user_id),
    'orders', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'ref', upper(left(replace(o.id::text, '-', ''), 8)),
                 'kind', o.kind,
                 'created_at', o.created_at,
                 'paid_at', o.paid_at,
                 'status', o.status,
                 'amount_subtotal', o.amount_subtotal,
                 'amount_discount', o.amount_discount,
                 'amount_total', o.amount_total,
                 'currency', o.currency,
                 'promotion_code', o.promotion_code,
                 'items', coalesce((
                   select jsonb_agg(
                            jsonb_build_object('code', p.code, 'name', p.name,
                                               'unit_amount', i.unit_amount, 'currency', i.currency)
                            order by i.position)
                   from public.order_items i
                   join public.products p on p.id = i.product_id
                   where i.order_id = o.id), '[]'::jsonb))
               order by o.created_at desc, o.id desc)
      from public.orders o
      where o.user_id = p_user_id and o.status not in ('open', 'expired')), '[]'::jsonb));
end $$;

-- ===== EXECUTE só para service_role ================================================================
revoke all on function public.admin_list_users(uuid, text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_users(uuid, text, text, integer) to service_role;
revoke all on function public.admin_get_user(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_user(uuid, uuid) to service_role;
revoke all on function public.admin_gift_product(uuid, uuid, text, text, boolean, boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_gift_product(uuid, uuid, text, text, boolean, boolean) to service_role;
revoke all on function public.admin_revoke_entitlement(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_revoke_entitlement(uuid, uuid, uuid, text) to service_role;
revoke all on function public.admin_resend_delivery(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_resend_delivery(uuid, uuid, uuid) to service_role;
revoke all on function public.admin_newsletter_off(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_newsletter_off(uuid, uuid, text) to service_role;
revoke all on function public.admin_check_user_block(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_check_user_block(uuid, uuid) to service_role;
revoke all on function public.admin_log_user_block(uuid, uuid, boolean, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_log_user_block(uuid, uuid, boolean, text) to service_role;
revoke all on function public.admin_export_user(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_export_user(uuid, uuid) to service_role;
revoke all on function public.admin_delete_user(uuid, uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_user(uuid, uuid, text, text) to service_role;
