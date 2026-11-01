-- Perfil da conta (2026-11-01, responsável): nome, data de nascimento e WhatsApp em Minha conta, todos opcionais.
-- Moram em public.profiles (toda conta tem a linha, pelo trigger do Auth), não no Auth: o Google reescreve
-- raw_user_meta_data a cada login, e o nome que a pessoa escolhe não pode voltar ao do Google.
--  * private.account_profile: o perfil para o site. Enquanto a pessoa não salva (profile_updated_at nulo), o nome é o do
--    Google, como sugestão; depois de salvo, vale o que ela salvou (inclusive vazio).
--  * set_account_profile: grava os três de uma vez (nulo apaga), com as mesmas regras da API (PUT /account/profile).
--    A data de nascimento só de quem tem 18 anos ou mais (Termos › Conta; LGPD, art. 14), no dia de Brasília.
--  * get_account: devolve profile { name, birth_date, whatsapp, saved }.
--  * export_account_data: a cópia leva o perfil.
--  * delete_account_data: apaga o perfil na hora (antes, a linha só ia embora com a exclusão no Auth).
--  * admin_get_user: o nome do perfil, a data de nascimento e o WhatsApp na ficha da conta.

alter table public.profiles
  add column full_name          text,
  add column birth_date         date,
  add column whatsapp           text,          -- E.164: + e de 8 a 15 dígitos (no Brasil, +55, DDD e número)
  add column profile_updated_at timestamptz,   -- quando a pessoa salvou o perfil pela última vez; NULL nunca salvou
  add constraint profiles_full_name_check  check (full_name is null
    or (char_length(full_name) between 1 and 80 and full_name = btrim(full_name) and full_name !~ '[[:cntrl:]]')),
  add constraint profiles_birth_date_check check (birth_date is null or birth_date >= date '1900-01-01'),
  add constraint profiles_whatsapp_check   check (whatsapp is null or whatsapp ~ '^\+[1-9][0-9]{7,14}$');

create function private.account_profile(p_user_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
           'name', case when p.profile_updated_at is not null then p.full_name
                        else nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')), '') end,
           'birth_date', p.birth_date,
           'whatsapp', p.whatsapp,
           'saved', p.profile_updated_at is not null)
    from auth.users u
    left join public.profiles p on p.user_id = u.id
   where u.id = p_user_id
$$;

-- Saída: o perfil gravado, no formato do get_account. KT001 para o que a API já recusa (o banco confere de novo).
create function public.set_account_profile(p_user_id uuid, p_full_name text, p_birth_date date, p_whatsapp text)
  returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := nullif(regexp_replace(btrim(coalesce(p_full_name, '')), '\s+', ' ', 'g'), '');
begin
  perform private.require_confirmed_email(p_user_id);
  if v_name is not null and (char_length(v_name) > 80 or v_name ~ '[[:cntrl:]]') then
    raise exception 'set_account_profile: nome inválido' using errcode = 'KT001';
  end if;
  if p_birth_date is not null and (p_birth_date < date '1900-01-01'
      or p_birth_date > ((now() at time zone 'America/Sao_Paulo')::date - interval '18 years')::date) then
    raise exception 'set_account_profile: data de nascimento fora do intervalo' using errcode = 'KT001';
  end if;
  if p_whatsapp is not null and p_whatsapp !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'set_account_profile: WhatsApp fora do formato E.164' using errcode = 'KT001';
  end if;

  insert into public.profiles (user_id) values (p_user_id) on conflict (user_id) do nothing;
  update public.profiles p
     set full_name = v_name, birth_date = p_birth_date, whatsapp = p_whatsapp, profile_updated_at = now()
   where p.user_id = p_user_id;
  return private.account_profile(p_user_id);
end $$;

create or replace function public.get_account(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_confirmed_email(p_user_id);

  return jsonb_build_object(
    'email', (select u.email from auth.users u where u.id = p_user_id),
    'profile', private.account_profile(p_user_id),
    'marketing', coalesce((
      select jsonb_build_object(
               'opted_in', p.marketing_opt_in,
               'updated_at', (select c.occurred_at from public.marketing_consents c
                              where c.user_id = p_user_id order by c.occurred_at desc, c.id desc limit 1),
               'text_version', case when p.marketing_opt_in then
                                 (select c.text_version from public.marketing_consents c
                                  where c.user_id = p_user_id and c.action = 'granted'
                                  order by c.occurred_at desc, c.id desc limit 1)
                               end,
               'prompted_at', p.marketing_prompted_at)
      from public.profiles p where p.user_id = p_user_id),
      jsonb_build_object('opted_in', false, 'updated_at', null, 'text_version', null, 'prompted_at', null)),
    'free_games_unlocked', private.free_games_unlocked(p_user_id),
    'orders', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'ref', private.order_ref(o.id),
                 'kind', o.kind,
                 'created_at', o.created_at,
                 'paid_at', o.paid_at,
                 'status', o.status,
                 'amount_subtotal', o.amount_subtotal,
                 'amount_discount', o.amount_discount,
                 'amount_total', o.amount_total,
                 'currency', o.currency,
                 'promotion_code', o.promotion_code,
                 'items', coalesce((
                   select jsonb_agg(
                            jsonb_build_object('code', p.code, 'name', p.name,
                                               'unit_amount', i.unit_amount, 'currency', i.currency)
                            order by i.position)
                   from public.order_items i
                   join public.products p on p.id = i.product_id
                   where i.order_id = o.id), '[]'::jsonb))
               order by o.created_at desc, o.id desc)
      from public.orders o
      where o.user_id = p_user_id and o.status not in ('open', 'expired')), '[]'::jsonb));
end $$;

create or replace function public.export_account_data(p_user_id uuid) returns jsonb
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
    'profile', (
      select jsonb_build_object('name', p.full_name, 'birth_date', p.birth_date, 'whatsapp', p.whatsapp,
                                'updated_at', p.profile_updated_at)
        from public.profiles p where p.user_id = p_user_id),
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
               'ref', private.order_ref(o.id),
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
               'order_ref', private.order_ref(e.order_id),
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
               'order_ref', case when fe.order_id is not null then private.order_ref(fe.order_id) end)
             order by fe.occurred_at, fe.id)
        from public.funnel_events fe left join public.products pr on pr.id = fe.product_id
       where fe.user_id = p_user_id), '[]'::jsonb));
end $$;

create or replace function public.delete_account_data(p_user_id uuid)
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

  -- 3. fila, consentimento e perfil (nome, nascimento e WhatsApp saem já aqui, sem esperar a exclusão no Auth)
  delete from public.email_outbox x where x.user_id = p_user_id;
  delete from public.marketing_consents c where c.user_id = p_user_id;
  update public.profiles p
     set marketing_opt_in = false, marketing_opt_in_at = null,
         full_name = null, birth_date = null, whatsapp = null, profile_updated_at = null
   where p.user_id = p_user_id;

  perform set_config('keytotwo.account_erasure', 'off', true);
  return query select 'deleted'::text, null::text, v_orders;
end $$;

create or replace function public.admin_get_user(p_user_id uuid, p_target uuid) returns table (outcome text, result jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user  auth.users%rowtype;
  v_email text;
begin
  if p_user_id is null or p_target is null then
    raise exception 'admin_get_user: p_user_id e p_target são obrigatórios' using errcode = 'KT001';
  end if;
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  select * into v_user from auth.users u where u.id = p_target and u.deleted_at is null;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  v_email := private.normalize_email(v_user.email);

  return query select 'ok'::text, jsonb_build_object(
    'account', jsonb_build_object(
      'id', v_user.id, 'email', v_user.email, 'created_at', v_user.created_at,
      'confirmed_at', v_user.email_confirmed_at, 'last_sign_in_at', v_user.last_sign_in_at,
      'providers', coalesce(v_user.raw_app_meta_data -> 'providers', jsonb_build_array(v_user.raw_app_meta_data ->> 'provider')),
      'name', private.account_profile(p_target) ->> 'name',
      'birth_date', (select pf.birth_date from public.profiles pf where pf.user_id = p_target),
      'whatsapp', (select pf.whatsapp from public.profiles pf where pf.user_id = p_target),
      'blocked', coalesce(v_user.banned_until > now(), false), 'banned_until', v_user.banned_until,
      'admin', coalesce(v_user.raw_app_meta_data -> 'admin' = 'true'::jsonb, false),
      'self', p_target = p_user_id,
      'stripe_customer_id', (select pf.stripe_customer_id from public.profiles pf where pf.user_id = p_target)),
    'newsletter', jsonb_build_object(
      'opted_in', coalesce((select pf.marketing_opt_in from public.profiles pf where pf.user_id = p_target), false),
      'opted_in_at', (select pf.marketing_opt_in_at from public.profiles pf where pf.user_id = p_target),
      'history', coalesce((select jsonb_agg(jsonb_build_object('action', c.action, 'source', c.source, 'occurred_at', c.occurred_at)
                                            order by c.occurred_at desc, c.id desc)
                             from (select * from public.marketing_consents c where c.user_id = p_target
                                    order by c.occurred_at desc, c.id desc limit 20) c), '[]'::jsonb)),
    'library', coalesce((select jsonb_agg(jsonb_build_object(
        'entitlement_id', e.id, 'status', e.status, 'revoke_reason', e.revoke_reason,
        'granted_at', e.granted_at, 'revoked_at', e.revoked_at,
        'product', jsonb_build_object('code', p.code, 'name', p.name, 'kind', p.kind),
        'order', jsonb_build_object('id', o.id, 'ref', private.order_ref(o.id), 'kind', o.kind),
        'games', coalesce((select jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name) order by eg.position)
                             from public.entitlement_games eg join public.games g on g.id = eg.game_id
                            where eg.entitlement_id = e.id), '[]'::jsonb))
        order by e.granted_at desc, e.id)
      from public.entitlements e
      join public.products p on p.id = e.product_id
      join public.orders o on o.id = e.order_id
     where e.user_id = p_target), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'ref', private.order_ref(o.id), 'kind', o.kind, 'status', o.status,
        'created_at', o.created_at, 'paid_at', o.paid_at, 'refunded_at', o.refunded_at,
        'amount_total', o.amount_total, 'amount_discount', o.amount_discount, 'currency', o.currency,
        'promotion_code', o.promotion_code, 'livemode', o.livemode,
        'deliverable', o.status = 'paid'
                       and not exists (select 1 from public.entitlements x where x.order_id = o.id and x.status <> 'active'),
        'items', coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'unit_amount', i.unit_amount)
                                            order by i.position)
                             from public.order_items i join public.products p on p.id = i.product_id
                            where i.order_id = o.id), '[]'::jsonb))
        order by o.created_at desc, o.id)
      from public.orders o where o.user_id = p_target), '[]'::jsonb),
    'emails', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', x.kind, 'status', x.status, 'skip_reason', x.skip_reason, 'created_at', x.created_at, 'sent_at', x.sent_at,
        'order_ref', case when x.order_id is not null then private.order_ref(x.order_id) end)
        order by x.created_at desc, x.id)
      from (select * from public.email_outbox x where x.user_id = p_target order by x.created_at desc, x.id limit 20) x), '[]'::jsonb),
    'suppressions', coalesce((select jsonb_agg(jsonb_build_object('reason', s.reason, 'source', s.source, 'occurred_at', s.occurred_at)
                                               order by s.occurred_at desc)
                                from public.email_suppressions s where s.email = v_email), '[]'::jsonb),
    'downloads', jsonb_build_object(
      'count', (select count(*) from public.download_events d where d.user_id = p_target),
      'last_at', (select max(d.created_at) from public.download_events d where d.user_id = p_target)),
    'history', coalesce((select jsonb_agg(jsonb_build_object(
        'action', a.action, 'created_at', a.created_at, 'details', a.details,
        'by', (select u.email from auth.users u where u.id = a.user_id))
        order by a.created_at desc, a.id desc)
      from (select * from private.admin_events a where a.target_id = p_target order by a.created_at desc, a.id desc limit 50) a), '[]'::jsonb),
    'giftable', coalesce((select jsonb_agg(jsonb_build_object(
        'code', p.code, 'name', p.name, 'kind', p.kind,
        'owned', not exists (select 1 from public.product_games pg
                              where pg.product_id = p.id
                                and not exists (select 1 from public.entitlements e
                                                  join public.entitlement_games eg on eg.entitlement_id = e.id
                                                 where e.user_id = p_target and e.status = 'active' and eg.game_id = pg.game_id)))
        order by p.kind, p.code)
      from public.products p where p.status = 'active'), '[]'::jsonb));
end $$;

-- ===== EXECUTE: a RPC nova só para service_role; a função interna para ninguém ========================
revoke all on function private.account_profile(uuid) from public, anon, authenticated, service_role;
revoke all on function public.set_account_profile(uuid, text, date, text) from public, anon, authenticated, service_role;
grant execute on function public.set_account_profile(uuid, text, date, text) to service_role;
