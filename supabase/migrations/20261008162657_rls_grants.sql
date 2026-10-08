-- RLS, policies e GRANTs (docs/data-contract.md v0.3.2, seção 5). D-1 e D-12: NENHUM privilégio de tabela para anon,
-- authenticated nem service_role; a API só executa RPCs. Lista FIXA de tabelas: nunca "all tables in schema public"
-- (atingiria public.test, o keep-alive externo). Não depende do GRANT automático da plataforma (encerrado em 2026-10-30).

-- Modelo de migração: lista FIXA de tabelas (nunca "all tables in schema public": atingiria public.test).
-- D-12: NENHUM privilégio de tabela para anon, authenticated nem service_role.
do $$
declare t text;
begin
  foreach t in array array[
    'products','games','product_games','files','file_objects','profiles','marketing_consents','email_suppressions',
    'carts','cart_items','orders','order_items','order_events','entitlements','entitlement_games',
    'stripe_events','funnel_events','download_events','email_outbox']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format($p$create policy deny_client_access on public.%I as permissive
                      for all to anon, authenticated using (false) with check (false)$p$, t);
  end loop;
end $$;

-- identidades (reverte o padrão da plataforma, caso o projeto ainda o aplique)
revoke all on sequence public.products_id_seq, public.games_id_seq, public.order_events_id_seq,
                       public.download_events_id_seq, public.funnel_events_id_seq,
                       public.marketing_consents_id_seq
  from public, anon, authenticated, service_role;

-- funções internas: nenhum papel de API
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'private'::regnamespace
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
  end loop;
end $$;
