-- 25_uptime: o aviso de site fora do ar (migração 20261026120000): record_uptime_checks grava cada rodada da checagem;
-- a varredura abre site_down depois de duas falhas seguidas do alvo (ou com a checagem parada), uma vez por queda, fecha
-- sozinha quando volta e manda o e-mail de volta.
-- Roda com `supabase test db` (pgTAP). Dados de teste só existem dentro da transação (rollback no fim). Dentro da
-- transação o now() não anda: as horas entram direto nas linhas e pelo p_now da varredura, cada uma numa instrução.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp): supabase/tests/database/helpers ===========
\ir helpers/base.psql
\ir helpers/fixtures.psql

-- T: duas horas atrás, no minuto cheio; as checagens e as varreduras andam em minutos a partir dele
create function pg_temp.t(p_minutes integer) returns timestamptz language sql as $$
  select date_trunc('minute', now()) - interval '2 hours' + make_interval(mins => p_minutes)
$$;
-- a varredura no minuto dado (sem devolver linha: o pg_prove leria o número solto)
create function pg_temp.scan(p_minutes integer) returns void language plpgsql as $$
begin
  perform private.scan_admin_alerts(pg_temp.t(p_minutes));
end $$;
create function pg_temp.check_at(p_minutes integer, p_target text, p_error text default null) returns void language sql as $$
  insert into private.uptime_checks (target, ok, error, checked_at) values (p_target, p_error is null, p_error, pg_temp.t(p_minutes))
$$;
create function pg_temp.down(p_target text, p_open boolean default true) returns bigint language sql as $$
  select count(*) from private.admin_alerts
   where kind = 'site_down' and details->>'target' = p_target and (resolved_at is null) = p_open
$$;
create function pg_temp.mails(p_target text, p_back boolean) returns bigint language sql as $$
  select count(*) from public.email_outbox
   where kind = 'admin_alert' and user_id = pg_temp.uid('uadm') and (payload->>'back')::boolean = p_back
     and payload->'alerts' @> jsonb_build_array(jsonb_build_object('kind', 'site_down', 'details', jsonb_build_object('target', p_target)))
$$;

do $$
begin
  perform pg_temp.mk_user('uadm');
  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}') || '{"admin": true}' where id = pg_temp.uid('uadm');
  -- a agenda do ambiente local pode ter gravado checagens de verdade
  delete from private.uptime_checks;
end $$;

-- ===== record_uptime_checks ========================================================================
select pg_temp.expect('record_uptime_checks: nulo', $q$select public.record_uptime_checks(null)$q$, 'KT001');
select pg_temp.expect('record_uptime_checks: lista vazia', $q$select public.record_uptime_checks('[]')$q$, 'KT001');
select pg_temp.expect('record_uptime_checks: alvo fora da lista', $q$select public.record_uptime_checks('[{"target": "admin", "ok": true}]')$q$, 'KT001');
select pg_temp.expect('record_uptime_checks: ok que não é booleano', $q$select public.record_uptime_checks('[{"target": "site", "ok": "sim"}]')$q$, 'KT001');
-- três desde 2026-11-01 (o Plunk entrou na checagem: 29_alertas_plunk)
select pg_temp.expect('record_uptime_checks: mais de três alvos', $q$select public.record_uptime_checks('[{"target": "site", "ok": true}, {"target": "store", "ok": true}, {"target": "plunk", "ok": true}, {"target": "site", "ok": true}]')$q$, 'KT001');
select pg_temp.expect_as('record_uptime_checks: anon não executa', 'anon', $q$select public.record_uptime_checks('[{"target": "site", "ok": true}]')$q$, '42501');
select pg_temp.expect_as('record_uptime_checks: service_role grava', 'service_role',
  format($q$select public.record_uptime_checks(%L)$q$, jsonb_build_array(
    jsonb_build_object('target', 'site', 'ok', true, 'error', 'ignorado'),
    jsonb_build_object('target', 'store', 'ok', false, 'error', repeat('x', 300)))), 'OK');
select pg_temp.assert('record_uptime_checks: o erro só na falha, com até 200 caracteres; o que passou de 30 dias sai',
  (select array_agg(target || ':' || ok || ':' || coalesce(char_length(error)::text, '-') order by target) = array['site:true:-', 'store:false:200']
     from private.uptime_checks));
do $$
begin
  insert into private.uptime_checks (target, ok, checked_at) values ('site', true, now() - interval '31 days');
  perform public.record_uptime_checks('[{"target": "store", "ok": false}]');
end $$;
select pg_temp.assert('record_uptime_checks: falha sem erro vira "falhou"; a linha de 31 dias saiu',
  (select count(*) = 1 from private.uptime_checks where target = 'store' and error = 'falhou')
  and not exists (select 1 from private.uptime_checks where checked_at < now() - interval '30 days'));
delete from private.uptime_checks;

-- ===== a varredura =================================================================================
select pg_temp.scan(0);
select pg_temp.assert('sem checagem nenhuma: sem alerta', not exists (select 1 from private.admin_alerts where kind = 'site_down'));

do $$
begin
  perform pg_temp.check_at(0, 'site'); perform pg_temp.check_at(0, 'store');
  perform pg_temp.check_at(5, 'site', 'HTTP 502'); perform pg_temp.check_at(5, 'store');
end $$;
select pg_temp.scan(6);
select pg_temp.assert('uma falha só (pode ser a rede): sem alerta', pg_temp.down('site') = 0);

do $$ begin perform pg_temp.check_at(10, 'site', 'HTTP 503'); perform pg_temp.check_at(10, 'store'); end $$;
select pg_temp.scan(11);
select pg_temp.assert('duas falhas seguidas: abre site_down do site, desde a primeira falha, com o último erro, e avisa os admins',
  (select a.alert_key = 'site_down:' || (select c.id from private.uptime_checks c where c.target = 'site' and c.checked_at = pg_temp.t(5))
      and a.details = jsonb_build_object('target', 'site', 'since', pg_temp.t(5), 'error', 'HTTP 503')
     from private.admin_alerts a where a.kind = 'site_down')
  and pg_temp.down('store') = 0 and pg_temp.mails('site', false) = 1);
select pg_temp.assert('fora do ar é do sistema: o admin não resolve à mão', private.alert_is_systemic('site_down'));

do $$ begin perform pg_temp.check_at(15, 'site', 'sem conexão'); perform pg_temp.check_at(15, 'store'); end $$;
select pg_temp.scan(16);
select pg_temp.assert('a mesma queda não abre outro alerta', pg_temp.down('site') = 1 and pg_temp.mails('site', false) = 1);

do $$ begin perform pg_temp.check_at(20, 'site'); perform pg_temp.check_at(20, 'store'); end $$;
select pg_temp.scan(21);
select pg_temp.assert('a checagem passou: fecha sozinho e manda o e-mail de volta, com a hora em que fechou',
  pg_temp.down('site') = 0 and pg_temp.down('site', false) = 1 and pg_temp.mails('site', true) = 1
  and (select (payload->'alerts'->0->>'resolved_at')::timestamptz = pg_temp.t(21) from public.email_outbox
        where kind = 'admin_alert' and user_id = pg_temp.uid('uadm') and (payload->>'back')::boolean));

do $$
begin
  perform pg_temp.check_at(25, 'site', 'HTTP 502'); perform pg_temp.check_at(25, 'store', 'sem preço: J001');
  perform pg_temp.check_at(30, 'site', 'HTTP 502'); perform pg_temp.check_at(30, 'store');
end $$;
select pg_temp.scan(31);
select pg_temp.assert('outra queda abre outro alerta; a loja que falhou uma vez só, não',
  pg_temp.down('site') = 1 and pg_temp.down('site', false) = 1 and pg_temp.down('store') = 0 and pg_temp.mails('site', false) = 2);

select pg_temp.scan(44);
select pg_temp.assert('checagem parada há menos de 15 minutos: sem alerta', pg_temp.down('monitor') = 0);
select pg_temp.scan(46);
select pg_temp.assert('checagem parada há mais de 15 minutos: abre a da checagem, desde a última que chegou',
  (select a.details = jsonb_build_object('target', 'monitor', 'since', pg_temp.t(30))
     from private.admin_alerts a where a.kind = 'site_down' and a.details->>'target' = 'monitor')
  and pg_temp.mails('monitor', false) = 1);

do $$ begin perform pg_temp.check_at(50, 'site'); perform pg_temp.check_at(50, 'store'); end $$;
select pg_temp.scan(51);
select pg_temp.assert('as checagens voltaram e passaram: fecham o site e a checagem, num e-mail de volta só',
  pg_temp.down('site') = 0 and pg_temp.down('monitor') = 0
  and (select count(*) = 2 from public.email_outbox where kind = 'admin_alert' and user_id = pg_temp.uid('uadm') and (payload->>'back')::boolean)
  and pg_temp.mails('monitor', true) = 1 and pg_temp.mails('site', true) = 2);

select * from finish();
rollback;
