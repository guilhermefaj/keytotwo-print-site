-- 24_usage: o uso da infraestrutura no admin (migração 20261025140000): record_api_usage soma por hora e tipo, e
-- admin_usage_metrics mostra o mês, os dias, a hora mais movimentada, o banco e as contas que entraram.
-- Roda com `supabase test db` (pgTAP). Dados de teste só existem dentro da transação (rollback no fim).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp): supabase/tests/database/helpers ===========
\ir helpers/base.psql
\ir helpers/fixtures.psql

create temp table res (k text primary key, j jsonb);
create function pg_temp.usage(p_key text) returns jsonb language sql as $$ select j from pg_temp.res where k = p_key $$;

-- O seed pode ter chamadas e contas: a conferência compara com o que havia antes.
insert into pg_temp.res select 'antes', jsonb_build_object(
  'month', coalesce((select sum(calls) from private.api_usage where hour >= date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date::timestamp at time zone 'America/Sao_Paulo'), 0),
  'public', coalesce((select sum(calls) from private.api_usage where area = 'public' and hour = date_trunc('hour', now())), 0));
do $fx$
begin
  perform pg_temp.mk_user('uadm'); perform pg_temp.mk_user('ucomum');
  -- No Supabase de verdade o raw_app_meta_data de quem foi inserido direto começa NULL (no PGlite, '{}').
  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}') || '{"admin": true}' where id = pg_temp.uid('uadm');
  update auth.users set last_sign_in_at = now() where id in (pg_temp.uid('uadm'), pg_temp.uid('ucomum'));
  perform public.record_api_usage('public'); perform public.record_api_usage('public'); perform public.record_api_usage('admin');
  -- uma linha de 401 dias atrás: a primeira chamada de uma hora nova a apaga
  insert into private.api_usage (hour, area, calls) values (date_trunc('hour', now()) - interval '401 days', 'public', 7);
  delete from private.api_usage where hour = date_trunc('hour', now()) and area = 'webhooks';
  perform public.record_api_usage('webhooks');
end $fx$;

select pg_temp.assert('record_api_usage soma na hora e no tipo da chamada',
  (select calls = (pg_temp.usage('antes')->>'public')::int + 2 from private.api_usage where hour = date_trunc('hour', now()) and area = 'public'));
select pg_temp.assert('a primeira chamada de uma hora (e tipo) apaga o que passou de 400 dias',
  not exists (select 1 from private.api_usage where hour < now() - interval '400 days'));
select pg_temp.expect('record_api_usage: tipo fora da lista', $q$select public.record_api_usage('outro')$q$, 'KT001');
select pg_temp.expect('record_api_usage: tipo nulo', $q$select public.record_api_usage(null)$q$, 'KT001');
select pg_temp.expect_as('record_api_usage: service_role executa', 'service_role', $q$select public.record_api_usage('account')$q$, 'OK');
select pg_temp.expect_as('record_api_usage: anon não executa', 'anon', $q$select public.record_api_usage('public')$q$, '42501');

insert into pg_temp.res select 'm7', to_jsonb(r) from public.admin_usage_metrics(pg_temp.uid('uadm'), 7) r;
insert into pg_temp.res select 'm30', to_jsonb(r) from public.admin_usage_metrics(pg_temp.uid('uadm'), 30) r;
select pg_temp.assert('admin_usage_metrics: as chamadas do mês e por tipo',
  (select j->>'outcome' = 'ok'
      and (j->'result'->>'calls_month')::int = (pg_temp.usage('antes')->>'month')::int + 5
      and (j->'result'->'by_area'->>'admin')::int >= 1 and (j->'result'->'by_area'->>'webhooks')::int >= 1
      and (select array_agg(k order by k) from jsonb_object_keys(j->'result'->'by_area') k) = array['account', 'admin', 'public', 'schedule', 'webhooks']
     from pg_temp.res where k = 'm7'));
select pg_temp.assert('admin_usage_metrics: um dia por dia do período, com hoje por último e as chamadas de hoje',
  (select jsonb_array_length(j->'result'->'daily') = 7
      and j->'result'->'daily'->6->>'date' = (now() at time zone 'America/Sao_Paulo')::date::text
      and (j->'result'->'daily'->6->>'calls')::int >= 5
     from pg_temp.res where k = 'm7')
  and (select jsonb_array_length(j->'result'->'daily') = 30 from pg_temp.res where k = 'm30'));
select pg_temp.assert('admin_usage_metrics: a hora mais movimentada das últimas 24 horas, o tamanho do banco e as contas que entraram no mês',
  (select (j->'result'->'peak_hour'->>'calls')::int >= 5 and (j->'result'->>'database_bytes')::bigint > 0
      and (j->'result'->>'active_accounts_month')::int >= 2
      and j->'result'->>'month_start' = date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date::text
     from pg_temp.res where k = 'm7'));
select pg_temp.assert('admin_usage_metrics: quem não é admin não vê',
  (select outcome = 'forbidden' and result is null from public.admin_usage_metrics(pg_temp.uid('ucomum'), 7)));
select pg_temp.expect('admin_usage_metrics: período fora de 7 ou 30', format($q$select * from public.admin_usage_metrics(%L, 14)$q$, pg_temp.uid('uadm')), 'KT001');
select pg_temp.expect_as('admin_usage_metrics: anon não executa', 'anon', format($q$select * from public.admin_usage_metrics(%L, 7)$q$, pg_temp.uid('uadm')), '42501');

select * from finish();
rollback;
