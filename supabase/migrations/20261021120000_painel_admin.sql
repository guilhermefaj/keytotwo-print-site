-- Painel do administrador (2026-10-21, pedido do responsável): métricas de vendas, contas, funil, downloads, gratuitos e
-- novidades num período. Admin é quem tem app_metadata.admin = true no Auth (só o servidor grava). O site lê o JWT só
-- para mostrar o link; a RPC confere de novo no banco, então tirar o admin vale na hora, sem esperar o token vencer.
-- Migração nova: só cria funções; nenhum dado é alterado.

-- ===== 1. Quem é admin ===========================================================================
create function private.is_admin(p_user_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from auth.users u
                  where u.id = p_user_id and u.deleted_at is null and u.raw_app_meta_data -> 'admin' = 'true'::jsonb)
$$;
revoke all on function private.is_admin(uuid) from public, anon, authenticated, service_role;

-- ===== 2. get_admin_metrics: os últimos p_days dias do calendário de Brasília, contando hoje =============
-- Vendas e receita: pedidos pagos no período, no modo da chave da Stripe (p_livemode), em reais; reembolsados e
-- contestações perdidas saem. Funil: pessoas distintas que puseram na sacola, abriram o pagamento e pagaram.
-- Gratuitos liberados: pessoas cujo primeiro aceite de e-mails caiu no período (é ele que libera os gratuitos).
-- Inscritos: quem está com as novidades ligadas agora, fora do período.
create function public.get_admin_metrics(p_user_id uuid, p_days integer, p_livemode boolean)
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

-- ===== EXECUTE só para service_role ================================================================
revoke all on function public.get_admin_metrics(uuid, integer, boolean) from public, anon, authenticated, service_role;
grant execute on function public.get_admin_metrics(uuid, integer, boolean) to service_role;
