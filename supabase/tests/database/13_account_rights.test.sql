-- 13_account_rights: export_account_data, delete_account_data e private.purge_email_outbox (docs/data-contract.md v0.3.6,
-- D-28, seção 6.11, T140 a T147). Roda com `supabase test db` (pgTAP). Dados de teste só existem dentro da transação.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp): supabase/tests/database/helpers ===========
\ir helpers/base.psql

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
          '{"provider": "email", "providers": ["email", "google"]}', '{"full_name": "Pessoa TESTE"}');
  insert into pg_temp.ids values (p_name, v_id);
  return v_id;
end $$;

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

create temp table oids (name text primary key, id uuid);
create function pg_temp.oid(p_name text) returns uuid language sql as $$ select id from pg_temp.oids where name = p_name $$;

create function pg_temp.mk_order(p_name text, p_user uuid, p_status text, p_products bigint[], p_created timestamptz default now()) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid(); i int; v_path text[];
begin
  insert into public.orders (id, user_id, email, status, cart_version, terms_version, terms_accepted_at,
                             stripe_checkout_session_id, livemode, created_at)
  values (v_id, p_user, (select lower(email) from auth.users where id = p_user), 'open', 0, 'termos-pgtap', now(),
          'cs_test_PGTAP_' || replace(v_id::text, '-', ''), false, p_created);
  for i in 1..cardinality(p_products) loop
    insert into public.order_items (order_id, product_id, position, stripe_price_id)
    select v_id, p.id, i, p.stripe_price_id from public.products p where p.id = p_products[i];
  end loop;
  v_path := case p_status
    when 'open' then '{}' when 'pending_payment' then '{pending_payment}' when 'paid' then '{paid}'
    when 'expired' then '{expired}' when 'disputed' then '{paid,disputed}' when 'refunded' then '{paid,refunded}' end::text[];
  for i in 1..coalesce(cardinality(v_path), 0) loop
    perform pg_temp.mv(v_id, v_path[i]);
  end loop;
  insert into pg_temp.oids values (p_name, v_id);
  return v_id;
end $$;

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

-- ===== fixtures ==================================================================================
-- del: conta com histórico completo; outro: não pode ser tocado; blk*: recusas; svc: exclusão como service_role.
do $fx$
declare v_pk bigint; v_s1 bigint; v_del uuid; v_other uuid; v_svc uuid; o uuid;
begin
  v_pk := pg_temp.mk_product('LPK', 'bundle', 2);
  v_s1 := pg_temp.mk_product('LS1', 'single', 1);
  v_del := pg_temp.mk_user('del');
  v_other := pg_temp.mk_user('outro');
  v_svc := pg_temp.mk_user('svc');
  perform pg_temp.mk_user('naoconf', false);

  o := pg_temp.mk_order('del_paid', v_del, 'paid', array[v_pk]);
  perform pg_temp.mk_ents(o);
  o := pg_temp.mk_order('del_refunded', v_del, 'refunded', array[v_s1]);
  perform pg_temp.mk_ents(o, 'revoked', 'refund');
  perform pg_temp.mk_order('del_expired', v_del, 'open', array[v_s1], now() - interval '2 days');
  insert into public.carts (user_id, version) values (v_del, 4);
  insert into public.cart_items (user_id, product_id) values (v_del, v_s1);
  perform public.set_marketing_consent(v_del, true, 'account', 'mkt-pgtap');
  insert into public.email_outbox (user_id, order_id, kind, category, to_email, dedupe_key, status, sent_at)
  values (v_del, pg_temp.oid('del_paid'), 'delivery', 'transactional', 'del@pgtap.test', 'delivery:' || pg_temp.oid('del_paid'), 'sent', now());
  insert into public.email_outbox (user_id, kind, category, to_email, dedupe_key, payload)
  values (v_del, 'cart_reminder', 'marketing', 'del@pgtap.test', 'cart_reminder:' || v_del || ':4', '{"cart_version": 4}');
  insert into public.email_suppressions (email, reason, source) values ('del@pgtap.test', 'hard_bounce', 'brevo_webhook');
  insert into public.download_events (user_id, file_id, kind)
  select v_del, f.id, 'paid' from public.files f join public.games g on g.id = f.game_id where g.code = 'GM-LPK-1';
  insert into public.funnel_events (user_id, type, order_id) values (v_del, 'order_paid', pg_temp.oid('del_paid'));

  o := pg_temp.mk_order('outro_paid', v_other, 'paid', array[v_s1]);
  perform pg_temp.mk_ents(o);
  perform public.set_marketing_consent(v_other, true, 'account', 'mkt-pgtap');

  o := pg_temp.mk_order('svc_paid', v_svc, 'paid', array[v_pk]);
  perform pg_temp.mk_ents(o);

  perform pg_temp.mk_order('blk_pending', pg_temp.mk_user('blk1'), 'pending_payment', array[v_s1]);
  perform pg_temp.mk_order('blk_open', pg_temp.mk_user('blk2'), 'open', array[v_s1]);
  o := pg_temp.mk_order('blk_disputed', pg_temp.mk_user('blk3'), 'disputed', array[v_s1]);
  perform pg_temp.mk_ents(o, 'revoked', 'dispute');
end $fx$;

-- ===== T140 export_account_data =================================================================
create temp table exported as select public.export_account_data(pg_temp.uid('del')) as data;
select pg_temp.assert('T140 export: todas as seções presentes',
  (select data ?& array['generated_at','account','marketing','consents','cart','orders','library','downloads','emails','email_suppressions','activity'] from exported));
select pg_temp.assert('T140 export: conta com e-mail, métodos de login, nome e sem senha',
  (select data->'account'->>'email' = 'del@pgtap.test' and data->'account'->'sign_in_methods' = '["email","google"]'::jsonb
          and data->'account'->>'name' = 'Pessoa TESTE' and (data->'account'->>'has_password')::boolean = false from exported));
select pg_temp.assert('T140 export: os 3 pedidos da pessoa (inclusive o checkout vencido), com itens e aceite dos termos',
  (select jsonb_array_length(data->'orders') = 3
          and (select bool_and(o->>'terms_version' = 'termos-pgtap' and jsonb_array_length(o->'items') = 1) from jsonb_array_elements(data->'orders') o)
     from exported));
select pg_temp.assert('T140 export: biblioteca com os jogos de cada direito',
  (select jsonb_array_length(data->'library') = 2
          and (select sum(jsonb_array_length(l->'games')) = 3 from jsonb_array_elements(data->'library') l) from exported));
select pg_temp.assert('T140 export: consentimento, sacola, download, e-mails, supressão e eventos',
  (select jsonb_array_length(data->'consents') = 1 and data->'consents'->0->>'text_version' = 'mkt-pgtap'
          and jsonb_array_length(data->'cart') = 1 and jsonb_array_length(data->'downloads') = 1
          and jsonb_array_length(data->'emails') = 2 and jsonb_array_length(data->'email_suppressions') = 1
          and (data->'marketing'->>'opted_in')::boolean
          and exists (select 1 from jsonb_array_elements(data->'activity') a where a->>'type' = 'order_paid') from exported));
select pg_temp.assert('T140 export: nada de outra conta e nenhum id interno',
  (select data::text not like '%outro@pgtap.test%' and data::text not like ('%' || pg_temp.oid('del_paid')::text || '%')
          and data::text not like ('%' || pg_temp.uid('del')::text || '%') from exported));
select pg_temp.expect('T140 export: usuário não confirmado → KT009', format($q$select public.export_account_data(%L)$q$, pg_temp.uid('naoconf')), 'KT009');
select pg_temp.expect('T140 export: usuário inexistente → KT009', $q$select public.export_account_data(gen_random_uuid())$q$, 'KT009');

-- ===== T141 recusas: o webhook ainda precisa do dono ===========================================
select pg_temp.assert('T141 pagamento pendente → blocked/payment_pending',
  (select outcome = 'blocked' and reason = 'payment_pending' and orders_anonymized = 0 from public.delete_account_data(pg_temp.uid('blk1'))));
select pg_temp.assert('T141 checkout ainda pagável → blocked/checkout_open',
  (select outcome = 'blocked' and reason = 'checkout_open' from public.delete_account_data(pg_temp.uid('blk2'))));
select pg_temp.assert('T141 contestação aberta → blocked/dispute_open',
  (select outcome = 'blocked' and reason = 'dispute_open' from public.delete_account_data(pg_temp.uid('blk3'))));
select pg_temp.assert('T141 recusa não muda nada',
  (select count(*) = 3 from public.orders where id in (pg_temp.oid('blk_pending'), pg_temp.oid('blk_open'), pg_temp.oid('blk_disputed'))
     and user_id is not null and email is not null and anonymized_at is null));
select pg_temp.expect('T141 usuário não confirmado → KT009', format($q$select * from public.delete_account_data(%L)$q$, pg_temp.uid('naoconf')), 'KT009');

-- ===== T142 exclusão: anonimiza os pedidos e apaga o resto ===================================
select pg_temp.assert('T142 deleted com os 3 pedidos anonimizados',
  (select outcome = 'deleted' and reason is null and orders_anonymized = 3 from public.delete_account_data(pg_temp.uid('del'))));
select pg_temp.assert('T142 pedidos: sem dono e sem e-mail, com valores, datas, aceite e ids da Stripe',
  (select count(*) = 3 from public.orders o
    where o.id in (pg_temp.oid('del_paid'), pg_temp.oid('del_refunded'), pg_temp.oid('del_expired'))
      and o.user_id is null and o.email is null and o.anonymized_at is not null
      and o.terms_version = 'termos-pgtap' and o.terms_accepted_at is not null and o.stripe_checkout_session_id is not null)
  and (select amount_total = 990 and paid_at is not null and stripe_payment_intent_id is not null and status = 'paid'
         from public.orders where id = pg_temp.oid('del_paid')));
select pg_temp.assert('T142 direitos: revogados e sem dono; o motivo anterior fica (refund), o ativo vira account_deleted',
  (select count(*) = 1 from public.entitlements where order_id = pg_temp.oid('del_paid') and user_id is null and status = 'revoked' and revoke_reason = 'account_deleted' and revoked_at is not null)
  and (select count(*) = 1 from public.entitlements where order_id = pg_temp.oid('del_refunded') and user_id is null and revoke_reason = 'refund'));
select pg_temp.assert('T142 fila e histórico de consentimento apagados; perfil sem opt-in; supressão mantida',
  (select count(*) = 0 from public.email_outbox where user_id = pg_temp.uid('del'))
  and (select count(*) = 0 from public.marketing_consents where user_id = pg_temp.uid('del'))
  and (select not marketing_opt_in and marketing_opt_in_at is null from public.profiles where user_id = pg_temp.uid('del'))
  and (select count(*) = 1 from public.email_suppressions where email = 'del@pgtap.test'));
select pg_temp.assert('T142 a outra conta segue intacta',
  (select user_id = pg_temp.uid('outro') and email = 'outro@pgtap.test' and anonymized_at is null from public.orders where id = pg_temp.oid('outro_paid'))
  and (select count(*) = 1 from public.marketing_consents where user_id = pg_temp.uid('outro'))
  and (select count(*) = 1 from public.entitlements where user_id = pg_temp.uid('outro') and status = 'active'));
select pg_temp.expect('T142 I-5 no commit: pedido pago com direitos account_deleted é consistente', 'set constraints all immediate', 'OK');
set constraints all deferred;
select pg_temp.assert('T142 a flag da exclusão não vaza para o resto da transação',
  coalesce(current_setting('keytotwo.account_erasure', true), 'off') = 'off');
select pg_temp.assert('T142 repetir (falha no Auth) é idempotente',
  (select outcome = 'deleted' and orders_anonymized = 0 from public.delete_account_data(pg_temp.uid('del'))));
select pg_temp.assert('T142 o link do e-mail para um direito da conta excluída responde revoked',
  (select outcome = 'revoked' from public.resolve_delivery(
     (select id from public.entitlements where order_id = pg_temp.oid('del_paid')),
     (select id from public.games where code = 'GM-LPK-1'))));

-- ===== T143 o Auth apaga o usuário: o resto cai em cascata ou fica sem dono =======================
select pg_temp.expect('T143 auth.users: a conta anonimizada se apaga', format($q$delete from auth.users where id = %L$q$, pg_temp.uid('del')), 'OK');
select pg_temp.assert('T143 cascata: perfil, sacola e itens sumiram',
  (select count(*) = 0 from public.profiles where user_id = pg_temp.uid('del'))
  and (select count(*) = 0 from public.carts where user_id = pg_temp.uid('del'))
  and (select count(*) = 0 from public.cart_items where user_id = pg_temp.uid('del')));
select pg_temp.assert('T143 funil e downloads ficam sem dono (SET NULL)',
  (select count(*) = 0 from public.funnel_events where user_id = pg_temp.uid('del'))
  and (select count(*) = 1 from public.funnel_events where order_id = pg_temp.oid('del_paid') and type = 'order_paid' and user_id is null)
  and (select count(*) = 0 from public.download_events where user_id = pg_temp.uid('del')));
select pg_temp.expect('T143 depois do Auth, a RPC recusa com KT009', format($q$select * from public.delete_account_data(%L)$q$, pg_temp.uid('del')), 'KT009');
select pg_temp.expect('T143 sem a RPC, o Auth continua recusando conta com pedido (RESTRICT)', format($q$delete from auth.users where id = %L$q$, pg_temp.uid('outro')), '23503');

-- ===== T144 travas: anonimizar só pela RPC, e sem volta ========================================
select pg_temp.expect('T144 pedido anonimizado não volta a ter dono', format($q$update public.orders set user_id = %L, email = 'outro@pgtap.test', anonymized_at = null where id = %L$q$, pg_temp.uid('outro'), pg_temp.oid('del_paid')), 'KT010');
select pg_temp.expect('T144 anonimizar fora da exclusão de conta', format($q$update public.orders set user_id = null, email = null, anonymized_at = now() where id = %L$q$, pg_temp.oid('outro_paid')), 'KT010');
select pg_temp.expect('T144 dono nulo sem anonymized_at (CHECK)', format($q$set local keytotwo.allow_reassign = 'on'; update public.orders set user_id = null where id = %L$q$, pg_temp.oid('outro_paid')), '23514');
select pg_temp.expect('T144 direito ativo sem dono (CHECK)', format($q$update public.entitlements set user_id = null where order_id = %L$q$, pg_temp.oid('outro_paid')), '23514');
select pg_temp.expect('T144 consentimento continua só inserção fora da exclusão', format($q$delete from public.marketing_consents where user_id = %L$q$, pg_temp.uid('outro')), 'KT008');

-- ===== T145 contestação depois da exclusão: o webhook segue funcionando sem dono ==================
select pg_temp.assert('T145 contestação aberta num pedido anonimizado',
  (select outcome = 'applied' and order_status = 'disputed' and entitlement_status = 'revoked'
     from public.set_order_status(pg_temp.oid('del_paid'), 'disputed', 'webhook', 'evt_PGTAP_LGPD_1', 'fraudulent')));
select pg_temp.assert('T145 contestação vencida: pago de novo, o acesso não volta (account_deleted)',
  (select outcome = 'applied' and order_status = 'paid' and entitlement_status = 'revoked'
     from public.set_order_status(pg_temp.oid('del_paid'), 'paid', 'webhook', 'evt_PGTAP_LGPD_2', 'dispute_won')));
select pg_temp.expect('T145 I-5 no commit depois da contestação', 'set constraints all immediate', 'OK');
set constraints all deferred;

-- ===== T146 papel da API ========================================================================
select pg_temp.expect_as('T146 service_role exporta', 'service_role', format($q$select public.export_account_data(%L)$q$, pg_temp.uid('svc')), 'OK');
select pg_temp.expect_as('T146 service_role exclui e o I-5 passa no commit', 'service_role',
  format($q$select * from public.delete_account_data(%L); set constraints all immediate$q$, pg_temp.uid('svc')), 'OK');
set constraints all deferred;
select pg_temp.expect_as('T146 authenticated não exporta', 'authenticated', format($q$select public.export_account_data(%L)$q$, pg_temp.uid('outro')), '42501');
select pg_temp.expect_as('T146 anon não exclui', 'anon', format($q$select * from public.delete_account_data(%L)$q$, pg_temp.uid('outro')), '42501');
select pg_temp.expect_as('T146 service_role não roda a limpeza da fila', 'service_role', $q$select private.purge_email_outbox()$q$, '42501');

-- ===== T147 limpeza da fila: 90 dias depois do envio =============================================
do $px$
declare v uuid := pg_temp.uid('outro');
begin
  insert into public.carts (user_id, version) values (v, 7);
  insert into public.email_outbox (user_id, kind, category, to_email, dedupe_key, status, sent_at, created_at, updated_at, scheduled_at) values
    (v, 'post_purchase', 'marketing', 'outro@pgtap.test', 'pg:velho-enviado', 'sent', now() - interval '100 days', now() - interval '101 days', now() - interval '100 days', now() - interval '101 days'),
    (v, 'post_purchase', 'marketing', 'outro@pgtap.test', 'pg:recente-enviado', 'sent', now() - interval '10 days', now() - interval '11 days', now() - interval '10 days', now() - interval '11 days');
  insert into public.email_outbox (user_id, kind, category, to_email, dedupe_key, status, skip_reason, payload, created_at, updated_at, scheduled_at) values
    (v, 'cart_reminder', 'marketing', 'outro@pgtap.test', 'pg:lembrete-versao-velha', 'skipped', 'cart_changed', '{"cart_version": 6}', now() - interval '120 days', now() - interval '120 days', now() - interval '120 days'),
    (v, 'cart_reminder', 'marketing', 'outro@pgtap.test', 'pg:lembrete-versao-atual', 'skipped', 'no_opt_in', '{"cart_version": 7}', now() - interval '120 days', now() - interval '120 days', now() - interval '120 days');
  insert into public.email_outbox (user_id, kind, category, to_email, dedupe_key, status, created_at, updated_at, scheduled_at) values
    (v, 'post_purchase', 'marketing', 'outro@pgtap.test', 'pg:velho-na-fila', 'queued', now() - interval '200 days', now() - interval '200 days', now() - interval '200 days');
end $px$;
select pg_temp.assert('T147 apaga só o enviado velho e o lembrete de versão antiga',
  (select private.purge_email_outbox() = 2));
select pg_temp.assert('T147 ficam o recente, o da fila e o lembrete da versão atual (dedupe)',
  (select array_agg(dedupe_key order by dedupe_key) = array['pg:lembrete-versao-atual','pg:recente-enviado','pg:velho-na-fila']
     from public.email_outbox where dedupe_key like 'pg:%'));
select pg_temp.assert('T147 agenda diária no pg_cron',
  (select count(*) = 1 from cron.job where jobname = 'email-outbox-purge' and command = 'select private.purge_email_outbox()'));

select * from finish();
rollback;
