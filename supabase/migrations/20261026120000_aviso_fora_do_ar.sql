-- Aviso de site fora do ar (2026-10-26): a cada 5 minutos a api confere o que quem compra usa (o site abre; a loja lista
-- os produtos com preço) e grava aqui. A varredura dos alertas abre "fora do ar" depois de duas falhas seguidas, ou se a
-- checagem parar de chegar, e os admins recebem um e-mail quando abre e outro quando volta.
--   1. private.uptime_checks e record_uptime_checks (a api grava cada rodada);
--   2. a agenda: uptime_tick chama POST /internal/uptime;
--   3. o alerta site_down na varredura e o e-mail de volta.

-- ===== 1. As checagens =============================================================================================
create table private.uptime_checks (
  id         bigint      generated always as identity primary key,
  target     text        not null,
  ok         boolean     not null,
  error      text,
  checked_at timestamptz not null default now(),
  constraint uptime_checks_target_check check (target in ('site', 'store')),
  constraint uptime_checks_error_check check ((error is null) = ok and char_length(error) <= 200)
);
create index uptime_checks_target_idx on private.uptime_checks (target, id);
revoke all on table private.uptime_checks from public, anon, authenticated, service_role;
revoke all on sequence private.uptime_checks_id_seq from public, anon, authenticated, service_role;

-- A api grava uma linha por alvo a cada rodada e apaga o que passou de 30 dias.
create function public.record_uptime_checks(p_checks jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_checks is null or jsonb_typeof(p_checks) <> 'array' or jsonb_array_length(p_checks) not between 1 and 2
     or exists (select 1 from jsonb_array_elements(p_checks) c
                 where jsonb_typeof(c) <> 'object' or coalesce(c->>'target', '') not in ('site', 'store')
                    or jsonb_typeof(c->'ok') is distinct from 'boolean') then
    raise exception 'record_uptime_checks: checagens inválidas' using errcode = 'KT001';
  end if;
  insert into private.uptime_checks (target, ok, error)
  select c->>'target', (c->>'ok')::boolean,
         case when (c->>'ok')::boolean then null else left(coalesce(nullif(c->>'error', ''), 'falhou'), 200) end
    from jsonb_array_elements(p_checks) c;
  delete from private.uptime_checks u where u.checked_at < now() - interval '30 days';
end $$;
revoke all on function public.record_uptime_checks(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.record_uptime_checks(jsonb) to service_role;

-- ===== 2. A agenda =================================================================================================
-- Chama a checagem na api com o segredo do despacho (os mesmos do Vault que o dispatch_tick usa). A checagem leva até
-- uns 10 segundos (o site e a Stripe); 30 de folga para a resposta.
create function private.uptime_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_key text;
begin
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'email_dispatch_url';
  select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.name = 'email_dispatch_key';
  if coalesce(v_url, '') = '' or coalesce(v_key, '') = '' then
    raise warning 'uptime_tick: faltam os segredos do despacho no Vault; a checagem do site não rodou';
    return;
  end if;
  perform net.http_post(
    url                  := regexp_replace(v_url, '/email-dispatch/?$', '/api/internal/uptime'),
    headers              := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_key),
    body                 := '{}'::jsonb,
    timeout_milliseconds := 30000);
end $$;
revoke all on function private.uptime_tick() from public, anon, authenticated, service_role;
select cron.schedule('uptime-tick', '*/5 * * * *', 'select private.uptime_tick()');

-- ===== 3. O alerta =================================================================================================
alter table private.admin_alerts drop constraint admin_alerts_kind_check;
alter table private.admin_alerts add constraint admin_alerts_kind_check
  check (kind in ('dispute', 'delivery_failed', 'order_stuck', 'stripe_unmatched', 'email_queue_stuck', 'backup_late', 'terms_missing', 'site_down'));

-- Fora do ar também é do sistema: fecha só quando volta a funcionar.
create or replace function private.alert_is_systemic(p_kind text) returns boolean
language sql immutable set search_path = '' as $$
  select p_kind in ('email_queue_stuck', 'backup_late', 'site_down')
$$;

-- p_back: o e-mail de que voltou a funcionar, quando um alerta de fora do ar fecha sozinho (a chave do e-mail é outra,
-- para não bater com a do aviso). O resto é igual ao de antes.
drop function private.notify_admins(bigint[]);
create function private.notify_admins(p_alert_ids bigint[], p_back boolean default false) returns void
language sql set search_path = '' as $$
  insert into public.email_outbox (user_id, kind, category, to_email, payload, dedupe_key)
  select u.id, 'admin_alert', 'transactional', private.confirmed_email(u.id),
         jsonb_build_object('alerts', (select jsonb_agg(private.alert_json(a) order by a.id)
                                         from private.admin_alerts a where a.id = any (p_alert_ids)),
                            'back', p_back),
         case when p_back then 'admin_alert_back:' else 'admin_alert:' end
           || (select min(x) from unnest(p_alert_ids) x) || ':' || u.id
    from auth.users u
   where cardinality(p_alert_ids) > 0 and private.is_admin(u.id) and private.confirmed_email(u.id) is not null
  on conflict (dedupe_key) do nothing
$$;
revoke all on function private.notify_admins(bigint[], boolean) from public, anon, authenticated, service_role;

-- A varredura (2026-10-26): o site_down abre e fecha pelas checagens, e o que fecha sozinho manda o e-mail de volta. O
-- resto é igual ao de antes.
create or replace function private.scan_admin_alerts(p_now timestamptz default now()) returns integer
language plpgsql set search_path = '' as $$
declare
  v_new  bigint[];
  v_back bigint[];
begin
  with closed as (
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
         -- a última checagem do alvo passou; a checagem parada, quando volta a chegar
         when 'site_down' then case a.details->>'target'
           when 'monitor' then exists (select 1 from private.uptime_checks c
                                        where c.checked_at between p_now - interval '15 minutes' and p_now)
           else coalesce((select c.ok from private.uptime_checks c
                           where c.target = a.details->>'target' and c.checked_at <= p_now order by c.id desc limit 1), false) end
         else false end
    returning a.id, a.kind
  )
  select array_agg(c.id order by c.id) filter (where c.kind = 'site_down') into v_back from closed c;

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
    -- pago sem o "Li e aceito" gravado (2026-10-25): só quem destrava o formulário à mão chega aqui. Fecha à mão.
    select 'terms_missing', 'terms:' || o.id, o.id, o.user_id, '{}'::jsonb
      from public.orders o
     where o.kind = 'purchase' and o.status = 'paid' and o.terms_accepted_at is null
       and o.paid_at > p_now - interval '7 days'
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
    union all
    -- site ou loja fora do ar: as duas últimas checagens do alvo falharam (uma só pode ser a rede). A chave é a
    -- primeira falha da sequência: cada queda abre um alerta só, que fecha quando uma checagem passa.
    select 'site_down', 'site_down:' || f.first_id, null, null,
           jsonb_build_object('target', t.target, 'since', f.since, 'error', f.error)
      from (values ('site'), ('store')) t (target)
      cross join lateral (
        select min(c.id) as first_id, min(c.checked_at) as since, count(*) as failures,
               (array_agg(c.error order by c.id desc))[1] as error
          from private.uptime_checks c
         where c.target = t.target and c.checked_at <= p_now
           and c.id > coalesce((select max(k.id) from private.uptime_checks k
                                 where k.target = t.target and k.ok and k.checked_at <= p_now), 0)
      ) f
     where f.failures >= 2
    union all
    -- a checagem parou de chegar há mais de 15 minutos (três rodadas): a api, que faz a checagem, pode estar fora
    select 'site_down', 'site_down:monitor:' || l.id, null, null, jsonb_build_object('target', 'monitor', 'since', l.checked_at)
      from (select c.id, c.checked_at from private.uptime_checks c where c.checked_at <= p_now order by c.id desc limit 1) l
     where l.checked_at < p_now - interval '15 minutes'
  ), opened as (
    insert into private.admin_alerts (kind, alert_key, order_id, user_id, details, opened_at)
    select c.kind, c.alert_key, c.order_id, c.user_id, c.details, p_now from candidates c
     where not exists (select 1 from private.admin_alerts a where a.alert_key = c.alert_key)
    on conflict (alert_key) do nothing
    returning id
  )
  select array_agg(id order by id) into v_new from opened;

  perform private.notify_admins(v_new);
  perform private.notify_admins(v_back, true);
  delete from private.admin_alerts a where a.resolved_at < p_now - interval '180 days';
  return coalesce(cardinality(v_new), 0);
end $$;
