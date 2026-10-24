-- 06_account_consent: triggers de auth.users (senha, perfil, funil), consentimento só por inserção, descadastro,
-- Roda com `supabase test db` (pgTAP). Dados de teste só existem dentro da transação (rollback no fim).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp): supabase/tests/database/helpers ===========
\ir helpers/base.psql
\ir helpers/fixtures.psql

-- cliente da Stripe, marketing_allowed, get_account e convite de marketing (docs/data-contract.md v0.3.3, D-18, D-19, D-22, seções 2.4 e 6.6/6.7).

do $fx$
declare v_pk bigint; v_s1 bigint; v_s2 bigint; u uuid; o uuid;
begin
  v_pk := pg_temp.mk_product('PK1', 'bundle', 3);
  v_s1 := pg_temp.mk_product('SG1', 'single', 1);
  v_s2 := pg_temp.mk_product('SG2', 'single', 1);
  perform pg_temp.mk_user('au1', false, 'hash-do-atacante');   -- cadastro com senha, não confirmado
  perform pg_temp.mk_user('au2', true,  'hash-admin');         -- já nasce confirmado (Google, criação administrativa)
  perform pg_temp.mk_user('au3', false, null);                 -- código por e-mail: sem senha
  perform pg_temp.mk_user('au4', false, 'hash-legitimo');
  perform pg_temp.mk_user('au5', false, 'hash-antigo');
  perform pg_temp.mk_user('ac1');
  perform pg_temp.mk_user('ac2');
  perform pg_temp.mk_user('unconf', false);
end $fx$;

-- ===== trigger em auth.users: perfil, account_confirmed e a senha de antes da confirmação (D-18, I-17) =====
select pg_temp.assert('INSERT cria o perfil (não confirmado)', (select count(*) = 1 from public.profiles where user_id = pg_temp.uid('au1')));
select pg_temp.assert('INSERT não confirmado NÃO grava account_confirmed', (select count(*) = 0 from public.funnel_events where user_id = pg_temp.uid('au1') and type = 'account_confirmed'));
select pg_temp.assert('INSERT já confirmado cria o perfil e grava account_confirmed uma vez',
  (select count(*) = 1 from public.profiles where user_id = pg_temp.uid('au2')) and (select count(*) = 1 from public.funnel_events where user_id = pg_temp.uid('au2') and type = 'account_confirmed'));
select pg_temp.assert('INSERT já confirmado mantém a senha administrativa', (select encrypted_password = 'hash-admin' from auth.users where id = pg_temp.uid('au2')));
update auth.users set email_confirmed_at = now() where id = pg_temp.uid('au1');
select pg_temp.assert('a 1ª confirmação ZERA a senha definida antes (ataque de cadastro prévio)', (select coalesce(encrypted_password, '<nulo>') = '' from auth.users where id = pg_temp.uid('au1')));
select pg_temp.assert('a 1ª confirmação grava account_confirmed', (select count(*) = 1 from public.funnel_events where user_id = pg_temp.uid('au1') and type = 'account_confirmed'));
update auth.users set encrypted_password = 'hash-novo-do-dono' where id = pg_temp.uid('au1');
update auth.users set email_confirmed_at = now() + interval '1 minute', last_sign_in_at = now() where id = pg_temp.uid('au1');
select pg_temp.assert('senha nova depois da confirmação vale e a 2ª atualização não zera', (select encrypted_password = 'hash-novo-do-dono' from auth.users where id = pg_temp.uid('au1')));
select pg_temp.assert('account_confirmed continua uma vez só', (select count(*) = 1 from public.funnel_events where user_id = pg_temp.uid('au1') and type = 'account_confirmed'));
update auth.users set email_confirmed_at = now() where id = pg_temp.uid('au3');
select pg_temp.assert('usuário sem senha (código) confirma sem erro e a senha segue vazia/nula', (select coalesce(encrypted_password, '') = '' from auth.users where id = pg_temp.uid('au3')));
update auth.users set email_confirmed_at = now(), encrypted_password = 'hash-definido-na-confirmacao' where id = pg_temp.uid('au4');
select pg_temp.assert('senha trocada NO MESMO UPDATE da confirmação é preservada', (select encrypted_password = 'hash-definido-na-confirmacao' from auth.users where id = pg_temp.uid('au4')));
update auth.users set email = 'novo-au5@pgtap.test' where id = pg_temp.uid('au5');
select pg_temp.assert('trocar o e-mail sem confirmar não zera a senha', (select encrypted_password = 'hash-antigo' from auth.users where id = pg_temp.uid('au5')));
select pg_temp.assert('todo usuário de teste tem perfil (trigger)', (select count(*) = 0 from auth.users u where u.email like '%@pgtap.test' and not exists (select 1 from public.profiles p where p.user_id = u.id)));
select pg_temp.expect('trigger de confirmação não quebra se o perfil já existe', format($q$update auth.users set email_confirmed_at = null where id = %L; update auth.users set email_confirmed_at = now() where id = %L$q$, pg_temp.uid('au5'), pg_temp.uid('au5')), 'OK');
select pg_temp.assert('a senha volta a ser zerada se a confirmação for refeita do zero (NULL → valor)', (select coalesce(encrypted_password, '') = '' from auth.users where id = pg_temp.uid('au5')));

-- ===== set_marketing_consent: histórico só por inserção + estado em profiles =======================
select pg_temp.expect('consent: usuário não confirmado', format($q$select * from public.set_marketing_consent(%L, true, 'account', 'v1')$q$, pg_temp.uid('unconf')), 'KT009');
select pg_temp.expect('consent: conceder sem versão do texto', format($q$select * from public.set_marketing_consent(%L, true, 'account')$q$, pg_temp.uid('ac1')), 'KT001');
select pg_temp.expect('consent: origem desconhecida', format($q$select * from public.set_marketing_consent(%L, true, 'banner', 'v1')$q$, pg_temp.uid('ac1')), 'KT001');
select pg_temp.expect('consent: origem que só concede, revogando', format($q$select * from public.set_marketing_consent(%L, false, 'free_games')$q$, pg_temp.uid('ac1')), 'KT001');
select pg_temp.expect('consent: a sacola não é origem (saiu em 2026-10-24)', format($q$select * from public.set_marketing_consent(%L, true, 'cart', 'v1')$q$, pg_temp.uid('ac1')), 'KT001');
select pg_temp.expect('consent: p_granted nulo', format($q$select * from public.set_marketing_consent(%L, null, 'account', 'v1')$q$, pg_temp.uid('ac1')), 'KT001');
select pg_temp.assert('consent: revogar quem nunca concedeu é noop e não cria linha',
  (select outcome = 'noop' and opted_in = false from public.set_marketing_consent(pg_temp.uid('ac1'), false, 'account'))
  and (select count(*) = 0 from public.marketing_consents where user_id = pg_temp.uid('ac1')));
select pg_temp.assert('consent: conceder = applied', (select outcome = 'applied' and opted_in from public.set_marketing_consent(pg_temp.uid('ac1'), true, 'signup_prompt', 'v1-pgtap')));
select pg_temp.assert('consent: grava no histórico com o e-mail da conta, a origem e a versão do texto',
  (select count(*) = 1 and bool_and(email = 'ac1@pgtap.test' and text_version = 'v1-pgtap' and source = 'signup_prompt' and action = 'granted')
   from public.marketing_consents where user_id = pg_temp.uid('ac1')));
select pg_temp.assert('consent: profiles acompanha (opt-in e data)', (select marketing_opt_in and marketing_opt_in_at is not null from public.profiles where user_id = pg_temp.uid('ac1')));
select pg_temp.assert('consent: mesmo estado, mesmo com outra versão do texto, é noop e não cria linha',
  (select outcome = 'noop' and opted_in from public.set_marketing_consent(pg_temp.uid('ac1'), true, 'account', 'v2-pgtap'))
  and (select count(*) = 1 from public.marketing_consents where user_id = pg_temp.uid('ac1')));
insert into public.email_outbox (user_id, kind, category, to_email, dedupe_key, payload)
  values (pg_temp.uid('ac1'), 'cart_reminder', 'marketing', 'ac1@pgtap.test', 'cart_reminder:ac1:1', '{"cart_version":1}');
insert into public.email_outbox (user_id, kind, category, to_email, dedupe_key, payload)
  values (pg_temp.uid('ac1'), 'cart_reminder', 'marketing', 'ac1@pgtap.test', 'cart_reminder:ac1:0', '{"cart_version":0}');
update public.email_outbox set status = 'sent', sent_at = now() where dedupe_key = 'cart_reminder:ac1:0';
select pg_temp.assert('consent: revogar = applied', (select outcome = 'applied' and not opted_in from public.set_marketing_consent(pg_temp.uid('ac1'), false, 'account')));
select pg_temp.assert('consent: revogar zera o opt-in e a data em profiles', (select not marketing_opt_in and marketing_opt_in_at is null from public.profiles where user_id = pg_temp.uid('ac1')));
select pg_temp.assert('consent: revogar cancela o marketing na fila (no_opt_in) e preserva o já enviado',
  (select status = 'canceled' and skip_reason = 'no_opt_in' from public.email_outbox where dedupe_key = 'cart_reminder:ac1:1')
  and (select status = 'sent' from public.email_outbox where dedupe_key = 'cart_reminder:ac1:0'));
select pg_temp.assert('consent: o histórico tem as 2 linhas (conceder, revogar), em ordem', (select array_agg(action order by id) = array['granted','revoked'] from public.marketing_consents where user_id = pg_temp.uid('ac1')));
select pg_temp.expect('consent: histórico só por inserção (UPDATE)', $q$update public.marketing_consents set source = 'account'$q$, 'KT008');
select pg_temp.expect('consent: histórico só por inserção (DELETE)', $q$delete from public.marketing_consents$q$, 'KT008');

-- ===== unsubscribe: descadastro em 1 clique, efeito imediato, sem exigir e-mail confirmado =========
do $s$ begin perform public.set_marketing_consent(pg_temp.uid('ac2'), true, 'free_games', 'v1-pgtap'); end $s$;
select pg_temp.assert('unsubscribe: quem tem opt-in é descadastrado (applied)', (select outcome = 'applied' and not opted_in from public.unsubscribe(pg_temp.uid('ac2'), 'unsubscribe_link')));
select pg_temp.assert('unsubscribe: a origem fica no histórico e o estado em profiles acompanha',
  (select action = 'revoked' and source = 'unsubscribe_link' from public.marketing_consents where user_id = pg_temp.uid('ac2') order by id desc limit 1)
  and (select not marketing_opt_in from public.profiles where user_id = pg_temp.uid('ac2')));
select pg_temp.assert('unsubscribe: repetido é noop', (select outcome = 'noop' and not opted_in from public.unsubscribe(pg_temp.uid('ac2'))));
select pg_temp.assert('unsubscribe: não exige e-mail confirmado (noop)', (select outcome = 'noop' from public.unsubscribe(pg_temp.uid('unconf'))));
insert into public.email_outbox (user_id, kind, category, to_email, dedupe_key, payload)
  values (pg_temp.uid('unconf'), 'cart_reminder', 'marketing', 'unconf@pgtap.test', 'cart_reminder:unconf:1', '{}');
select pg_temp.assert('unsubscribe: sem opt-in é noop', (select outcome = 'noop' from public.unsubscribe(pg_temp.uid('unconf'))));
select pg_temp.assert('unsubscribe: tira da fila o marketing que sobrou, mesmo sem opt-in', (select status = 'canceled' and skip_reason = 'no_opt_in' from public.email_outbox where dedupe_key = 'cart_reminder:unconf:1'));
select pg_temp.expect('unsubscribe: origem inválida', format($q$select * from public.unsubscribe(%L, 'banner')$q$, pg_temp.uid('ac2')), 'KT001');
select pg_temp.expect('unsubscribe: o suporte tira das novidades pelo admin, não por aqui', format($q$select * from public.unsubscribe(%L, 'support')$q$, pg_temp.uid('ac2')), 'KT001');
select pg_temp.expect('unsubscribe: usuário inexistente', $q$select * from public.unsubscribe(gen_random_uuid())$q$, 'KT001');
select pg_temp.expect('unsubscribe: p_user_id nulo', $q$select * from public.unsubscribe(null)$q$, 'KT001');
select pg_temp.expect_as('unsubscribe: service_role executa', 'service_role', format($q$select * from public.unsubscribe(%L)$q$, pg_temp.uid('ac2')), 'OK');

-- ===== set_stripe_customer ==========================================================================
select pg_temp.assert('stripe: grava e devolve o cliente', (select public.set_stripe_customer(pg_temp.uid('ac1'), 'cus_PGTAP_A') = 'cus_PGTAP_A'));
select pg_temp.assert('stripe: não sobrescreve; devolve o vigente', (select public.set_stripe_customer(pg_temp.uid('ac1'), 'cus_PGTAP_OUTRO') = 'cus_PGTAP_A')
  and (select stripe_customer_id = 'cus_PGTAP_A' from public.profiles where user_id = pg_temp.uid('ac1')));
select pg_temp.expect('stripe: cliente de outro perfil (23505)', format($q$select public.set_stripe_customer(%L, 'cus_PGTAP_A')$q$, pg_temp.uid('ac2')), '23505');
select pg_temp.expect('stripe: formato inválido', format($q$select public.set_stripe_customer(%L, 'xyz')$q$, pg_temp.uid('ac2')), 'KT001');
select pg_temp.expect('stripe: usuário não confirmado', format($q$select public.set_stripe_customer(%L, 'cus_PGTAP_Z')$q$, pg_temp.uid('unconf')), 'KT009');
-- Customer apagado no painel da Stripe (2026-10-24): com p_replaces igual ao guardado, troca; com outro, não mexe.
select pg_temp.assert('stripe: p_replaces diferente do guardado não troca', (select public.set_stripe_customer(pg_temp.uid('ac1'), 'cus_PGTAP_B', 'cus_PGTAP_OUTRO') = 'cus_PGTAP_A'));
select pg_temp.assert('stripe: p_replaces igual ao guardado troca e devolve o novo', (select public.set_stripe_customer(pg_temp.uid('ac1'), 'cus_PGTAP_B', 'cus_PGTAP_A') = 'cus_PGTAP_B'));
select pg_temp.assert('stripe: ... e o perfil ficou com o novo', (select stripe_customer_id = 'cus_PGTAP_B' from public.profiles where user_id = pg_temp.uid('ac1')));
select pg_temp.expect('stripe: p_replaces em formato inválido', format($q$select public.set_stripe_customer(%L, 'cus_PGTAP_C', 'xyz')$q$, pg_temp.uid('ac1')), 'KT001');

-- ===== marketing_allowed ==========================================================================
do $mk$
begin
  perform pg_temp.mk_user('mk1');
  insert into public.email_suppressions (email, reason, source, created_at) values ('mk1@pgtap.test', 'unsubscribe_all', 'brevo_webhook', now() - interval '2 days');
  insert into public.marketing_consents (user_id, email, action, source, text_version) values (pg_temp.uid('mk1'), 'mk1@pgtap.test', 'granted', 'account', 'v1');
  perform pg_temp.mk_user('mk2');
  insert into public.marketing_consents (user_id, email, action, source, text_version) values (pg_temp.uid('mk2'), 'mk2@pgtap.test', 'granted', 'account', 'v1');
  insert into public.email_suppressions (email, reason, source, created_at) values ('mk2@pgtap.test', 'unsubscribe_all', 'brevo_webhook', now() + interval '1 minute');
  perform pg_temp.mk_user('mk3');
  insert into public.marketing_consents (user_id, email, action, source, text_version) values (pg_temp.uid('mk3'), 'mk3@pgtap.test', 'granted', 'account', 'v1');
  insert into public.email_suppressions (email, reason, source) values ('mk3@pgtap.test', 'complaint', 'brevo_webhook');
  perform pg_temp.mk_user('mk4');
  insert into public.marketing_consents (user_id, email, action, source, text_version) values (pg_temp.uid('mk4'), 'mk4@pgtap.test', 'granted', 'account', 'v1');
  perform pg_temp.mk_user('mk5');
  insert into public.marketing_consents (user_id, email, action, source, text_version) values (pg_temp.uid('mk5'), 'mk5@pgtap.test', 'granted', 'account', 'v1');
  insert into public.email_suppressions (email, reason, source) values ('mk5@pgtap.test', 'hard_bounce', 'brevo_webhook');
end $mk$;
select pg_temp.assert('marketing_allowed: opt-in + confirmado + sem supressão', (select private.marketing_allowed(pg_temp.uid('mk4'))));
select pg_temp.assert('marketing_allowed: sem opt-in = false', (select not private.marketing_allowed(pg_temp.uid('ac2'))));
select pg_temp.assert('marketing_allowed: não confirmado = false', (select not private.marketing_allowed(pg_temp.uid('unconf'))));
select pg_temp.assert('marketing_allowed: hard_bounce suprime', (select not private.marketing_allowed(pg_temp.uid('mk5'))));
select pg_temp.assert('marketing_allowed: complaint suprime', (select not private.marketing_allowed(pg_temp.uid('mk3'))));
select pg_temp.assert('marketing_allowed: unsubscribe_all ANTERIOR ao opt-in não bloqueia', (select private.marketing_allowed(pg_temp.uid('mk1'))));
select pg_temp.assert('marketing_allowed: unsubscribe_all POSTERIOR ao opt-in bloqueia', (select not private.marketing_allowed(pg_temp.uid('mk2'))));
update auth.users set deleted_at = now() where id = pg_temp.uid('mk4');
select pg_temp.assert('marketing_allowed: usuário removido = false', (select not private.marketing_allowed(pg_temp.uid('mk4'))));
select pg_temp.assert('marketing_allowed: usuário inexistente = false', (select not private.marketing_allowed(gen_random_uuid())));
select pg_temp.expect('suppression: histórico só por inserção', $q$update public.email_suppressions set source = 'brevo_webhook'$q$, 'KT008');

-- ===== get_account =================================================================================
do $acc$
declare u uuid; o uuid;
begin
  u := pg_temp.uid('ac1');
  perform pg_temp.mk_order(u, 'open',            array[(select id from public.products where code = 'SG2')], 'GA0', now() - interval '9 days');
  perform pg_temp.mk_order(u, 'expired',         array[(select id from public.products where code = 'SG2')], 'GA1', now() - interval '8 days');
  perform pg_temp.mk_order(u, 'pending_payment', array[(select id from public.products where code = 'PK1'), (select id from public.products where code = 'SG1')], 'GA2', now() - interval '7 days');
  o := pg_temp.mk_order(u, 'paid', array[(select id from public.products where code = 'SG1')], 'GA3', now() - interval '6 days'); perform pg_temp.mk_ents(o);
  perform pg_temp.mk_order(u, 'failed', array[(select id from public.products where code = 'SG2')], 'GA4', now() - interval '5 days');
  o := pg_temp.mk_order(u, 'refunded', array[(select id from public.products where code = 'SG2')], 'GA5', now() - interval '4 days'); perform pg_temp.mk_ents(o, 'revoked', 'refund');
  o := pg_temp.mk_order(u, 'disputed', array[(select id from public.products where code = 'SG2')], 'GA6', now() - interval '3 days'); perform pg_temp.mk_ents(o, 'revoked', 'dispute');
  o := pg_temp.mk_order(pg_temp.uid('ac2'), 'paid', array[(select id from public.products where code = 'SG1')], 'GA7'); perform pg_temp.mk_ents(o);
end $acc$;
select pg_temp.assert('get_account: e-mail da conta', (select public.get_account(pg_temp.uid('ac1'))->>'email' = 'ac1@pgtap.test'));
select pg_temp.assert('get_account: só pedidos do usuário, sem open e expired (5 pedidos)', (select jsonb_array_length(public.get_account(pg_temp.uid('ac1'))->'orders') = 5));
select pg_temp.assert('get_account: do mais recente ao mais antigo', (select array_agg(o->>'status' order by ord) = array['disputed','refunded','failed','paid','pending_payment']
  from jsonb_array_elements(public.get_account(pg_temp.uid('ac1'))->'orders') with ordinality t(o, ord)));
select pg_temp.assert('get_account: ref de 8 caracteres hexadecimais maiúsculos', (select bool_and(o->>'ref' ~ '^[0-9A-F]{8}$') from jsonb_array_elements(public.get_account(pg_temp.uid('ac1'))->'orders') o));
select pg_temp.assert('get_account: itens do pedido com nome e valor cobrado, por position',
  (select o->'items' = '[{"code":"PK1","name":"Produto PK1 [TESTE]","unit_amount":0,"currency":"brl"},{"code":"SG1","name":"Produto SG1 [TESTE]","unit_amount":0,"currency":"brl"}]'::jsonb
   from jsonb_array_elements(public.get_account(pg_temp.uid('ac1'))->'orders') o where o->>'status' = 'pending_payment'));
select pg_temp.assert('get_account: campos do pedido', (select (o ? 'ref') and (o ? 'created_at') and (o ? 'paid_at') and (o ? 'status') and (o ? 'amount_total') and (o ? 'currency') and (o ? 'items')
  from jsonb_array_elements(public.get_account(pg_temp.uid('ac1'))->'orders') o limit 1));
select pg_temp.assert('get_account: paid_at é nulo fora da família paga', (select (o->'paid_at') = 'null'::jsonb from jsonb_array_elements(public.get_account(pg_temp.uid('ac1'))->'orders') o where o->>'status' in ('pending_payment','failed') limit 1));
select pg_temp.assert('get_account: não vaza pedido de outro usuário', (select jsonb_array_length(public.get_account(pg_temp.uid('ac2'))->'orders') = 1));
select pg_temp.assert('get_account: sem ids da Stripe, URL, e-mail alheio nem ids internos', (select public.get_account(pg_temp.uid('ac1'))::text !~ '(cs_test|pi_PGTAP|cus_|https?:|object_key|bucket|ac2@)'));
select pg_temp.assert('get_account: marketing sem consentimento vigente (revogado)', (select (public.get_account(pg_temp.uid('ac1'))->'marketing'->>'opted_in')::boolean = false
  and (public.get_account(pg_temp.uid('ac1'))->'marketing'->>'text_version') is null
  and (public.get_account(pg_temp.uid('ac1'))->'marketing'->>'updated_at') is not null));
select pg_temp.assert('get_account: marketing de quem nunca consentiu', (select public.get_account(pg_temp.uid('au3'))->'marketing' = '{"opted_in": false, "updated_at": null, "text_version": null, "prompted_at": null}'::jsonb));
select pg_temp.assert('get_account: marketing com opt-in vigente traz a versão do texto',
  (select public.get_account(pg_temp.uid('mk1'))->'marketing'->>'text_version' = 'v1' and (public.get_account(pg_temp.uid('mk1'))->'marketing'->>'opted_in')::boolean));
select pg_temp.expect('get_account: usuário não confirmado', format($q$select public.get_account(%L)$q$, pg_temp.uid('unconf')), 'KT009');
select pg_temp.expect('get_account: usuário removido', format($q$select public.get_account(%L)$q$, pg_temp.uid('mk4')), 'KT009');
select pg_temp.expect('get_account: usuário inexistente', $q$select public.get_account(gen_random_uuid())$q$, 'KT009');
select pg_temp.expect('get_account: p_user_id nulo', $q$select public.get_account(null)$q$, 'KT001');

-- ===== profiles.marketing_prompted_at (D-22): o consentimento signup_prompt marca a 1ª vez que o convite foi visto =====
-- Ver ou dispensar o convite NÃO é consentimento. mark_marketing_prompt saiu em 2026-10-24 (o convite do site saiu antes).
do $pr$
begin
  perform pg_temp.mk_user('pr2'); perform pg_temp.mk_user('pr3'); perform pg_temp.mk_user('pr4');
end $pr$;
select pg_temp.assert('prompt: perfil nasce sem convite exibido', (select count(*) = 3 and bool_and(marketing_prompted_at is null) from public.profiles where user_id in (select pg_temp.uid(n) from unnest(array['pr2','pr3','pr4']) n)));
select pg_temp.assert('prompt: mark_marketing_prompt não existe mais', not exists (select 1 from pg_proc where proname = 'mark_marketing_prompt'));
select pg_temp.assert('prompt: get_account de quem nunca viu o convite traz prompted_at nulo (a chave existe)',
  (select (public.get_account(pg_temp.uid('pr2'))->'marketing') ? 'prompted_at' and (public.get_account(pg_temp.uid('pr2'))->'marketing'->'prompted_at') = 'null'::jsonb));
select pg_temp.assert('prompt: set_marketing_consent com signup_prompt (concedendo) é applied',
  (select outcome = 'applied' from public.set_marketing_consent(pg_temp.uid('pr2'), true, 'signup_prompt', 'v1-pgtap')));
select pg_temp.assert('prompt: ... e o marcador ficou preenchido, com 1 linha no histórico', (select marketing_prompted_at is not null from public.profiles where user_id = pg_temp.uid('pr2'))
  and (select count(*) = 1 from public.marketing_consents where user_id = pg_temp.uid('pr2')));
update public.profiles set marketing_prompted_at = now() - interval '5 days' where user_id = pg_temp.uid('pr2');
select pg_temp.assert('prompt: signup_prompt repetido é noop', (select outcome = 'noop' from public.set_marketing_consent(pg_temp.uid('pr2'), true, 'signup_prompt', 'v1-pgtap')));
select pg_temp.assert('prompt: ... e não sobrescreve o marcador antigo', (select marketing_prompted_at < now() - interval '4 days' from public.profiles where user_id = pg_temp.uid('pr2')));
select pg_temp.assert('prompt: descadastrar é applied', (select outcome = 'applied' from public.unsubscribe(pg_temp.uid('pr2'), 'unsubscribe_link')));
select pg_temp.assert('prompt: ... e o marcador permanece depois da revogação', (select marketing_prompted_at < now() - interval '4 days' from public.profiles where user_id = pg_temp.uid('pr2')));
do $pn$ begin perform public.set_marketing_consent(pg_temp.uid('pr3'), true, 'account', 'v1-pgtap'); end $pn$;
select pg_temp.assert('prompt: conceder pela conta (origem account) não preenche o marcador', (select marketing_prompted_at is null from public.profiles where user_id = pg_temp.uid('pr3')));
select pg_temp.assert('prompt: signup_prompt em noop (já tinha opt-in) é noop',
  (select outcome = 'noop' from public.set_marketing_consent(pg_temp.uid('pr3'), true, 'signup_prompt', 'v1-pgtap')));
select pg_temp.assert('prompt: ... mas preenche o marcador (a pessoa viu o convite) e o histórico segue com 1 linha', (select marketing_prompted_at is not null from public.profiles where user_id = pg_temp.uid('pr3'))
  and (select count(*) = 1 from public.marketing_consents where user_id = pg_temp.uid('pr3')));
select pg_temp.expect('prompt: signup_prompt sem a versão do texto é recusado', format($q$select * from public.set_marketing_consent(%L, true, 'signup_prompt')$q$, pg_temp.uid('pr4')), 'KT001');
select pg_temp.assert('prompt: ... e a chamada recusada não marca o convite', (select marketing_prompted_at is null from public.profiles where user_id = pg_temp.uid('pr4')));

select * from finish();
rollback;
