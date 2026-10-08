-- 03_state_machine: transições do pedido (11 arestas), imutabilidade, I-5 por item, arquivos, logs só de inserção
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

-- e exclusão de usuário (docs/data-contract.md v0.3.2, seções 3 e 4).

do $fx$
declare v_pk bigint; v_s1 bigint; v_s2 bigint; u1 uuid; u2 uuid; o1 uuid; o2 uuid;
begin
  v_pk := pg_temp.mk_product('PK1', 'bundle', 3);
  v_s1 := pg_temp.mk_product('SG1', 'single', 1);
  v_s2 := pg_temp.mk_product('SG2', 'single', 1);
  u1 := pg_temp.mk_user('u1');
  u2 := pg_temp.mk_user('u2');
  o1 := pg_temp.mk_order(u1, 'paid', array[v_pk, v_s1], 'FX1');
  perform pg_temp.mk_ents(o1);
  o2 := pg_temp.mk_order(u2, 'open', array[v_s2], 'FX2');
  insert into public.stripe_events (id, type, livemode, outcome, order_id) values ('evt_PGTAP_FX1', 'checkout.session.completed', false, 'applied', o1);
  insert into public.order_events (order_id, to_status, source) values (o1, 'paid', 'webhook');
  insert into public.download_events (user_id, file_id, kind) select u1, f.id, 'paid' from public.files f limit 1;
  insert into public.funnel_events (user_id, type, order_id) values (u1, 'order_paid', o1);
  insert into public.marketing_consents (user_id, email, action, source, text_version) values (u2, 'u2@pgtap.test', 'granted', 'account', 'v1');
  insert into public.email_suppressions (email, reason, source) values ('sup@pgtap.test', 'hard_bounce', 'brevo_webhook');
end $fx$;

-- ===== imutáveis dos pedidos e itens ==============================================================
select pg_temp.expect('orders: livemode imutável', $q$update public.orders set livemode = true where stripe_checkout_session_id='cs_test_PGTAP_FX1'$q$, 'KT010');
select pg_temp.expect('orders: cart_version imutável', $q$update public.orders set cart_version = 9 where stripe_checkout_session_id='cs_test_PGTAP_FX1'$q$, 'KT010');
select pg_temp.expect('orders: terms_version imutável', $q$update public.orders set terms_version = 'outra' where stripe_checkout_session_id='cs_test_PGTAP_FX1'$q$, 'KT010');
select pg_temp.expect('orders: aceite dos termos imutável', $q$update public.orders set terms_accepted_at = now() + interval '1 day' where stripe_checkout_session_id='cs_test_PGTAP_FX1'$q$, 'KT010');
select pg_temp.expect('orders: o dono não muda', format($q$update public.orders set user_id = %L where stripe_checkout_session_id='cs_test_PGTAP_FX1'$q$, pg_temp.uid('u2')), 'KT010');
select pg_temp.expect('orders: o dono muda só com o GUC de atendimento', format($q$select set_config('keytotwo.allow_reassign','on',true); with o as (select pg_temp.mk_order(%L,'open',array[(select id from public.products where code='SG1')],'GUC1') as id) update public.orders x set user_id = %L from o where x.id = o.id; select set_config('keytotwo.allow_reassign','off',true)$q$, pg_temp.uid('u2'), pg_temp.uid('u1')), 'OK');
select pg_temp.expect('orders: sessão gravada não muda', $q$update public.orders set stripe_checkout_session_id = 'cs_test_PGTAP_OUTRA' where stripe_checkout_session_id='cs_test_PGTAP_FX1'$q$, 'KT010');
select pg_temp.expect('orders: intent gravado não muda', $q$update public.orders set stripe_payment_intent_id = 'pi_PGTAP_OUTRO' where stripe_checkout_session_id='cs_test_PGTAP_FX1'$q$, 'KT010');
select pg_temp.expect('order_items: não insere em pedido pago', $q$insert into public.order_items (order_id,product_id,position,stripe_price_id) select o.id, p.id, 9, p.stripe_price_id from public.orders o, public.products p where o.stripe_checkout_session_id='cs_test_PGTAP_FX1' and p.code='SG2'$q$, 'KT010');
select pg_temp.expect('order_items: não apaga de pedido pago', $q$delete from public.order_items where order_id = (select id from public.orders where stripe_checkout_session_id='cs_test_PGTAP_FX1')$q$, 'KT010');
select pg_temp.expect('order_items: Price imutável', $q$update public.order_items set stripe_price_id = 'price_OUTRO' where order_id = (select id from public.orders where stripe_checkout_session_id='cs_test_PGTAP_FX1')$q$, 'KT010');
select pg_temp.expect('order_items: valor cobrado não muda depois de gravado', $q$update public.order_items set unit_amount = 99 where order_id = (select id from public.orders where stripe_checkout_session_id='cs_test_PGTAP_FX1')$q$, 'KT010');
select pg_temp.expect('order_items: Price inválido (a guarda de imutabilidade vem antes do CHECK)', $q$update public.order_items set stripe_price_id = 'abc' where order_id = (select id from public.orders where stripe_checkout_session_id='cs_test_PGTAP_FX2')$q$, 'KT010');
select pg_temp.expect('order_items: o valor entra uma vez, com o pedido open', $q$update public.order_items set unit_amount = 5, currency = 'brl' where order_id = (select id from public.orders where stripe_checkout_session_id='cs_test_PGTAP_FX2')$q$, 'OK');
select pg_temp.expect('order_items: apaga de pedido open', $q$delete from public.order_items where order_id = (select id from public.orders where stripe_checkout_session_id='cs_test_PGTAP_FX2')$q$, 'OK');

-- ===== arquivos: status só avança, conteúdo imutável depois de draft ===============================
do $f$
declare v_gid bigint; v_fid uuid;
begin
  select id into v_gid from public.games where code = 'GM-PK1-1';
  insert into public.files (game_id, kind, access, version, filename, size_bytes, sha256)
  values (v_gid, 'pdf', 'paid', '1.1', 'GM-PK1-1-v1.1.pdf', 2048, repeat('1', 64)) returning id into v_fid;
  insert into public.file_objects (file_id, access, bucket, object_key)
  values (v_fid, 'paid', 'bucket-pgtap-teste', 'paid/GM-PK1-1/1.1/GM-PK1-1-v1.1.pdf');
  select id into v_gid from public.games where code = 'GM-PK1-2';
  insert into public.files (game_id, kind, access, version, filename, size_bytes, sha256)
  values (v_gid, 'pdf', 'paid', '9.0', 'GM-PK1-2-v9.0.pdf', 2048, repeat('2', 64));
end $f$;
select pg_temp.expect('files: draft→published com outro publicado no mesmo jogo', $q$update public.files set status='published' where filename='GM-PK1-1-v1.1.pdf'$q$, '23505');
select pg_temp.expect('files: draft→retired não existe', $q$update public.files set status='retired' where filename='GM-PK1-2-v9.0.pdf'$q$, 'KT006');
select pg_temp.expect('files: aposentar o publicado e publicar o novo, na mesma transação', $q$update public.files set status='retired' where filename='GM-PK1-1-v1.0.pdf'; update public.files set status='published' where filename='GM-PK1-1-v1.1.pdf'$q$, 'OK');
select pg_temp.assert('files: published_at e retired_at preenchidos pela guarda',
  (select published_at is not null and retired_at is not null from public.files where filename = 'GM-PK1-1-v1.0.pdf')
  and (select published_at is not null and retired_at is null from public.files where filename = 'GM-PK1-1-v1.1.pdf'));
select pg_temp.expect('files: retired→published', $q$update public.files set status='published' where filename='GM-PK1-1-v1.0.pdf'$q$, 'KT006');
select pg_temp.expect('files: published→draft', $q$update public.files set status='draft', published_at=null where filename='GM-PK1-1-v1.1.pdf'$q$, 'KT006');
select pg_temp.expect('files: conteúdo (tamanho) imutável depois de draft', $q$update public.files set size_bytes = 5 where filename='GM-PK1-1-v1.1.pdf'$q$, 'KT010');
select pg_temp.expect('files: conteúdo (sha256) imutável depois de draft', $q$update public.files set sha256 = repeat('f', 64) where filename='GM-PK1-1-v1.1.pdf'$q$, 'KT010');
select pg_temp.expect('files: conteúdo (nome) imutável depois de draft', $q$update public.files set filename = 'outro-v1.1.pdf' where filename='GM-PK1-1-v1.1.pdf'$q$, 'KT010');
select pg_temp.expect('files: o rascunho ainda se edita', $q$update public.files set size_bytes = 4096 where filename='GM-PK1-2-v9.0.pdf'$q$, 'OK');
select pg_temp.expect('files: não apaga arquivo publicado', $q$delete from public.files where filename='GM-PK1-1-v1.1.pdf'$q$, 'KT010');
select pg_temp.expect('files: não apaga arquivo aposentado', $q$delete from public.files where filename='GM-PK1-1-v1.0.pdf'$q$, 'KT010');
select pg_temp.expect('files: apaga rascunho (leva o objeto em cascata)', $q$delete from public.files where filename='GM-PK1-2-v9.0.pdf'$q$, 'OK');
select pg_temp.expect('files: rascunho com download_events não se apaga', $q$insert into public.files (game_id, kind, access, version, filename, size_bytes, sha256) select id, 'pdf', 'paid', '8.0', 'GM-PK1-3-v8.0.pdf', 10, repeat('3', 64) from public.games where code='GM-PK1-3'; insert into public.download_events (file_id, kind) select id, 'paid' from public.files where filename='GM-PK1-3-v8.0.pdf'; delete from public.files where filename='GM-PK1-3-v8.0.pdf'$q$, '23503');

-- ===== I-5 (checada no commit): cada caso em subtransação, forçando a checagem com SET CONSTRAINTS IMMEDIATE =====
-- paid: todo item com direito (ativo ou revogado manual). disputed/dispute_lost/refunded: todos revogados. Demais: nenhum direito.
select pg_temp.expect('I-5: paid sem direito algum', $q$set constraints all deferred; select pg_temp.mk_order(pg_temp.uid('u1'),'paid',array[(select id from public.products where code='PK1')],'I51'); set constraints all immediate$q$, 'KT011');
select pg_temp.expect('I-5: paid de 2 itens com 1 direito', $q$set constraints all deferred;
  select pg_temp.mk_order(pg_temp.uid('u1'),'paid',array[(select id from public.products where code='PK1'),(select id from public.products where code='SG2')],'I52');
  insert into public.entitlements (order_id,product_id,user_id) select o.id, (select id from public.products where code='PK1'), o.user_id from public.orders o where o.stripe_checkout_session_id='cs_test_PGTAP_I52';
  set constraints all immediate$q$, 'KT011');
select pg_temp.expect('I-5: paid de 2 itens com 2 direitos ativos (OK)', $q$set constraints all deferred;
  select pg_temp.mk_ents(pg_temp.mk_order(pg_temp.uid('u1'),'paid',array[(select id from public.products where code='PK1'),(select id from public.products where code='SG2')],'I53'));
  set constraints all immediate$q$, 'OK');
select pg_temp.expect('I-5: paid com revogação manual (OK)', $q$set constraints all deferred;
  select pg_temp.mk_ents(pg_temp.mk_order(pg_temp.uid('u1'),'paid',array[(select id from public.products where code='SG2')],'I54'),'revoked','manual');
  set constraints all immediate$q$, 'OK');
select pg_temp.expect('I-5: paid com direito revogado por refund', $q$set constraints all deferred;
  select pg_temp.mk_ents(pg_temp.mk_order(pg_temp.uid('u1'),'paid',array[(select id from public.products where code='SG2')],'I55'),'revoked','refund');
  set constraints all immediate$q$, 'KT011');
select pg_temp.expect('I-5: refunded com direito ativo', $q$set constraints all deferred;
  select pg_temp.mk_ents(pg_temp.mk_order(pg_temp.uid('u1'),'refunded',array[(select id from public.products where code='SG2')],'I56'));
  set constraints all immediate$q$, 'KT011');
select pg_temp.expect('I-5: refunded com todos revogados (OK)', $q$set constraints all deferred;
  select pg_temp.mk_ents(pg_temp.mk_order(pg_temp.uid('u1'),'refunded',array[(select id from public.products where code='PK1'),(select id from public.products where code='SG2')],'I57'),'revoked','refund');
  set constraints all immediate$q$, 'OK');
select pg_temp.expect('I-5: disputed com todos revogados (OK)', $q$set constraints all deferred;
  select pg_temp.mk_ents(pg_temp.mk_order(pg_temp.uid('u1'),'disputed',array[(select id from public.products where code='PK1')],'I58'),'revoked','dispute');
  set constraints all immediate$q$, 'OK');
select pg_temp.expect('I-5: disputed com 1 de 2 itens revogado', $q$set constraints all deferred;
  select pg_temp.mk_order(pg_temp.uid('u1'),'disputed',array[(select id from public.products where code='PK1'),(select id from public.products where code='SG2')],'I59');
  insert into public.entitlements (order_id,product_id,user_id,status,revoked_at,revoke_reason) select o.id,(select id from public.products where code='PK1'),o.user_id,'revoked',now(),'dispute' from public.orders o where o.stripe_checkout_session_id='cs_test_PGTAP_I59';
  set constraints all immediate$q$, 'KT011');
select pg_temp.expect('I-5: dispute_lost com direito ativo', $q$set constraints all deferred;
  select pg_temp.mk_ents(pg_temp.mk_order(pg_temp.uid('u1'),'dispute_lost',array[(select id from public.products where code='PK1')],'I60'));
  set constraints all immediate$q$, 'KT011');
select pg_temp.expect('I-5: pedido open com direito', $q$set constraints all deferred;
  select pg_temp.mk_ents(pg_temp.mk_order(pg_temp.uid('u1'),'open',array[(select id from public.products where code='SG2')],'I61'));
  set constraints all immediate$q$, 'KT011');
select pg_temp.expect('I-5: pending_payment com direito', $q$set constraints all deferred;
  select pg_temp.mk_ents(pg_temp.mk_order(pg_temp.uid('u1'),'pending_payment',array[(select id from public.products where code='SG2')],'I62'));
  set constraints all immediate$q$, 'KT011');
select pg_temp.expect('I-5: contestação aberta revoga todos no MESMO commit (OK)', $q$set constraints all deferred;
  select pg_temp.mk_ents(pg_temp.mk_order(pg_temp.uid('u1'),'paid',array[(select id from public.products where code='PK1'),(select id from public.products where code='SG2')],'I63'));
  set constraints all immediate;
  set constraints all deferred;
  update public.entitlements set status='revoked', revoked_at=now(), revoke_reason='dispute' where order_id=(select id from public.orders where stripe_checkout_session_id='cs_test_PGTAP_I63');
  select pg_temp.mv((select id from public.orders where stripe_checkout_session_id='cs_test_PGTAP_I63'),'disputed');
  set constraints all immediate$q$, 'OK');
select pg_temp.expect('I-5: mudar o pedido sem revogar o direito', $q$set constraints all deferred;
  select pg_temp.mk_ents(pg_temp.mk_order(pg_temp.uid('u1'),'paid',array[(select id from public.products where code='SG2')],'I64'));
  set constraints all immediate;
  set constraints all deferred;
  select pg_temp.mv((select id from public.orders where stripe_checkout_session_id='cs_test_PGTAP_I64'),'disputed');
  set constraints all immediate$q$, 'KT011');

-- ===== logs: só inserção (o SET NULL de usuário é permitido) ======================================
select pg_temp.expect('order_events: UPDATE', $q$update public.order_events set reason = 'x'$q$, 'KT008');
select pg_temp.expect('order_events: DELETE', $q$delete from public.order_events$q$, 'KT008');
select pg_temp.expect('stripe_events: UPDATE', $q$update public.stripe_events set type = 'x'$q$, 'KT008');
select pg_temp.expect('stripe_events: DELETE', $q$delete from public.stripe_events$q$, 'KT008');
select pg_temp.expect('entitlement_games: UPDATE', $q$update public.entitlement_games set position = 7$q$, 'KT008');
select pg_temp.expect('entitlement_games: DELETE', $q$delete from public.entitlement_games$q$, 'KT008');
select pg_temp.expect('marketing_consents: UPDATE', $q$update public.marketing_consents set source = 'support'$q$, 'KT008');
select pg_temp.expect('marketing_consents: DELETE', $q$delete from public.marketing_consents$q$, 'KT008');
select pg_temp.expect('email_suppressions: UPDATE', $q$update public.email_suppressions set source = 'support'$q$, 'KT008');
select pg_temp.expect('email_suppressions: DELETE', $q$delete from public.email_suppressions$q$, 'KT008');
select pg_temp.expect('download_events: UPDATE qualquer', $q$update public.download_events set kind = 'free'$q$, 'KT008');
select pg_temp.expect('download_events: DELETE', $q$delete from public.download_events$q$, 'KT008');
select pg_temp.expect('funnel_events: UPDATE de tipo', $q$update public.funnel_events set type = 'order_paid'$q$, 'KT008');
select pg_temp.expect('funnel_events: DELETE', $q$delete from public.funnel_events$q$, 'KT008');
select pg_temp.expect('download_events: user_id → NULL passa (conta anonimizada)', $q$update public.download_events set user_id = null where user_id is not null$q$, 'OK');
select pg_temp.expect('funnel_events: user_id → NULL passa', $q$update public.funnel_events set user_id = null where user_id is not null$q$, 'OK');

-- ===== exclusão de usuário: o que bloqueia e o que cai em cascata =================================
select pg_temp.expect('auth.users: usuário com pedido não se apaga (RESTRICT)', format($q$delete from auth.users where id = %L$q$, pg_temp.uid('u1')), '23503');
select pg_temp.expect('auth.users: usuário com consentimento não se apaga (RESTRICT)', format($q$delete from auth.users where id = %L$q$, pg_temp.uid('u2')), '23503');
do $d$
declare v uuid;
begin
  v := pg_temp.mk_user('del1');
  insert into public.carts (user_id) values (v);
  insert into public.cart_items (user_id, product_id) select v, id from public.products where code = 'SG1';
end $d$;
select pg_temp.expect('auth.users: usuário sem histórico se apaga', format($q$delete from auth.users where id = %L$q$, pg_temp.uid('del1')), 'OK');
select pg_temp.assert('cascata: carrinho, itens e perfil sumiram', (select count(*) = 0 from public.carts where user_id = pg_temp.uid('del1'))
  and (select count(*) = 0 from public.cart_items where user_id = pg_temp.uid('del1')) and (select count(*) = 0 from public.profiles where user_id = pg_temp.uid('del1')));

-- ===== matriz de transições (64 pares). POR ÚLTIMO: deixa pedidos sem direito pendentes no commit diferido. =====
set constraints all deferred;
create temp table matrix (frm text, tto text, state text);
do $m$
declare s text[] := array['open','pending_payment','paid','failed','expired','disputed','dispute_lost','refunded'];
  f text; t text; v_user uuid := pg_temp.uid('u2'); v_prod bigint; v_order uuid; v_state text; n int := 0;
begin
  select id into v_prod from public.products where code = 'SG1';
  foreach f in array s loop
    foreach t in array s loop
      n := n + 1;
      v_order := pg_temp.mk_order(v_user, f, array[v_prod], 'MX' || n);
      v_state := 'OK';
      begin
        update public.orders set status = t,
          amount_total = case when t in ('pending_payment','paid','disputed','dispute_lost','refunded') then 0 end,
          currency     = case when t in ('pending_payment','paid','disputed','dispute_lost','refunded') then 'brl' end,
          paid_at      = case when t in ('paid','disputed','dispute_lost','refunded') then coalesce(paid_at, now()) end,
          refunded_at  = case when t = 'refunded' then now() end
        where id = v_order;
      exception when others then get stacked diagnostics v_state = returned_sqlstate; end;
      insert into matrix values (f, t, v_state);
    end loop;
  end loop;
end $m$;
select pg_temp.assert('matriz: 64 pares testados', (select count(*) = 64 from matrix));
select pg_temp.assert('matriz: só OK ou KT006', (select count(*) = 0 from matrix where state not in ('OK','KT006')));
select pg_temp.assert('matriz: 11 arestas + 8 "mesmo estado" passam; 45 são recusadas',
  (select count(*) filter (where state = 'OK') = 19 and count(*) filter (where state = 'KT006') = 45 from matrix));
select pg_temp.assert('matriz: exatamente as arestas da seção 4.1',
  (select count(*) = 0 from matrix where (state = 'OK') <> (frm = tto or (frm, tto) in
    (('open','pending_payment'),('open','paid'),('open','failed'),('open','expired'),('pending_payment','paid'),('pending_payment','failed'),
     ('paid','disputed'),('paid','refunded'),('disputed','paid'),('disputed','dispute_lost'),('disputed','refunded')))));

select * from finish();
rollback;
