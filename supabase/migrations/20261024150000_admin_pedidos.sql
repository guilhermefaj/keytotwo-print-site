-- Pedidos e reembolsos no admin (2026-10-24, Fase 3; decisões do responsável): a lista e a ficha de cada pedido, o
-- reembolso do pedido inteiro pela API da Stripe, o aviso de reembolso por e-mail e o "conferir com a Stripe" para o
-- pedido que ficou aberto aqui com a sessão paga lá.
--   1. admin_events ganha order_refund e order_reconcile; email_outbox ganha o kind refund (transacional, de um pedido);
--   2. claim_email_batch: a checagem de "pedido segue pago" vale para entrega e presente, não para o aviso de reembolso;
--   3. set_order_status aceita a origem admin e, ao reembolsar (por qualquer caminho), põe o aviso na fila;
--   4. RPCs novas: admin_list_orders, admin_get_order, admin_order_stripe (o que a API precisa para falar com a Stripe)
--      e admin_log_order_action (o histórico do admin, depois que a Stripe aceitou).
-- O reembolso parcial fica de fora (decisão do responsável): o webhook só reembolsa o pedido com a cobrança inteira
-- devolvida, como antes.

-- ===== 1. Ações do admin e o kind do aviso =========================================================================
alter table private.admin_events drop constraint admin_events_action_check;
alter table private.admin_events add constraint admin_events_action_check check (action in (
  'blog_create', 'blog_update', 'blog_publish', 'blog_unpublish', 'blog_delete', 'blog_image', 'blog_image_delete',
  'user_gift', 'user_revoke', 'user_resend', 'user_newsletter_off', 'user_block', 'user_unblock', 'user_export', 'user_delete',
  'user_admin_grant', 'user_admin_revoke', 'order_refund', 'order_reconcile'));

alter table public.email_outbox
  drop constraint email_outbox_kind_check,
  drop constraint email_outbox_kind_category_check,
  drop constraint email_outbox_delivery_order_check;
alter table public.email_outbox
  add constraint email_outbox_kind_check check (kind in ('delivery', 'gift', 'refund', 'cart_reminder', 'post_purchase')),
  add constraint email_outbox_kind_category_check check ((kind in ('delivery', 'gift', 'refund')) = (category = 'transactional')),
  add constraint email_outbox_delivery_order_check check (kind not in ('delivery', 'gift', 'refund') or order_id is not null);

-- Fotografia do aviso de reembolso: o código do pedido, o valor devolvido (o total cobrado) e os produtos.
create function private.refund_payload(p_order_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'order_ref', private.order_ref(o.id),
    'amount_total', o.amount_total,
    'currency', o.currency,
    'items', coalesce((select jsonb_agg(jsonb_build_object('code', pr.code, 'name', pr.name) order by oi.position)
                         from public.order_items oi join public.products pr on pr.id = oi.product_id
                        where oi.order_id = o.id), '[]'::jsonb))
    from public.orders o where o.id = p_order_id
$$;
revoke all on function private.refund_payload(uuid) from public, anon, authenticated, service_role;

-- ===== 2 e 3. A fila de e-mail e o status do pedido (o resto de cada função é igual ao de antes) ==================

create or replace function public.claim_email_batch(
  p_limit     integer default 20,
  p_outbox_id uuid default null,
  p_now       timestamptz default now()
) returns table (
  id       uuid,
  kind     text,
  category text,
  user_id  uuid,
  order_id uuid,
  to_email text,
  payload  jsonb,
  attempts integer
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  r              record;
  v_attempts     integer;
  v_reason       text;
  v_order_status text;
  v_cart_version integer;
  v_cart_items   integer;
  v_last         timestamptz;
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 or p_now is null then
    raise exception 'claim_email_batch: p_limit deve estar entre 1 e 200 e p_now é obrigatório' using errcode = 'KT001';
  end if;

  for r in
    select x.* from public.email_outbox x
     where (p_outbox_id is null or x.id = p_outbox_id)
       and x.scheduled_at <= p_now
       and (x.status = 'queued' or (x.status = 'sending' and x.locked_at < p_now - interval '10 minutes'))
     order by x.scheduled_at, x.created_at, x.id
     limit p_limit
     for update skip locked
  loop
    v_attempts := r.attempts;

    -- 'sending' parado há mais de 10 minutos (o despachante caiu): conta uma tentativa; na 5ª, falha de vez
    if r.status = 'sending' then
      v_attempts := v_attempts + 1;
      if v_attempts >= 5 then
        update public.email_outbox x
           set status = 'failed', attempts = v_attempts, locked_at = null, last_error = 'despachante não respondeu (timeout)'
         where x.id = r.id;
        continue;
      end if;
    end if;

    v_reason := null;
    if r.category = 'marketing' then
      -- marketing é rechecado AQUI: opt-in vigente, e-mail confirmado, sem supressão
      if not private.marketing_allowed(r.user_id) then
        v_reason := case
          when not coalesce((select p.marketing_opt_in from public.profiles p where p.user_id = r.user_id), false) then 'no_opt_in'
          when private.confirmed_email(r.user_id) is null then 'email_not_confirmed'
          else 'suppressed' end;
      elsif r.kind = 'cart_reminder' then
        select c.version into v_cart_version from public.carts c where c.user_id = r.user_id;
        select count(*) into v_cart_items from public.cart_items ci where ci.user_id = r.user_id;
        if v_cart_items = 0 then
          v_reason := 'cart_empty';
        elsif v_cart_version is distinct from (r.payload->>'cart_version')::integer then
          v_reason := 'cart_changed';
        end if;
      elsif r.kind = 'post_purchase' then
        select o.status into v_order_status from public.orders o where o.id = r.order_id;
        if v_order_status is distinct from 'paid' then
          v_reason := 'order_not_paid';
        end if;
      end if;

      if v_reason is not null then
        update public.email_outbox x
           set status = 'skipped', skip_reason = v_reason, attempts = v_attempts, locked_at = null
         where x.id = r.id;
        continue;
      end if;

      -- no máximo 1 e-mail de marketing por pessoa a cada 24 h: o excedente vai para depois, sem ser pulado
      select max(coalesce(m.sent_at, m.locked_at)) into v_last
        from public.email_outbox m
       where m.user_id = r.user_id and m.category = 'marketing' and m.id <> r.id
         and ((m.status = 'sent' and m.sent_at > p_now - interval '24 hours')
              or (m.status = 'sending' and m.locked_at >= p_now - interval '10 minutes'));
      if v_last is not null then
        update public.email_outbox x
           set status = 'queued', attempts = v_attempts, locked_at = null,
               scheduled_at = greatest(r.scheduled_at, v_last + interval '24 hours')
         where x.id = r.id;
        continue;
      end if;
    elsif r.kind <> 'refund' then
      -- transacional (entrega e presente): só sai se o pedido segue pago e nenhum direito foi revogado. O aviso de
      -- reembolso é o contrário: sai justamente com o pedido reembolsado.
      select o.status into v_order_status from public.orders o where o.id = r.order_id;
      if v_order_status in ('disputed', 'dispute_lost', 'refunded') then
        v_reason := 'entitlement_revoked';
      elsif v_order_status is distinct from 'paid' then
        v_reason := 'order_not_paid';
      elsif exists (select 1 from public.entitlements e where e.order_id = r.order_id and e.status <> 'active') then
        v_reason := 'entitlement_revoked';
      end if;
      if v_reason is not null then
        update public.email_outbox x
           set status = 'canceled', skip_reason = v_reason, attempts = v_attempts, locked_at = null
         where x.id = r.id;
        continue;
      end if;
    end if;

    update public.email_outbox x
       set status = 'sending', locked_at = p_now, attempts = v_attempts
     where x.id = r.id;
    id := r.id; kind := r.kind; category := r.category; user_id := r.user_id; order_id := r.order_id;
    to_email := r.to_email; payload := r.payload; attempts := v_attempts;
    return next;
  end loop;
end $$;

create or replace function public.set_order_status(
  p_order_id          uuid,
  p_new_status        text,
  p_source            text default 'webhook',
  p_stripe_event_id   text default null,
  p_reason            text default null,
  p_amount_total      bigint default null,
  p_currency          text default null,
  p_payment_intent_id text default null,
  p_amount_subtotal   bigint default null,
  p_amount_discount   bigint default null,
  p_promotion_code    text default null,
  p_event_type        text default null
) returns table (
  outcome            text,
  order_id           uuid,
  previous_status    text,
  order_status       text,
  entitlement_status text
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_order      public.orders%rowtype;
  v_code       text := nullif(btrim(p_promotion_code), '');
  v_event_type text := coalesce(nullif(btrim(p_event_type), ''), 'unspecified');
  v_outcome    text;
  v_ent_status text;
begin
  if p_order_id is null or p_new_status is null
     or p_new_status not in ('pending_payment', 'failed', 'expired', 'disputed', 'dispute_lost', 'refunded', 'paid')
     or p_source is null or p_source not in ('webhook', 'return_page', 'reconcile', 'admin')
     or (p_stripe_event_id is not null and p_stripe_event_id !~ '^evt_[A-Za-z0-9_]+$')
     or (p_reason is not null and char_length(p_reason) > 200)
     or (p_payment_intent_id is not null and p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$')
     or (p_currency is not null and p_currency !~ '^[a-z]{3}$')
     or p_amount_total < 0 or p_amount_subtotal < 0 or p_amount_discount < 0
     or (v_code is not null and char_length(v_code) > 200)
     or char_length(v_event_type) > 100 then
    raise exception 'set_order_status: argumentos inválidos' using errcode = 'KT001';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    -- sem o pedido não há livemode para o livro-razão: o evento não é gravado; a rota registra no log
    return query select 'not_found'::text, null::uuid, null::text, null::text, null::text;
    return;
  end if;

  v_ent_status := private.order_access(p_order_id);

  -- evento repetido
  if p_stripe_event_id is not null and exists (select 1 from public.stripe_events e where e.id = p_stripe_event_id) then
    return query select 'duplicate_event'::text, p_order_id, v_order.status, v_order.status, v_ent_status;
    return;
  end if;

  -- mesmo estado
  if v_order.status = p_new_status then
    perform private.log_stripe_event(p_stripe_event_id, v_event_type, v_order.livemode, v_order.stripe_checkout_session_id, p_order_id, 'noop');
    return query select 'noop'::text, p_order_id, v_order.status, v_order.status, v_ent_status;
    return;
  end if;

  -- 'paid' a partir de open/pending_payment é da fulfill_order (cria os direitos)
  if p_new_status = 'paid' and v_order.status in ('open', 'pending_payment') then
    raise exception 'set_order_status: use fulfill_order para pagar um pedido %', v_order.status using errcode = 'KT001';
  end if;

  -- o evento de cobrança chegou antes da liberação: a Stripe reenvia (não grava o evento)
  if (p_new_status in ('disputed', 'dispute_lost', 'refunded') and v_order.status in ('open', 'pending_payment'))
     or (p_new_status = 'dispute_lost' and v_order.status = 'paid') then
    return query select 'deferred'::text, p_order_id, v_order.status, v_order.status, v_ent_status;
    return;
  end if;

  -- aresta inexistente
  if not private.order_transition_allowed(v_order.status, p_new_status) then
    perform private.log_stripe_event(p_stripe_event_id, v_event_type, v_order.livemode, v_order.stripe_checkout_session_id, p_order_id, 'ignored');
    return query select 'ignored'::text, p_order_id, v_order.status, v_order.status, v_ent_status;
    return;
  end if;

  -- aplicar
  if p_new_status = 'pending_payment' then
    if p_amount_total is null or p_amount_subtotal is null or p_amount_discount is null or p_currency is null then
      raise exception 'set_order_status: pending_payment exige subtotal, desconto, total e moeda' using errcode = 'KT007';
    end if;
    if p_amount_discount > p_amount_subtotal or p_amount_subtotal - p_amount_discount <> p_amount_total then
      raise exception 'set_order_status: valores da sessão não fecham (subtotal=%, desconto=%, total=%)',
        p_amount_subtotal, p_amount_discount, p_amount_total using errcode = 'KT012';
    end if;
    update public.orders o
       set status = 'pending_payment', amount_subtotal = p_amount_subtotal, amount_discount = p_amount_discount,
           amount_total = p_amount_total, currency = p_currency, promotion_code = v_code,
           stripe_payment_intent_id = coalesce(o.stripe_payment_intent_id, p_payment_intent_id)
     where o.id = p_order_id;

  elsif p_new_status = 'failed' then
    update public.orders o set status = 'failed' where o.id = p_order_id;

  elsif p_new_status = 'expired' then
    update public.orders o set status = 'expired' where o.id = p_order_id;
    insert into public.funnel_events (user_id, type, order_id) values (v_order.user_id, 'checkout_expired', p_order_id);

  elsif p_new_status = 'disputed' then
    update public.orders o set status = 'disputed' where o.id = p_order_id;
    update public.entitlements e
       set status = 'revoked', revoked_at = now(), revoke_reason = 'dispute'
     where e.order_id = p_order_id and e.status = 'active';
    perform private.cancel_order_emails(p_order_id, 'entitlement_revoked');
    insert into public.funnel_events (user_id, type, order_id) values (v_order.user_id, 'dispute_opened', p_order_id);

  elsif p_new_status = 'paid' then   -- disputed -> paid: reativa só o que a contestação revogou
    update public.orders o set status = 'paid' where o.id = p_order_id;
    update public.entitlements e
       set status = 'active', revoked_at = null, revoke_reason = null
     where e.order_id = p_order_id and e.status = 'revoked' and e.revoke_reason = 'dispute';
    insert into public.funnel_events (user_id, type, order_id) values (v_order.user_id, 'dispute_closed', p_order_id);

  elsif p_new_status = 'dispute_lost' then   -- os direitos seguem revogados (dispute)
    update public.orders o set status = 'dispute_lost' where o.id = p_order_id;
    insert into public.funnel_events (user_id, type, order_id) values (v_order.user_id, 'dispute_closed', p_order_id);

  elsif p_new_status = 'refunded' then
    update public.orders o set status = 'refunded', refunded_at = now() where o.id = p_order_id;
    update public.entitlements e
       set status = 'revoked', revoked_at = coalesce(e.revoked_at, now()), revoke_reason = 'refund'
     where e.order_id = p_order_id and (e.status = 'active' or e.revoke_reason = 'dispute');
    perform private.cancel_order_emails(p_order_id, 'entitlement_revoked');
    -- aviso de reembolso (transacional): um por pedido, no e-mail atual da conta; conta apagada não recebe
    insert into public.email_outbox (user_id, order_id, kind, category, to_email, payload, dedupe_key)
    select v_order.user_id, p_order_id, 'refund', 'transactional', private.normalize_email(u.email),
           private.refund_payload(p_order_id), 'refund:' || p_order_id::text
      from auth.users u
     where u.id = v_order.user_id and u.deleted_at is null and private.normalize_email(u.email) is not null
    on conflict (dedupe_key) do nothing;
  end if;

  insert into public.order_events (order_id, from_status, to_status, source, stripe_event_id, reason)
  values (p_order_id, v_order.status, p_new_status, p_source, p_stripe_event_id, p_reason);
  perform private.log_stripe_event(p_stripe_event_id, v_event_type, v_order.livemode, v_order.stripe_checkout_session_id, p_order_id, 'applied');

  v_ent_status := private.order_access(p_order_id);
  v_outcome := 'applied';
  return query select v_outcome, p_order_id, v_order.status, p_new_status, v_ent_status;
end $$;

-- ===== 4. Pedidos no admin ========================================================================================
-- Lista: 50 por página, o mais novo primeiro, só os do modo da chave da Stripe (teste ou produção). A busca acha pelo
-- código do pedido (8 caracteres, com ou sem #) ou por parte do e-mail (o atual da conta, ou o do pedido se a conta saiu).
create function public.admin_list_orders(p_user_id uuid, p_query text, p_filter text, p_livemode boolean, p_offset integer)
  returns table (outcome text, result jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_query text := nullif(lower(btrim(coalesce(p_query, ''))), '');
  v_ref   text;
begin
  if p_user_id is null or p_filter is null or p_livemode is null
     or p_filter not in ('all', 'paid', 'pending', 'abandoned', 'refunded', 'disputed', 'courtesy')
     or p_offset is null or p_offset not between 0 and 1000000 or char_length(coalesce(p_query, '')) > 200 then
    raise exception 'admin_list_orders: argumentos inválidos' using errcode = 'KT001';
  end if;
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  v_ref := case when v_query ~ '^#?[0-9a-f]{8}$' then upper(ltrim(v_query, '#')) end;

  return query
  with listed as (
    select o.id, o.kind, o.status, o.created_at, o.paid_at, o.amount_total, o.currency, o.promotion_code, o.user_id,
           coalesce(private.normalize_email(u.email), o.email) as email
      from public.orders o
      left join auth.users u on u.id = o.user_id and u.deleted_at is null
     where o.livemode = p_livemode
       and case p_filter
             when 'paid'      then o.kind = 'purchase' and o.status = 'paid'
             when 'pending'   then o.status in ('open', 'pending_payment')
             when 'abandoned' then o.status in ('expired', 'failed')
             when 'refunded'  then o.status = 'refunded'
             when 'disputed'  then o.status in ('disputed', 'dispute_lost')
             when 'courtesy'  then o.kind = 'courtesy'
             else true end
       and (v_query is null
            or (v_ref is not null and private.order_ref(o.id) = v_ref)
            or position(v_query in lower(coalesce(u.email, o.email, ''))) > 0)
  )
  select 'ok'::text, jsonb_build_object(
    'total', (select count(*) from listed),
    'offset', p_offset,
    'limit', 50,
    'orders', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'ref', private.order_ref(l.id), 'kind', l.kind, 'status', l.status, 'email', l.email,
        'user_id', l.user_id, 'created_at', l.created_at, 'paid_at', l.paid_at,
        'amount_total', l.amount_total, 'currency', l.currency, 'promotion_code', l.promotion_code,
        'items', coalesce((select jsonb_agg(coalesce(p.name, p.code) order by i.position)
                             from public.order_items i join public.products p on p.id = i.product_id
                            where i.order_id = l.id), '[]'::jsonb))
        order by l.created_at desc, l.id)
      from (select * from listed order by created_at desc, id limit 50 offset p_offset) l), '[]'::jsonb));
end $$;

-- Ficha do pedido: valores, a pessoa, os itens, a linha do tempo, os jogos liberados, os downloads depois do pagamento,
-- os e-mails, o histórico do admin e o que dá para fazer (reenviar o acesso, reembolsar, conferir com a Stripe).
create function public.admin_get_order(p_user_id uuid, p_order_id uuid) returns table (outcome text, result jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_order public.orders%rowtype;
  v_email text;
begin
  if p_user_id is null or p_order_id is null then
    raise exception 'admin_get_order: p_user_id e p_order_id são obrigatórios' using errcode = 'KT001';
  end if;
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  select * into v_order from public.orders o where o.id = p_order_id;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  select private.normalize_email(u.email) into v_email from auth.users u where u.id = v_order.user_id and u.deleted_at is null;

  return query select 'ok'::text, jsonb_build_object(
    'order', jsonb_build_object(
      'id', v_order.id, 'ref', private.order_ref(v_order.id), 'kind', v_order.kind, 'status', v_order.status,
      'created_at', v_order.created_at, 'paid_at', v_order.paid_at, 'refunded_at', v_order.refunded_at,
      'checkout_expires_at', v_order.checkout_expires_at,
      'amount_subtotal', v_order.amount_subtotal, 'amount_discount', v_order.amount_discount,
      'amount_total', v_order.amount_total, 'currency', v_order.currency, 'promotion_code', v_order.promotion_code,
      'livemode', v_order.livemode, 'terms_version', v_order.terms_version, 'terms_accepted_at', v_order.terms_accepted_at,
      'stripe_checkout_session_id', v_order.stripe_checkout_session_id, 'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
      'deliverable', v_order.status = 'paid'
                     and not exists (select 1 from public.entitlements x where x.order_id = v_order.id and x.status <> 'active'),
      'refundable', v_order.kind = 'purchase' and v_order.status = 'paid'
                    and v_order.stripe_payment_intent_id is not null and coalesce(v_order.amount_total, 0) > 0,
      'reconcilable', v_order.kind = 'purchase' and v_order.status in ('open', 'pending_payment', 'expired')
                      and v_order.stripe_checkout_session_id is not null),
    'person', jsonb_build_object(
      'id', v_order.user_id, 'email', v_email, 'order_email', v_order.email, 'exists', v_email is not null,
      'stripe_customer_id', (select pf.stripe_customer_id from public.profiles pf where pf.user_id = v_order.user_id)),
    'items', coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'kind', p.kind,
                                                           'unit_amount', i.unit_amount, 'currency', i.currency)
                                        order by i.position)
                         from public.order_items i join public.products p on p.id = i.product_id
                        where i.order_id = v_order.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('from_status', ev.from_status, 'to_status', ev.to_status,
                                                            'source', ev.source, 'reason', ev.reason, 'created_at', ev.created_at)
                                         order by ev.created_at, ev.id)
                          from public.order_events ev where ev.order_id = v_order.id), '[]'::jsonb),
    'entitlements', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'status', e.status, 'revoke_reason', e.revoke_reason, 'granted_at', e.granted_at, 'revoked_at', e.revoked_at,
        'product', jsonb_build_object('code', p.code, 'name', p.name, 'kind', p.kind),
        'games', coalesce((select jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name) order by eg.position)
                             from public.entitlement_games eg join public.games g on g.id = eg.game_id
                            where eg.entitlement_id = e.id), '[]'::jsonb))
        order by e.granted_at, e.id)
      from public.entitlements e join public.products p on p.id = e.product_id
     where e.order_id = v_order.id), '[]'::jsonb),
    'downloads', (select jsonb_build_object('count', count(*), 'last_at', max(d.created_at))
                    from public.download_events d join public.files f on f.id = d.file_id
                   where d.user_id = v_order.user_id and d.kind = 'paid' and d.created_at >= v_order.paid_at
                     and f.game_id in (select eg.game_id from public.entitlements e
                                         join public.entitlement_games eg on eg.entitlement_id = e.id
                                        where e.order_id = v_order.id)),
    'emails', coalesce((select jsonb_agg(jsonb_build_object('kind', x.kind, 'status', x.status, 'skip_reason', x.skip_reason,
                                                            'created_at', x.created_at, 'sent_at', x.sent_at)
                                         order by x.created_at desc, x.id)
                          from public.email_outbox x where x.order_id = v_order.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object(
        'action', a.action, 'created_at', a.created_at, 'details', a.details,
        'by', (select u.email from auth.users u where u.id = a.user_id))
        order by a.created_at desc, a.id desc)
      from private.admin_events a where a.details ->> 'order_id' = v_order.id::text), '[]'::jsonb));
end $$;

-- O que a API precisa para falar com a Stripe sobre um pedido (reembolsar ou conferir a sessão). Quem decide se o
-- pedido muda são set_order_status e fulfill_order, que conferem de novo dentro da transação delas.
create function public.admin_order_stripe(p_user_id uuid, p_order_id uuid)
  returns table (outcome text, ref text, kind text, status text, livemode boolean, user_id uuid,
                 checkout_session_id text, payment_intent_id text, amount_total bigint, currency text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if p_user_id is null or p_order_id is null then
    raise exception 'admin_order_stripe: p_user_id e p_order_id são obrigatórios' using errcode = 'KT001';
  end if;
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::text, null::text, null::text, null::boolean, null::uuid, null::text, null::text, null::bigint, null::text;
    return;
  end if;
  return query
  select 'ok'::text, private.order_ref(o.id), o.kind, o.status, o.livemode, o.user_id,
         o.stripe_checkout_session_id, o.stripe_payment_intent_id, o.amount_total, o.currency
    from public.orders o where o.id = p_order_id;
  if not found then
    return query select 'not_found'::text, null::text, null::text, null::text, null::boolean, null::uuid, null::text, null::text, null::bigint, null::text;
  end if;
end $$;

-- Histórico do admin de uma ação num pedido, gravado depois que a Stripe aceitou (reembolso) ou que a sessão foi
-- conferida. Vai também para a ficha da pessoa (target_id é o dono). No reembolso, devolve o aviso que está na fila,
-- para a API mandar na hora.
create function public.admin_log_order_action(p_user_id uuid, p_order_id uuid, p_action text, p_reason text, p_details jsonb)
  returns table (outcome text, outbox_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_reason text;
  v_owner  uuid;
begin
  if p_user_id is null or p_order_id is null or p_action is null or p_action not in ('order_refund', 'order_reconcile')
     or p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'admin_log_order_action: argumentos inválidos' using errcode = 'KT001';
  end if;
  v_reason := private.admin_reason(p_reason);
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::uuid;
    return;
  end if;
  select o.user_id into v_owner from public.orders o where o.id = p_order_id;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  insert into private.admin_events (user_id, action, target_id, details)
  values (p_user_id, p_action, v_owner,
          p_details || jsonb_build_object('order_id', p_order_id, 'order_ref', private.order_ref(p_order_id), 'reason', v_reason));
  return query select 'ok'::text,
    (select x.id from public.email_outbox x
      where p_action = 'order_refund' and x.dedupe_key = 'refund:' || p_order_id::text and x.status = 'queued');
end $$;

do $$
declare sig text;
begin
  foreach sig in array array[
    'admin_list_orders(uuid, text, text, boolean, integer)', 'admin_get_order(uuid, uuid)',
    'admin_order_stripe(uuid, uuid)', 'admin_log_order_action(uuid, uuid, text, text, jsonb)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', sig);
    execute format('grant execute on function public.%s to service_role', sig);
  end loop;
end $$;
