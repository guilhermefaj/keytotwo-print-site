-- 04_cart: carrinho isolado por usuário, version, posse sobreposta, catálogo (docs/data-contract.md v0.3.3, seção 6.2).
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

do $fx$
declare v_pk bigint; v_sg1 bigint; v_sg2 bigint; v_ov bigint; v_pt bigint; a uuid; o uuid;
begin
  v_pk  := pg_temp.mk_product('PK1', 'bundle', 3);      -- jogos GM-PK1-1..3
  v_sg1 := pg_temp.mk_product('SG1', 'single', 1);      -- jogo GM-SG1-1
  v_sg2 := pg_temp.mk_product('SG2', 'single', 1);      -- jogo GM-SG2-1
  -- OV1: avulso que contém o jogo 1 do PK1 (sobreposição total com o pacote)
  insert into public.products (code, slug, kind, name, status, stripe_price_id, games_expected)
  values ('OV1', 'ov1', 'single', 'Avulso OV1 [TESTE]', 'active', 'price_PGTAP_OV1', 1) returning id into v_ov;
  insert into public.product_games (product_id, game_id, position) select v_ov, id, 1 from public.games where code = 'GM-PK1-1';
  -- PT1: pacote de 2 jogos, um do PK1 e um do SG1 (sobreposição parcial)
  insert into public.products (code, slug, kind, name, status, stripe_price_id, games_expected)
  values ('PT1', 'pt1', 'bundle', 'Pacote PT1 [TESTE]', 'active', 'price_PGTAP_PT1', 2) returning id into v_pt;
  insert into public.product_games (product_id, game_id, position) select v_pt, id, 1 from public.games where code = 'GM-PK1-1';
  insert into public.product_games (product_id, game_id, position) select v_pt, id, 2 from public.games where code = 'GM-SG1-1';
  perform pg_temp.mk_user('ca');
  perform pg_temp.mk_user('cb');
  perform pg_temp.mk_user('cc', false);
  perform pg_temp.mk_user('cd');
end $fx$;

-- ===== isolamento entre usuários e version ========================================================
select pg_temp.assert('carrinho vazio: {"version": 0, "items": []}', (select public.get_cart(pg_temp.uid('ca')) = '{"version": 0, "items": []}'::jsonb));
select pg_temp.assert('cart_add: added, version 1', (select outcome = 'added' and cart_version = 1 from public.cart_add(pg_temp.uid('ca'), 'SG1')));
select pg_temp.assert('cart_add repetido: noop, version intacta', (select outcome = 'noop' and cart_version = 1 from public.cart_add(pg_temp.uid('ca'), 'SG1')));
select pg_temp.assert('A tem 1 item', (select jsonb_array_length(public.get_cart(pg_temp.uid('ca'))->'items') = 1 and (public.get_cart(pg_temp.uid('ca'))->>'version')::int = 1));
select pg_temp.assert('o carrinho de B segue vazio (isolamento A × B)', (select public.get_cart(pg_temp.uid('cb')) = '{"version": 0, "items": []}'::jsonb));
select pg_temp.assert('B adiciona o mesmo produto sem afetar A', (select outcome = 'added' and cart_version = 1 from public.cart_add(pg_temp.uid('cb'), 'SG1'))
  and (select (public.get_cart(pg_temp.uid('ca'))->>'version')::int = 1));
select pg_temp.assert('B remove: o carrinho de A não muda', (select outcome = 'removed' and cart_version = 2 from public.cart_remove(pg_temp.uid('cb'), 'SG1'))
  and (select jsonb_array_length(public.get_cart(pg_temp.uid('ca'))->'items') = 1));
select pg_temp.assert('cart_remove repetido: noop', (select outcome = 'noop' and cart_version = 2 from public.cart_remove(pg_temp.uid('cb'), 'SG1')));
select pg_temp.assert('cart_remove de código desconhecido: noop', (select outcome = 'noop' from public.cart_remove(pg_temp.uid('cb'), 'NAO-EXISTE')));
select pg_temp.assert('cart_remove sem carrinho: noop, version 0', (select outcome = 'noop' and cart_version = 0 from public.cart_remove(pg_temp.uid('cd'), 'SG1')));
select pg_temp.assert('funil: cart_item_added e cart_item_removed com a versão', (select count(*) = 1 from public.funnel_events where user_id = pg_temp.uid('cb') and type = 'cart_item_added' and cart_version = 1)
  and (select count(*) = 1 from public.funnel_events where user_id = pg_temp.uid('cb') and type = 'cart_item_removed' and cart_version = 2)
  and (select count(*) = 1 from public.funnel_events where user_id = pg_temp.uid('ca') and type = 'cart_item_added'));
select pg_temp.assert('a version só sobe quando algo muda', (select outcome = 'noop' and cart_version = 1 from public.cart_add(pg_temp.uid('ca'), 'SG1')));

-- ===== produto indisponível ======================================================================
select pg_temp.assert('cart_add de código inexistente: product_unavailable', (select outcome = 'product_unavailable' from public.cart_add(pg_temp.uid('ca'), 'NAO-EXISTE')));
update public.products set status = 'archived' where code = 'SG2';
select pg_temp.assert('cart_add de produto arquivado: product_unavailable', (select outcome = 'product_unavailable' from public.cart_add(pg_temp.uid('ca'), 'SG2')));
update public.products set status = 'active' where code = 'SG2';
update public.games set status = 'draft' where code = 'GM-SG2-1';
select pg_temp.assert('cart_add com jogo não publicado: product_unavailable', (select outcome = 'product_unavailable' from public.cart_add(pg_temp.uid('ca'), 'SG2')));
update public.games set status = 'published' where code = 'GM-SG2-1';
update public.products set games_expected = 4 where code = 'PK1';
select pg_temp.assert('cart_add com composição incompleta: product_unavailable', (select outcome = 'product_unavailable' from public.cart_add(pg_temp.uid('ca'), 'PK1')));
update public.products set games_expected = 3 where code = 'PK1';
select pg_temp.assert('produto vendável volta a entrar', (select outcome = 'added' from public.cart_add(pg_temp.uid('cd'), 'SG2')));

-- ===== e-mail confirmado (KT009) ==================================================================
select pg_temp.expect('cart_add: usuário não confirmado', format($q$select * from public.cart_add(%L, 'SG1')$q$, pg_temp.uid('cc')), 'KT009');
select pg_temp.expect('cart_remove: usuário não confirmado', format($q$select * from public.cart_remove(%L, 'SG1')$q$, pg_temp.uid('cc')), 'KT009');
select pg_temp.expect('get_cart: usuário não confirmado', format($q$select public.get_cart(%L)$q$, pg_temp.uid('cc')), 'KT009');
select pg_temp.expect('cart_add: usuário inexistente', $q$select * from public.cart_add(gen_random_uuid(), 'SG1')$q$, 'KT009');
select pg_temp.expect('cart_add: p_user_id nulo', $q$select * from public.cart_add(null, 'SG1')$q$, 'KT001');
select pg_temp.expect('cart_add: código vazio', format($q$select * from public.cart_add(%L, '  ')$q$, pg_temp.uid('ca')), 'KT001');
select pg_temp.assert('o usuário não confirmado não ganhou carrinho', (select count(*) = 0 from public.carts where user_id = pg_temp.uid('cc')));

-- ===== posse: já possuído por inteiro é recusado; sobreposição parcial é aceita e sinalizada ======
do $own$
declare o uuid;
begin
  o := pg_temp.mk_order(pg_temp.uid('cb'), 'paid', array[(select id from public.products where code = 'PK1')], 'OWN1');
  perform pg_temp.mk_ents(o);
end $own$;
select pg_temp.assert('already_owned: o pacote que B já possui', (select outcome = 'already_owned' and owned_games = '["GM-PK1-1","GM-PK1-2","GM-PK1-3"]'::jsonb from public.cart_add(pg_temp.uid('cb'), 'PK1')));
select pg_temp.assert('already_owned: avulso contido no pacote possuído (OV1 ⊂ PK1)', (select outcome = 'already_owned' from public.cart_add(pg_temp.uid('cb'), 'OV1')));
select pg_temp.assert('already_owned não mexe no carrinho nem na version', (select count(*) = 0 from public.cart_items where user_id = pg_temp.uid('cb')) and (select version = 2 from public.carts where user_id = pg_temp.uid('cb')));
select pg_temp.assert('sobreposição parcial é aceita e sinalizada (PT1 tem 1 de 2 jogos de B)', (select outcome = 'added' and owned_games = '["GM-PK1-1"]'::jsonb from public.cart_add(pg_temp.uid('cb'), 'PT1')));
select pg_temp.assert('outro usuário sem posse: o mesmo produto entra sem aviso', (select outcome = 'added' and owned_games = '[]'::jsonb from public.cart_add(pg_temp.uid('ca'), 'PT1')));
select pg_temp.assert('get_cart: aviso de sobreposição parcial em owned_games',
  (select (i->>'status' = 'ok') and (i->'owned_games' = '["GM-PK1-1"]'::jsonb)
   from jsonb_array_elements(public.get_cart(pg_temp.uid('cb'))->'items') i where i->>'code' = 'PT1'));
select pg_temp.assert('get_cart: shared_with entre itens do próprio carrinho (SG1 e PT1 dividem o jogo GM-SG1-1)',
  (select (i->'shared_with') = '["PT1"]'::jsonb from jsonb_array_elements(public.get_cart(pg_temp.uid('ca'))->'items') i where i->>'code' = 'SG1')
  and (select (i->'shared_with') = '["SG1"]'::jsonb from jsonb_array_elements(public.get_cart(pg_temp.uid('ca'))->'items') i where i->>'code' = 'PT1'));

-- ===== get_cart: status por item, ordem, campos ===================================================
select pg_temp.assert('get_cart: itens na ordem de added_at', (select jsonb_agg(i->>'code') = '["SG1","PT1"]'::jsonb from jsonb_array_elements(public.get_cart(pg_temp.uid('ca'))->'items') i));
select pg_temp.assert('get_cart: campos do item', (select (i ? 'code') and (i ? 'kind') and (i ? 'name') and (i ? 'stripe_price_id') and (i ? 'games') and (i ? 'available') and (i ? 'status') and (i ? 'owned_games') and (i ? 'shared_with')
  from jsonb_array_elements(public.get_cart(pg_temp.uid('ca'))->'items') i limit 1));
select pg_temp.assert('get_cart: jogos do item por position', (select i->'games' = '[{"code":"GM-PK1-1","name":"Jogo GM-PK1-1 [TESTE]"},{"code":"GM-SG1-1","name":"Jogo GM-SG1-1 [TESTE]"}]'::jsonb
  from jsonb_array_elements(public.get_cart(pg_temp.uid('ca'))->'items') i where i->>'code' = 'PT1'));
update public.products set status = 'archived' where code = 'SG1';
select pg_temp.assert('get_cart: item que deixou de ser vendável vira unavailable', (select i->>'status' = 'unavailable' and (i->>'available')::boolean = false
  from jsonb_array_elements(public.get_cart(pg_temp.uid('ca'))->'items') i where i->>'code' = 'SG1'));
update public.products set status = 'active' where code = 'SG1';
do $own2$
declare o uuid;
begin
  o := pg_temp.mk_order(pg_temp.uid('ca'), 'paid', array[(select id from public.products where code = 'SG1')], 'OWN2');
  perform pg_temp.mk_ents(o);
end $own2$;
select pg_temp.assert('get_cart: item cujo jogo o usuário passou a possuir vira already_owned', (select i->>'status' = 'already_owned'
  from jsonb_array_elements(public.get_cart(pg_temp.uid('ca'))->'items') i where i->>'code' = 'SG1'));

-- ===== get_catalog =================================================================================
select pg_temp.assert('get_catalog: lista só produtos ativos e vendáveis, com preço e jogos por position',
  (select (c->>'stripe_price_id' = 'price_PGTAP_PK1') and jsonb_array_length(c->'games') = 3 and (c->'games'->0->>'code') = 'GM-PK1-1' and (c->>'kind') = 'bundle'
   from jsonb_array_elements(public.get_catalog()) c where c->>'code' = 'PK1'));
update public.products set status = 'archived' where code = 'SG2';
select pg_temp.assert('get_catalog: arquivado some', (select count(*) = 0 from jsonb_array_elements(public.get_catalog()) c where c->>'code' = 'SG2'));
update public.products set status = 'active' where code = 'SG2';
update public.games set status = 'draft' where code = 'GM-SG2-1';
select pg_temp.assert('get_catalog: produto com jogo não publicado some', (select count(*) = 0 from jsonb_array_elements(public.get_catalog()) c where c->>'code' = 'SG2'));
update public.games set status = 'published' where code = 'GM-SG2-1';
select pg_temp.assert('get_catalog: volta quando fica vendável', (select count(*) = 1 from jsonb_array_elements(public.get_catalog()) c where c->>'code' = 'SG2'));
select pg_temp.assert('get_catalog: sem chave do B2 nem URL', (select public.get_catalog()::text !~ '(object_key|bucket|https?:)'));

-- ===== o service_role (papel da API) chama as RPCs ================================================
select pg_temp.expect_as('service_role: cart_add', 'service_role', format($q$select * from public.cart_add(%L, 'PK1')$q$, pg_temp.uid('cd')), 'OK');
select pg_temp.expect_as('service_role: get_cart', 'service_role', format($q$select public.get_cart(%L)$q$, pg_temp.uid('cd')), 'OK');

select * from finish();
rollback;
