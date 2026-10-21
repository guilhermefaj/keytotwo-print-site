-- 14_admin_metrics: get_admin_metrics e private.is_admin (docs/data-contract.md, seção 6.12). Roda com `supabase test db`
-- (pgTAP). Dados de teste só existem dentro da transação. O seed pode ter dados: as contas comparam com uma base.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp) ============================================
create function pg_temp.expect(p_label text, p_sql text, p_state text) returns text language plpgsql as $$
declare st text := 'OK';
begin
  begin execute p_sql; exception when others then get stacked diagnostics st = returned_sqlstate; end;
  return extensions.is(st, p_state, p_label);
end $$;

create function pg_temp.expect_as(p_label text, p_role text, p_sql text, p_state text) returns text language plpgsql as $$
declare st text := 'OK';
begin
  execute format('set local role %I', p_role);
  begin execute p_sql; exception when others then get stacked diagnostics st = returned_sqlstate; end;
  reset role;
  return extensions.is(st, p_state, p_label);
end $$;

create function pg_temp.assert(p_label text, p_cond boolean) returns text language sql as $$
  select extensions.ok(coalesce(p_cond, false), p_label)
$$;

create temp table ids (name text primary key, id uuid);
create function pg_temp.uid(p_name text) returns uuid language sql as $$ select id from pg_temp.ids where name = p_name $$;

create function pg_temp.mk_user(p_name text, p_confirmed boolean default true) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_name || '@pgtap.test', null,
          case when p_confirmed then now() end, '', '', '', '', now(), now(),
          '{"provider": "email", "providers": ["email"]}', '{"full_name": "Pessoa TESTE"}');
  insert into pg_temp.ids values (p_name, v_id);
  return v_id;
end $$;

create function pg_temp.set_admin(p_user uuid, p_admin boolean) returns void language sql as $$
  update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('admin', p_admin) where id = p_user
$$;

create function pg_temp.mk_product(p_code text) returns bigint
language plpgsql as $$
declare v_pid bigint; v_gid bigint;
begin
  insert into public.products (code, slug, kind, name, status, stripe_price_id, games_expected)
  values (p_code, lower(p_code), 'single', 'Produto ' || p_code || ' [TESTE]', 'active', 'price_PGTAP_' || p_code, 1)
  returning id into v_pid;
  insert into public.games (code, slug, name, status) values ('GM-' || p_code, lower('GM-' || p_code), 'Jogo ' || p_code || ' [TESTE]', 'published')
  returning id into v_gid;
  insert into public.product_games (product_id, game_id, position) values (v_pid, v_gid, 1);
  return v_pid;
end $$;

create function pg_temp.mv(p_order uuid, p_to text) returns void language plpgsql as $$
declare v_paid boolean := p_to in ('paid','disputed','dispute_lost','refunded');
        v_money boolean := p_to in ('pending_payment','paid','disputed','dispute_lost','refunded');
begin
  if p_to in ('pending_payment', 'paid') then
    update public.order_items set unit_amount = 990, currency = 'brl' where order_id = p_order and unit_amount is null;
  end if;
  update public.orders o set
     status = p_to,
     amount_total = case when v_money then coalesce(o.amount_total, 990) else o.amount_total end,
     amount_subtotal = case when v_money then coalesce(o.amount_subtotal, 990) else o.amount_subtotal end,
     amount_discount = case when v_money then coalesce(o.amount_discount, 0) else o.amount_discount end,
     currency = case when v_money then 'brl' else o.currency end,
     paid_at = case when v_paid then coalesce(o.paid_at, now()) else o.paid_at end,
     stripe_payment_intent_id = case when v_paid then coalesce(o.stripe_payment_intent_id, 'pi_PGTAP_' || replace(o.id::text, '-', '')) else o.stripe_payment_intent_id end,
     refunded_at = case when p_to = 'refunded' then now() else o.refunded_at end
   where o.id = p_order;
end $$;

-- Pedido com um produto, levado ao estado pedido; os pagos ganham o direito (I-5).
create function pg_temp.mk_order(p_user uuid, p_status text, p_product bigint, p_livemode boolean default false) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid(); v_ent uuid; i int; v_path text[];
begin
  insert into public.orders (id, user_id, email, status, cart_version, terms_version, terms_accepted_at,
                             stripe_checkout_session_id, livemode)
  values (v_id, p_user, (select lower(email) from auth.users where id = p_user), 'open', 0, 'termos-pgtap', now(),
          (case when p_livemode then 'cs_live_PGTAP_' else 'cs_test_PGTAP_' end) || replace(v_id::text, '-', ''), p_livemode);
  insert into public.order_items (order_id, product_id, position, stripe_price_id)
  select v_id, p.id, 1, p.stripe_price_id from public.products p where p.id = p_product;
  v_path := case p_status when 'paid' then '{paid}' when 'refunded' then '{paid,refunded}' end::text[];
  for i in 1..coalesce(cardinality(v_path), 0) loop
    perform pg_temp.mv(v_id, v_path[i]);
  end loop;
  if p_status = 'paid' then
    insert into public.entitlements (order_id, product_id, user_id, status) values (v_id, p_product, p_user, 'active')
    returning id into v_ent;
    insert into public.entitlement_games (entitlement_id, game_id, position)
    select v_ent, pg.game_id, pg.position from public.product_games pg where pg.product_id = p_product;
  end if;
  return v_id;
end $$;

create function pg_temp.m(p_days int, p_livemode boolean default false) returns jsonb language sql as $$
  select metrics from public.get_admin_metrics(pg_temp.uid('adm'), p_days, p_livemode)
$$;

-- Diferença de um número das métricas em relação à base.
create temp table base (days int, livemode boolean, metrics jsonb);
create function pg_temp.delta(p_days int, p_path text[], p_livemode boolean default false) returns bigint language sql as $$
  select (pg_temp.m(p_days, p_livemode) #>> p_path)::bigint - (b.metrics #>> p_path)::bigint
    from pg_temp.base b where b.days = p_days and b.livemode = p_livemode
$$;

-- ===== fixtures ==================================================================================
do $fx$
begin
  perform pg_temp.mk_user('adm');
  perform pg_temp.set_admin(pg_temp.uid('adm'), true);
  perform pg_temp.mk_user('comum');
  perform pg_temp.mk_user('naoconf', false);
  perform pg_temp.set_admin(pg_temp.uid('naoconf'), true);
end $fx$;

insert into pg_temp.base select d, l, pg_temp.m(d, l) from unnest(array[7, 30]) d, unnest(array[false, true]) l;

do $fx$
declare v_pid bigint; v_c1 uuid; v_c2 uuid; v_paid uuid; v_file uuid;
begin
  v_pid := pg_temp.mk_product('AM1');
  v_c1 := pg_temp.mk_user('c1');                                   -- 2 contas novas hoje
  v_c2 := pg_temp.mk_user('c2');
  v_paid := pg_temp.mk_order(v_c1, 'paid', v_pid);                 -- conta: R$ 9,90
  perform pg_temp.mk_order(v_c2, 'refunded', v_pid);               -- reembolsado: fora
  perform pg_temp.mk_order(v_c2, 'paid', v_pid, true);             -- outro modo da Stripe: fora no teste
  -- funil: c1 duas vezes na sacola (conta 1 pessoa), c2 uma vez; c2 também há 10 dias (só nos 30 dias)
  insert into public.funnel_events (user_id, type, product_id, cart_version) values
    (v_c1, 'cart_item_added', v_pid, 1), (v_c1, 'cart_item_added', v_pid, 2), (v_c2, 'cart_item_added', v_pid, 1);
  insert into public.funnel_events (user_id, type, product_id, cart_version, occurred_at)
    values (pg_temp.uid('comum'), 'cart_item_added', v_pid, 1, now() - interval '10 days');
  insert into public.funnel_events (user_id, type, order_id, cart_version) values (v_c1, 'checkout_started', v_paid, 2);
  -- downloads: 2 pagos e 1 gratuito
  insert into public.files (game_id, kind, access, version, filename, size_bytes, sha256, status, published_at)
  select pg.game_id, 'pdf', 'paid', '1.0', 'AM1-v1.0.pdf', 1000, repeat('0', 64), 'published', now()
    from public.product_games pg where pg.product_id = v_pid
  returning id into v_file;
  insert into public.download_events (user_id, file_id, kind) values (v_c1, v_file, 'paid'), (v_c1, v_file, 'paid'), (null, v_file, 'free');
  -- novidades: c1 aceita hoje (libera os gratuitos agora); c2 aceitou há 10 dias (liberou fora dos 7 dias)
  insert into public.marketing_consents (user_id, email, action, source, text_version) values (v_c1, 'c1@pgtap.test', 'granted', 'free_games', 'v1');
  insert into public.marketing_consents (user_id, email, action, source, text_version, occurred_at)
    values (v_c2, 'c2@pgtap.test', 'granted', 'account', 'v1', now() - interval '10 days');
end $fx$;

-- ===== acesso ====================================================================================
select pg_temp.assert('admin recebe ok com métricas', (select outcome = 'ok' and metrics is not null
  from public.get_admin_metrics(pg_temp.uid('adm'), 7, false)));
select pg_temp.assert('quem não é admin recebe forbidden, sem métricas', (select outcome = 'forbidden' and metrics is null
  from public.get_admin_metrics(pg_temp.uid('comum'), 7, false)));
select pg_temp.expect('admin sem e-mail confirmado: KT009',
  format($q$select * from public.get_admin_metrics(%L, 7, false)$q$, pg_temp.uid('naoconf')), 'KT009');
select pg_temp.expect('usuário inexistente: KT009', $q$select * from public.get_admin_metrics(gen_random_uuid(), 7, false)$q$, 'KT009');
select pg_temp.expect('p_days 0: KT001', format($q$select * from public.get_admin_metrics(%L, 0, false)$q$, pg_temp.uid('adm')), 'KT001');
select pg_temp.expect('p_days 367: KT001', format($q$select * from public.get_admin_metrics(%L, 367, false)$q$, pg_temp.uid('adm')), 'KT001');
select pg_temp.expect('p_livemode nulo: KT001', format($q$select * from public.get_admin_metrics(%L, 7, null)$q$, pg_temp.uid('adm')), 'KT001');
select pg_temp.assert('admin = false no app_metadata não é admin', not private.is_admin(pg_temp.uid('comum')));
select pg_temp.expect_as('service_role executa', 'service_role',
  format($q$select * from public.get_admin_metrics(%L, 7, false)$q$, pg_temp.uid('adm')), 'OK');
select pg_temp.expect_as('anon não executa', 'anon', $q$select * from public.get_admin_metrics(gen_random_uuid(), 7, false)$q$, '42501');
select pg_temp.expect_as('authenticated não executa', 'authenticated', $q$select * from public.get_admin_metrics(gen_random_uuid(), 7, false)$q$, '42501');
select pg_temp.expect_as('authenticated não chama private.is_admin', 'authenticated', $q$select private.is_admin(gen_random_uuid())$q$, '42501');

-- ===== números ===================================================================================
select pg_temp.assert('período: últimos 7 dias de Brasília, contando hoje',
  (select m->>'until' = (now() at time zone 'America/Sao_Paulo')::date::text
      and m->>'since' = ((now() at time zone 'America/Sao_Paulo')::date - 6)::text
      and jsonb_array_length(m->'daily') = 7 and (m->>'days')::int = 7
     from pg_temp.m(7) m));
select pg_temp.assert('30 dias: 30 entradas diárias', jsonb_array_length(pg_temp.m(30)->'daily') = 30);
select pg_temp.assert('vendas: só o pedido pago no modo de teste', pg_temp.delta(7, '{sales,orders}') = 1);
select pg_temp.assert('receita: R$ 9,90, sem o reembolsado nem o outro modo', pg_temp.delta(7, '{sales,revenue}') = 990);
select pg_temp.assert('modo live conta o pedido live', pg_temp.delta(7, '{sales,orders}', true) = 1 and pg_temp.delta(7, '{sales,revenue}', true) = 990);
select pg_temp.assert('contas novas: c1 e c2', pg_temp.delta(7, '{accounts}') = 2);
select pg_temp.assert('funil: sacola conta pessoas distintas', pg_temp.delta(7, '{funnel,cart}') = 2);
select pg_temp.assert('funil: sacola de 10 dias atrás entra nos 30 dias', pg_temp.delta(30, '{funnel,cart}') = 3);
select pg_temp.assert('funil: pagamento iniciado', pg_temp.delta(7, '{funnel,checkout}') = 1);
select pg_temp.assert('funil: pagou', pg_temp.delta(7, '{funnel,paid}') = 1);
select pg_temp.assert('downloads pagos e gratuitos', pg_temp.delta(7, '{downloads,paid}') = 2 and pg_temp.delta(7, '{downloads,free}') = 1);
select pg_temp.assert('gratuitos liberados: só o primeiro aceite no período conta', pg_temp.delta(7, '{free_unlocks}') = 1);
select pg_temp.assert('gratuitos liberados em 30 dias: c1 e c2', pg_temp.delta(30, '{free_unlocks}') = 2);
select pg_temp.assert('inscritos agora: c1 e c2, em qualquer período', pg_temp.delta(7, '{newsletter,subscribed}') = 2 and pg_temp.delta(30, '{newsletter,subscribed}') = 2);
select pg_temp.assert('hoje no diário: a venda e as contas novas',
  (select (d->>'orders')::int >= 1 and (d->>'revenue')::bigint >= 990 and (d->>'accounts')::int >= 2
     from pg_temp.m(7) m, jsonb_array_elements(m->'daily') d
    where d->>'date' = (now() at time zone 'America/Sao_Paulo')::date::text));
select pg_temp.assert('diário soma o total do período',
  (select (select sum((d->>'orders')::int) from jsonb_array_elements(m->'daily') d) = (m#>>'{sales,orders}')::int from pg_temp.m(30) m));
select pg_temp.assert('métricas sem e-mail nem identificador de pessoa', pg_temp.m(30)::text !~ '(@|[0-9a-f]{8}-[0-9a-f]{4})');

-- ===== tirar o admin vale na hora ================================================================
do $$ begin perform pg_temp.set_admin(pg_temp.uid('adm'), false); end $$;
select pg_temp.assert('sem o admin, forbidden na hora', (select outcome = 'forbidden' from public.get_admin_metrics(pg_temp.uid('adm'), 7, false)));

select * from finish();
rollback;
