-- Alertas do Plunk (2026-11-01, responsável): o painel e o e-mail dos admins passam a avisar também quando
--   1. o Plunk está fora do ar: a checagem de 5 em 5 minutos ganha o alvo plunk (a API dele responde e acha o banco);
--   2. inscrições não chegam ao Plunk: alguém com opt-in está há mais de 1 hora sem ir para lá (as boas-vindas não saem);
--   3. o backup do Plunk atrasou: a cópia dele não chega há mais de 26 horas (o backup.sh registra as duas cópias).
-- O e-mail dos alertas sai direto pelo Amazon SES (email.ts), sem passar pelo Plunk na VPS: com a VPS fora, o aviso sai.

-- ===== 1. Backup: a cópia de cada banco ============================================================================
-- target vem do nome do arquivo (o backup.sh envia o do Plunk como diario/plunk-…), sem mudar a chamada do job.
alter table private.backup_runs add column target text not null default 'supabase';
update private.backup_runs set target = 'plunk' where object_key like 'diario/plunk-%';
alter table private.backup_runs add constraint backup_runs_target_check check (target in ('supabase', 'plunk'));

create or replace function private.record_backup(p_object_key text, p_bytes bigint) returns void
language sql security definer set search_path = '' as $$
  delete from private.backup_runs r where r.finished_at < now() - interval '400 days';
  insert into private.backup_runs (object_key, bytes, target)
  values (p_object_key, p_bytes, case when p_object_key like 'diario/plunk-%' then 'plunk' else 'supabase' end);
$$;

-- ===== 2. A checagem do Plunk ======================================================================================
alter table private.uptime_checks drop constraint uptime_checks_target_check;
alter table private.uptime_checks add constraint uptime_checks_target_check check (target in ('site', 'store', 'plunk'));

create or replace function public.record_uptime_checks(p_checks jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_checks is null or jsonb_typeof(p_checks) <> 'array' or jsonb_array_length(p_checks) not between 1 and 3
     or exists (select 1 from jsonb_array_elements(p_checks) c
                 where jsonb_typeof(c) <> 'object' or coalesce(c->>'target', '') not in ('site', 'store', 'plunk')
                    or jsonb_typeof(c->'ok') is distinct from 'boolean') then
    raise exception 'record_uptime_checks: checagens inválidas' using errcode = 'KT001';
  end if;
  insert into private.uptime_checks (target, ok, error)
  select c->>'target', (c->>'ok')::boolean,
         case when (c->>'ok')::boolean then null else left(coalesce(nullif(c->>'error', ''), 'falhou'), 200) end
    from jsonb_array_elements(p_checks) c;
  delete from private.uptime_checks u where u.checked_at < now() - interval '30 days';
end $$;

-- ===== 3. Os alertas novos =========================================================================================
alter table private.admin_alerts drop constraint admin_alerts_kind_check;
alter table private.admin_alerts add constraint admin_alerts_kind_check
  check (kind in ('dispute', 'delivery_failed', 'order_stuck', 'stripe_unmatched', 'email_queue_stuck', 'backup_late', 'terms_missing',
                  'site_down', 'marketing_sync_stuck', 'plunk_backup_late'));

create or replace function private.alert_is_systemic(p_kind text) returns boolean
language sql immutable set search_path = '' as $$
  select p_kind in ('email_queue_stuck', 'backup_late', 'site_down', 'marketing_sync_stuck', 'plunk_backup_late')
$$;

-- Quem está há mais de 1 hora sem chegar ao Plunk, com erro (o envio tenta de novo, cada vez mais espaçado, até 6
-- horas). dirty_at é a última mudança da pessoa: uma mudança nova recomeça a contagem. Sem erro (a marca esperando,
-- fora do modo plunk) não conta. O mais antigo vem primeiro: ele é a chave do alerta.
create function private.stuck_marketing_contacts(p_now timestamptz)
returns table (user_id uuid, dirty_at timestamptz, last_error text, total bigint)
language sql stable set search_path = '' as $$
  select m.user_id, m.dirty_at, m.last_error, count(*) over ()
    from private.marketing_contacts m
   where m.dirty_at is not null and m.last_error is not null and m.dirty_at < p_now - interval '1 hour'
   order by m.dirty_at, m.user_id
   limit 1
$$;
revoke all on function private.stuck_marketing_contacts(timestamptz) from public, anon, authenticated, service_role;

-- A varredura (2026-11-01): o backup atrasado olha só a cópia do Supabase; o do Plunk tem o alerta dele (só depois da
-- primeira cópia registrada); o Plunk entra na checagem de fora do ar, com o e-mail de volta; e as inscrições paradas.
-- O resto é igual ao de 2026-10-26.
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
         when 'backup_late' then (select max(r.finished_at) from private.backup_runs r where r.target = 'supabase') >= p_now - interval '26 hours'
         when 'plunk_backup_late' then (select max(r.finished_at) from private.backup_runs r where r.target = 'plunk') >= p_now - interval '26 hours'
         when 'marketing_sync_stuck' then not exists (select 1 from private.stuck_marketing_contacts(p_now))
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
    -- inscrições paradas: um alerta por vez, como a fila (a chave é a pessoa parada há mais tempo e a mudança dela).
    -- Vai o número de pessoas e o último erro, sem e-mail.
    select 'marketing_sync_stuck', 'marketing_sync:' || s.user_id || ':' || extract(epoch from s.dirty_at)::bigint, null, null,
           jsonb_build_object('count', s.total, 'since', s.dirty_at, 'error', s.last_error)
      from private.stuck_marketing_contacts(p_now) s
     where not exists (select 1 from private.admin_alerts a where a.kind = 'marketing_sync_stuck' and a.resolved_at is null)
    union all
    -- backup atrasado: a chave é a última cópia, então só abre de novo se atrasar depois de outra cópia
    select 'backup_late', 'backup:' || b.id, null, null, jsonb_build_object('last_finished_at', b.finished_at)
      from (select r.id, r.finished_at from private.backup_runs r where r.target = 'supabase' order by r.id desc limit 1) b
     where b.finished_at < p_now - interval '26 hours'
    union all
    -- o mesmo para a cópia do Plunk, que começa a contar na primeira registrada
    select 'plunk_backup_late', 'plunk_backup:' || b.id, null, null, jsonb_build_object('last_finished_at', b.finished_at)
      from (select r.id, r.finished_at from private.backup_runs r where r.target = 'plunk' order by r.id desc limit 1) b
     where b.finished_at < p_now - interval '26 hours'
    union all
    -- site, loja ou Plunk fora do ar: as duas últimas checagens do alvo falharam (uma só pode ser a rede). A chave é a
    -- primeira falha da sequência: cada queda abre um alerta só, que fecha quando uma checagem passa.
    select 'site_down', 'site_down:' || f.first_id, null, null,
           jsonb_build_object('target', t.target, 'since', f.since, 'error', f.error)
      from (values ('site'), ('store'), ('plunk')) t (target)
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
