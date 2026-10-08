-- I5: supressões da Brevo, follow-ups e a agenda (docs/data-contract.md v0.3.5, seções 6.7 e 6.10).
-- Migração nova: nenhuma tabela muda. Acrescenta record_email_event (público, só service_role), private.enqueue_followups,
-- private.dispatch_tick e o job do pg_cron. Nenhum valor secreto aqui: a URL e a chave do despacho vivem no Vault
-- (email_dispatch_url e email_dispatch_key), gravadas por um passo local (supabase/local) ou, na nuvem, à mão no painel.
-- As constantes do D3 (3 h, D+3, janela até D+14, 5 min) são a PROPOSTA do plano e ficam à vista nas funções (P-18).

-- ===== 0. extensões ===================================================================================
-- Disponíveis no Supabase (local e nuvem). O pg_cron fica em pg_catalog, o pg_net em extensions e o Vault em vault.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault;

-- ===== 1. record_email_event: webhook da Brevo (bounce, queixa, descadastro) ============================
create function public.record_email_event(
  p_email               text,
  p_event               text,
  p_provider_message_id text default null,
  p_occurred_at         timestamptz default now()
) returns table (outcome text, user_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_email    text := private.normalize_email(p_email);
  v_reason   text;
  v_user     uuid;
  v_when     timestamptz;
  v_rows     integer;
  v_opted    boolean;
  v_opted_at timestamptz;
  v_revoked  boolean := false;
begin
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or p_event is null or p_event not in ('hard_bounce', 'complaint', 'unsubscribe') then
    raise exception 'record_email_event: e-mail ou evento inválido' using errcode = 'KT001';
  end if;
  v_reason := case p_event when 'unsubscribe' then 'unsubscribe_all' else p_event end;
  -- o horário que vale é o do EVENTO (não o da chegada do webhook); evento "do futuro" vira agora
  v_when := least(coalesce(p_occurred_at, now()), now());

  -- a conta do e-mail, se existir (a supressão vale mesmo sem conta)
  select u.id into v_user from auth.users u
   where lower(u.email) = v_email and u.deleted_at is null
   order by u.created_at limit 1;

  -- a supressão é por e-mail e motivo e é idempotente; o horário do evento entra nas duas datas
  insert into public.email_suppressions (email, reason, source, provider_message_id, occurred_at, created_at)
  values (v_email, v_reason, 'brevo_webhook', left(nullif(btrim(coalesce(p_provider_message_id, '')), ''), 200), v_when, v_when)
  on conflict (email, reason) do nothing;
  get diagnostics v_rows = row_count;

  -- queixa e descadastro também revogam o consentimento da conta, se ele está vigente e o evento é posterior ao opt-in
  -- (assim um segundo descadastro, depois de a pessoa dar opt-in de novo, ainda vale; e um evento velho reenviado não revoga o opt-in novo)
  if v_user is not null and p_event in ('complaint', 'unsubscribe') then
    select p.marketing_opt_in, p.marketing_opt_in_at into v_opted, v_opted_at from public.profiles p where p.user_id = v_user for update;
    if coalesce(v_opted, false) and v_when >= v_opted_at then
      insert into public.marketing_consents (user_id, email, action, source) values (v_user, v_email, 'revoked', 'brevo_webhook');
      v_revoked := true;
    end if;
    if v_rows > 0 or v_revoked then
      perform private.cancel_queued_marketing(v_user);   -- a trigger já deixou profiles em dia
    end if;
  end if;

  return query select (case when v_rows > 0 or v_revoked then 'applied' else 'noop' end)::text, v_user;
end $$;

-- ===== 2. private.enqueue_followups: decide e enfileira os lembretes ===================================
-- Chamada pela agenda (nunca pela API). Devolve quantos e-mails enfileirou. A rechecagem de consentimento, carrinho e pedido é refeita no envio
-- (claim_email_batch); aqui só entra quem é elegível agora. Idempotente: a dedupe_key impede repetir.
create function private.enqueue_followups(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  c_reminder_after constant interval := interval '3 hours';   -- lembrete de carrinho: sem mudança há 3 h (D3)
  c_post_after     constant interval := interval '3 days';    -- pós-compra em D+3 (D3)
  c_post_until     constant interval := interval '14 days';   -- janela do pós-compra: não dispara pedido velho quando a agenda liga
  v_sched timestamptz := least(coalesce(p_now, now()), now());   -- igual a p_now em produção; deixa o teste adiantar o relógio
  v_now   timestamptz := coalesce(p_now, now());
  v_n     integer := 0;
  v_rows  integer;
begin
  -- lembrete de carrinho: itens vendáveis e ainda não possuídos, carrinho parado, uma vez por version
  insert into public.email_outbox (user_id, kind, category, to_email, payload, scheduled_at, dedupe_key)
  select c.user_id, 'cart_reminder', 'marketing', private.normalize_email(u.email),
         jsonb_build_object('cart_version', c.version, 'items', it.items),
         v_sched, 'cart_reminder:' || c.user_id::text || ':' || c.version::text
    from public.carts c
    join auth.users u on u.id = c.user_id
   cross join lateral (
     select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name) order by ci.added_at, p.id) as items, count(*) as n
       from public.cart_items ci
       join public.products p on p.id = ci.product_id
      where ci.user_id = c.user_id
        and private.product_is_sellable(p.id)
        and not (exists (select 1 from public.product_games pg where pg.product_id = p.id)
                 and not exists (select 1 from public.product_games pg
                                  where pg.product_id = p.id
                                    and pg.game_id not in (select o from private.owned_game_ids(c.user_id) o)))
   ) it
   where c.updated_at <= v_now - c_reminder_after
     and it.n > 0
     and not exists (select 1 from public.orders o where o.user_id = c.user_id and o.status = 'pending_payment')
     and private.marketing_allowed(c.user_id)
  on conflict (dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  v_n := v_n + v_rows;

  -- pós-compra: pedido pago entre D+3 e D+14, com direito ativo, uma vez por pedido
  insert into public.email_outbox (user_id, order_id, kind, category, to_email, payload, scheduled_at, dedupe_key)
  select o.user_id, o.id, 'post_purchase', 'marketing', private.normalize_email(u.email),
         jsonb_build_object('order_ref', upper(left(replace(o.id::text, '-', ''), 8)), 'games', gm.games),
         v_sched, 'post_purchase:' || o.id::text
    from public.orders o
    join auth.users u on u.id = o.user_id
   cross join lateral (
     select jsonb_agg(jsonb_build_object('code', t.code, 'name', t.name) order by t.item_pos, t.game_pos, t.gid) as games, count(*) as n
       from (select distinct on (g.id) g.id as gid, g.code, g.name, oi.position as item_pos, eg.position as game_pos
               from public.entitlements e
               join public.order_items oi on oi.order_id = e.order_id and oi.product_id = e.product_id
               join public.entitlement_games eg on eg.entitlement_id = e.id
               join public.games g on g.id = eg.game_id
              where e.order_id = o.id and e.status = 'active'
              order by g.id, oi.position) t
   ) gm
   where o.status = 'paid'
     and o.paid_at <= v_now - c_post_after
     and o.paid_at >  v_now - c_post_until
     and gm.n > 0
     and private.marketing_allowed(o.user_id)
  on conflict (dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  v_n := v_n + v_rows;

  return v_n;
end $$;

-- ===== 3. private.dispatch_tick: o que o pg_cron roda a cada 5 minutos ================================
-- 1) enfileira os follow-ups (um erro aqui vira WARNING e não impede o passo 2);
-- 2) se o Vault tem email_dispatch_url e email_dispatch_key, chama o despacho (função de borda) por pg_net, que envia a fila e reenvia as falhas.
-- Sem os segredos, só enfileira e avisa no log do banco. Nunca imprime o valor de segredo.
create function private.dispatch_tick() returns void
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

-- ===== 4. a agenda: a cada 5 minutos (cron.schedule com o mesmo nome substitui o job) ===================
select cron.schedule('email-dispatch-tick', '*/5 * * * *', 'select private.dispatch_tick()');

-- ===== EXECUTE: record_email_event só para service_role; as funções internas para ninguém ================
revoke all on function private.enqueue_followups(timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.dispatch_tick() from public, anon, authenticated, service_role;
revoke all on function public.record_email_event(text, text, text, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.record_email_event(text, text, text, timestamptz) to service_role;
