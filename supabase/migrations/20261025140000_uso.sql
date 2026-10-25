-- Uso da infraestrutura no admin (2026-10-25, pedido do responsável depois da revisão de segurança): sem limite de
-- requisições simples no Supabase, as Métricas mostram o que a loja usa do plano grátis. As próprias funções contam as
-- chamadas, por hora e por tipo, em segundo plano (os números oficiais pediriam um token da conta inteira na API).
--   1. private.api_usage e record_api_usage (a api, os webhooks e o despacho chamam a cada requisição);
--   2. admin_usage_metrics: as chamadas do mês e por dia, a hora mais movimentada, o tamanho do banco e as contas que
--      entraram no mês.

-- ===== 1. O contador ===============================================================================================
-- area: public (a loja sem login), account (com sessão), admin, webhooks (Stripe e Brevo) e schedule (a agenda do
-- banco: despacho de e-mail e cupons). Uma linha por hora e tipo: cerca de 120 por dia.
create table private.api_usage (
  hour  timestamptz not null,
  area  text        not null,
  calls integer     not null default 0,
  primary key (hour, area),
  constraint api_usage_area_check check (area in ('public', 'account', 'admin', 'webhooks', 'schedule')),
  constraint api_usage_calls_check check (calls >= 0)
);
revoke all on table private.api_usage from public, anon, authenticated, service_role;

-- A primeira chamada de cada hora (e tipo) também apaga o que passou de 400 dias.
create function public.record_api_usage(p_area text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_new boolean;
begin
  if p_area is null or p_area not in ('public', 'account', 'admin', 'webhooks', 'schedule') then
    raise exception 'record_api_usage: tipo inválido' using errcode = 'KT001';
  end if;
  insert into private.api_usage as u (hour, area, calls) values (date_trunc('hour', now()), p_area, 1)
  on conflict (hour, area) do update set calls = u.calls + 1
  returning (xmax = 0) into v_new;
  if v_new then
    delete from private.api_usage u where u.hour < now() - interval '400 days';
  end if;
end $$;
revoke all on function public.record_api_usage(text) from public, anon, authenticated, service_role;
grant execute on function public.record_api_usage(text) to service_role;

-- ===== 2. O que o admin vê =========================================================================================
-- O mês é o do calendário de Brasília (o ciclo da cobrança da Supabase pode começar em outro dia); os dias seguem o
-- período das Métricas (7 ou 30). Contas que entraram: last_sign_in_at no mês (a Supabase conta também quem só renovou
-- a sessão, então o número dela pode ser um pouco maior).
create function public.admin_usage_metrics(p_user_id uuid, p_days integer) returns table (outcome text, result jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_month date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  v_month_start timestamptz := v_month::timestamp at time zone 'America/Sao_Paulo';
begin
  if p_user_id is null or p_days is null or p_days not in (7, 30) then
    raise exception 'admin_usage_metrics: argumentos inválidos' using errcode = 'KT001';
  end if;
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  return query select 'ok'::text, jsonb_build_object(
    'month_start', v_month,
    'calls_month', coalesce((select sum(u.calls) from private.api_usage u where u.hour >= v_month_start), 0),
    'by_area', (select jsonb_object_agg(a.area, coalesce((select sum(u.calls) from private.api_usage u where u.area = a.area and u.hour >= v_month_start), 0))
                  from unnest(array['public', 'account', 'admin', 'webhooks', 'schedule']) a(area)),
    'daily', (select jsonb_agg(jsonb_build_object('date', d.day::date, 'calls', coalesce((
                       select sum(u.calls) from private.api_usage u
                        where u.hour >= d.day at time zone 'America/Sao_Paulo'
                          and u.hour < (d.day + interval '1 day') at time zone 'America/Sao_Paulo'), 0)) order by d.day)
                from generate_series((v_today - (p_days - 1))::timestamp, v_today::timestamp, interval '1 day') d(day)),
    'peak_hour', (select jsonb_build_object('hour', x.hour, 'calls', x.calls)
                    from (select u.hour, sum(u.calls) as calls from private.api_usage u
                           where u.hour > now() - interval '24 hours' group by u.hour order by 2 desc, 1 desc limit 1) x),
    'database_bytes', pg_database_size(current_database()),
    'active_accounts_month', (select count(*) from auth.users u where u.last_sign_in_at >= v_month_start and u.deleted_at is null));
end $$;
revoke all on function public.admin_usage_metrics(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_usage_metrics(uuid, integer) to service_role;
