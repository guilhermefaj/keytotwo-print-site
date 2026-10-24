-- Backup do banco e alertas do admin (2026-10-24, decisões do responsável): uma cópia por noite, feita pela VPS com um
-- papel só de leitura, e o que precisa de atenção num lugar só, com e-mail para os admins quando aparece algo novo.
--   1. o papel backup_ro e o registro de cada cópia (o alerta de backup atrasado confere este registro);
--   2. private.admin_alerts: um alerta por coisa, que fecha sozinho quando o problema se resolve;
--   3. o e-mail admin_alert (transacional, sem pedido), para cada admin, quando abre alerta novo;
--   4. a varredura, que roda no dispatch_tick (a cada 5 minutos), e a contestação aberta na hora pelo webhook;
--   5. RPCs do admin: admin_list_alerts e admin_resolve_alert.

-- ===== 1. Backup ===================================================================================================
-- O backup noturno da VPS (deploy/backup) entra com este papel: lê tudo (pg_read_all_data; BYPASSRLS para o pg_dump ver
-- as linhas das tabelas com RLS) e não escreve nada, fora o registro da cópia. A senha não fica aqui (o repositório é
-- público): é definida direto no banco hospedado. Sem senha, o papel não entra.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'backup_ro') then
    create role backup_ro with login bypassrls;
  end if;
end $$;
grant pg_read_all_data to backup_ro;

create table private.backup_runs (
  id          bigint      generated always as identity primary key,
  object_key  text        not null,
  bytes       bigint      not null,
  finished_at timestamptz not null default now(),
  constraint backup_runs_object_key_check check (char_length(object_key) between 1 and 200),
  constraint backup_runs_bytes_check check (bytes > 0)
);
revoke all on table private.backup_runs from public, anon, authenticated, service_role;
revoke all on sequence private.backup_runs_id_seq from public, anon, authenticated, service_role;

-- O job chama no fim de cada cópia enviada à B2. Guarda pouco mais de um ano de registros.
create function private.record_backup(p_object_key text, p_bytes bigint) returns void
language sql security definer set search_path = '' as $$
  delete from private.backup_runs r where r.finished_at < now() - interval '400 days';
  insert into private.backup_runs (object_key, bytes) values (p_object_key, p_bytes);
$$;
revoke all on function private.record_backup(text, bigint) from public, anon, authenticated, service_role;
grant execute on function private.record_backup(text, bigint) to backup_ro;

-- ===== 2. Alertas ==================================================================================================
-- A chave é única para sempre: cada coisa (a contestação, o e-mail, o pedido, o evento da Stripe, a última cópia) abre
-- um alerta uma vez só, e resolver à mão não faz a varredura abrir de novo. resolution = 'auto' quando fechou sozinho;
-- senão é o motivo de quem resolveu (resolved_by).
create table private.admin_alerts (
  id          bigint      generated always as identity primary key,
  kind        text        not null,
  alert_key   text        not null unique,
  order_id    uuid        references public.orders (id),
  user_id     uuid,
  details     jsonb       not null default '{}'::jsonb,
  opened_at   timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution  text,
  constraint admin_alerts_kind_check check (kind in ('dispute', 'delivery_failed', 'order_stuck', 'stripe_unmatched', 'email_queue_stuck', 'backup_late')),
  constraint admin_alerts_resolution_check check ((resolved_at is null) = (resolution is null) and (resolved_by is null or resolved_at is not null))
);
create index admin_alerts_open_idx on private.admin_alerts (kind) where resolved_at is null;
create index admin_alerts_resolved_idx on private.admin_alerts (resolved_at) where resolved_at is not null;
revoke all on table private.admin_alerts from public, anon, authenticated, service_role;
revoke all on sequence private.admin_alerts_id_seq from public, anon, authenticated, service_role;

alter table private.admin_events drop constraint admin_events_action_check;
alter table private.admin_events add constraint admin_events_action_check check (action in (
  'blog_create', 'blog_update', 'blog_publish', 'blog_unpublish', 'blog_delete', 'blog_image', 'blog_image_delete',
  'user_gift', 'user_revoke', 'user_resend', 'user_newsletter_off', 'user_block', 'user_unblock', 'user_export', 'user_delete',
  'user_admin_grant', 'user_admin_revoke', 'order_refund', 'order_reconcile', 'alert_resolve'));

-- Fila de e-mail parada e backup atrasado são do sistema: fecham só quando voltam a funcionar.
create function private.alert_is_systemic(p_kind text) returns boolean
language sql immutable set search_path = '' as $$
  select p_kind in ('email_queue_stuck', 'backup_late')
$$;

-- O alerta como a lista do admin e o e-mail mostram: o pedido (código, status e modo da Stripe) e quem resolveu.
create function private.alert_json(a private.admin_alerts) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', a.id, 'kind', a.kind, 'details', a.details, 'opened_at', a.opened_at,
    'order_id', a.order_id, 'order_ref', private.order_ref(a.order_id), 'order_status', o.status, 'livemode', o.livemode,
    'user_id', a.user_id, 'resolved_at', a.resolved_at, 'resolution', a.resolution,
    'resolved_by', (select u.email from auth.users u where u.id = a.resolved_by),
    'manual', not private.alert_is_systemic(a.kind))
    from (select 1) one left join public.orders o on o.id = a.order_id
$$;

-- O e-mail parado na fila há mais tempo, se algum está há mais de 30 minutos (o despacho roda a cada 5).
create function private.stuck_email(p_now timestamptz) returns uuid
language sql stable set search_path = '' as $$
  select x.id from public.email_outbox x
   where (x.status = 'queued' and x.scheduled_at < p_now - interval '30 minutes')
      or (x.status = 'sending' and x.locked_at < p_now - interval '30 minutes')
   order by coalesce(x.locked_at, x.scheduled_at), x.id
   limit 1
$$;

-- ===== 3. O e-mail dos admins ======================================================================================
alter table public.email_outbox
  drop constraint email_outbox_kind_check,
  drop constraint email_outbox_kind_category_check;
alter table public.email_outbox
  add constraint email_outbox_kind_check check (kind in ('delivery', 'gift', 'refund', 'admin_alert', 'cart_reminder', 'post_purchase')),
  add constraint email_outbox_kind_category_check check ((kind in ('delivery', 'gift', 'refund', 'admin_alert')) = (category = 'transactional'));

-- Um e-mail por admin (com o e-mail confirmado) com os alertas que acabaram de abrir. O mesmo alerta nunca manda dois:
-- a chave do e-mail é o primeiro alerta da leva.
create function private.notify_admins(p_alert_ids bigint[]) returns void
language sql set search_path = '' as $$
  insert into public.email_outbox (user_id, kind, category, to_email, payload, dedupe_key)
  select u.id, 'admin_alert', 'transactional', private.confirmed_email(u.id),
         jsonb_build_object('alerts', (select jsonb_agg(private.alert_json(a) order by a.id)
                                         from private.admin_alerts a where a.id = any (p_alert_ids))),
         'admin_alert:' || (select min(x) from unnest(p_alert_ids) x) || ':' || u.id
    from auth.users u
   where cardinality(p_alert_ids) > 0 and private.is_admin(u.id) and private.confirmed_email(u.id) is not null
  on conflict (dedupe_key) do nothing
$$;

-- claim_email_batch: a checagem de "pedido segue pago" vale só para entrega e presente (o resto é igual ao de antes).
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
    elsif r.kind in ('delivery', 'gift') then
      -- entrega e presente: só saem se o pedido segue pago e nenhum direito foi revogado. O aviso de reembolso sai
      -- justamente com o pedido reembolsado, e o alerta dos admins não é de um pedido.
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

-- ===== 4. A varredura e a contestação ==============================================================================
-- Fecha o que se resolveu e abre o que é novo (o pedido parado, o e-mail que não saiu, o evento da Stripe sem pedido,
-- dos últimos 7 dias). Roda no dispatch_tick: o e-mail dos admins sai no mesmo minuto. Apaga os alertas resolvidos
-- há mais de 180 dias. Devolve quantos abriu.
create function private.scan_admin_alerts(p_now timestamptz default now()) returns integer
language plpgsql set search_path = '' as $$
declare
  v_new bigint[];
begin
  update private.admin_alerts a
     set resolved_at = p_now, resolution = 'auto'
   where a.resolved_at is null
     and case a.kind
       when 'dispute' then (select o.status from public.orders o where o.id = a.order_id) <> 'disputed'
       when 'order_stuck' then (select o.status from public.orders o where o.id = a.order_id) not in ('open', 'pending_payment')
       -- um reenvio do mesmo e-mail saiu, ou a entrega deixou de valer (o pedido não está mais pago)
       when 'delivery_failed' then exists (
              select 1 from public.email_outbox x
               where x.order_id = a.order_id and x.kind = a.details->>'email_kind' and x.status = 'sent'
                 and x.created_at > (a.details->>'created_at')::timestamptz)
            or (a.details->>'email_kind' <> 'refund' and (select o.status from public.orders o where o.id = a.order_id) <> 'paid')
       when 'email_queue_stuck' then private.stuck_email(p_now) is null
       when 'backup_late' then (select max(r.finished_at) from private.backup_runs r) >= p_now - interval '26 hours'
       else false end;

  with candidates (kind, alert_key, order_id, user_id, details) as (
    -- contestação: a chave é a passagem para disputed, a mesma que o webhook usa ao abrir com o prazo
    select 'dispute', 'dispute:' || ev.id, o.id, o.user_id, '{}'::jsonb
      from public.orders o
      cross join lateral (select max(e.id) as id from public.order_events e where e.order_id = o.id and e.to_status = 'disputed') ev
     where o.status = 'disputed' and ev.id is not null
    union all
    -- acesso, presente ou aviso de reembolso que falhou de vez, ou que saiu e voltou (endereço que não recebe)
    select 'delivery_failed', 'email:' || x.id, x.order_id, x.user_id,
           jsonb_build_object('outbox_id', x.id, 'email_kind', x.kind, 'created_at', x.created_at,
                              'cause', case x.status when 'failed' then 'failed' else 'bounced' end, 'error', left(x.last_error, 200))
      from public.email_outbox x
     where x.kind in ('delivery', 'gift', 'refund') and x.created_at > p_now - interval '7 days'
       and (x.status = 'failed'
            or (x.status = 'sent' and exists (
                  select 1 from public.email_suppressions s
                   where s.reason = 'hard_bounce' and btrim(s.provider_message_id, '<>') = btrim(x.provider_message_id, '<>'))))
    union all
    -- pedido aberto há mais de 26 horas: a sessão da Stripe vence em 24, então o aviso dela não chegou
    select 'order_stuck', 'order:' || o.id, o.id, o.user_id, jsonb_build_object('status', o.status)
      from public.orders o
     where o.kind = 'purchase' and o.status in ('open', 'pending_payment') and o.stripe_checkout_session_id is not null
       and o.created_at > p_now - interval '7 days' and o.created_at < p_now - interval '26 hours'
    union all
    -- a Stripe confirmou o pagamento de um pedido que não existe aqui
    select 'stripe_unmatched', 'stripe:' || e.id, null, null,
           jsonb_build_object('event_id', e.id, 'type', e.type, 'object_id', e.stripe_object_id, 'livemode', e.livemode)
      from public.stripe_events e
     where e.outcome = 'not_found' and e.received_at > p_now - interval '7 days'
    union all
    -- fila de e-mail parada: um alerta por vez (a chave é o e-mail parado há mais tempo), que fecha quando a fila anda
    select 'email_queue_stuck', 'email_queue:' || s.id, null, null, '{}'::jsonb
      from (select private.stuck_email(p_now) as id) s
     where s.id is not null
       and not exists (select 1 from private.admin_alerts a where a.kind = 'email_queue_stuck' and a.resolved_at is null)
    union all
    -- backup atrasado: a chave é a última cópia, então só abre de novo se atrasar depois de outra cópia
    select 'backup_late', 'backup:' || b.id, null, null, jsonb_build_object('last_finished_at', b.finished_at)
      from (select r.id, r.finished_at from private.backup_runs r order by r.id desc limit 1) b
     where b.finished_at < p_now - interval '26 hours'
  ), opened as (
    insert into private.admin_alerts (kind, alert_key, order_id, user_id, details, opened_at)
    select c.kind, c.alert_key, c.order_id, c.user_id, c.details, p_now from candidates c
     where not exists (select 1 from private.admin_alerts a where a.alert_key = c.alert_key)
    on conflict (alert_key) do nothing
    returning id
  )
  select array_agg(id order by id) into v_new from opened;

  perform private.notify_admins(v_new);
  delete from private.admin_alerts a where a.resolved_at < p_now - interval '180 days';
  return coalesce(cardinality(v_new), 0);
end $$;
revoke all on function private.scan_admin_alerts(timestamptz) from public, anon, authenticated, service_role;

-- O webhook abre a contestação na hora, com o prazo das provas e o id da Stripe. Se a varredura chegou antes, só
-- completa os detalhes (o e-mail já saiu). Pedido que não está em contestação não abre nada.
create function public.record_dispute_alert(
  p_order_id   uuid,
  p_dispute_id text,
  p_due_by     timestamptz,
  p_amount     bigint,
  p_currency   text,
  p_reason     text
) returns table (outcome text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_user    uuid;
  v_event   bigint;
  v_id      bigint;
  v_details jsonb;
begin
  if p_order_id is null or p_dispute_id is null or p_dispute_id !~ '^dp_[A-Za-z0-9_]+$'
     or (p_currency is not null and p_currency !~ '^[a-z]{3}$') or p_amount < 0
     or (p_reason is not null and char_length(p_reason) > 100) then
    raise exception 'record_dispute_alert: argumentos inválidos' using errcode = 'KT001';
  end if;
  select o.user_id, (select max(e.id) from public.order_events e where e.order_id = o.id and e.to_status = 'disputed')
    into v_user, v_event
    from public.orders o where o.id = p_order_id and o.status = 'disputed';
  if v_event is null then
    return query select 'not_disputed'::text;
    return;
  end if;
  v_details := jsonb_strip_nulls(jsonb_build_object(
    'dispute_id', p_dispute_id, 'due_by', p_due_by, 'amount', p_amount, 'currency', p_currency, 'reason', p_reason));
  insert into private.admin_alerts (kind, alert_key, order_id, user_id, details)
  values ('dispute', 'dispute:' || v_event, p_order_id, v_user, v_details)
  on conflict (alert_key) do nothing
  returning id into v_id;
  if v_id is not null then
    perform private.notify_admins(array[v_id]);
  else
    update private.admin_alerts a set details = a.details || v_details where a.alert_key = 'dispute:' || v_event;
  end if;
  return query select 'ok'::text;
end $$;

-- ===== 5. RPCs do admin ============================================================================================
-- Os abertos (todos) e os resolvidos nos últimos 30 dias (até 100), do mais novo ao mais antigo.
create function public.admin_list_alerts(p_user_id uuid) returns table (outcome text, alerts jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_user_id is null then
    raise exception 'admin_list_alerts: argumentos inválidos' using errcode = 'KT001';
  end if;
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  return query select 'ok'::text, jsonb_build_object(
    'open', coalesce((select jsonb_agg(private.alert_json(a) order by a.opened_at desc, a.id desc)
                        from private.admin_alerts a where a.resolved_at is null), '[]'::jsonb),
    'resolved', coalesce((select jsonb_agg(private.alert_json(r) order by r.resolved_at desc, r.id desc)
                            from (select * from private.admin_alerts a where a.resolved_at > now() - interval '30 days'
                                   order by a.resolved_at desc, a.id desc limit 100) r), '[]'::jsonb));
end $$;

-- Resolver à mão, com motivo (vai para o histórico, com o dono do pedido como alvo). Os do sistema fecham sozinhos.
create function public.admin_resolve_alert(p_user_id uuid, p_alert_id bigint, p_reason text) returns table (outcome text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_reason text;
  v_alert  private.admin_alerts%rowtype;
begin
  if p_user_id is null or p_alert_id is null then
    raise exception 'admin_resolve_alert: argumentos inválidos' using errcode = 'KT001';
  end if;
  v_reason := private.admin_reason(p_reason);
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text;
    return;
  end if;
  select * into v_alert from private.admin_alerts a where a.id = p_alert_id for update;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;
  if v_alert.resolved_at is not null or private.alert_is_systemic(v_alert.kind) then
    return query select 'not_resolvable'::text;
    return;
  end if;
  update private.admin_alerts a set resolved_at = now(), resolved_by = p_user_id, resolution = v_reason where a.id = p_alert_id;
  insert into private.admin_events (user_id, action, target_id, details)
  values (p_user_id, 'alert_resolve', v_alert.user_id, jsonb_strip_nulls(jsonb_build_object(
    'alert_id', v_alert.id, 'kind', v_alert.kind, 'order_id', v_alert.order_id,
    'order_ref', private.order_ref(v_alert.order_id), 'reason', v_reason)));
  return query select 'ok'::text;
end $$;

do $$
declare sig text;
begin
  foreach sig in array array[
    'record_dispute_alert(uuid, text, timestamptz, bigint, text, text)', 'admin_list_alerts(uuid)',
    'admin_resolve_alert(uuid, bigint, text)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', sig);
    execute format('grant execute on function public.%s to service_role', sig);
  end loop;
end $$;

do $$
declare sig text;
begin
  foreach sig in array array['alert_is_systemic(text)', 'alert_json(private.admin_alerts)', 'stuck_email(timestamptz)', 'notify_admins(bigint[])']
  loop
    execute format('revoke all on function private.%s from public, anon, authenticated, service_role', sig);
  end loop;
end $$;

-- dispatch_tick: a varredura dos alertas entra antes do despacho, então o e-mail dos admins sai no mesmo minuto
-- (o resto é igual ao de antes). Falha na varredura não impede o despacho.
create or replace function private.dispatch_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_key text;
begin
  begin
    perform private.enqueue_followups();
  exception when others then
    raise warning 'dispatch_tick: enqueue_followups falhou (%): %', sqlstate, sqlerrm;
  end;

  begin
    perform private.scan_admin_alerts();
  exception when others then
    raise warning 'dispatch_tick: scan_admin_alerts falhou (%): %', sqlstate, sqlerrm;
  end;

  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'email_dispatch_url';
  select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.name = 'email_dispatch_key';
  if coalesce(v_url, '') = '' or coalesce(v_key, '') = '' then
    raise warning 'dispatch_tick: faltam os segredos email_dispatch_url e/ou email_dispatch_key no Vault; só enfileirei, o despacho não foi chamado';
    return;
  end if;

  begin
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_key),
      body    := jsonb_build_object('limit', 20));
  exception when others then
    raise warning 'dispatch_tick: a chamada do despacho falhou (%): %', sqlstate, sqlerrm;
  end;
end $$;
