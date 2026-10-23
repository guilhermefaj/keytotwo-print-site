-- 02_privileges_rls: RLS, policies, GRANTs e ACL (docs/data-contract.md v0.3.3, seção 5; D-1 e D-12).
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

-- anon, authenticated e service_role NÃO têm privilégio de tabela algum; a API só executa RPCs.
-- (A chave do B2, em file_objects, é ilegível para os três: não há GRANT em tabela nenhuma.)

select pg_temp.assert('RLS ligada nas 19 tabelas', (select count(*) = 19 from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity
    and c.relname in ('products','games','product_games','files','file_objects','profiles','marketing_consents','email_suppressions','carts','cart_items','orders','order_items','order_events','entitlements','entitlement_games','stripe_events','funnel_events','download_events','email_outbox')));
select pg_temp.assert('deny_client_access é a única policy, em todas as 19 (anon e authenticated, ALL)',
  (select count(*) = 19 from pg_policies where schemaname = 'public' and policyname = 'deny_client_access' and cmd = 'ALL' and cardinality(roles) = 2)
  and (select count(*) = 19 from pg_policies where schemaname = 'public' and tablename in ('products','games','product_games','files','file_objects','profiles','marketing_consents','email_suppressions','carts','cart_items','orders','order_items','order_events','entitlements','entitlement_games','stripe_events','funnel_events','download_events','email_outbox')));
select pg_temp.assert('nenhum privilégio de tabela para anon, authenticated e service_role (D-12)',
  (select count(*) = 0 from pg_class c, unnest(array['anon','authenticated','service_role']) r,
        unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname in ('products','games','product_games','files','file_objects','profiles','marketing_consents','email_suppressions','carts','cart_items','orders','order_items','order_events','entitlements','entitlement_games','stripe_events','funnel_events','download_events','email_outbox') and has_table_privilege(r, c.oid, p)));
select pg_temp.assert('nenhum privilégio de coluna',
  (select count(*) = 0 from pg_class c, unnest(array['anon','authenticated','service_role']) r
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname in ('products','games','product_games','files','file_objects','profiles','marketing_consents','email_suppressions','carts','cart_items','orders','order_items','order_events','entitlements','entitlement_games','stripe_events','funnel_events','download_events','email_outbox')
     and has_any_column_privilege(r, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')));
select pg_temp.assert('nenhum privilégio de sequência (identidades do contrato)',
  (select count(*) = 0 from pg_class c, unnest(array['anon','authenticated','service_role']) r, unnest(array['USAGE','SELECT','UPDATE']) p
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'S' and c.relname <> 'test_id_seq' and has_sequence_privilege(r, c.oid, p)));
select pg_temp.assert('schema private sem uso para os papéis de API',
  not has_schema_privilege('anon','private','USAGE') and not has_schema_privilege('authenticated','private','USAGE') and not has_schema_privilege('service_role','private','USAGE'));
select pg_temp.assert('funções de private sem EXECUTE para os papéis de API',
  (select count(*) = 0 from pg_proc p, unnest(array['anon','authenticated','service_role']) r
   where p.pronamespace = 'private'::regnamespace and has_function_privilege(r, p.oid, 'EXECUTE')));

-- ===== RPCs do I2b e do I3: ACL e modo de execução ========================================================
select pg_temp.assert('as RPCs de public são exatamente as 35 do I2b ao blog (todas as do contrato)',
  (select array_agg(p.proname::text order by p.proname collate "C") = array['admin_delete_blog_post','admin_get_blog_post','admin_list_blog_posts','admin_register_blog_image','admin_save_blog_post','attach_checkout_session','cart_add','cart_remove','claim_email_batch','create_order_from_cart','delete_account_data','export_account_data','fulfill_order','get_account','get_admin_metrics','get_blog_version','get_cart','get_catalog','get_library','get_order_status','get_stripe_prices','list_free_games','list_published_blog_posts','mark_email_result','mark_marketing_prompt','quote_cart','record_email_event','remember_stripe_prices','resolve_delivery','resolve_download','resolve_free_download','set_marketing_consent','set_order_status','set_stripe_customer','unsubscribe']
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'));
select pg_temp.assert('cada RPC: ACL = {dono, service_role} apenas',
  (select count(*) = 35 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'));
select pg_temp.assert('cada RPC: SECURITY DEFINER com search_path vazio',
  (select count(*) = 35 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and p.prosecdef and p.proconfig @> array['search_path=""']));

-- ===== comportamento por papel ====================================================================
select pg_temp.expect_as('anon lê orders', 'anon', 'select 1 from public.orders', '42501');
select pg_temp.expect_as('authenticated lê orders', 'authenticated', 'select 1 from public.orders', '42501');
select pg_temp.expect_as('service_role lê orders (D-12)', 'service_role', 'select 1 from public.orders', '42501');
select pg_temp.expect_as('service_role lê email_outbox (D-12, sem exceção)', 'service_role', 'select 1 from public.email_outbox', '42501');
select pg_temp.expect_as('anon lê file_objects (chave do B2)', 'anon', 'select 1 from public.file_objects', '42501');
select pg_temp.expect_as('authenticated lê file_objects (chave do B2)', 'authenticated', 'select 1 from public.file_objects', '42501');
select pg_temp.expect_as('service_role lê file_objects (chave do B2)', 'service_role', 'select 1 from public.file_objects', '42501');
select pg_temp.expect_as('authenticated lê profiles', 'authenticated', 'select 1 from public.profiles', '42501');
select pg_temp.expect_as('authenticated lê carts', 'authenticated', 'select 1 from public.carts', '42501');
select pg_temp.expect_as('authenticated lê entitlements', 'authenticated', 'select 1 from public.entitlements', '42501');
select pg_temp.expect_as('service_role insere em carts', 'service_role', $q$insert into public.carts (user_id) values (gen_random_uuid())$q$, '42501');
select pg_temp.expect_as('service_role atualiza orders', 'service_role', $q$update public.orders set status = 'expired'$q$, '42501');
select pg_temp.expect_as('authenticated insere em marketing_consents', 'authenticated', $q$insert into public.marketing_consents (user_id,email,action,source,text_version) values (gen_random_uuid(),'a@b.test','granted','account','v1')$q$, '42501');
select pg_temp.expect_as('anon executa RPC (get_catalog)', 'anon', $q$select public.get_catalog()$q$, '42501');
select pg_temp.expect_as('authenticated executa RPC (get_cart)', 'authenticated', $q$select public.get_cart(gen_random_uuid())$q$, '42501');
select pg_temp.expect_as('anon executa RPC (unsubscribe)', 'anon', $q$select * from public.unsubscribe(gen_random_uuid())$q$, '42501');
select pg_temp.expect_as('authenticated chama função de private', 'authenticated', $q$select private.confirmed_email(gen_random_uuid())$q$, '42501');
select pg_temp.expect_as('service_role executa RPC (get_catalog)', 'service_role', $q$select public.get_catalog()$q$, 'OK');
select pg_temp.expect_as('service_role executa RPC (cart_add) até o fim da regra de negócio', 'service_role', $q$select * from public.cart_add(gen_random_uuid(), 'XXX')$q$, 'KT009');
-- as funções e triggers de private rodam dentro da RPC (dono), sem nenhum GRANT para a API
do $u$ begin perform pg_temp.mk_user('rl1'); end $u$;
select pg_temp.expect_as('service_role: RPC grava o consentimento e dispara o trigger de private', 'service_role',
  format($q$select * from public.set_marketing_consent(%L, true, 'account', 'v1-pgtap')$q$, pg_temp.uid('rl1')), 'OK');
select pg_temp.assert('o trigger de private atualizou profiles', (select marketing_opt_in and marketing_opt_in_at is not null from public.profiles where user_id = pg_temp.uid('rl1')));

select * from finish();
rollback;
