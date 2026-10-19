-- LGPD: direitos do titular e retenção (docs/data-contract.md v0.3.6, D-28 e seção 6.11).
-- Migração nova: só acrescenta (alter table, create or replace e funções novas).
--  * export_account_data: a cópia dos dados da conta (JSON), para GET /account/export.
--  * delete_account_data: anonimiza o que a lei fiscal manda guardar (pedidos) e apaga o resto; depois a função api
--    apaga o usuário no Auth (admin). Substitui a D-23 (D-28): conta com histórico agora se exclui de verdade.
--  * private.purge_email_outbox + job diário do pg_cron: a fila de e-mail guarda cada mensagem por 90 dias depois do envio.
-- As FKs RESTRICT de orders, marketing_consents e email_outbox para auth.users continuam: são a rede de segurança contra
-- apagar o usuário sem passar pela RPC (o Auth recusa com 23503).
-- Todas as RPCs: SECURITY DEFINER, search_path vazio, EXECUTE só para service_role.

-- ===== 1. orders: dono e e-mail saem na anonimização =================================================
alter table public.orders
  alter column user_id drop not null,
  alter column email drop not null,
  add column anonymized_at timestamptz;

alter table public.orders
  add constraint orders_anonymized_check check (
    (anonymized_at is null and user_id is not null and email is not null)
    or (anonymized_at is not null and user_id is null and email is null));

comment on column public.orders.anonymized_at is 'Quando a conta do dono foi excluída (D-28). O pedido fica sem user_id e sem e-mail; valores, datas, aceite dos termos e ids da Stripe ficam pelo prazo fiscal.';

-- ===== 2. entitlements: o direito de conta excluída fica revogado e sem dono ==========================
alter table public.entitlements alter column user_id drop not null;
alter table public.entitlements drop constraint entitlements_reason_check;
alter table public.entitlements
  add constraint entitlements_reason_check check (revoke_reason is null or revoke_reason in ('refund', 'dispute', 'manual', 'account_deleted')),
  add constraint entitlements_user_check check (user_id is not null or status = 'revoked');

-- ===== 3. I-5: account_deleted conta como a revogação do atendimento (o pedido pago continua pago) =======
create or replace function private.assert_order_entitlement_consistency() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_order_id uuid;
  v_status   text;
  v_items    integer;
  v_ents     integer;
  v_active   integer;
  v_revoked  integer;
  v_manual   integer;
begin
  -- if/else (e não CASE): cada tabela tem só um dos campos de "new".
  if tg_table_name = 'orders' then
    v_order_id := new.id;
  else
    v_order_id := new.order_id;
  end if;

  select o.status into v_status from public.orders o where o.id = v_order_id;
  if not found then
    return null;
  end if;

  select count(*) into v_items from public.order_items i where i.order_id = v_order_id;
  select count(*),
         count(*) filter (where e.status = 'active'),
         count(*) filter (where e.status = 'revoked'),
         count(*) filter (where e.status = 'revoked' and e.revoke_reason in ('manual', 'account_deleted'))
    into v_ents, v_active, v_revoked, v_manual
    from public.entitlements e
   where e.order_id = v_order_id;

  if v_status = 'paid' then
    if v_items < 1 or v_ents <> v_items or v_revoked <> v_manual then
      raise exception 'pedido % paid: itens=%, direitos=%, revogados fora do atendimento e da exclusão de conta=%',
        v_order_id, v_items, v_ents, v_revoked - v_manual using errcode = 'KT011';
    end if;
  elsif v_status in ('disputed', 'dispute_lost', 'refunded') then
    if v_items < 1 or v_ents <> v_items or v_active > 0 then
      raise exception 'pedido % (%): itens=%, direitos=%, ativos=% (todos devem estar revogados)',
        v_order_id, v_status, v_items, v_ents, v_active using errcode = 'KT011';
    end if;
  elsif v_ents > 0 then
    raise exception 'pedido % (%) não pode ter direito', v_order_id, v_status using errcode = 'KT011';
  end if;
  return null;
end $$;
revoke all on function private.assert_order_entitlement_consistency() from public, anon, authenticated, service_role;

-- ===== 4. guard_order_changes: anonimizar só pela exclusão de conta, e sem volta =======================
create or replace function private.guard_order_changes() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id
     or new.livemode is distinct from old.livemode
     or new.created_at is distinct from old.created_at
     or new.cart_version is distinct from old.cart_version
     or new.terms_version is distinct from old.terms_version then
    raise exception 'orders: id, livemode, created_at, cart_version e terms_version são imutáveis' using errcode = 'KT010';
  end if;
  -- D-28: a anonimização só acontece dentro de delete_account_data, e um pedido anonimizado não volta a ter dono nem e-mail
  if old.anonymized_at is not null then
    if new.anonymized_at is distinct from old.anonymized_at or new.user_id is not null or new.email is not null then
      raise exception 'orders: pedido anonimizado não volta a ter dono nem e-mail' using errcode = 'KT010';
    end if;
  elsif new.anonymized_at is not null
        and coalesce(current_setting('keytotwo.account_erasure', true), 'off') <> 'on' then
    raise exception 'orders: anonimização só pela exclusão de conta' using errcode = 'KT010';
  end if;
  -- o dono nunca muda (atendimento: set local keytotwo.allow_reassign = 'on'); na anonimização ele sai (o CHECK exige)
  if new.user_id is distinct from old.user_id
     and not (old.anonymized_at is null and new.anonymized_at is not null)
     and coalesce(current_setting('keytotwo.allow_reassign', true), 'off') <> 'on' then
    raise exception 'orders: o dono do pedido não muda' using errcode = 'KT010';
  end if;
  if old.stripe_checkout_session_id is not null
     and new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id then
    raise exception 'orders: stripe_checkout_session_id não muda depois de gravado' using errcode = 'KT010';
  end if;
  if old.stripe_payment_intent_id is not null
     and new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id then
    raise exception 'orders: stripe_payment_intent_id não muda depois de gravado' using errcode = 'KT010';
  end if;
  if old.terms_accepted_at is not null and new.terms_accepted_at is distinct from old.terms_accepted_at then
    raise exception 'orders: terms_accepted_at não muda depois de gravado' using errcode = 'KT010';
  end if;
  -- D-24: o que foi cobrado (e o cupom) é gravado uma vez
  if (old.amount_total is not null and new.amount_total is distinct from old.amount_total)
     or (old.amount_subtotal is not null and new.amount_subtotal is distinct from old.amount_subtotal)
     or (old.amount_discount is not null and new.amount_discount is distinct from old.amount_discount)
     or (old.currency is not null and new.currency is distinct from old.currency)
     or (old.promotion_code is not null and new.promotion_code is distinct from old.promotion_code) then
    raise exception 'orders: valores e código promocional não mudam depois de gravados' using errcode = 'KT010';
  end if;
  if new.status is distinct from old.status and not private.order_transition_allowed(old.status, new.status) then
    raise exception 'orders: transição % -> % não permitida', old.status, new.status using errcode = 'KT006';
  end if;
  return new;
end $$;

-- ===== 5. histórico de consentimento: só inserção, exceto a exclusão de conta =========================
-- As demais tabelas de log seguem sem exceção (order_events, stripe_events, entitlement_games, email_suppressions).
create or replace function private.forbid_modification() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and tg_table_name = 'marketing_consents'
     and coalesce(current_setting('keytotwo.account_erasure', true), 'off') = 'on' then
    return old;
  end if;
  raise exception '% é só inserção (% não permitido)', tg_table_name, tg_op using errcode = 'KT008';
end $$;

-- ===== 6. export_account_data: a cópia dos dados da conta (LGPD, art. 18, II e V) ======================
-- Tudo o que o banco liga à pessoa, sem ids internos: conta, preferência e histórico de consentimento, sacola,
-- pedidos com itens, biblioteca, downloads, e-mails da fila, supressões do e-mail e eventos de uso.
create function public.export_account_data(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_email text;
begin
  v_email := private.require_confirmed_email(p_user_id);

  return jsonb_build_object(
    'generated_at', now(),
    'account', (
      select jsonb_build_object(
               'email', v_email,
               'created_at', u.created_at,
               'email_confirmed_at', u.email_confirmed_at,
               'last_sign_in_at', u.last_sign_in_at,
               'sign_in_methods', coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb),
               'name', coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
               'avatar_url', coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture'),
               'has_password', coalesce(u.encrypted_password, '') <> '',
               'stripe_customer_id', p.stripe_customer_id)
        from auth.users u
        left join public.profiles p on p.user_id = u.id
       where u.id = p_user_id),
    'marketing', (
      select jsonb_build_object('opted_in', p.marketing_opt_in, 'opted_in_at', p.marketing_opt_in_at, 'prompted_at', p.marketing_prompted_at)
        from public.profiles p where p.user_id = p_user_id),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object('action', c.action, 'source', c.source, 'text_version', c.text_version,
                                          'email', c.email, 'occurred_at', c.occurred_at) order by c.occurred_at, c.id)
        from public.marketing_consents c where c.user_id = p_user_id), '[]'::jsonb),
    'cart', coalesce((
      select jsonb_agg(jsonb_build_object('code', pr.code, 'name', pr.name, 'added_at', ci.added_at) order by ci.added_at, pr.id)
        from public.cart_items ci join public.products pr on pr.id = ci.product_id
       where ci.user_id = p_user_id), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ref', upper(left(replace(o.id::text, '-', ''), 8)),
               'status', o.status,
               'email', o.email,
               'created_at', o.created_at,
               'paid_at', o.paid_at,
               'refunded_at', o.refunded_at,
               'amount_subtotal', o.amount_subtotal,
               'amount_discount', o.amount_discount,
               'amount_total', o.amount_total,
               'currency', o.currency,
               'promotion_code', o.promotion_code,
               'terms_version', o.terms_version,
               'terms_accepted_at', o.terms_accepted_at,
               'items', coalesce((
                 select jsonb_agg(jsonb_build_object('code', pr.code, 'name', pr.name, 'unit_amount', i.unit_amount, 'currency', i.currency)
                                  order by i.position)
                   from public.order_items i join public.products pr on pr.id = i.product_id
                  where i.order_id = o.id), '[]'::jsonb))
             order by o.created_at, o.id)
        from public.orders o where o.user_id = p_user_id), '[]'::jsonb),
    'library', coalesce((
      select jsonb_agg(jsonb_build_object(
               'order_ref', upper(left(replace(e.order_id::text, '-', ''), 8)),
               'product', jsonb_build_object('code', pr.code, 'name', pr.name),
               'status', e.status,
               'granted_at', e.granted_at,
               'revoked_at', e.revoked_at,
               'revoke_reason', e.revoke_reason,
               'games', coalesce((
                 select jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name) order by eg.position)
                   from public.entitlement_games eg join public.games g on g.id = eg.game_id
                  where eg.entitlement_id = e.id), '[]'::jsonb))
             order by e.granted_at, e.id)
        from public.entitlements e join public.products pr on pr.id = e.product_id
       where e.user_id = p_user_id), '[]'::jsonb),
    'downloads', coalesce((
      select jsonb_agg(jsonb_build_object('game', g.code, 'file', f.filename, 'version', f.version, 'at', d.created_at)
                       order by d.created_at, d.id)
        from public.download_events d
        join public.files f on f.id = d.file_id
        left join public.games g on g.id = f.game_id
       where d.user_id = p_user_id), '[]'::jsonb),
    'emails', coalesce((
      select jsonb_agg(jsonb_build_object('kind', x.kind, 'category', x.category, 'to', x.to_email, 'status', x.status,
                                          'created_at', x.created_at, 'sent_at', x.sent_at) order by x.created_at, x.id)
        from public.email_outbox x where x.user_id = p_user_id), '[]'::jsonb),
    'email_suppressions', coalesce((
      select jsonb_agg(jsonb_build_object('reason', s.reason, 'source', s.source, 'occurred_at', s.occurred_at) order by s.occurred_at, s.reason)
        from public.email_suppressions s where s.email = v_email), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(jsonb_build_object(
               'type', fe.type,
               'at', fe.occurred_at,
               'product', pr.code,
               'order_ref', case when fe.order_id is not null then upper(left(replace(fe.order_id::text, '-', ''), 8)) end)
             order by fe.occurred_at, fe.id)
        from public.funnel_events fe left join public.products pr on pr.id = fe.product_id
       where fe.user_id = p_user_id), '[]'::jsonb));
end $$;

-- ===== 7. delete_account_data: anonimiza os pedidos e apaga o resto (D-28) =============================
-- Recusa (outcome 'blocked') com pagamento em andamento, checkout aberto ou contestação aberta: o webhook ainda
-- precisa do dono para liberar ou revogar. Fora isso, na mesma transação:
--  1. direitos: revogados (account_deleted) e sem dono; ficam porque o pedido pago continua no livro fiscal (I-5);
--  2. pedidos: sem dono e sem e-mail (anonymized_at); ficam valores, datas, itens, aceite dos termos e ids da Stripe;
--  3. fila de e-mail e histórico de consentimento: apagados; o perfil volta a "sem opt-in";
--  4. o resto (perfil, sacola, identidades e sessões) cai em cascata quando a api apaga o usuário no Auth;
--     funil e downloads ficam sem dono (FK SET NULL). A lista de supressão (por e-mail) fica: é o que garante o descadastro.
-- Idempotente: repetir depois de uma falha no Auth não muda nada e devolve 'deleted' de novo.
create function public.delete_account_data(p_user_id uuid)
  returns table (outcome text, reason text, orders_anonymized integer)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_orders integer;
begin
  perform private.require_confirmed_email(p_user_id);

  -- travas na ordem da fulfill_order (pedido, depois carrinho) e, por fim, o perfil
  perform 1 from public.orders o where o.user_id = p_user_id order by o.id for update;
  perform 1 from public.carts c where c.user_id = p_user_id for update;
  perform 1 from public.profiles p where p.user_id = p_user_id for update;

  if exists (select 1 from public.orders o where o.user_id = p_user_id and o.status = 'pending_payment') then
    return query select 'blocked'::text, 'payment_pending'::text, 0;
    return;
  end if;
  -- sessão de checkout ainda pagável (a Stripe expira em até 24 h; sem sessão gravada, conta 1 dia da criação)
  if exists (select 1 from public.orders o
              where o.user_id = p_user_id and o.status = 'open'
                and coalesce(o.checkout_expires_at, o.created_at + interval '1 day') > now()) then
    return query select 'blocked'::text, 'checkout_open'::text, 0;
    return;
  end if;
  if exists (select 1 from public.orders o where o.user_id = p_user_id and o.status = 'disputed') then
    return query select 'blocked'::text, 'dispute_open'::text, 0;
    return;
  end if;

  perform set_config('keytotwo.account_erasure', 'on', true);

  -- 1. antes do pedido: a FK composta (order_id, user_id) dos direitos aponta para o dono do pedido
  update public.entitlements e
     set user_id       = null,
         status        = 'revoked',
         revoked_at    = coalesce(e.revoked_at, now()),
         revoke_reason = coalesce(e.revoke_reason, 'account_deleted')
   where e.user_id = p_user_id;

  -- 2. pedidos anonimizados
  update public.orders o
     set user_id = null, email = null, anonymized_at = now()
   where o.user_id = p_user_id;
  get diagnostics v_orders = row_count;

  -- 3. fila, consentimento e perfil
  delete from public.email_outbox x where x.user_id = p_user_id;
  delete from public.marketing_consents c where c.user_id = p_user_id;
  update public.profiles p
     set marketing_opt_in = false, marketing_opt_in_at = null
   where p.user_id = p_user_id and p.marketing_opt_in;

  perform set_config('keytotwo.account_erasure', 'off', true);
  return query select 'deleted'::text, null::text, v_orders;
end $$;

-- ===== 8. retenção da fila de e-mail: 90 dias depois do envio ==========================================
-- Apaga as linhas encerradas (sent, failed, skipped, canceled) cuja última mudança passou de 90 dias. Os botões do e-mail
-- valem 30 dias e o pós-compra só é enfileirado até D+14, então nada é reenviado por causa da limpeza. Exceção: o
-- lembrete de carrinho da versão ATUAL do carrinho fica, porque a dedupe_key dele é o que impede repetir o lembrete.
create function private.purge_email_outbox(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  c_keep constant interval := interval '90 days';
  v_rows integer;
begin
  delete from public.email_outbox x
   where x.status in ('sent', 'failed', 'skipped', 'canceled')
     and coalesce(x.sent_at, x.updated_at) < coalesce(p_now, now()) - c_keep
     and not (x.kind = 'cart_reminder'
              and exists (select 1 from public.carts c
                           where c.user_id = x.user_id and c.version = (x.payload ->> 'cart_version')::integer));
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

-- todo dia às 04:17 UTC (cron.schedule com o mesmo nome substitui o job)
select cron.schedule('email-outbox-purge', '17 4 * * *', 'select private.purge_email_outbox()');

-- ===== EXECUTE: as RPCs só para service_role; a função interna para ninguém ============================
revoke all on function private.purge_email_outbox(timestamptz) from public, anon, authenticated, service_role;
do $$
declare sig text;
begin
  foreach sig in array array['export_account_data(uuid)', 'delete_account_data(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', sig);
    execute format('grant execute on function public.%s to service_role', sig);
  end loop;
end $$;
