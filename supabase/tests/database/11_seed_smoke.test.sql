-- 11_seed_smoke: o seed de teste (supabase/seed.sql) depois do db reset (docs/data-contract.md v0.3.4, seção 8).
-- Roda com `supabase test db` (pgTAP). Dados de teste só existem dentro da transação (rollback no fim).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp) ============================================
-- expect: executa o SQL e compara o SQLSTATE obtido ('OK' = sem erro) com o esperado.
create function pg_temp.expect(p_label text, p_sql text, p_state text) returns text language plpgsql as $$
declare st text := 'OK';
begin
  begin execute p_sql; exception when others then get stacked diagnostics st = returned_sqlstate; end;
  return extensions.is(st, p_state, p_label);
end $$;

-- expect_as: o mesmo, mas com o papel trocado (o pgTAP roda de volta como dono).
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

-- usuário do Auth (as triggers criam o perfil e o account_confirmed)
create function pg_temp.mk_user(p_name text, p_confirmed boolean default true, p_password text default null) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_name || '@pgtap.test', p_password,
          case when p_confirmed then now() end, '', '', '', '', now(), now());
  insert into pg_temp.ids values (p_name, v_id);
  return v_id;
end $$;

-- produto ativo com N jogos publicados (PDF pago publicado + objeto no B2)
create function pg_temp.mk_product(p_code text, p_kind text, p_games int) returns bigint
language plpgsql as $$
declare v_pid bigint; v_gid bigint; v_fid uuid; i int; v_gcode text;
begin
  insert into public.products (code, slug, kind, name, status, stripe_price_id, games_expected)
  values (p_code, lower(p_code), p_kind, 'Produto ' || p_code || ' [TESTE]', 'active', 'price_PGTAP_' || p_code, p_games)
  returning id into v_pid;
  for i in 1..p_games loop
    v_gcode := 'GM-' || p_code || '-' || i;
    insert into public.games (code, slug, name, status) values (v_gcode, lower(v_gcode), 'Jogo ' || v_gcode || ' [TESTE]', 'published')
    returning id into v_gid;
    insert into public.product_games (product_id, game_id, position) values (v_pid, v_gid, i);
    insert into public.files (game_id, kind, access, version, filename, size_bytes, sha256, status, published_at)
    values (v_gid, 'pdf', 'paid', '1.0', v_gcode || '-v1.0.pdf', 1000 + i, repeat('0', 64), 'published', now())
    returning id into v_fid;
    insert into public.file_objects (file_id, access, bucket, object_key)
    values (v_fid, 'paid', 'bucket-pgtap-teste', 'paid/' || v_gcode || '/1.0/' || v_gcode || '-v1.0.pdf');
  end loop;
  return v_pid;
end $$;

-- um passo da máquina de estados do pedido, com os campos que o estado exige
create function pg_temp.mv(p_order uuid, p_to text) returns void language plpgsql as $$
declare v_paid boolean := p_to in ('paid','disputed','dispute_lost','refunded');
        v_money boolean := p_to in ('pending_payment','paid','disputed','dispute_lost','refunded');
begin
  if p_to in ('pending_payment', 'paid') then
    update public.order_items set unit_amount = 0, currency = 'brl' where order_id = p_order and unit_amount is null;
  end if;
  update public.orders o set
     status = p_to,
     amount_total = case when v_money then 0 else o.amount_total end,
     amount_subtotal = case when v_money then 0 else o.amount_subtotal end,
     amount_discount = case when v_money then 0 else o.amount_discount end,
     currency = case when v_money then 'brl' else o.currency end,
     paid_at = case when v_paid then coalesce(o.paid_at, now()) else o.paid_at end,
     stripe_payment_intent_id = case when v_paid then coalesce(o.stripe_payment_intent_id, 'pi_PGTAP_' || replace(o.id::text, '-', '')) else o.stripe_payment_intent_id end,
     refunded_at = case when p_to = 'refunded' then now() else o.refunded_at end
   where o.id = p_order;
end $$;

-- pedido no estado alvo, chegando por arestas legais
create function pg_temp.mk_order(p_user uuid, p_status text, p_products bigint[], p_tag text, p_created timestamptz default now()) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid(); i int; v_path text[];
begin
  insert into public.orders (id, user_id, email, status, cart_version, terms_version, terms_accepted_at,
                             stripe_checkout_session_id, livemode, created_at)
  values (v_id, p_user, (select lower(email) from auth.users where id = p_user), 'open', 0, 'v-pgtap', now(),
          'cs_test_PGTAP_' || p_tag, false, p_created);
  for i in 1..cardinality(p_products) loop
    insert into public.order_items (order_id, product_id, position, stripe_price_id)
    select v_id, p.id, i, p.stripe_price_id from public.products p where p.id = p_products[i];
  end loop;
  v_path := case p_status
    when 'open' then '{}' when 'pending_payment' then '{pending_payment}' when 'paid' then '{paid}'
    when 'failed' then '{failed}' when 'expired' then '{expired}'
    when 'disputed' then '{paid,disputed}' when 'dispute_lost' then '{paid,disputed,dispute_lost}'
    when 'refunded' then '{paid,refunded}' end::text[];
  for i in 1..coalesce(cardinality(v_path), 0) loop
    perform pg_temp.mv(v_id, v_path[i]);
  end loop;
  return v_id;
end $$;

-- direitos (um por item) com a fotografia da composição
create function pg_temp.mk_ents(p_order uuid, p_status text default 'active', p_reason text default null) returns void
language plpgsql as $$
declare r record; v_ent uuid;
begin
  for r in select i.product_id, o.user_id from public.order_items i join public.orders o on o.id = i.order_id
           where i.order_id = p_order order by i.position loop
    insert into public.entitlements (order_id, product_id, user_id, status, revoked_at, revoke_reason)
    values (p_order, r.product_id, r.user_id, p_status, case when p_status = 'revoked' then now() end, p_reason)
    returning id into v_ent;
    insert into public.entitlement_games (entitlement_id, game_id, position)
    select v_ent, pg.game_id, pg.position from public.product_games pg where pg.product_id = r.product_id;
  end loop;
end $$;

-- Este é o único arquivo que depende do seed. Roda sobre a base semeada, sem criar dados.
-- Robusto à stack compartilhada: toda asserção conta só o que o SEED criou (por e-mail ou código conhecido), nunca o
-- total do banco; usuários extras (qa-* dos e2e, por exemplo) e a ordem de execução não alteram o resultado.
-- As views existem só nesta transação (pg_temp) e somem no rollback.
create temp view seed_users as select id, email from auth.users where email like 'teste-%@keytotwo.test';
create temp view seed_products as select * from public.products where code in ('P001', 'J001', 'TESTE-AV2');
create temp view seed_games as select * from public.games where code in ('TESTE-J01', 'TESTE-J02', 'TESTE-J03', 'TESTE-J04', 'TESTE-J05', 'TESTE-GRATIS');
create temp view seed_files as select * from public.files where game_id in (select id from seed_games);
create temp view seed_orders as select * from public.orders where user_id in (select id from seed_users);

-- ===== conteúdo e rótulos ==========================================================================
select pg_temp.assert('5 usuários de teste (4 confirmados, 1 não)', (select count(*) = 5 and count(*) filter (where email_confirmed_at is not null) = 4 from auth.users where email like 'teste-%@keytotwo.test'));
select pg_temp.assert('usuários do seed no formato do GoTrue: tokens de texto sem NULL (senão admin/users responde 500 e o login por código falha)',
  (select count(*) = 5 and bool_and(confirmation_token is not null and recovery_token is not null and email_change_token_new is not null and email_change is not null and email_change_token_current is not null and reauthentication_token is not null and phone_change is not null and phone_change_token is not null) from auth.users where email like 'teste-%@keytotwo.test'));
select pg_temp.assert('cada usuário do seed tem identidade de e-mail coerente (provider_id = id, email_verified acompanha a confirmação)',
  (select count(*) = 5 and bool_and(i.provider = 'email' and i.provider_id = u.id::text and (i.identity_data->>'email_verified')::boolean = (u.email_confirmed_at is not null)) from auth.users u join auth.identities i on i.user_id = u.id where u.email like 'teste-%@keytotwo.test'));
select pg_temp.assert('todo usuário do seed tem perfil criado pela trigger', (select count(*) = 5 from public.profiles p join auth.users u on u.id = p.user_id where u.email like 'teste-%@keytotwo.test'));
select pg_temp.assert('account_confirmed gravado para os 4 confirmados e não para o C', (select count(*) = 4 from public.funnel_events f join auth.users u on u.id = f.user_id where f.type = 'account_confirmed' and u.email like 'teste-%@keytotwo.test')
  and (select count(*) = 0 from public.funnel_events f join auth.users u on u.id = f.user_id where f.type = 'account_confirmed' and u.email = 'teste-c@keytotwo.test'));
select pg_temp.assert('3 produtos: P001 (pacote de 5), o avulso J001 e o avulso TESTE-AV2', (select count(*) = 3 and count(*) filter (where kind = 'bundle') = 1 and count(*) filter (where kind = 'single') = 2 from seed_products));
select pg_temp.assert('P001 com nome PENDENTE e rótulo TESTE; avulsos só TESTE', (select name = '[PENDENTE] Nome comercial do P001 [TESTE]' from public.products where code = 'P001')
  and (select bool_and(name like '[TESTE]%') from seed_products where kind = 'single'));
select pg_temp.assert('todo produto leva TESTE ou PENDENTE no nome; todo jogo é identificável como teste pelo code e pelo slug (o nome pode ser limpo)', (select count(*) = 0 from seed_products where name !~ '(TESTE|PENDENTE)')
  and (select count(*) = 0 from seed_games where code !~ '^TESTE-' or slug !~ '^teste-'));
select pg_temp.assert('avulso J001: single ativo, 1 jogo esperado, ligado só ao jogo TESTE-J01 (Rabisque e Adivinhe), com Price price_TESTE_J001 ou o Price real de TESTE',
  (select p.kind = 'single' and p.status = 'active' and p.games_expected = 1 and p.slug = 'j001'
          and (p.stripe_price_id = 'price_TESTE_J001' or p.stripe_price_id ~ '^price_[A-Za-z0-9_]+$')
          and (select array_agg(g.code) = array['TESTE-J01'] from public.product_games pg join public.games g on g.id = pg.game_id where pg.product_id = p.id)
   from public.products p where p.code = 'J001'));
select pg_temp.assert('6 jogos: 5 pagos publicados + 1 grátis em draft', (select count(*) = 6 and count(*) filter (where access = 'paid' and status = 'published') = 5 and count(*) filter (where access = 'free' and status = 'draft') = 1 from seed_games));
select pg_temp.assert('composição: P001 = 5 jogos; cada avulso = 1 (e os avulsos repetem jogos do P001)', (select count(*) = 7 from public.product_games pg where pg.product_id in (select id from seed_products))
  and (select count(*) = 5 from public.product_games pg join seed_products p on p.id = pg.product_id where p.code = 'P001'));
select pg_temp.assert('6 arquivos e 6 objetos do B2 (5 PDFs pagos e o grátis), todos fictícios, sem URL', (select count(*) = 6 from seed_files) and (select count(*) = 6 from public.file_objects where file_id in (select id from seed_files))
  and (select bool_and(case when status = 'published' then size_bytes = 699 and sha256 ~ '^[0-9a-f]{64}$' and sha256 <> repeat('0', 64)
                            else size_bytes = 1024 and sha256 = repeat('0', 64) end) from seed_files)
  and (select bool_and(object_key !~ '(:|\?|\s)' and bucket = 'bucket-teste-pendente') from public.file_objects where file_id in (select id from seed_files)));
select pg_temp.assert('arquivo grátis em draft; todo arquivo é PDF', (select count(*) = 1 from seed_files where status = 'draft' and access = 'free')
  and (select bool_and(kind = 'pdf') from seed_files));
select pg_temp.assert('nenhum preço: valores 0 (e subtotal e desconto 0) nos pedidos do seed', (select bool_and(amount_total = 0 and amount_subtotal = 0 and amount_discount = 0 and promotion_code is null) from seed_orders where amount_total is not null));
select pg_temp.assert('Prices: todos fictícios, price_TESTE_*',
  (select bool_and(stripe_price_id ~ '^price_TESTE_[A-Za-z0-9_]+$') from seed_products));
select pg_temp.assert('e-mails, ids da Stripe e termos rotulados como teste', (select count(*) = 8 and bool_and(email like '%@keytotwo.test' and terms_version = 'v1-TESTE') from seed_orders)
  and (select bool_and(coalesce(stripe_checkout_session_id, 'cs_test_TESTE_x') ~ 'TESTE' and coalesce(stripe_payment_intent_id, 'pi_TESTE_x') ~ 'TESTE') from seed_orders)
  and (select bool_and(stripe_customer_id ~ 'TESTE') from public.profiles where user_id in (select id from seed_users) and stripe_customer_id is not null));

select pg_temp.assert('convite de marketing: só A já o viu (marketing_prompted_at); ninguém tem consentimento sem passar pelo histórico', (select count(*) = 1 from public.profiles where marketing_prompted_at is not null and user_id in (select id from seed_users)) and (select marketing_prompted_at is not null from public.profiles p join seed_users u on u.id = p.user_id where u.email = 'teste-a@keytotwo.test')
  and (select count(*) filter (where marketing_opt_in) = 1 from public.profiles where user_id in (select id from seed_users)) and (select count(*) = 1 from public.marketing_consents where user_id in (select id from seed_users)));

-- ===== pedidos em todos os estados ==================================================================
select pg_temp.assert('8 pedidos, um em cada estado possível do P2 (paid ×2)', (select array_agg(status order by status collate "C") = array['dispute_lost','disputed','expired','open','paid','paid','pending_payment','refunded'] from seed_orders));
select pg_temp.assert('refs distintas (8 prefixos distintos de id)', (select count(distinct left(replace(id::text, '-', ''), 8)) = 8 from seed_orders));
select pg_temp.assert('direitos: 2 ativos e 3 revogados (1 refund, 2 dispute); nenhum fora de pedido da família paga',
  (select count(*) filter (where status = 'active') = 2 and count(*) filter (where status = 'revoked' and revoke_reason = 'refund') = 1 and count(*) filter (where status = 'revoked' and revoke_reason = 'dispute') = 2 from public.entitlements where user_id in (select id from seed_users)));
select pg_temp.assert('fotografia da composição: 9 linhas (5 do P001 + 1 de cada um dos 4 avulsos)', (select count(*) = 9 from public.entitlement_games eg join public.entitlements e on e.id = eg.entitlement_id where e.user_id in (select id from seed_users)));
select pg_temp.assert('valores cobrados gravados nos itens dos pedidos que passaram de pending_payment', (select bool_and(i.unit_amount = 0 and i.currency = 'brl') from public.order_items i join seed_orders o on o.id = i.order_id where o.status in ('pending_payment','paid','disputed','dispute_lost','refunded')));
select pg_temp.assert('termos aceitos em todos os pedidos', (select count(*) = 8 and bool_and(terms_accepted_at is not null) from seed_orders));

-- ===== as RPCs sobre o seed ========================================================================
select pg_temp.assert('A (dona do P001) tem os 5 jogos e nenhum pendente', (select jsonb_array_length(public.get_library(u.id)->'games') = 5 and jsonb_array_length(public.get_library(u.id)->'pending') = 0 from auth.users u where u.email = 'teste-a@keytotwo.test'));
select pg_temp.assert('B (avulso 1) tem 1 jogo, via J001', (select jsonb_array_length(public.get_library(u.id)->'games') = 1 and public.get_library(u.id)->'games'->0->'products'->0->>'code' = 'J001' from auth.users u where u.email = 'teste-b@keytotwo.test'));
select pg_temp.assert('D só tem pedido em processamento, E nada ativo', (select jsonb_array_length(public.get_library(u.id)->'games') = 0 and jsonb_array_length(public.get_library(u.id)->'pending') = 1 from auth.users u where u.email = 'teste-d@keytotwo.test')
  and (select public.get_library(u.id) = '{"games": [], "pending": []}'::jsonb from auth.users u where u.email = 'teste-e@keytotwo.test'));
select pg_temp.assert('cart_add(A, J001): aceita o já possuído (A já tem o jogo 1 inteiro), com o jogo em owned_games', (select outcome = 'added' and owned_games = '["TESTE-J01"]'::jsonb from auth.users u, lateral public.cart_add(u.id, 'J001') where u.email = 'teste-a@keytotwo.test'));
select pg_temp.assert('carrinho de B: P001 com sobreposição parcial (já tem o jogo 1)', (select (public.get_cart(u.id)->>'version')::int = 1 and public.get_cart(u.id)->'items'->0->>'code' = 'P001'
  and public.get_cart(u.id)->'items'->0->'owned_games' = '["TESTE-J01"]'::jsonb and public.get_cart(u.id)->'items'->0->>'status' = 'ok' from auth.users u where u.email = 'teste-b@keytotwo.test'));
select pg_temp.assert('o carrinho de A só tem o J001, riscado (already_owned), e é isolado do de B', (select jsonb_path_query_array(public.get_cart(u.id)->'items', '$[*].code') = '["J001"]'::jsonb and public.get_cart(u.id)->'items'->0->>'status' = 'already_owned' from auth.users u where u.email = 'teste-a@keytotwo.test'));
do $c$ begin perform public.cart_remove((select id from auth.users where email = 'teste-a@keytotwo.test'), 'J001'); end $c$;
select pg_temp.expect('C (não confirmado) não consegue usar o carrinho', $q$select * from public.cart_add((select id from auth.users where email = 'teste-c@keytotwo.test'), 'P001')$q$, 'KT009');
select pg_temp.assert('get_account(D): pendente, reembolsado e contestado; sem checkout abandonado', (select jsonb_array_length(public.get_account(u.id)->'orders') = 3 from auth.users u where u.email = 'teste-d@keytotwo.test'));
select pg_temp.assert('get_account(E): só a contestação perdida (expired e open ficam de fora)', (select jsonb_array_length(public.get_account(u.id)->'orders') = 1 and public.get_account(u.id)->'orders'->0->>'status' = 'dispute_lost' from auth.users u where u.email = 'teste-e@keytotwo.test'));
select pg_temp.assert('consentimento: só A tem opt-in vigente (v1-TESTE)', (select (public.get_account(u.id)->'marketing'->>'opted_in')::boolean and public.get_account(u.id)->'marketing'->>'text_version' = 'v1-TESTE' from auth.users u where u.email = 'teste-a@keytotwo.test')
  and (select count(*) = 1 from public.profiles where marketing_opt_in and user_id in (select id from seed_users)));
select pg_temp.assert('get_catalog: os 3 produtos do seed, todos vendáveis', (select count(*) = 3 and bool_and(coalesce(e->>'code', '') <> '') from jsonb_array_elements(public.get_catalog()) e where e->>'code' in ('P001', 'J001', 'TESTE-AV2')));

-- ===== fila de e-mail ==============================================================================
select pg_temp.assert('as 2 entregas do seed (pedidos pagos de A e de B) estão na fila de e-mail, transacionais e sem token (em qualquer estado: o despacho pode já tê-las enviado)',
  (select count(*) = 2 and bool_and(category = 'transactional' and payload::text !~ '(token|https?:)') from public.email_outbox where kind = 'delivery' and user_id in (select id from seed_users)));
select pg_temp.assert('payload da entrega: ref, produtos e um jogo por direito (entitlement_id e game_id)',
  (select jsonb_array_length(payload->'games') = 5 and (payload->'games'->0 ?& array['entitlement_id','game_id','code','name']) and payload->>'order_ref' ~ '^[0-9A-F]{8}$'
   from public.email_outbox o join public.orders ord on ord.id = o.order_id where o.kind = 'delivery' and ord.stripe_checkout_session_id = 'cs_test_TESTE_O1'));

-- ===== I3: checkout e liberação sobre o seed (rollback no fim: o seed não muda) =====================
do $c$
declare
  v_b uuid := (select id from seed_users where email = 'teste-b@keytotwo.test');
  v_o uuid;
  v_price text := (select stripe_price_id from public.products where code = 'P001');
begin
  create temp table smoke (k text primary key, j jsonb);
  insert into smoke select 'co1', to_jsonb(r) from public.create_order_from_cart(v_b, false, 1, 'v1-TESTE', true) r;
  insert into smoke select 'co2', to_jsonb(r) from public.create_order_from_cart(v_b, false, 1, 'v1-TESTE', true) r;
  v_o := (select (j->>'order_id')::uuid from smoke where k = 'co1');
  perform public.attach_checkout_session(v_o, 'cs_test_SMOKE_B1');
  insert into smoke select 'ful', to_jsonb(r) from public.fulfill_order(v_o, 'cs_test_SMOKE_B1', 'paid', 100, 10, 90, 'brl', 'SMOKE10', 'pi_SMOKE_B1', null, false,
    jsonb_build_array(jsonb_build_object('stripe_price_id', v_price, 'quantity', 1, 'unit_amount', 100, 'currency', 'brl')), 'webhook', 'evt_SMOKE_B1', 'checkout.session.completed') r;
  insert into smoke select 'rep', to_jsonb(r) from public.fulfill_order(v_o, 'cs_test_SMOKE_B1', 'paid', 100, 10, 90, 'brl', 'SMOKE10', 'pi_SMOKE_B1', null, false,
    jsonb_build_array(jsonb_build_object('stripe_price_id', v_price, 'quantity', 1, 'unit_amount', 100, 'currency', 'brl')), 'webhook', 'evt_SMOKE_B1', 'checkout.session.completed') r;
end $c$;
select pg_temp.assert('seed I3: o carrinho de B vira um pedido open com o P001 e o Price do catálogo',
  (select j->>'outcome' = 'ok' and not (j->>'reused')::boolean and jsonb_array_length(j->'items') = 1 and j->'items'->0->>'product_code' = 'P001'
          and j->'items'->0->>'stripe_price_id' = (select stripe_price_id from public.products where code = 'P001')
          and j->>'email' = 'teste-b@keytotwo.test' from smoke where k = 'co1'));
select pg_temp.assert('seed I3: chamar de novo reaproveita o pedido', (select (j->>'reused')::boolean and j->>'order_id' = (select j->>'order_id' from smoke where k = 'co1') from smoke where k = 'co2'));
select pg_temp.assert('seed I3: fulfill_order libera o P001 com o cupom e a entrega', (select j->>'outcome' = 'applied' and (j->>'entitlement_count')::int = 1 and (j->>'send_delivery')::boolean from smoke where k = 'ful'));
select pg_temp.assert('seed I3: reenvio do mesmo evento é duplicate_event', (select j->>'outcome' = 'duplicate_event' and not (j->>'send_delivery')::boolean from smoke where k = 'rep'));
select pg_temp.assert('seed I3: B passa a ter os 5 jogos do P001 (o J01 já era dele) e o carrinho sem o P001',
  (select jsonb_array_length(public.get_library(u.id)->'games') = 5 from seed_users u where u.email = 'teste-b@keytotwo.test')
  and (select count(*) = 0 from public.cart_items ci join seed_users u on u.id = ci.user_id where u.email = 'teste-b@keytotwo.test'));
select pg_temp.assert('seed I3: o pedido de B guarda subtotal 100, desconto 10, total 90 e o código',
  (select amount_subtotal = 100 and amount_discount = 10 and amount_total = 90 and promotion_code = 'SMOKE10' and status = 'paid'
   from public.orders o join seed_users u on u.id = o.user_id where u.email = 'teste-b@keytotwo.test' and o.stripe_checkout_session_id = 'cs_test_SMOKE_B1'));
select pg_temp.assert('seed I3: get_order_status do pedido pago de A (O1): dono vê o P001, outra conta só o estado',
  (select outcome = 'ok' and status = 'paid' and relation = 'owner' and items->0->>'code' = 'P001'
   from public.get_order_status('a1000001-0000-4000-8000-000000000001'::uuid, (select id from seed_users where email = 'teste-a@keytotwo.test')))
  and (select relation = 'other' and items is null
   from public.get_order_status('a1000001-0000-4000-8000-000000000001'::uuid, (select id from seed_users where email = 'teste-e@keytotwo.test'))));

-- ===== I4: downloads, entrega e fila sobre o seed (rollback no fim) ==================================
do $c$
declare
  v_a uuid := (select id from seed_users where email = 'teste-a@keytotwo.test');
  v_b uuid := (select id from seed_users where email = 'teste-b@keytotwo.test');
  v_e uuid := (select id from seed_users where email = 'teste-e@keytotwo.test');
  v_f1 uuid := (select id from public.files where filename = 'TESTE-J01-v1.0.pdf');
  v_f3 uuid := (select id from public.files where filename = 'TESTE-J03-v1.0.pdf');
  v_ent_a uuid := (select e.id from public.entitlements e where e.order_id = 'a1000001-0000-4000-8000-000000000001'::uuid);
  v_game3 bigint := (select id from public.games where code = 'TESTE-J03');
begin
  if not exists (select 1 from pg_tables where tablename = 'smoke4') then create temp table smoke4 (k text, j jsonb); end if;
  insert into smoke4 select 'ev0', to_jsonb(coalesce((select max(id) from public.download_events), 0));   -- só o que vier depois disto é do smoke
  insert into smoke4 select 'dl_a', to_jsonb(r) from public.resolve_download(v_a, v_f1) r;
  insert into smoke4 select 'dl_b3', to_jsonb(r) from public.resolve_download(v_b, v_f3) r;   -- B comprou o P001 no smoke do I3, logo acima
  insert into smoke4 select 'dl_e1', to_jsonb(r) from public.resolve_download(v_e, v_f1) r;   -- E só tem direitos revogados
  insert into smoke4 select 'del', to_jsonb(r) from public.resolve_delivery(v_ent_a, v_game3) r;
  insert into smoke4 select 'free', public.list_free_games();
end $c$;
select pg_temp.assert('seed I4: A (dona do P001) baixa o TESTE-J01 com a chave do seed, o nome e os 699 bytes',
  (select j->>'outcome' = 'ok' and j->>'object_key' = 'paid/TESTE-J01/1.0/TESTE-J01-v1.0.pdf' and j->>'filename' = 'TESTE-J01-v1.0.pdf' and j->>'content_type' = 'application/pdf'
          and (j->>'size_bytes')::int = 699 from smoke4 where k = 'dl_a'));
select pg_temp.assert('seed I4: B, que acabou de comprar o P001, baixa o jogo 3; E (sem direito ativo) não baixa o jogo 1',
  (select j->>'outcome' = 'ok' and j->>'object_key' = 'paid/TESTE-J03/1.0/TESTE-J03-v1.0.pdf' from smoke4 where k = 'dl_b3')
  and (select j->>'outcome' = 'not_entitled' and j->'object_key' = 'null'::jsonb from smoke4 where k = 'dl_e1'));
select pg_temp.assert('seed I4: a entrega do pedido de A serve o jogo 3 pela versão vigente', (select j->>'outcome' = 'ok' and j->>'object_key' = 'paid/TESTE-J03/1.0/TESTE-J03-v1.0.pdf' from smoke4 where k = 'del'));
select pg_temp.assert('seed I4: sem jogo gratuito publicado, lista vazia', (select j = '[]'::jsonb from smoke4 where k = 'free'));
select pg_temp.assert('seed I4: os downloads gravaram eventos pagos, sem IP', (select count(*) = 3 and bool_and(kind = 'paid') from public.download_events where user_id in (select id from seed_users) and id > (select (j #>> '{}')::bigint from smoke4 where k = 'ev0')));
do $c$
begin
  insert into smoke4 select 'claim', to_jsonb(r) from public.claim_email_batch(5, (select (j->>'outbox_id')::uuid from smoke where k = 'ful')) r;
end $c$;
select pg_temp.assert('seed I4: o claim por p_outbox_id entrega ao despachante a entrega do pedido que o smoke do I3 acabou de pagar, com o payload por jogo',
  (select count(*) = 1 and bool_and(j->>'kind' = 'delivery' and j->>'category' = 'transactional' and j->>'to_email' = 'teste-b@keytotwo.test' and jsonb_array_length(j->'payload'->'games') = 5) from smoke4 where k = 'claim'));
do $c$
declare v_id uuid := (select (j->>'id')::uuid from smoke4 where k = 'claim' order by j->>'id' limit 1);
begin
  insert into smoke4 select 'mark', to_jsonb(r) from public.mark_email_result(v_id, 'sent', 'msg-seed') r;
  insert into smoke4 select 'marked_id', to_jsonb(v_id);
end $c$;
select pg_temp.assert('seed I4: mark sent aplica o envio', (select j->>'outcome' = 'applied' and j->>'status' = 'sent' from smoke4 where k = 'mark'));
select pg_temp.assert('seed I4: ... a linha ficou sent e o funil registrou delivery_sent uma vez no pedido',
  (select x.status = 'sent' and x.provider_message_id = 'msg-seed' from public.email_outbox x where x.id = (select (j #>> '{}')::uuid from smoke4 where k = 'marked_id'))
  and (select count(*) = 1 from public.funnel_events f join public.email_outbox x on x.order_id = f.order_id
        where f.type = 'delivery_sent' and x.id = (select (j #>> '{}')::uuid from smoke4 where k = 'marked_id')));

select * from finish();
rollback;
