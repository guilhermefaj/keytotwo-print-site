-- 29_alertas_plunk: os alertas do Plunk (migração 20261101180000): o Plunk fora do ar pela checagem, as inscrições que
-- não chegam ao Plunk e o backup do Plunk atrasado, separado do backup do Supabase.
-- Roda com `supabase test db` (pgTAP). Dados de teste só existem dentro da transação (rollback no fim). Dentro da
-- transação o now() não anda: as horas entram direto nas linhas e pelo p_now da varredura, cada uma numa instrução.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp): supabase/tests/database/helpers ===========
\ir helpers/base.psql
\ir helpers/fixtures.psql

-- T: três dias atrás, no minuto cheio; as checagens, as cópias e as varreduras andam em minutos a partir dele
create function pg_temp.t(p_minutes integer) returns timestamptz language sql as $$
  select date_trunc('minute', now()) - interval '3 days' + make_interval(mins => p_minutes)
$$;
-- a varredura no minuto dado (sem devolver linha: o pg_prove leria o número solto)
create function pg_temp.scan(p_minutes integer) returns void language plpgsql as $$
begin
  perform private.scan_admin_alerts(pg_temp.t(p_minutes));
end $$;
create function pg_temp.check_at(p_minutes integer, p_target text, p_error text default null) returns void language sql as $$
  insert into private.uptime_checks (target, ok, error, checked_at) values (p_target, p_error is null, p_error, pg_temp.t(p_minutes))
$$;
create function pg_temp.open(p_kind text) returns bigint language sql as $$
  select count(*) from private.admin_alerts where kind = p_kind and resolved_at is null
$$;
create function pg_temp.mails(p_kind text, p_back boolean default false) returns bigint language sql as $$
  select count(*) from public.email_outbox
   where kind = 'admin_alert' and user_id = pg_temp.uid('uadm') and (payload->>'back')::boolean = p_back
     and payload->'alerts' @> jsonb_build_array(jsonb_build_object('kind', p_kind))
$$;
create function pg_temp.backup_at(p_minutes integer, p_key text) returns void language sql as $$
  insert into private.backup_runs (object_key, bytes, target, finished_at)
  values (p_key, 1, case when p_key like 'diario/plunk-%' then 'plunk' else 'supabase' end, pg_temp.t(p_minutes))
$$;
create function pg_temp.stuck(p_name text, p_minutes integer, p_error text) returns void language sql as $$
  insert into private.marketing_contacts (user_id, dirty_at, attempts, last_error)
  values (pg_temp.uid(p_name), pg_temp.t(p_minutes), 3, p_error)
  on conflict (user_id) do update set dirty_at = excluded.dirty_at, attempts = 3, last_error = excluded.last_error, locked_at = null
$$;

do $$
begin
  perform pg_temp.mk_user('uadm');
  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}') || '{"admin": true}' where id = pg_temp.uid('uadm');
  perform pg_temp.mk_user('ana');
  perform pg_temp.mk_user('bia');
  -- a agenda do ambiente local pode ter gravado checagens, cópias e contatos de verdade
  delete from private.uptime_checks;
  delete from private.backup_runs;
  delete from private.marketing_contacts;
end $$;

-- ===== o registro da cópia =========================================================================
select private.record_backup('diario/2026-11-02T0630Z.tar.gz.age', 10);
select private.record_backup('diario/plunk-2026-11-02T0631Z.dump.age', 20);
select pg_temp.assert('record_backup: a cópia do Plunk vem pelo nome do arquivo; a outra é do Supabase',
  (select array_agg(target || ':' || bytes order by bytes) = array['supabase:10', 'plunk:20'] from private.backup_runs));
select pg_temp.assert('backup_ro continua só com o registro da cópia', has_function_privilege('backup_ro', 'private.record_backup(text, bigint)', 'EXECUTE'));
delete from private.backup_runs;

-- ===== a checagem do Plunk =========================================================================
select pg_temp.expect('record_uptime_checks: alvo fora da lista', $q$select public.record_uptime_checks('[{"target": "admin", "ok": true}]')$q$, 'KT001');
select pg_temp.expect('record_uptime_checks: mais de três alvos',
  $q$select public.record_uptime_checks('[{"target": "site", "ok": true}, {"target": "store", "ok": true}, {"target": "plunk", "ok": true}, {"target": "site", "ok": true}]')$q$, 'KT001');
select pg_temp.expect_as('record_uptime_checks: service_role grava os três alvos', 'service_role',
  $q$select public.record_uptime_checks('[{"target": "site", "ok": true}, {"target": "store", "ok": true}, {"target": "plunk", "ok": false, "error": "HTTP 502"}]')$q$, 'OK');
select pg_temp.assert('record_uptime_checks: o Plunk gravado com o erro',
  exists (select 1 from private.uptime_checks where target = 'plunk' and not ok and error = 'HTTP 502'));
delete from private.uptime_checks;

do $$
begin
  perform pg_temp.check_at(0, 'site'); perform pg_temp.check_at(0, 'store'); perform pg_temp.check_at(0, 'plunk', 'HTTP 502');
end $$;
select pg_temp.scan(1);
select pg_temp.assert('uma falha do Plunk só: sem alerta', pg_temp.open('site_down') = 0);
do $$
begin
  perform pg_temp.check_at(5, 'site'); perform pg_temp.check_at(5, 'store'); perform pg_temp.check_at(5, 'plunk', 'sem conexão');
end $$;
select pg_temp.scan(6);
select pg_temp.assert('duas falhas do Plunk: abre site_down do plunk, desde a primeira, e avisa os admins',
  (select a.details = jsonb_build_object('target', 'plunk', 'since', pg_temp.t(0), 'error', 'sem conexão')
     from private.admin_alerts a where a.kind = 'site_down' and a.resolved_at is null)
  and pg_temp.mails('site_down') = 1);
do $$
begin
  perform pg_temp.check_at(10, 'site'); perform pg_temp.check_at(10, 'store'); perform pg_temp.check_at(10, 'plunk');
end $$;
select pg_temp.scan(11);
select pg_temp.assert('o Plunk voltou: fecha sozinho e manda o e-mail de volta', pg_temp.open('site_down') = 0 and pg_temp.mails('site_down', true) = 1);

-- ===== inscrições paradas ==========================================================================
-- daqui em diante as checagens seguem passando, para a checagem parada não entrar no meio
create function pg_temp.healthy(p_minutes integer) returns void language sql as $$
  select pg_temp.check_at(p_minutes, 'site'); select pg_temp.check_at(p_minutes, 'store'); select pg_temp.check_at(p_minutes, 'plunk');
$$;
select pg_temp.healthy(100);
select pg_temp.stuck('ana', 50, 'plunk_contacts_http_502');
select pg_temp.scan(100);
select pg_temp.assert('com erro há menos de 1 hora: sem alerta', pg_temp.open('marketing_sync_stuck') = 0);
do $$ begin perform pg_temp.healthy(115); perform pg_temp.stuck('bia', 100, 'plunk_contacts_http_500'); end $$;
select pg_temp.scan(115);
select pg_temp.assert('com erro há mais de 1 hora: abre um alerta só, pela mais antiga, com o número de pessoas e sem e-mail',
  (select a.alert_key = 'marketing_sync:' || pg_temp.uid('ana') || ':' || extract(epoch from pg_temp.t(50))::bigint
      and a.details = jsonb_build_object('count', 1, 'since', pg_temp.t(50), 'error', 'plunk_contacts_http_502')
     from private.admin_alerts a where a.kind = 'marketing_sync_stuck')
  and pg_temp.mails('marketing_sync_stuck') = 1);
select pg_temp.assert('inscrições paradas são do sistema: o admin não resolve à mão', private.alert_is_systemic('marketing_sync_stuck'));
select pg_temp.healthy(170);
select pg_temp.scan(170);
select pg_temp.assert('outra pessoa parada não abre outro alerta enquanto o primeiro está aberto', pg_temp.open('marketing_sync_stuck') = 1);
update private.marketing_contacts set dirty_at = null, last_error = null, attempts = 0 where user_id = pg_temp.uid('ana');
select pg_temp.healthy(175);
select pg_temp.scan(175);
select pg_temp.assert('a mais antiga passou, mas outra segue parada: o alerta continua aberto', pg_temp.open('marketing_sync_stuck') = 1);
update private.marketing_contacts set dirty_at = null, last_error = null, attempts = 0 where user_id = pg_temp.uid('bia');
select pg_temp.healthy(180);
select pg_temp.scan(180);
select pg_temp.assert('todas passaram: fecha sozinho, sem e-mail de volta',
  pg_temp.open('marketing_sync_stuck') = 0 and pg_temp.mails('marketing_sync_stuck', true) = 0);
do $$ begin perform pg_temp.healthy(185); update private.marketing_contacts set dirty_at = pg_temp.t(100) where user_id = pg_temp.uid('ana'); end $$;
select pg_temp.scan(185);
select pg_temp.assert('a marca esperando sem erro (fora do modo plunk) não conta', pg_temp.open('marketing_sync_stuck') = 0);
do $$ begin perform pg_temp.healthy(190); update private.marketing_contacts set dirty_at = pg_temp.t(120), last_error = 'erro' where user_id = pg_temp.uid('bia'); end $$;
select pg_temp.scan(190);
select pg_temp.assert('com erro de novo, abre outro alerta',
  pg_temp.open('marketing_sync_stuck') = 1 and (select count(*) = 2 from private.admin_alerts where kind = 'marketing_sync_stuck'));

-- ===== backup do Plunk atrasado ====================================================================
do $$ begin perform pg_temp.healthy(200); perform pg_temp.backup_at(200, 'diario/2026-11-01T0630Z.tar.gz.age'); end $$;
select pg_temp.scan(200);
select pg_temp.assert('sem cópia nenhuma do Plunk: sem alerta (começa a contar na primeira)', pg_temp.open('plunk_backup_late') = 0);
do $$ begin perform pg_temp.healthy(201); perform pg_temp.backup_at(201, 'diario/plunk-2026-11-01T0631Z.dump.age'); end $$;
-- 27 horas depois, só a cópia do Supabase chegou de novo
do $$ begin perform pg_temp.healthy(1820); perform pg_temp.backup_at(1820, 'diario/2026-11-02T0630Z.tar.gz.age'); end $$;
select pg_temp.scan(1820);
select pg_temp.assert('o Plunk sem cópia há mais de 26 horas: abre o alerta dele; o do Supabase, não',
  pg_temp.open('plunk_backup_late') = 1 and pg_temp.open('backup_late') = 0 and pg_temp.mails('plunk_backup_late') = 1
  and (select details = jsonb_build_object('last_finished_at', pg_temp.t(201)) from private.admin_alerts where kind = 'plunk_backup_late'));
select pg_temp.assert('backup do Plunk atrasado é do sistema', private.alert_is_systemic('plunk_backup_late'));
do $$ begin perform pg_temp.healthy(1825); perform pg_temp.backup_at(1825, 'diario/plunk-2026-11-02T0631Z.dump.age'); end $$;
select pg_temp.scan(1825);
select pg_temp.assert('a cópia nova do Plunk fecha o alerta', pg_temp.open('plunk_backup_late') = 0);
-- a cópia do Plunk não segura o alerta do Supabase: 27 horas depois, só o Plunk copiou
do $$ begin perform pg_temp.healthy(3440); perform pg_temp.backup_at(3440, 'diario/plunk-2026-11-03T0631Z.dump.age'); end $$;
select pg_temp.scan(3440);
select pg_temp.assert('só o Plunk copiou: abre o backup atrasado do Supabase', pg_temp.open('backup_late') = 1 and pg_temp.open('plunk_backup_late') = 0);

select * from finish();
rollback;
