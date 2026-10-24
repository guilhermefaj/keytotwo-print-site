-- 03_state_machine: transições do pedido (11 arestas), imutabilidade, I-5 por item, arquivos, logs só de inserção
-- Roda com `supabase test db` (pgTAP). Dados de teste só existem dentro da transação (rollback no fim).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp): supabase/tests/database/helpers ===========
\ir helpers/base.psql
\ir helpers/fixtures.psql

-- e exclusão de usuário (docs/data-contract.md v0.3.3, seções 3 e 4).

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
select pg_temp.expect('orders: amount_total gravado não muda', $q$update public.orders set amount_total = 5, amount_subtotal = 5 where stripe_checkout_session_id='cs_test_PGTAP_FX1'$q$, 'KT010');
select pg_temp.expect('orders: amount_subtotal gravado não muda', $q$update public.orders set amount_subtotal = 5, amount_total = 5 where stripe_checkout_session_id='cs_test_PGTAP_FX1'$q$, 'KT010');
select pg_temp.expect('orders: moeda gravada não muda', $q$update public.orders set currency = 'usd' where stripe_checkout_session_id='cs_test_PGTAP_FX1'$q$, 'KT010');
select pg_temp.expect('orders: código promocional nulo pode ser preenchido uma vez', $q$update public.orders set promotion_code = 'TESTE10' where stripe_checkout_session_id='cs_test_PGTAP_FX1'$q$, 'OK');
select pg_temp.expect('orders: código promocional gravado não muda', $q$update public.orders set promotion_code = 'OUTRO' where stripe_checkout_session_id='cs_test_PGTAP_FX1'$q$, 'KT010');
select pg_temp.expect('orders: gravar o mesmo valor de novo passa', $q$update public.orders set amount_total = amount_total, currency = currency where stripe_checkout_session_id='cs_test_PGTAP_FX1'$q$, 'OK');
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
select pg_temp.expect('email_suppressions: UPDATE', $q$update public.email_suppressions set source = 'brevo_webhook'$q$, 'KT008');
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
          amount_total    = case when t in ('pending_payment','paid','disputed','dispute_lost','refunded') then coalesce(amount_total, 0) else amount_total end,
          amount_subtotal = case when t in ('pending_payment','paid','disputed','dispute_lost','refunded') then coalesce(amount_subtotal, 0) else amount_subtotal end,
          amount_discount = case when t in ('pending_payment','paid','disputed','dispute_lost','refunded') then coalesce(amount_discount, 0) else amount_discount end,
          currency        = case when t in ('pending_payment','paid','disputed','dispute_lost','refunded') then coalesce(currency, 'brl') else currency end,
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
