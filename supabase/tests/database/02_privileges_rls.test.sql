-- 02_privileges_rls: RLS, policies, GRANTs e ACL (docs/data-contract.md v0.3.3, seção 5; D-1 e D-12).
-- Roda com `supabase test db` (pgTAP). Dados de teste só existem dentro da transação (rollback no fim).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp): supabase/tests/database/helpers ===========
\ir helpers/base.psql
\ir helpers/fixtures.psql

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
select pg_temp.assert('as RPCs de public são exatamente as 76 do I2b aos cupons e parceiros (todas as do contrato)',
  (select array_agg(p.proname::text order by p.proname collate "C") = array['admin_add_pack_game','admin_blog_image_usage','admin_check_user_block','admin_create_discount','admin_delete_blog_image','admin_delete_blog_post','admin_delete_user','admin_export_user','admin_follow_up','admin_get_blog_post','admin_get_order','admin_get_partner','admin_get_user','admin_gift_products','admin_list_alerts','admin_list_blog_posts','admin_list_catalog','admin_list_discounts','admin_list_orders','admin_list_partners','admin_list_users','admin_log_order_action','admin_log_user_block','admin_mark_partner_paid','admin_marketing_metrics','admin_newsletter_off','admin_order_stripe','admin_partner_orders','admin_register_blog_image','admin_remove_pack_game','admin_resend_delivery','admin_resolve_alert','admin_revoke_entitlement','admin_save_blog_post','admin_save_partner','admin_set_admin','admin_set_discount_state','admin_set_list_price','admin_set_product_price','admin_set_product_status','attach_checkout_session','cart_add','cart_remove','claim_email_batch','create_order_from_cart','delete_account_data','due_discounts','export_account_data','fulfill_order','get_account','get_admin_metrics','get_blog_version','get_cart','get_catalog','get_catalog_version','get_library','get_order_status','get_promo_banner','get_stripe_prices','list_free_games','list_published_blog_posts','mark_discount_started','mark_email_result','quote_cart','record_dispute_alert','record_email_event','record_partner_visit','remember_stripe_prices','resolve_delivery','resolve_download','resolve_free_download','set_marketing_consent','set_order_referral','set_order_status','set_stripe_customer','unsubscribe']
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'));
select pg_temp.assert('cada RPC: ACL = {dono, service_role} apenas, menos as versões do blog e do catálogo',
  (select count(*) = 74 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and p.proname not in ('get_blog_version', 'get_catalog_version') and p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'));
-- As exceções (blog, 2026-10-23; catálogo, 2026-10-24): o vigia da VPS lê as versões pela API de dados; são md5 do
-- que o site já mostra.
select pg_temp.assert('get_blog_version e get_catalog_version: EXECUTE para anon e service_role; nada para authenticated nem public',
  (select count(*) = 2 and bool_and(has_function_privilege('anon', p.oid, 'EXECUTE') and has_function_privilege('service_role', p.oid, 'EXECUTE')
          and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
          and p.proacl::text = '{postgres=X/postgres,service_role=X/postgres,anon=X/postgres}')
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('get_blog_version', 'get_catalog_version')));
select pg_temp.assert('cada RPC: SECURITY DEFINER com search_path vazio',
  (select count(*) = 76 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
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
select pg_temp.expect_as('anon lê a versão do blog (vigia da VPS)', 'anon', $q$select public.get_blog_version()$q$, 'OK');
select pg_temp.expect_as('anon não lê os posts publicados pelo banco', 'anon', $q$select public.list_published_blog_posts()$q$, '42501');
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
