-- Cupons, parceiros e indicações (2026-10-24, decisões do responsável): cupons com percentual, para o que valem,
-- início e fim, limite, primeira compra e valor mínimo; temporadas com a faixa do topo; parceiros com link de indicação
-- (?p=<apelido>), código próprio e comissão; de onde veio cada pedido.
--   1. private.partners, private.discounts (um cupom e um código promocional da Stripe cada), as visitas por dia e os
--      repasses de comissão; orders.referral (o link e as marcas de campanha de quem chegou por um link);
--   2. de quem é a venda: o código digitado vence o link (o código é único para sempre, então a venda não troca de dono);
--   3. a faixa do topo vem do banco (o cupom ativo com faixa) e entra na versão do catálogo, para o vigia reconstruir;
--   4. o cupom agendado liga sozinho: a agenda chama a API quando um começa (a Stripe não agenda o início);
--   5. RPCs: a visita e a indicação do pedido (API pública e checkout), e as do admin (cupons, parceiros, repasses,
--      métricas e a origem na ficha do pedido).
-- Comissão 0%: amigo ou parceiro pago por fora; as vendas contam, a comissão não.

-- ===== 1. Tabelas ==================================================================================================
create table private.partners (
  id                 uuid        primary key default gen_random_uuid(),
  slug               text        not null unique,
  name               text        not null,
  handle             text,
  contact            text,
  commission_percent numeric(5, 2) not null default 0,
  status             text        not null default 'active',
  notes              text,
  created_at         timestamptz not null default now(),
  constraint partners_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 30),
  constraint partners_name_check check (char_length(btrim(name)) between 2 and 80),
  constraint partners_handle_check check (handle is null or char_length(btrim(handle)) between 2 and 80),
  constraint partners_contact_check check (contact is null or char_length(btrim(contact)) between 3 and 120),
  constraint partners_commission_check check (commission_percent between 0 and 100),
  constraint partners_status_check check (status in ('active', 'paused')),
  constraint partners_notes_check check (notes is null or char_length(notes) <= 500)
);

-- state: scheduled (começa depois; inativo na Stripe), active, paused (inativo na Stripe) e ended (para sempre). O fim
-- por data (ends_at) é o expires_at do código na Stripe; aqui ele aparece como "terminado" sem mudar o state.
create table private.discounts (
  id                       uuid        primary key default gen_random_uuid(),
  code                     text        not null unique,
  percent_off              numeric(5, 2) not null,
  product_codes            text[],
  starts_at                timestamptz,
  ends_at                  timestamptz,
  max_redemptions          integer,
  first_time_only          boolean     not null default false,
  minimum_amount           bigint,
  campaign                 text,
  banner                   text,
  partner_id               uuid        references private.partners (id),
  state                    text        not null,
  stripe_coupon_id         text        not null unique,
  stripe_promotion_code_id text        not null unique,
  created_at               timestamptz not null default now(),
  ended_at                 timestamptz,
  constraint discounts_code_check check (code ~ '^[A-Z0-9]{3,30}$'),
  constraint discounts_percent_check check (percent_off > 0 and percent_off <= 100),
  constraint discounts_products_check check (product_codes is null or cardinality(product_codes) between 1 and 20),
  constraint discounts_window_check check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint discounts_redemptions_check check (max_redemptions is null or max_redemptions > 0),
  constraint discounts_minimum_check check (minimum_amount is null or minimum_amount > 0),
  constraint discounts_campaign_check check (campaign is null or char_length(btrim(campaign)) between 2 and 60),
  constraint discounts_banner_check check (banner is null or char_length(btrim(banner)) between 5 and 140),
  constraint discounts_state_check check (state in ('scheduled', 'active', 'paused', 'ended')),
  constraint discounts_ended_check check ((state = 'ended') = (ended_at is not null)),
  constraint discounts_stripe_check check (stripe_promotion_code_id ~ '^promo_[A-Za-z0-9_]+$' and char_length(stripe_coupon_id) between 1 and 200)
);

-- Visitas pelo link do parceiro, por dia (de Brasília): o navegador manda uma por parceiro por dia; é só um número.
create table private.partner_visits (
  partner_id uuid    not null references private.partners (id),
  day        date    not null,
  visits     integer not null default 0,
  primary key (partner_id, day),
  constraint partner_visits_check check (visits >= 0)
);

-- Comissão paga de um mês fechado: o valor fica como foi pago, mesmo que o percentual mude depois.
create table private.partner_payouts (
  id         bigint      generated always as identity primary key,
  partner_id uuid        not null references private.partners (id),
  month      date        not null,
  amount     bigint      not null,
  orders     integer     not null,
  note       text,
  paid_at    timestamptz not null default now(),
  paid_by    uuid        not null,
  constraint partner_payouts_month_key unique (partner_id, month),
  constraint partner_payouts_month_check check (extract(day from month) = 1),
  constraint partner_payouts_amount_check check (amount >= 0 and orders >= 0),
  constraint partner_payouts_note_check check (note is null or char_length(note) <= 300)
);

do $$
declare t text;
begin
  foreach t in array array['partners', 'discounts', 'partner_visits', 'partner_payouts'] loop
    execute format('revoke all on table private.%I from public, anon, authenticated, service_role', t);
  end loop;
  revoke all on sequence private.partner_payouts_id_seq from public, anon, authenticated, service_role;
end $$;

-- De onde veio quem comprou (2026-10-24): o parceiro do link e as marcas de campanha (utm_*), gravados no checkout.
alter table public.orders
  add column referral jsonb,
  add constraint orders_referral_check check (referral is null or (jsonb_typeof(referral) = 'object' and pg_column_size(referral) <= 2000));
comment on column public.orders.referral is 'O link de quem chegou por indicação ou campanha: partner_id, landed_at, path e utm_source, utm_medium, utm_campaign, utm_content. Sem dado pessoal.';

alter table private.admin_events drop constraint admin_events_action_check;
alter table private.admin_events add constraint admin_events_action_check check (action in (
  'blog_create', 'blog_update', 'blog_publish', 'blog_unpublish', 'blog_delete', 'blog_image', 'blog_image_delete',
  'user_gift', 'user_revoke', 'user_resend', 'user_newsletter_off', 'user_block', 'user_unblock', 'user_export', 'user_delete',
  'user_admin_grant', 'user_admin_revoke', 'order_refund', 'order_reconcile', 'alert_resolve',
  'product_status', 'product_price', 'product_list_price', 'pack_add_game', 'pack_remove_game',
  'discount_create', 'discount_state', 'partner_save', 'partner_payout'));

-- ===== 2. De quem é a venda e o que o cupom rendeu ===================================================================
-- O parceiro do pedido: o do código usado, se for de um parceiro; senão, o do link.
create function private.order_partner(p_promotion_code text, p_referral jsonb) returns uuid
language sql stable set search_path = '' as $$
  select coalesce((select d.partner_id from private.discounts d where d.code = upper(p_promotion_code)),
                  nullif(p_referral->>'partner_id', '')::uuid)
$$;

-- A origem na ficha do pedido: o parceiro, por onde (código ou link), a chegada e as marcas de campanha.
create function private.order_origin(p_promotion_code text, p_referral jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select case when p.id is null and coalesce(p_referral, '{}'::jsonb) - 'partner_id' = '{}'::jsonb then null
    else jsonb_strip_nulls(jsonb_build_object(
      'partner', case when p.id is not null then jsonb_build_object('id', p.id, 'slug', p.slug, 'name', p.name) end,
      'source', case when p.id is null then null
                     when exists (select 1 from private.discounts d where d.code = upper(p_promotion_code) and d.partner_id = p.id) then 'code'
                     else 'link' end,
      'landed_at', p_referral->'landed_at', 'path', p_referral->'path', 'utm_source', p_referral->'utm_source',
      'utm_medium', p_referral->'utm_medium', 'utm_campaign', p_referral->'utm_campaign', 'utm_content', p_referral->'utm_content'))
    end
    from (select 1) one left join private.partners p on p.id = private.order_partner(p_promotion_code, p_referral)
$$;

-- Compras pagas no modo da chave, com o parceiro de cada uma e o mês de Brasília do pagamento.
create function private.paid_purchases(p_livemode boolean)
  returns table (order_id uuid, partner_id uuid, promotion_code text, referral jsonb, paid_at timestamptz, month date,
                 amount_total bigint, amount_discount bigint)
language sql stable set search_path = '' as $$
  select o.id, private.order_partner(o.promotion_code, o.referral), upper(o.promotion_code), o.referral, o.paid_at,
         date_trunc('month', o.paid_at at time zone 'America/Sao_Paulo')::date, coalesce(o.amount_total, 0), coalesce(o.amount_discount, 0)
    from public.orders o
   where o.kind = 'purchase' and o.status = 'paid' and o.livemode = p_livemode and o.paid_at is not null
$$;

-- A comissão de um parceiro num mês: o percentual de hoje sobre o total cobrado (já com o desconto).
create function private.partner_month(p_partner_id uuid, p_month date, p_livemode boolean)
  returns table (orders integer, revenue bigint, commission bigint)
language sql stable set search_path = '' as $$
  select count(*)::integer, coalesce(sum(x.amount_total), 0)::bigint,
         round(coalesce(sum(x.amount_total), 0) * (select p.commission_percent from private.partners p where p.id = p_partner_id) / 100)::bigint
    from private.paid_purchases(p_livemode) x
   where x.partner_id = p_partner_id and x.month = p_month
$$;

-- ===== 3. A faixa do topo =========================================================================================
-- O texto da faixa: o cupom ativo (sem parceiro, dentro do prazo) com faixa que começou por último. {cupom} vira o código;
-- sem {cupom}, o código vai no fim.
create function public.get_promo_banner() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('code', d.code, 'text', d.banner)
    from private.discounts d
   where d.state = 'active' and d.banner is not null and d.partner_id is null
     and (d.starts_at is null or d.starts_at <= now()) and (d.ends_at is null or d.ends_at > now())
   order by coalesce(d.starts_at, d.created_at) desc, d.created_at desc
   limit 1
$$;

-- A versão do catálogo público passa a cobrir a faixa: ela muda quando um cupom com faixa começa ou acaba.
create or replace function public.get_catalog_version() returns text
language sql stable security definer set search_path = '' as $$
  select md5(public.get_catalog()::text || coalesce(public.get_promo_banner()::text, ''))
$$;

-- ===== 4. O cupom agendado =========================================================================================
-- Os agendados cujo início chegou (a API liga na Stripe e chama mark_discount_started).
create function public.due_discounts() returns table (id uuid, code text, stripe_promotion_code_id text)
language sql stable security definer set search_path = '' as $$
  select d.id, d.code, d.stripe_promotion_code_id from private.discounts d
   where d.state = 'scheduled' and d.starts_at <= now()
$$;

create function public.mark_discount_started(p_id uuid) returns table (outcome text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  update private.discounts d set state = 'active' where d.id = p_id and d.state = 'scheduled';
  return query select case when found then 'ok' else 'unchanged' end::text;
end $$;

-- A cada 5 minutos: se algum agendado começou, chama a API (o mesmo segredo do despacho de e-mail; o endereço é o da
-- função api ao lado do email-dispatch).
create function private.discounts_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_key text;
begin
  if not exists (select 1 from private.discounts d where d.state = 'scheduled' and d.starts_at <= now()) then
    return;
  end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'email_dispatch_url';
  select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.name = 'email_dispatch_key';
  if coalesce(v_url, '') = '' or coalesce(v_key, '') = '' then
    raise warning 'discounts_tick: faltam os segredos do despacho no Vault; o cupom agendado não ligou';
    return;
  end if;
  perform net.http_post(
    url     := regexp_replace(v_url, '/email-dispatch/?$', '/api/internal/discounts/tick'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_key),
    body    := '{}'::jsonb);
end $$;
revoke all on function private.discounts_tick() from public, anon, authenticated, service_role;
select cron.schedule('discounts-tick', '*/5 * * * *', 'select private.discounts_tick()');

-- ===== 5. A visita e a indicação do pedido ==========================================================================
-- Quem abriu o link do parceiro: conta a visita do dia e devolve o nome e o código ativo dele, para a faixa e o
-- pagamento. Parceiro pausado ou que não existe: not_found.
create function public.record_partner_visit(p_slug text)
  returns table (outcome text, slug text, name text, code text, percent_off numeric)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_partner private.partners;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 30 then
    return query select 'not_found'::text, null::text, null::text, null::text, null::numeric;
    return;
  end if;
  select * into v_partner from private.partners p where p.slug = p_slug and p.status = 'active';
  if not found then
    return query select 'not_found'::text, null::text, null::text, null::text, null::numeric;
    return;
  end if;
  insert into private.partner_visits (partner_id, day, visits)
  values (v_partner.id, (now() at time zone 'America/Sao_Paulo')::date, 1)
  on conflict (partner_id, day) do update set visits = private.partner_visits.visits + 1;
  return query
    select 'ok'::text, v_partner.slug, v_partner.name, d.code, d.percent_off
      from (select 1) one
      left join lateral (select x.code, x.percent_off from private.discounts x
                          where x.partner_id = v_partner.id and x.state = 'active'
                            and (x.starts_at is null or x.starts_at <= now()) and (x.ends_at is null or x.ends_at > now())
                          order by x.created_at desc limit 1) d on true;
end $$;

-- O checkout grava de onde veio quem compra: o parceiro do link (ativo, chegada nos últimos 30 dias) e as marcas de
-- campanha. Só no pedido aberto da própria pessoa; o que não vale é descartado, sem erro.
create function public.set_order_referral(p_user_id uuid, p_order_id uuid, p_referral jsonb) returns table (outcome text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_partner uuid;
  v_landed  timestamptz;
  v_clean   jsonb := '{}'::jsonb;
  k         text;
begin
  if p_user_id is null or p_order_id is null or p_referral is null or jsonb_typeof(p_referral) <> 'object' then
    raise exception 'set_order_referral: argumentos inválidos' using errcode = 'KT001';
  end if;
  if not exists (select 1 from public.orders o where o.id = p_order_id and o.user_id = p_user_id and o.status = 'open' and o.referral is null) then
    return query select 'not_found'::text;
    return;
  end if;
  begin
    v_landed := (p_referral->>'landed_at')::timestamptz;
  exception when others then
    v_landed := null;
  end;
  if v_landed is not null and v_landed > now() - interval '30 days' and v_landed <= now() + interval '5 minutes' then
    select p.id into v_partner from private.partners p where p.slug = p_referral->>'partner' and p.status = 'active';
    v_clean := jsonb_build_object('landed_at', v_landed);
    if v_partner is not null then v_clean := v_clean || jsonb_build_object('partner_id', v_partner); end if;
  end if;
  foreach k in array array['path', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] loop
    if jsonb_typeof(p_referral->k) = 'string' and char_length(p_referral->>k) between 1 and 100 then
      v_clean := v_clean || jsonb_build_object(k, p_referral->>k);
    end if;
  end loop;
  if v_clean = '{}'::jsonb or v_clean = jsonb_build_object('landed_at', v_landed) then
    return query select 'empty'::text;
    return;
  end if;
  update public.orders o set referral = v_clean where o.id = p_order_id;
  return query select 'ok'::text;
end $$;

-- ===== 6. RPCs do admin: cupons ======================================================================================
create function private.discount_json(d private.discounts, p_livemode boolean) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', d.id, 'code', d.code, 'percent_off', d.percent_off, 'product_codes', d.product_codes,
    'starts_at', d.starts_at, 'ends_at', d.ends_at, 'max_redemptions', d.max_redemptions,
    'first_time_only', d.first_time_only, 'minimum_amount', d.minimum_amount, 'campaign', d.campaign, 'banner', d.banner,
    'partner', (select jsonb_build_object('id', p.id, 'slug', p.slug, 'name', p.name) from private.partners p where p.id = d.partner_id),
    'state', d.state,
    -- o que vale agora: ativo fora do prazo aparece como agendado ou terminado
    'effective_state', case when d.state = 'active' and d.ends_at is not null and d.ends_at <= now() then 'expired'
                            when d.state = 'scheduled' and d.starts_at <= now() then 'starting'
                            else d.state end,
    'stripe_coupon_id', d.stripe_coupon_id, 'stripe_promotion_code_id', d.stripe_promotion_code_id,
    'created_at', d.created_at, 'ended_at', d.ended_at,
    'stats', (select jsonb_build_object('orders', count(*), 'revenue', coalesce(sum(x.amount_total), 0),
                                        'discount', coalesce(sum(x.amount_discount), 0))
                from private.paid_purchases(p_livemode) x where x.promotion_code = d.code))
$$;

create function public.admin_list_discounts(p_user_id uuid, p_livemode boolean) returns table (outcome text, result jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_user_id is null or p_livemode is null then
    raise exception 'admin_list_discounts: argumentos inválidos' using errcode = 'KT001';
  end if;
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  return query select 'ok'::text, jsonb_build_object(
    'discounts', coalesce((select jsonb_agg(private.discount_json(d, p_livemode) order by d.created_at desc) from private.discounts d), '[]'::jsonb),
    'partners', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'slug', p.slug, 'name', p.name, 'status', p.status) order by p.name)
                            from private.partners p), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'stripe_product',
                                                              (select s.product from private.stripe_prices s where s.price_id = p.stripe_price_id))
                                           order by p.kind, p.code)
                            from public.products p where p.status = 'active'), '[]'::jsonb));
end $$;

-- Depois que a API criou o cupom e o código na Stripe. O código é único para sempre (a venda não troca de dono).
create function public.admin_create_discount(p_user_id uuid, p_discount jsonb, p_stripe_coupon_id text,
                                             p_stripe_promotion_code_id text, p_reason text)
  returns table (outcome text, id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_reason  text;
  v_partner uuid;
  v_id      uuid;
  v_starts  timestamptz := (p_discount->>'starts_at')::timestamptz;
begin
  if p_user_id is null or p_discount is null or jsonb_typeof(p_discount) <> 'object'
     or p_stripe_coupon_id is null or p_stripe_promotion_code_id is null then
    raise exception 'admin_create_discount: argumentos inválidos' using errcode = 'KT001';
  end if;
  v_reason := private.admin_reason(p_reason);
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::uuid;
    return;
  end if;
  if exists (select 1 from private.discounts d where d.code = upper(p_discount->>'code')) then
    return query select 'code_taken'::text, null::uuid;
    return;
  end if;
  if p_discount->>'partner' is not null then
    select p.id into v_partner from private.partners p where p.slug = p_discount->>'partner';
    if v_partner is null then
      return query select 'partner_not_found'::text, null::uuid;
      return;
    end if;
  end if;
  insert into private.discounts (code, percent_off, product_codes, starts_at, ends_at, max_redemptions, first_time_only,
                                 minimum_amount, campaign, banner, partner_id, state, stripe_coupon_id, stripe_promotion_code_id)
  values (upper(p_discount->>'code'), (p_discount->>'percent_off')::numeric,
          case when jsonb_typeof(p_discount->'product_codes') = 'array'
               then array(select jsonb_array_elements_text(p_discount->'product_codes')) end,
          v_starts, (p_discount->>'ends_at')::timestamptz, (p_discount->>'max_redemptions')::integer,
          coalesce((p_discount->>'first_time_only')::boolean, false), (p_discount->>'minimum_amount')::bigint,
          nullif(btrim(p_discount->>'campaign'), ''), nullif(btrim(p_discount->>'banner'), ''), v_partner,
          case when v_starts is not null and v_starts > now() then 'scheduled' else 'active' end,
          p_stripe_coupon_id, p_stripe_promotion_code_id)
  returning private.discounts.id into v_id;
  insert into private.admin_events (user_id, action, details)
  values (p_user_id, 'discount_create', jsonb_build_object('discount_id', v_id, 'code', upper(p_discount->>'code'), 'reason', v_reason));
  return query select 'ok'::text, v_id;
end $$;

-- Pausar, voltar a valer e encerrar (para sempre). Voltar a valer antes do início volta a agendado.
create function public.admin_set_discount_state(p_user_id uuid, p_id uuid, p_state text, p_reason text)
  returns table (outcome text, state text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_reason text;
  v_d      private.discounts;
  v_next   text;
begin
  if p_user_id is null or p_id is null or p_state is null or p_state not in ('active', 'paused', 'ended') then
    raise exception 'admin_set_discount_state: argumentos inválidos' using errcode = 'KT001';
  end if;
  v_reason := private.admin_reason(p_reason);
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::text;
    return;
  end if;
  select * into v_d from private.discounts d where d.id = p_id for update;
  if not found then
    return query select 'not_found'::text, null::text;
    return;
  end if;
  v_next := case when p_state = 'active' and v_d.starts_at is not null and v_d.starts_at > now() then 'scheduled' else p_state end;
  if v_d.state = 'ended' or v_d.state = v_next then
    return query select 'unchanged'::text, v_d.state;
    return;
  end if;
  update private.discounts d set state = v_next, ended_at = case when v_next = 'ended' then now() end where d.id = p_id;
  insert into private.admin_events (user_id, action, details)
  values (p_user_id, 'discount_state', jsonb_build_object('discount_id', p_id, 'code', v_d.code, 'from', v_d.state, 'to', v_next, 'reason', v_reason));
  return query select 'ok'::text, v_next;
end $$;

-- ===== 7. RPCs do admin: parceiros =================================================================================
create function public.admin_list_partners(p_user_id uuid, p_livemode boolean) returns table (outcome text, result jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_user_id is null or p_livemode is null then
    raise exception 'admin_list_partners: argumentos inválidos' using errcode = 'KT001';
  end if;
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  return query
    with sales as (select x.partner_id, count(*) as orders, sum(x.amount_total) as revenue
                     from private.paid_purchases(p_livemode) x where x.partner_id is not null group by x.partner_id)
    select 'ok'::text, coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'slug', p.slug, 'name', p.name, 'handle', p.handle, 'contact', p.contact,
      'commission_percent', p.commission_percent, 'status', p.status, 'notes', p.notes, 'created_at', p.created_at,
      'visits_30d', coalesce((select sum(v.visits) from private.partner_visits v
                               where v.partner_id = p.id and v.day > (now() at time zone 'America/Sao_Paulo')::date - 30), 0),
      'orders', coalesce(s.orders, 0), 'revenue', coalesce(s.revenue, 0),
      'codes', coalesce((select jsonb_agg(d.code order by d.created_at desc) from private.discounts d where d.partner_id = p.id and d.state <> 'ended'), '[]'::jsonb))
      order by p.status, p.name), '[]'::jsonb)
      from private.partners p left join sales s on s.partner_id = p.id;
end $$;

-- A ficha do parceiro: os números por mês (com a comissão e o repasse), os cupons e as últimas vendas.
create function public.admin_get_partner(p_user_id uuid, p_id uuid, p_livemode boolean) returns table (outcome text, result jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_partner private.partners;
begin
  if p_user_id is null or p_id is null or p_livemode is null then
    raise exception 'admin_get_partner: argumentos inválidos' using errcode = 'KT001';
  end if;
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  select * into v_partner from private.partners p where p.id = p_id;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  return query select 'ok'::text, jsonb_build_object(
    'partner', to_jsonb(v_partner),
    'months', coalesce((
      select jsonb_agg(jsonb_build_object('month', m.month, 'orders', m.orders, 'revenue', m.revenue, 'commission', m.commission,
                                          'closed', m.month < date_trunc('month', now() at time zone 'America/Sao_Paulo')::date,
                                          'payout', (select jsonb_build_object('amount', y.amount, 'orders', y.orders, 'paid_at', y.paid_at, 'note', y.note)
                                                       from private.partner_payouts y where y.partner_id = p_id and y.month = m.month))
                       order by m.month desc)
        from (select x.month, count(*)::integer as orders, sum(x.amount_total)::bigint as revenue,
                     round(sum(x.amount_total) * v_partner.commission_percent / 100)::bigint as commission
                from private.paid_purchases(p_livemode) x where x.partner_id = p_id group by x.month
              union
              select y.month, 0, 0, 0 from private.partner_payouts y
               where y.partner_id = p_id
                 and not exists (select 1 from private.paid_purchases(p_livemode) x where x.partner_id = p_id and x.month = y.month)) m), '[]'::jsonb),
    'visits', jsonb_build_object(
      'last_30_days', coalesce((select sum(v.visits) from private.partner_visits v
                                 where v.partner_id = p_id and v.day > (now() at time zone 'America/Sao_Paulo')::date - 30), 0),
      'total', coalesce((select sum(v.visits) from private.partner_visits v where v.partner_id = p_id), 0)),
    'discounts', coalesce((select jsonb_agg(private.discount_json(d, p_livemode) order by d.created_at desc)
                             from private.discounts d where d.partner_id = p_id), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.order_id, 'ref', private.order_ref(o.order_id), 'paid_at', o.paid_at,
                                                            'amount_total', o.amount_total, 'promotion_code', o.promotion_code,
                                                            'source', case when exists (select 1 from private.discounts d where d.code = o.promotion_code and d.partner_id = p_id) then 'code' else 'link' end)
                                         order by o.paid_at desc)
                          from (select * from private.paid_purchases(p_livemode) x where x.partner_id = p_id order by x.paid_at desc limit 50) o), '[]'::jsonb));
end $$;

-- Criar (p_id nulo) ou editar o parceiro. O apelido do link não muda depois de criado (links já divulgados).
create function public.admin_save_partner(p_user_id uuid, p_id uuid, p_partner jsonb, p_reason text)
  returns table (outcome text, id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_reason text;
  v_id     uuid := p_id;
begin
  if p_user_id is null or p_partner is null or jsonb_typeof(p_partner) <> 'object' then
    raise exception 'admin_save_partner: argumentos inválidos' using errcode = 'KT001';
  end if;
  v_reason := private.admin_reason(p_reason);
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::uuid;
    return;
  end if;
  if p_id is null then
    if exists (select 1 from private.partners p where p.slug = p_partner->>'slug') then
      return query select 'slug_taken'::text, null::uuid;
      return;
    end if;
    insert into private.partners (slug, name, handle, contact, commission_percent, status, notes)
    values (p_partner->>'slug', btrim(p_partner->>'name'), nullif(btrim(p_partner->>'handle'), ''), nullif(btrim(p_partner->>'contact'), ''),
            coalesce((p_partner->>'commission_percent')::numeric, 0), coalesce(p_partner->>'status', 'active'), nullif(btrim(p_partner->>'notes'), ''))
    returning private.partners.id into v_id;
  else
    update private.partners p
       set name = btrim(p_partner->>'name'), handle = nullif(btrim(p_partner->>'handle'), ''), contact = nullif(btrim(p_partner->>'contact'), ''),
           commission_percent = coalesce((p_partner->>'commission_percent')::numeric, 0), status = coalesce(p_partner->>'status', 'active'),
           notes = nullif(btrim(p_partner->>'notes'), '')
     where p.id = p_id;
    if not found then
      return query select 'not_found'::text, null::uuid;
      return;
    end if;
  end if;
  insert into private.admin_events (user_id, action, details)
  values (p_user_id, 'partner_save', jsonb_build_object('partner_id', v_id, 'partner', p_partner->>'slug', 'created', p_id is null, 'reason', v_reason));
  return query select 'ok'::text, v_id;
end $$;

-- Marcar a comissão de um mês fechado como paga: o valor de agora fica guardado.
create function public.admin_mark_partner_paid(p_user_id uuid, p_id uuid, p_month date, p_note text, p_reason text, p_livemode boolean)
  returns table (outcome text, amount bigint)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_reason text;
  v_month  record;
begin
  if p_user_id is null or p_id is null or p_month is null or extract(day from p_month) <> 1 or p_livemode is null
     or (p_note is not null and char_length(p_note) > 300) then
    raise exception 'admin_mark_partner_paid: argumentos inválidos' using errcode = 'KT001';
  end if;
  v_reason := private.admin_reason(p_reason);
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::bigint;
    return;
  end if;
  if not exists (select 1 from private.partners p where p.id = p_id) then
    return query select 'not_found'::text, null::bigint;
    return;
  end if;
  if p_month >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date then
    return query select 'not_closed'::text, null::bigint;
    return;
  end if;
  if exists (select 1 from private.partner_payouts y where y.partner_id = p_id and y.month = p_month) then
    return query select 'already_paid'::text, null::bigint;
    return;
  end if;
  select * into v_month from private.partner_month(p_id, p_month, p_livemode);
  if v_month.commission = 0 then
    return query select 'nothing_due'::text, 0::bigint;
    return;
  end if;
  insert into private.partner_payouts (partner_id, month, amount, orders, note, paid_by)
  values (p_id, p_month, v_month.commission, v_month.orders, nullif(btrim(p_note), ''), p_user_id);
  insert into private.admin_events (user_id, action, details)
  values (p_user_id, 'partner_payout', jsonb_build_object('partner_id', p_id, 'month', p_month, 'amount', v_month.commission, 'reason', v_reason));
  return query select 'ok'::text, v_month.commission;
end $$;

-- As vendas de um parceiro num mês, para a planilha (sem e-mail nem nome de cliente).
create function public.admin_partner_orders(p_user_id uuid, p_id uuid, p_month date, p_livemode boolean) returns table (outcome text, result jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_user_id is null or p_id is null or p_month is null or p_livemode is null then
    raise exception 'admin_partner_orders: argumentos inválidos' using errcode = 'KT001';
  end if;
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  return query select 'ok'::text, jsonb_build_object(
    'partner', (select jsonb_build_object('slug', p.slug, 'name', p.name, 'commission_percent', p.commission_percent) from private.partners p where p.id = p_id),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('ref', private.order_ref(x.order_id), 'paid_at', x.paid_at, 'amount_total', x.amount_total,
                                                            'amount_discount', x.amount_discount, 'promotion_code', x.promotion_code)
                                         order by x.paid_at)
                          from private.paid_purchases(p_livemode) x where x.partner_id = p_id and x.month = p_month), '[]'::jsonb));
end $$;

-- Cupons, parceiros e campanhas no período das Métricas (os mesmos dias de Brasília do get_admin_metrics).
create function public.admin_marketing_metrics(p_user_id uuid, p_days integer, p_livemode boolean) returns table (outcome text, result jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_since timestamptz;
begin
  if p_user_id is null or p_days is null or p_days not in (7, 30) or p_livemode is null then
    raise exception 'admin_marketing_metrics: argumentos inválidos' using errcode = 'KT001';
  end if;
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  v_since := ((now() at time zone 'America/Sao_Paulo')::date - (p_days - 1))::timestamp at time zone 'America/Sao_Paulo';
  return query
    with period as (select * from private.paid_purchases(p_livemode) x where x.paid_at >= v_since)
    select 'ok'::text, jsonb_build_object(
      'codes', coalesce((select jsonb_agg(c order by (c->>'orders')::int desc, c->>'code') from (
                 select jsonb_build_object('code', x.promotion_code, 'orders', count(*), 'revenue', sum(x.amount_total), 'discount', sum(x.amount_discount)) as c
                   from period x where x.promotion_code is not null group by x.promotion_code) codes), '[]'::jsonb),
      'partners', coalesce((select jsonb_agg(c order by (c->>'orders')::int desc, c->>'name') from (
                    select jsonb_build_object('name', p.name, 'slug', p.slug, 'orders', count(*), 'revenue', sum(x.amount_total)) as c
                      from period x join private.partners p on p.id = x.partner_id group by p.name, p.slug) partners), '[]'::jsonb),
      'campaigns', coalesce((select jsonb_agg(c order by (c->>'orders')::int desc) from (
                     select jsonb_build_object('source', x.referral->>'utm_source', 'campaign', x.referral->>'utm_campaign', 'orders', count(*), 'revenue', sum(x.amount_total)) as c
                       from period x where x.referral ? 'utm_source' or x.referral ? 'utm_campaign'
                      group by x.referral->>'utm_source', x.referral->>'utm_campaign') campaigns), '[]'::jsonb));
end $$;


-- ===== 8. A origem na ficha do pedido (o resto da função é igual ao de antes) ==========================================
create or replace function public.admin_get_order(p_user_id uuid, p_order_id uuid) returns table (outcome text, result jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_order public.orders%rowtype;
  v_email text;
begin
  if p_user_id is null or p_order_id is null then
    raise exception 'admin_get_order: p_user_id e p_order_id são obrigatórios' using errcode = 'KT001';
  end if;
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  select * into v_order from public.orders o where o.id = p_order_id;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  select private.normalize_email(u.email) into v_email from auth.users u where u.id = v_order.user_id and u.deleted_at is null;

  return query select 'ok'::text, jsonb_build_object(
    'order', jsonb_build_object(
      'id', v_order.id, 'ref', private.order_ref(v_order.id), 'kind', v_order.kind, 'status', v_order.status,
      'created_at', v_order.created_at, 'paid_at', v_order.paid_at, 'refunded_at', v_order.refunded_at,
      'checkout_expires_at', v_order.checkout_expires_at,
      'amount_subtotal', v_order.amount_subtotal, 'amount_discount', v_order.amount_discount,
      'amount_total', v_order.amount_total, 'currency', v_order.currency, 'promotion_code', v_order.promotion_code,
      'livemode', v_order.livemode, 'terms_version', v_order.terms_version, 'terms_accepted_at', v_order.terms_accepted_at,
      'stripe_checkout_session_id', v_order.stripe_checkout_session_id, 'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
      'deliverable', v_order.status = 'paid'
                     and not exists (select 1 from public.entitlements x where x.order_id = v_order.id and x.status <> 'active'),
      'refundable', v_order.kind = 'purchase' and v_order.status = 'paid'
                    and v_order.stripe_payment_intent_id is not null and coalesce(v_order.amount_total, 0) > 0,
      'reconcilable', v_order.kind = 'purchase' and v_order.status in ('open', 'pending_payment', 'expired')
                      and v_order.stripe_checkout_session_id is not null),
    'person', jsonb_build_object(
      'id', v_order.user_id, 'email', v_email, 'order_email', v_order.email, 'exists', v_email is not null,
      'stripe_customer_id', (select pf.stripe_customer_id from public.profiles pf where pf.user_id = v_order.user_id)),
    'origin', private.order_origin(v_order.promotion_code, v_order.referral),
    'items', coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'kind', p.kind,
                                                           'unit_amount', i.unit_amount, 'currency', i.currency)
                                        order by i.position)
                         from public.order_items i join public.products p on p.id = i.product_id
                        where i.order_id = v_order.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('from_status', ev.from_status, 'to_status', ev.to_status,
                                                            'source', ev.source, 'reason', ev.reason, 'created_at', ev.created_at)
                                         order by ev.created_at, ev.id)
                          from public.order_events ev where ev.order_id = v_order.id), '[]'::jsonb),
    'entitlements', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'status', e.status, 'revoke_reason', e.revoke_reason, 'granted_at', e.granted_at, 'revoked_at', e.revoked_at,
        'product', jsonb_build_object('code', p.code, 'name', p.name, 'kind', p.kind),
        'games', coalesce((select jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name) order by eg.position)
                             from public.entitlement_games eg join public.games g on g.id = eg.game_id
                            where eg.entitlement_id = e.id), '[]'::jsonb))
        order by e.granted_at, e.id)
      from public.entitlements e join public.products p on p.id = e.product_id
     where e.order_id = v_order.id), '[]'::jsonb),
    'downloads', (select jsonb_build_object('count', count(*), 'last_at', max(d.created_at))
                    from public.download_events d join public.files f on f.id = d.file_id
                   where d.user_id = v_order.user_id and d.kind = 'paid' and d.created_at >= v_order.paid_at
                     and f.game_id in (select eg.game_id from public.entitlements e
                                         join public.entitlement_games eg on eg.entitlement_id = e.id
                                        where e.order_id = v_order.id)),
    'emails', coalesce((select jsonb_agg(jsonb_build_object('kind', x.kind, 'status', x.status, 'skip_reason', x.skip_reason,
                                                            'created_at', x.created_at, 'sent_at', x.sent_at)
                                         order by x.created_at desc, x.id)
                          from public.email_outbox x where x.order_id = v_order.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object(
        'action', a.action, 'created_at', a.created_at, 'details', a.details,
        'by', (select u.email from auth.users u where u.id = a.user_id))
        order by a.created_at desc, a.id desc)
      from private.admin_events a where a.details ->> 'order_id' = v_order.id::text), '[]'::jsonb));
end $$;

do $$
declare sig text;
begin
  foreach sig in array array[
    'get_promo_banner()', 'due_discounts()', 'mark_discount_started(uuid)', 'record_partner_visit(text)',
    'set_order_referral(uuid, uuid, jsonb)', 'admin_list_discounts(uuid, boolean)',
    'admin_create_discount(uuid, jsonb, text, text, text)', 'admin_set_discount_state(uuid, uuid, text, text)',
    'admin_list_partners(uuid, boolean)', 'admin_get_partner(uuid, uuid, boolean)', 'admin_save_partner(uuid, uuid, jsonb, text)',
    'admin_mark_partner_paid(uuid, uuid, date, text, text, boolean)', 'admin_partner_orders(uuid, uuid, date, boolean)',
    'admin_marketing_metrics(uuid, integer, boolean)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', sig);
    execute format('grant execute on function public.%s to service_role', sig);
  end loop;
  foreach sig in array array[
    'order_partner(text, jsonb)', 'order_origin(text, jsonb)', 'paid_purchases(boolean)', 'partner_month(uuid, date, boolean)',
    'discount_json(private.discounts, boolean)']
  loop
    execute format('revoke all on function private.%s from public, anon, authenticated, service_role', sig);
  end loop;
end $$;
