-- 19_backup_alerts: backup do banco e alertas do admin (migração 20261024180000): o papel só de leitura do backup e o
-- registro das cópias; a varredura que abre cada alerta uma vez e fecha sozinha o que se resolveu; a contestação aberta
-- pelo webhook; o e-mail dos admins; a lista e o "resolver" do admin.
-- Roda com `supabase test db` (pgTAP). Dados de teste só existem dentro da transação (rollback no fim). Dentro da
-- transação o now() não anda: as horas entram pelo p_now da varredura ou direto nas linhas. Cada varredura e cada RPC
-- roda numa instrução própria (pg_temp.scan, res): a conferência na mesma instrução não veria o que ela gravou.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp): supabase/tests/database/helpers ===========
\ir helpers/base.psql
\ir helpers/fixtures.psql
\ir helpers/checkout.psql

create temp table res (k text primary key, j jsonb);
create function pg_temp.res(p_k text) returns jsonb language sql as $$ select j from pg_temp.res where k = p_k $$;
-- varredura com rótulo: guarda quantos alertas abriu
create function pg_temp.scan(p_k text, p_now timestamptz default now()) returns integer language sql as $$
  insert into pg_temp.res values (p_k, to_jsonb(private.scan_admin_alerts(p_now))) returning j::integer
$$;
create function pg_temp.opened(p_k text) returns integer language sql as $$ select pg_temp.res(p_k)::integer $$;
-- o alerta de uma chave; os e-mails de alerta do admin de teste; a entrega de um pedido
create function pg_temp.alert(p_key text) returns private.admin_alerts language sql as $$
  select * from private.admin_alerts where alert_key = p_key
$$;
create function pg_temp.mails_with(p_alert jsonb) returns bigint language sql as $$
  select count(*) from public.email_outbox
   where kind = 'admin_alert' and user_id = pg_temp.uid('aadm') and payload->'alerts' @> jsonb_build_array(p_alert)
$$;
create function pg_temp.delivery(p_order uuid) returns uuid language sql as $$
  select id from public.email_outbox where order_id = p_order and kind = 'delivery' order by created_at limit 1
$$;

-- ===== fixtures ====================================================================================
do $$
declare o uuid;
begin
  perform pg_temp.mk_user('aadm');
  update auth.users set raw_app_meta_data = jsonb_build_object('provider', 'email', 'admin', true) where id = pg_temp.uid('aadm');
  perform pg_temp.mk_user('aana');
  perform pg_temp.mk_user('abia');
  -- um produto por pedido de cada pessoa (quem já tem o jogo não compra de novo)
  perform pg_temp.mk_product('ASOLO', 'single', 1);
  perform pg_temp.mk_product('BSOLO', 'single', 1);
  perform pg_temp.mk_product('CSOLO', 'single', 1);
  o := pg_temp.buy(pg_temp.uid('aana'), array['ASOLO'], array[990]); insert into pg_temp.oids values ('falhou', o);
  o := pg_temp.buy(pg_temp.uid('abia'), array['ASOLO'], array[990]); insert into pg_temp.oids values ('voltou', o);
  o := pg_temp.buy(pg_temp.uid('aana'), array['BSOLO'], array[990]); insert into pg_temp.oids values ('contestado', o);
  o := pg_temp.buy(pg_temp.uid('abia'), array['BSOLO'], array[990]); insert into pg_temp.oids values ('contestado2', o);
  o := pg_temp.open_order(pg_temp.uid('abia'), array['CSOLO']); insert into pg_temp.oids values ('aberto', o);
  -- as entregas deste arquivo saem da fila (a fila parada é testada à parte)
  update public.email_outbox set status = 'sent', sent_at = now(), provider_message_id = '<' || id || '@relay.test>'
   where order_id in (select id from pg_temp.oids);
end $$;

-- ===== backup ======================================================================================
select pg_temp.assert('backup_ro entra, passa pela RLS e lê tudo por pg_read_all_data',
  (select rolcanlogin and rolbypassrls and not rolsuper and not rolcreaterole from pg_roles where rolname = 'backup_ro')
  and pg_has_role('backup_ro', 'pg_read_all_data', 'member'));
-- As permissões pelo catálogo, sem trocar de papel: no CI o postgres criou o backup_ro, mas não pode virar ele.
select pg_temp.assert('backup_ro lê as tabelas da loja e do Auth, e não escreve',
  has_table_privilege('backup_ro', 'public.orders', 'SELECT') and has_table_privilege('backup_ro', 'auth.users', 'SELECT')
  and has_table_privilege('backup_ro', 'private.admin_events', 'SELECT')
  and not has_table_privilege('backup_ro', 'public.orders', 'UPDATE') and not has_table_privilege('backup_ro', 'private.backup_runs', 'INSERT'));
select pg_temp.assert('backup_ro só executa o registro da cópia; service_role não registra',
  has_function_privilege('backup_ro', 'private.record_backup(text, bigint)', 'EXECUTE')
  and not has_function_privilege('backup_ro', 'private.confirmed_email(uuid)', 'EXECUTE')
  and not has_function_privilege('backup_ro', 'public.admin_list_alerts(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'private.record_backup(text, bigint)', 'EXECUTE'));
select private.record_backup('diario/pgtap.tar.gz.age', 1234);
select pg_temp.assert('a cópia ficou registrada',
  exists (select 1 from private.backup_runs where object_key = 'diario/pgtap.tar.gz.age' and bytes = 1234));

-- ===== e-mail que não saiu =========================================================================
update public.email_outbox set status = 'failed', attempts = 5, last_error = 'brevo_http_400', sent_at = null, provider_message_id = null
 where id = pg_temp.delivery(pg_temp.oid('falhou'));
-- o aviso de "endereço não recebe" vem sem os < > do Message-ID: o cruzamento ignora os dois
insert into public.email_suppressions (email, reason, source, provider_message_id, occurred_at)
select 'abia@pgtap.test', 'hard_bounce', 'brevo_webhook', pg_temp.delivery(pg_temp.oid('voltou')) || '@relay.test', now();
select pg_temp.scan('entregas');

select pg_temp.assert('varredura: abre a entrega que falhou e a que voltou (o pedido aberto ainda não)',
  pg_temp.opened('entregas') >= 2
  and (select kind = 'delivery_failed' and order_id = pg_temp.oid('falhou') and user_id = pg_temp.uid('aana') and resolved_at is null
              and details->>'cause' = 'failed' and details->>'email_kind' = 'delivery' and details->>'error' = 'brevo_http_400'
         from pg_temp.alert('email:' || pg_temp.delivery(pg_temp.oid('falhou'))))
  and (select details->>'cause' = 'bounced' from pg_temp.alert('email:' || pg_temp.delivery(pg_temp.oid('voltou'))))
  and (pg_temp.alert('order:' || pg_temp.oid('aberto'))).id is null);
select pg_temp.assert('e-mail do admin: um só, com os dois alertas, transacional e sem pedido',
  (select count(*) = 1 from public.email_outbox where kind = 'admin_alert' and user_id = pg_temp.uid('aadm'))
  and (select category = 'transactional' and order_id is null and status = 'queued' and to_email = 'aadm@pgtap.test'
              and payload->'alerts' @> jsonb_build_array(
                    jsonb_build_object('kind', 'delivery_failed', 'order_ref', private.order_ref(pg_temp.oid('falhou')), 'manual', true),
                    jsonb_build_object('kind', 'delivery_failed', 'order_ref', private.order_ref(pg_temp.oid('voltou'))))
         from public.email_outbox where kind = 'admin_alert' and user_id = pg_temp.uid('aadm')));
select pg_temp.assert('quem não é admin não recebe',
  not exists (select 1 from public.email_outbox where kind = 'admin_alert' and user_id in (pg_temp.uid('aana'), pg_temp.uid('abia'))));
select pg_temp.assert('a fila entrega o e-mail do admin (não é cancelado por não ter pedido)',
  (select count(*) = 1 from public.claim_email_batch(1, (select id from public.email_outbox where kind = 'admin_alert' and user_id = pg_temp.uid('aadm')))));

select pg_temp.scan('entregas de novo');
select pg_temp.assert('varredura de novo: nada abre duas vezes, nenhum e-mail a mais',
  pg_temp.opened('entregas de novo') = 0
  and (select count(*) = 1 from private.admin_alerts where alert_key = 'email:' || pg_temp.delivery(pg_temp.oid('falhou')))
  and (select count(*) = 1 from public.email_outbox where kind = 'admin_alert' and user_id = pg_temp.uid('aadm')));

-- o reenvio saiu: o alerta fecha sozinho
insert into public.email_outbox (user_id, order_id, kind, category, to_email, dedupe_key, status, sent_at, created_at)
values (pg_temp.uid('aana'), pg_temp.oid('falhou'), 'delivery', 'transactional', 'aana@pgtap.test', 'pgtap:reenvio', 'sent',
        now() + interval '1 minute', now() + interval '1 minute');
select pg_temp.scan('reenvio');
select pg_temp.assert('reenvio que saiu fecha o alerta da entrega (auto)',
  (select resolved_at is not null and resolution = 'auto' and resolved_by is null
     from pg_temp.alert('email:' || pg_temp.delivery(pg_temp.oid('falhou')))));

-- ===== fila parada =================================================================================
insert into public.email_outbox (user_id, kind, category, to_email, dedupe_key, scheduled_at)
values (pg_temp.uid('aana'), 'cart_reminder', 'marketing', 'aana@pgtap.test', 'pgtap:parado', now() - interval '31 minutes');
select pg_temp.scan('fila 1');
select pg_temp.scan('fila 2');
select pg_temp.assert('fila parada há mais de 30 minutos abre um alerta, uma vez só',
  pg_temp.opened('fila 1') >= 1 and pg_temp.opened('fila 2') = 0
  and (select alert_key = 'email_queue:' || (select id from public.email_outbox where dedupe_key = 'pgtap:parado')
         from private.admin_alerts where kind = 'email_queue_stuck' and resolved_at is null));
update public.email_outbox set status = 'sent', sent_at = now() where dedupe_key = 'pgtap:parado';
select pg_temp.scan('fila andou');
select pg_temp.assert('a fila andou: o alerta fecha sozinho',
  not exists (select 1 from private.admin_alerts where kind = 'email_queue_stuck' and resolved_at is null));

-- ===== backup atrasado =============================================================================
select pg_temp.assert('cópia recente: sem alerta', not exists (select 1 from private.admin_alerts where kind = 'backup_late'));
-- 27 horas depois: a última cópia atrasou (e o pedido aberto ficou parado, conferido abaixo)
select pg_temp.scan('27 horas', now() + interval '27 hours');
select pg_temp.assert('sem cópia há mais de 26 horas: abre o alerta da última cópia',
  (select details ? 'last_finished_at' and resolved_at is null
     from pg_temp.alert('backup:' || (select max(id) from private.backup_runs))));
select private.record_backup('diario/pgtap-2.tar.gz.age', 99);
select pg_temp.scan('cópia nova');
select pg_temp.assert('a cópia seguinte fecha o alerta sozinho',
  not exists (select 1 from private.admin_alerts where kind = 'backup_late' and resolved_at is null));

-- ===== pedido parado ===============================================================================
select pg_temp.assert('pedido aberto há mais de 26 horas abriu o alerta',
  (select kind = 'order_stuck' and order_id = pg_temp.oid('aberto') and details->>'status' = 'open' and resolved_at is null
     from pg_temp.alert('order:' || pg_temp.oid('aberto'))));
select pg_temp.setst(pg_temp.oid('aberto'), 'expired');
select pg_temp.scan('expirou', now() + interval '27 hours');
select pg_temp.assert('o pedido mudou de status: o alerta fecha sozinho',
  (select resolution = 'auto' from pg_temp.alert('order:' || pg_temp.oid('aberto'))));

-- ===== contestação =================================================================================
insert into pg_temp.res select 'sem contestação', jsonb_build_object('outcome', outcome)
  from public.record_dispute_alert(pg_temp.oid('contestado'), 'dp_PGTAP1', now(), 990, 'brl', 'fraudulent');
select pg_temp.assert('pedido sem contestação: o webhook não abre nada',
  pg_temp.res('sem contestação')->>'outcome' = 'not_disputed');
select pg_temp.expect('contestação com id inválido é KT001',
  $$select * from public.record_dispute_alert(pg_temp.oid('contestado'), 'xx_1', now(), 990, 'brl', 'fraudulent')$$, 'KT001');

select pg_temp.setst(pg_temp.oid('contestado'), 'disputed', '{"reason": "fraudulent"}');
select pg_temp.setst(pg_temp.oid('contestado2'), 'disputed', '{"reason": "fraudulent"}');
insert into pg_temp.res select 'webhook', jsonb_build_object('outcome', outcome)
  from public.record_dispute_alert(pg_temp.oid('contestado'), 'dp_PGTAP1', '2026-11-03T12:00:00Z', 990, 'brl', 'fraudulent');
select pg_temp.assert('o webhook abre a contestação na hora, com o prazo, e avisa o admin',
  pg_temp.res('webhook')->>'outcome' = 'ok'
  and (select kind = 'dispute' and details->>'dispute_id' = 'dp_PGTAP1' and (details->>'amount')::int = 990
              and (details->>'due_by')::timestamptz = '2026-11-03T12:00:00Z'
         from private.admin_alerts where order_id = pg_temp.oid('contestado'))
  and pg_temp.mails_with(jsonb_build_object('kind', 'dispute', 'order_id', pg_temp.oid('contestado'))) = 1);

insert into pg_temp.res select 'webhook de novo', jsonb_build_object('outcome', outcome)
  from public.record_dispute_alert(pg_temp.oid('contestado'), 'dp_PGTAP1', '2026-11-03T12:00:00Z', 990, 'brl', 'fraudulent');
select pg_temp.scan('contestações');
select pg_temp.assert('o webhook repetido não duplica; a varredura abre a contestação que o webhook não registrou',
  pg_temp.res('webhook de novo')->>'outcome' = 'ok' and pg_temp.opened('contestações') >= 1
  and (select count(*) = 1 from private.admin_alerts where order_id = pg_temp.oid('contestado'))
  and pg_temp.mails_with(jsonb_build_object('kind', 'dispute', 'order_id', pg_temp.oid('contestado'))) = 1
  and (select kind = 'dispute' and details = '{}'::jsonb and resolved_at is null
         from private.admin_alerts where order_id = pg_temp.oid('contestado2')));
select pg_temp.setst(pg_temp.oid('contestado'), 'paid', '{"reason": "dispute_won"}');
select pg_temp.scan('ganhou');
select pg_temp.assert('a contestação fechou: o alerta fecha sozinho',
  (select resolution = 'auto' from private.admin_alerts where order_id = pg_temp.oid('contestado')));

-- ===== evento da Stripe sem pedido =================================================================
insert into public.stripe_events (id, type, livemode, stripe_object_id, order_id, outcome)
values ('evt_PGTAP_semPedido', 'checkout.session.completed', true, 'cs_live_PGTAP_x', null, 'not_found');
select pg_temp.scan('stripe');
select pg_temp.assert('pagamento de um pedido que não existe aqui abre o alerta',
  (select kind = 'stripe_unmatched' and details->>'type' = 'checkout.session.completed' and (details->>'livemode')::boolean
     from pg_temp.alert('stripe:evt_PGTAP_semPedido')));

-- ===== lista e resolver ============================================================================
select pg_temp.assert('lista: forbidden para quem não é admin',
  (select outcome = 'forbidden' and alerts is null from public.admin_list_alerts(pg_temp.uid('aana'))));
select pg_temp.assert('lista: abertos e resolvidos, com o pedido e quem pode resolver',
  (select outcome = 'ok'
          and alerts->'open' @> jsonb_build_array(
                jsonb_build_object('kind', 'delivery_failed', 'order_id', pg_temp.oid('voltou'), 'order_status', 'paid', 'livemode', false, 'manual', true),
                jsonb_build_object('kind', 'stripe_unmatched', 'manual', true))
          and alerts->'resolved' @> jsonb_build_array(
                jsonb_build_object('kind', 'order_stuck', 'order_id', pg_temp.oid('aberto'), 'resolution', 'auto'),
                jsonb_build_object('kind', 'backup_late', 'manual', false))
     from public.admin_list_alerts(pg_temp.uid('aadm'))));

select pg_temp.expect('resolver sem motivo é KT001',
  format($$select * from public.admin_resolve_alert(%L, %s, ' a ')$$, pg_temp.uid('aadm'), (pg_temp.alert('stripe:evt_PGTAP_semPedido')).id), 'KT001');
select pg_temp.assert('resolver: forbidden, not_found e os do sistema não se resolvem à mão',
  (select outcome = 'forbidden' from public.admin_resolve_alert(pg_temp.uid('aana'), (pg_temp.alert('stripe:evt_PGTAP_semPedido')).id, 'Conferido na Stripe'))
  and (select outcome = 'not_found' from public.admin_resolve_alert(pg_temp.uid('aadm'), -1, 'Conferido na Stripe'))
  and (select outcome = 'not_resolvable' from public.admin_resolve_alert(pg_temp.uid('aadm'),
         (select max(id) from private.admin_alerts where kind = 'backup_late'), 'Conferido na VPS')));

insert into pg_temp.res select 'resolver', jsonb_build_object('outcome', outcome)
  from public.admin_resolve_alert(pg_temp.uid('aadm'), (pg_temp.alert('email:' || pg_temp.delivery(pg_temp.oid('voltou')))).id,
                                  '  Pediu outro e-mail pelo suporte  ');
select pg_temp.assert('resolver à mão: motivo, quem resolveu e o histórico do admin com o pedido',
  pg_temp.res('resolver')->>'outcome' = 'ok'
  and (select resolution = 'Pediu outro e-mail pelo suporte' and resolved_by = pg_temp.uid('aadm') and resolved_at is not null
         from pg_temp.alert('email:' || pg_temp.delivery(pg_temp.oid('voltou'))))
  and exists (select 1 from private.admin_events where user_id = pg_temp.uid('aadm') and action = 'alert_resolve'
                 and target_id = pg_temp.uid('abia') and details->>'order_ref' = private.order_ref(pg_temp.oid('voltou'))
                 and details->>'kind' = 'delivery_failed' and details->>'reason' = 'Pediu outro e-mail pelo suporte'));
insert into pg_temp.res select 'resolver de novo', jsonb_build_object('outcome', outcome)
  from public.admin_resolve_alert(pg_temp.uid('aadm'), (pg_temp.alert('email:' || pg_temp.delivery(pg_temp.oid('voltou')))).id, 'De novo');
select pg_temp.scan('depois de resolver');
select pg_temp.assert('resolvido à mão: não se resolve de novo, e a varredura não reabre',
  pg_temp.res('resolver de novo')->>'outcome' = 'not_resolvable'
  and (select count(*) = 1 and bool_and(resolved_by = pg_temp.uid('aadm')) from private.admin_alerts
        where alert_key = 'email:' || pg_temp.delivery(pg_temp.oid('voltou'))));

-- ===== agenda e limpeza ============================================================================
insert into public.email_outbox (user_id, kind, category, to_email, dedupe_key, scheduled_at)
values (pg_temp.uid('abia'), 'cart_reminder', 'marketing', 'abia@pgtap.test', 'pgtap:parado2', now() - interval '40 minutes');
select private.dispatch_tick();
select pg_temp.assert('o dispatch_tick roda a varredura',
  exists (select 1 from private.admin_alerts where kind = 'email_queue_stuck' and resolved_at is null));
insert into private.admin_alerts (kind, alert_key, details, opened_at, resolved_at, resolution)
values ('stripe_unmatched', 'pgtap:velho', '{}', now() - interval '200 days', now() - interval '181 days', 'auto');
select pg_temp.scan('limpeza');
select pg_temp.assert('alerta resolvido há mais de 180 dias sai',
  not exists (select 1 from private.admin_alerts where alert_key = 'pgtap:velho'));

select * from finish();
rollback;
