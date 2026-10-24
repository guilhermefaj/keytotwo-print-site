-- 09_email_queue: claim_email_batch e mark_email_result (docs/data-contract.md v0.3.4, seção 6.7, T85 a T87).
-- Roda com `supabase test db` (pgTAP). Dados de teste só existem dentro da transação (rollback no fim).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp): supabase/tests/database/helpers ===========
\ir helpers/base.psql
\ir helpers/fixtures.psql

\ir helpers/checkout.psql

-- A concorrência da fila (dois despachantes ao mesmo tempo) está em 90_concurrency (T125).

-- ===== ajudantes ====================================================================================
create temp table mq (k text primary key, id uuid);
create function pg_temp.mq(p_k text) returns uuid language sql as $$ select id from pg_temp.mq where k = p_k $$;
create function pg_temp.mqs(p_k text) returns text language sql as $$ select status || '/' || coalesce(skip_reason, '-') from public.email_outbox where id = pg_temp.mq(p_k) $$;

-- usuário com opt-in vigente
create function pg_temp.mk_opt(p_name text) returns uuid language plpgsql as $$
declare v uuid := pg_temp.mk_user(p_name);
begin
  insert into public.marketing_consents (user_id, email, action, source, text_version) values (v, p_name || '@pgtap.test', 'granted', 'account', 'v1-pgtap');
  return v;
end $$;

-- linha da fila; p_sched é relativo a now() (negativo = já vencida)
create function pg_temp.mk_mail(p_key text, p_user text, p_kind text, p_order uuid default null, p_sched interval default '-1 minute', p_payload jsonb default '{}'::jsonb,
                                p_status text default 'queued', p_locked interval default null, p_attempts integer default 0, p_sent interval default null) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.email_outbox (user_id, order_id, kind, category, to_email, payload, scheduled_at, dedupe_key, status, locked_at, attempts, sent_at, skip_reason)
  values (pg_temp.uid(p_user), p_order, p_kind, case when p_kind = 'delivery' then 'transactional' else 'marketing' end, p_user || '@pgtap.test', p_payload,
          now() + p_sched, 'q:' || p_key, p_status,
          case when p_status = 'sending' then now() + p_locked end, p_attempts,
          case when p_status = 'sent' then now() + p_sent end,
          case when p_status in ('skipped', 'canceled') then 'no_opt_in' end)
  returning id into v;
  insert into pg_temp.mq values (p_key, v);
  return v;
end $$;

-- pedido pago com direito por produto (para a entrega e o pós-compra)
create function pg_temp.mk_paid(p_user text, p_tag text, p_status text default 'paid') returns uuid language plpgsql as $$
declare o uuid;
begin
  o := pg_temp.mk_order(pg_temp.uid(p_user), p_status, array[(select id from public.products where code = 'SG1')], p_tag);
  if p_status in ('paid') then perform pg_temp.mk_ents(o); end if;
  if p_status in ('disputed', 'dispute_lost') then perform pg_temp.mk_ents(o, 'revoked', 'dispute'); end if;
  if p_status = 'refunded' then perform pg_temp.mk_ents(o, 'revoked', 'refund'); end if;
  return o;
end $$;

-- ===== fixtures ====================================================================================
-- Este arquivo é dono da fila: o que já existia (entregas do seed, e-mails de outros dados) sai da fila só dentro desta transação,
-- para nenhum claim pegar linha alheia (o rollback no fim devolve tudo).
update public.email_outbox set status = 'canceled', skip_reason = 'order_not_paid', locked_at = null where status in ('queued', 'sending');
do $fx$
begin
  perform pg_temp.mk_product('SG1', 'single', 1);
  perform pg_temp.mk_product('CS1', 'single', 1);
  perform pg_temp.mk_product('CS2', 'single', 1);
end $fx$;

-- ===== T85 a fila nunca duplica a entrega =============================================================
do $c$ begin perform pg_temp.mk_user('qdup'); perform pg_temp.mk_mail('dup1', 'qdup', 'delivery', pg_temp.mk_paid('qdup', 'QDUP'), interval '1 day'); end $c$;
select pg_temp.expect('fila: a mesma dedupe_key não entra duas vezes (23505)',
  format($q$insert into public.email_outbox (user_id, order_id, kind, category, to_email, dedupe_key) select user_id, order_id, kind, category, to_email, dedupe_key from public.email_outbox where id = %L$q$, pg_temp.mq('dup1')), '23505');

-- ===== T86 claim_email_batch: validação e mecânica ====================================================
select pg_temp.expect('claim: p_limit zero', $q$select * from public.claim_email_batch(0)$q$, 'KT001');
select pg_temp.expect('claim: p_limit acima de 200', $q$select * from public.claim_email_batch(201)$q$, 'KT001');
select pg_temp.expect('claim: p_limit nulo', $q$select * from public.claim_email_batch(null)$q$, 'KT001');
select pg_temp.expect('claim: p_now nulo', $q$select * from public.claim_email_batch(10, null, null)$q$, 'KT001');

-- mecânica sobre entregas de pedidos pagos (a regra de cada tipo vem depois)
do $c$
declare i integer;
begin
  for i in 1..6 loop
    perform pg_temp.mk_user('qsel' || i);
    perform pg_temp.mk_mail('sel' || i, 'qsel' || i, 'delivery', pg_temp.mk_paid('qsel' || i, 'QSEL' || i), (-(10 - i) || ' minutes')::interval);   -- vencidas, a 1 mais antiga
  end loop;
  perform pg_temp.mk_user('qfut');
  perform pg_temp.mk_mail('fut', 'qfut', 'delivery', pg_temp.mk_paid('qfut', 'QFUT'), interval '2 hours');                       -- ainda não venceu
  perform pg_temp.mk_user('qdone');
  perform pg_temp.mk_mail('sent', 'qdone', 'delivery', pg_temp.mk_paid('qdone', 'QDONE'), p_status => 'sent', p_sent => interval '-1 hour');
  perform pg_temp.mk_user('qfail'); perform pg_temp.mk_mail('failed', 'qfail', 'delivery', pg_temp.mk_paid('qfail', 'QFAIL'), p_status => 'failed', p_attempts => 5);
  perform pg_temp.mk_user('qcanc'); perform pg_temp.mk_mail('canceled', 'qcanc', 'delivery', pg_temp.mk_paid('qcanc', 'QCANC'), p_status => 'canceled');
  insert into pg_temp.mq values ('claim_a', gen_random_uuid());
end $c$;
create temp table got (k text, j jsonb);
do $c$
begin
  insert into got select 'a', to_jsonb(r) from public.claim_email_batch(3) r;
end $c$;
select pg_temp.assert('claim: respeita p_limit (3) e pega os mais antigos primeiro',
  (select count(*) = 3 and array_agg(j->>'id' order by (select scheduled_at from public.email_outbox where id = (j->>'id')::uuid))
          = array[pg_temp.mq('sel1')::text, pg_temp.mq('sel2')::text, pg_temp.mq('sel3')::text] from got where k = 'a'));
select pg_temp.assert('claim: os pegos ficam sending, com locked_at', (select count(*) = 3 and bool_and(status = 'sending' and locked_at is not null) from public.email_outbox where id in (select (j->>'id')::uuid from got where k = 'a')));
select pg_temp.assert('claim: devolve id, kind, category, user_id, order_id, to_email, payload e attempts',
  (select j ?& array['id', 'kind', 'category', 'user_id', 'order_id', 'to_email', 'payload', 'attempts'] and j->>'kind' = 'delivery' and j->>'category' = 'transactional'
          and (j->>'attempts')::int = 0 and j->>'to_email' = 'qsel1@pgtap.test' and j->>'user_id' = pg_temp.uid('qsel1')::text from got where k = 'a' and j->>'id' = pg_temp.mq('sel1')::text));
do $c$ begin insert into got select 'b', to_jsonb(r) from public.claim_email_batch(50) r; end $c$;
select pg_temp.assert('claim: a 2ª chamada pega só o que sobrou vencido (3 entregas), nunca o que já estava sending',
  (select count(*) = 3 and bool_and(j->>'id' in (pg_temp.mq('sel4')::text, pg_temp.mq('sel5')::text, pg_temp.mq('sel6')::text)) from got where k = 'b'));
select pg_temp.assert('claim: nada é devolvido duas vezes', (select count(*) = count(distinct j->>'id') from got));
select pg_temp.assert('claim: não pega o que não venceu, nem sent, failed nem canceled',
  pg_temp.mqs('fut') = 'queued/-' and pg_temp.mqs('sent') = 'sent/-' and pg_temp.mqs('failed') = 'failed/-' and pg_temp.mqs('canceled') = 'canceled/no_opt_in');
do $c$ begin insert into got select 'c', to_jsonb(r) from public.claim_email_batch(50, null, now() + interval '3 hours') r; end $c$;
select pg_temp.assert('claim: com p_now no futuro, o que venceu entra (e o sending de 3 h atrás volta, porque ficou parado)',
  (select count(*) filter (where j->>'id' = pg_temp.mq('fut')::text) = 1 from got where k = 'c')
  and (select count(*) = 6 from got where k = 'c' and j->>'id' in (select id::text from pg_temp.mq where k like 'sel%')));

-- p_outbox_id: só a linha pedida (envio imediato depois do COMMIT do fulfill)
do $c$
begin
  perform pg_temp.mk_user('qone1'); perform pg_temp.mk_user('qone2');
  perform pg_temp.mk_mail('one1', 'qone1', 'delivery', pg_temp.mk_paid('qone1', 'QONE1'));
  perform pg_temp.mk_mail('one2', 'qone2', 'delivery', pg_temp.mk_paid('qone2', 'QONE2'));
  insert into got select 'd', to_jsonb(r) from public.claim_email_batch(10, pg_temp.mq('one2')) r;
end $c$;
select pg_temp.assert('claim: com p_outbox_id pega só essa linha', (select count(*) = 1 and bool_and(j->>'id' = pg_temp.mq('one2')::text) from got where k = 'd')
  and pg_temp.mqs('one1') = 'queued/-' and pg_temp.mqs('one2') = 'sending/-');
select pg_temp.assert('claim: com p_outbox_id de linha já em envio não devolve nada', (select count(*) = 0 from public.claim_email_batch(10, pg_temp.mq('one2'))));
select pg_temp.assert('claim: com p_outbox_id de linha que não venceu não devolve nada', (select count(*) = 0 from public.claim_email_batch(10, pg_temp.mq('fut'))));

-- sending parado: 10 minutos
do $c$
declare i integer;
begin
  perform pg_temp.mk_user('qstl1'); perform pg_temp.mk_user('qstl2'); perform pg_temp.mk_user('qstl3'); perform pg_temp.mk_user('qstl4');
  perform pg_temp.mk_mail('stale', 'qstl1', 'delivery', pg_temp.mk_paid('qstl1', 'QSTL1'), p_status => 'sending', p_locked => interval '-11 minutes', p_attempts => 1);
  perform pg_temp.mk_mail('fresh', 'qstl2', 'delivery', pg_temp.mk_paid('qstl2', 'QSTL2'), p_status => 'sending', p_locked => interval '-5 minutes', p_attempts => 1);
  perform pg_temp.mk_mail('stale5', 'qstl3', 'delivery', pg_temp.mk_paid('qstl3', 'QSTL3'), p_status => 'sending', p_locked => interval '-11 minutes', p_attempts => 4);
  insert into got select 'e', to_jsonb(r) from public.claim_email_batch(50) r;
end $c$;
select pg_temp.assert('claim: sending parado há mais de 10 min volta, contando uma tentativa (1 -> 2)',
  (select count(*) = 1 and bool_and((j->>'attempts')::int = 2) from got where k = 'e' and j->>'id' = pg_temp.mq('stale')::text)
  and (select status = 'sending' and attempts = 2 and locked_at >= now() - interval '1 minute' from public.email_outbox where id = pg_temp.mq('stale')));
select pg_temp.assert('claim: sending de 5 min atrás (fresco) não é tocado', (select count(*) = 0 from got where k = 'e' and j->>'id' = pg_temp.mq('fresh')::text)
  and (select attempts = 1 from public.email_outbox where id = pg_temp.mq('fresh')));
select pg_temp.assert('claim: sending parado na 5ª tentativa falha de vez (despachante que cai sempre não trava a fila)',
  (select count(*) = 0 from got where k = 'e' and j->>'id' = pg_temp.mq('stale5')::text)
  and (select status = 'failed' and attempts = 5 and locked_at is null and last_error like '%timeout%' from public.email_outbox where id = pg_temp.mq('stale5')));

-- ===== T86 entrega (transacional): só sai se o pedido segue pago e nenhum direito foi revogado ========
do $c$
declare st text;
begin
  perform pg_temp.mk_user('qd_ok');
  perform pg_temp.mk_mail('d_ok', 'qd_ok', 'delivery', pg_temp.mk_paid('qd_ok', 'QDOK'));
  foreach st in array array['disputed', 'dispute_lost', 'refunded', 'open', 'pending_payment', 'failed', 'expired'] loop
    perform pg_temp.mk_user('qd_' || st);
    perform pg_temp.mk_mail('d_' || st, 'qd_' || st, 'delivery', pg_temp.mk_paid('qd_' || st, 'QD' || st, st));
  end loop;
  -- pago, mas um direito foi revogado à mão (atendimento)
  perform pg_temp.mk_user('qd_manual');
  perform pg_temp.mk_mail('d_manual', 'qd_manual', 'delivery', pg_temp.mk_paid('qd_manual', 'QDMAN'));
  update public.entitlements set status = 'revoked', revoked_at = now(), revoke_reason = 'manual' where user_id = pg_temp.uid('qd_manual');
  insert into got select 'f', to_jsonb(r) from public.claim_email_batch(100) r;
end $c$;
select pg_temp.assert('entrega: pedido pago com direitos ativos segue para envio', pg_temp.mqs('d_ok') = 'sending/-' and exists (select 1 from got where k = 'f' and j->>'id' = pg_temp.mq('d_ok')::text));
select pg_temp.assert('entrega: pedido contestado, perdido ou reembolsado é cancelado (entitlement_revoked)',
  pg_temp.mqs('d_disputed') = 'canceled/entitlement_revoked' and pg_temp.mqs('d_dispute_lost') = 'canceled/entitlement_revoked' and pg_temp.mqs('d_refunded') = 'canceled/entitlement_revoked');
select pg_temp.assert('entrega: pedido que não está pago (open, pending_payment, failed, expired) é cancelado (order_not_paid)',
  pg_temp.mqs('d_open') = 'canceled/order_not_paid' and pg_temp.mqs('d_pending_payment') = 'canceled/order_not_paid'
  and pg_temp.mqs('d_failed') = 'canceled/order_not_paid' and pg_temp.mqs('d_expired') = 'canceled/order_not_paid');
select pg_temp.assert('entrega: pago com um direito revogado à mão é cancelado (entitlement_revoked)', pg_temp.mqs('d_manual') = 'canceled/entitlement_revoked');
select pg_temp.assert('entrega: os cancelados não voltam, nem com o relógio adiantado',
  (select count(*) = 0 from pg_temp.mq m cross join lateral public.claim_email_batch(1, m.id, now() + interval '5 hours') r where m.k like 'd\_%' and m.k <> 'd_ok'));

-- ===== T86 marketing: rechecado AQUI (opt-in, e-mail confirmado, supressão) ===========================
do $c$
declare o uuid;
begin
  -- sem opt-in
  perform pg_temp.mk_user('qm_noopt');   perform pg_temp.mk_mail('m_noopt', 'qm_noopt', 'post_purchase', pg_temp.mk_paid('qm_noopt', 'QMNO'));
  -- opt-in com bounce, queixa, descadastro geral depois do opt-in, descadastro geral ANTES do opt-in, e-mail não confirmado, e-mail removido
  perform pg_temp.mk_opt('qm_bounce');   perform pg_temp.mk_mail('m_bounce', 'qm_bounce', 'post_purchase', pg_temp.mk_paid('qm_bounce', 'QMBO'));
  insert into public.email_suppressions (email, reason, source) values ('qm_bounce@pgtap.test', 'hard_bounce', 'brevo_webhook');
  perform pg_temp.mk_opt('qm_compl');    perform pg_temp.mk_mail('m_compl', 'qm_compl', 'post_purchase', pg_temp.mk_paid('qm_compl', 'QMCO'));
  insert into public.email_suppressions (email, reason, source) values ('qm_compl@pgtap.test', 'complaint', 'brevo_webhook');
  perform pg_temp.mk_opt('qm_after');    perform pg_temp.mk_mail('m_after', 'qm_after', 'post_purchase', pg_temp.mk_paid('qm_after', 'QMAF'));
  insert into public.email_suppressions (email, reason, source, created_at) values ('qm_after@pgtap.test', 'unsubscribe_all', 'brevo_webhook', now() + interval '1 minute');
  perform pg_temp.mk_opt('qm_before');   perform pg_temp.mk_mail('m_before', 'qm_before', 'post_purchase', pg_temp.mk_paid('qm_before', 'QMBE'));
  insert into public.email_suppressions (email, reason, source, created_at) values ('qm_before@pgtap.test', 'unsubscribe_all', 'brevo_webhook', now() - interval '2 days');
  perform pg_temp.mk_opt('qm_unconf');   perform pg_temp.mk_mail('m_unconf', 'qm_unconf', 'post_purchase', pg_temp.mk_paid('qm_unconf', 'QMUN'));
  update auth.users set email_confirmed_at = null where id = pg_temp.uid('qm_unconf');
  perform pg_temp.mk_opt('qm_ok');       perform pg_temp.mk_mail('m_ok', 'qm_ok', 'post_purchase', pg_temp.mk_paid('qm_ok', 'QMOK'));
  -- pós-compra com o pedido fora de paid
  perform pg_temp.mk_opt('qm_notpaid');  perform pg_temp.mk_mail('m_notpaid', 'qm_notpaid', 'post_purchase', pg_temp.mk_paid('qm_notpaid', 'QMNP', 'refunded'));
  insert into got select 'g', to_jsonb(r) from public.claim_email_batch(200) r;
end $c$;
select pg_temp.assert('marketing sem opt-in = skipped (no_opt_in)', pg_temp.mqs('m_noopt') = 'skipped/no_opt_in');
select pg_temp.assert('marketing com hard_bounce ou queixa = skipped (suppressed)', pg_temp.mqs('m_bounce') = 'skipped/suppressed' and pg_temp.mqs('m_compl') = 'skipped/suppressed');
select pg_temp.assert('marketing com descadastro geral DEPOIS do opt-in = skipped (suppressed)', pg_temp.mqs('m_after') = 'skipped/suppressed');
select pg_temp.assert('marketing com descadastro geral ANTES do opt-in não bloqueia', pg_temp.mqs('m_before') = 'sending/-');
select pg_temp.assert('marketing com e-mail não confirmado = skipped (email_not_confirmed)', pg_temp.mqs('m_unconf') = 'skipped/email_not_confirmed');
select pg_temp.assert('marketing permitido segue para envio, com o payload', pg_temp.mqs('m_ok') = 'sending/-' and exists (select 1 from got where k = 'g' and j->>'id' = pg_temp.mq('m_ok')::text and j->>'kind' = 'post_purchase'));
select pg_temp.assert('pós-compra com o pedido fora de paid = skipped (order_not_paid)', pg_temp.mqs('m_notpaid') = 'skipped/order_not_paid');
select pg_temp.assert('os skipped também saem da fila para sempre',
  (select count(*) = 0 from pg_temp.mq m cross join lateral public.claim_email_batch(1, m.id, now() + interval '5 hours') r where m.k in ('m_noopt', 'm_bounce', 'm_compl', 'm_after', 'm_unconf', 'm_notpaid')));

-- lembrete de carrinho: a version e o carrinho são conferidos no envio
do $c$
declare v integer;
begin
  perform pg_temp.mk_opt('qc_ok');      perform public.cart_add(pg_temp.uid('qc_ok'), 'CS1');
  v := (select version from public.carts where user_id = pg_temp.uid('qc_ok'));
  perform pg_temp.mk_mail('c_ok', 'qc_ok', 'cart_reminder', null, '-1 minute', jsonb_build_object('cart_version', v, 'items', '[]'::jsonb));
  perform pg_temp.mk_opt('qc_chg');     perform public.cart_add(pg_temp.uid('qc_chg'), 'CS1'); perform public.cart_add(pg_temp.uid('qc_chg'), 'CS2');
  perform pg_temp.mk_mail('c_chg', 'qc_chg', 'cart_reminder', null, '-1 minute', jsonb_build_object('cart_version', 1, 'items', '[]'::jsonb));   -- o carrinho já está na version 2
  perform pg_temp.mk_opt('qc_empty');   perform public.cart_add(pg_temp.uid('qc_empty'), 'CS1'); perform public.cart_remove(pg_temp.uid('qc_empty'), 'CS1');
  perform pg_temp.mk_mail('c_empty', 'qc_empty', 'cart_reminder', null, '-1 minute', jsonb_build_object('cart_version', 2, 'items', '[]'::jsonb));
  perform pg_temp.mk_opt('qc_nocart');
  perform pg_temp.mk_mail('c_nocart', 'qc_nocart', 'cart_reminder', null, '-1 minute', jsonb_build_object('cart_version', 1, 'items', '[]'::jsonb));
  perform pg_temp.mk_opt('qc_nover');   perform public.cart_add(pg_temp.uid('qc_nover'), 'CS1');
  perform pg_temp.mk_mail('c_nover', 'qc_nover', 'cart_reminder', null, '-1 minute', '{}'::jsonb);
  insert into got select 'h', to_jsonb(r) from public.claim_email_batch(200) r;
end $c$;
select pg_temp.assert('lembrete: carrinho na mesma version e com itens segue', pg_temp.mqs('c_ok') = 'sending/-');
select pg_temp.assert('lembrete: version do carrinho diferente da do payload = skipped (cart_changed)', pg_temp.mqs('c_chg') = 'skipped/cart_changed');
select pg_temp.assert('lembrete: carrinho vazio = skipped (cart_empty)', pg_temp.mqs('c_empty') = 'skipped/cart_empty');
select pg_temp.assert('lembrete: sem carrinho = skipped (cart_empty)', pg_temp.mqs('c_nocart') = 'skipped/cart_empty');
select pg_temp.assert('lembrete: payload sem cart_version = skipped (cart_changed, falha fechada)', pg_temp.mqs('c_nover') = 'skipped/cart_changed');

-- no máximo 1 e-mail de marketing por pessoa a cada 24 h: o excedente vai para depois, sem ser pulado
do $c$
begin
  -- dois pós-compras de quem pode receber, no mesmo lote
  perform pg_temp.mk_opt('ql_two');
  perform pg_temp.mk_mail('l_two_a', 'ql_two', 'post_purchase', pg_temp.mk_paid('ql_two', 'QL2A'), '-2 minutes');
  perform pg_temp.mk_mail('l_two_b', 'ql_two', 'post_purchase', pg_temp.mk_paid('ql_two', 'QL2B'), '-1 minute');
  -- já recebeu um há 2 h
  perform pg_temp.mk_opt('ql_recent');
  perform pg_temp.mk_mail('l_recent_sent', 'ql_recent', 'post_purchase', pg_temp.mk_paid('ql_recent', 'QLR0'), '-3 hours', '{}'::jsonb, 'sent', null, 0, interval '-2 hours');
  perform pg_temp.mk_mail('l_recent', 'ql_recent', 'post_purchase', pg_temp.mk_paid('ql_recent', 'QLR1'), '-1 minute');
  -- recebeu um há 25 h
  perform pg_temp.mk_opt('ql_old');
  perform pg_temp.mk_mail('l_old_sent', 'ql_old', 'post_purchase', pg_temp.mk_paid('ql_old', 'QLO0'), '-26 hours', '{}'::jsonb, 'sent', null, 0, interval '-25 hours');
  perform pg_temp.mk_mail('l_old', 'ql_old', 'post_purchase', pg_temp.mk_paid('ql_old', 'QLO1'), '-1 minute');
  -- a entrega (transacional) não entra na conta do limite
  perform pg_temp.mk_opt('ql_tx');
  perform pg_temp.mk_mail('l_tx_sent', 'ql_tx', 'post_purchase', pg_temp.mk_paid('ql_tx', 'QLT0'), '-3 hours', '{}'::jsonb, 'sent', null, 0, interval '-1 minute');
  perform pg_temp.mk_mail('l_tx', 'ql_tx', 'delivery', pg_temp.mk_paid('ql_tx', 'QLT1'), '-1 minute');
  insert into got select 'i', to_jsonb(r) from public.claim_email_batch(200) r;
end $c$;
select pg_temp.assert('limite diário: no mesmo lote o 1º segue e o 2º do mesmo usuário fica na fila, adiado em 24 h (não é pulado)',
  pg_temp.mqs('l_two_a') = 'sending/-' and pg_temp.mqs('l_two_b') = 'queued/-'
  and (select scheduled_at >= now() + interval '23 hours 59 minutes' and scheduled_at <= now() + interval '24 hours 1 minute' and locked_at is null from public.email_outbox where id = pg_temp.mq('l_two_b')));
select pg_temp.assert('limite diário: quem recebeu há 2 h espera até completar 24 h do envio', pg_temp.mqs('l_recent') = 'queued/-'
  and (select scheduled_at between now() + interval '21 hours 59 minutes' and now() + interval '22 hours 1 minute' from public.email_outbox where id = pg_temp.mq('l_recent')));
select pg_temp.assert('limite diário: quem recebeu há 25 h recebe', pg_temp.mqs('l_old') = 'sending/-');
select pg_temp.assert('limite diário: a entrega transacional não conta e não é limitada', pg_temp.mqs('l_tx') = 'sending/-');
select pg_temp.assert('limite diário: o adiado não é devolvido enquanto não vence, e depois do prazo (e do envio do anterior) sai',
  (select count(*) = 0 from public.claim_email_batch(200) r where r.id = pg_temp.mq('l_two_b'))
  and (select status = 'queued' from public.email_outbox where id = pg_temp.mq('l_two_b')));
do $c$ begin
  perform public.mark_email_result(pg_temp.mq('l_two_a'), 'sent', 'msg-two-a');
  insert into got select 'j', to_jsonb(r) from public.claim_email_batch(200, pg_temp.mq('l_two_b'), now() + interval '25 hours') r;
end $c$;
select pg_temp.assert('limite diário: passadas 24 h do envio anterior, o adiado sai', (select count(*) = 1 from got where k = 'j') and pg_temp.mqs('l_two_b') = 'sending/-');

-- ===== T87 mark_email_result ===========================================================================
select pg_temp.expect('mark: id nulo', $q$select * from public.mark_email_result(null, 'sent')$q$, 'KT001');
select pg_temp.expect('mark: status nulo', format($q$select * from public.mark_email_result(%L, null)$q$, pg_temp.mq('d_ok')), 'KT001');
select pg_temp.expect('mark: status desconhecido', format($q$select * from public.mark_email_result(%L, 'queued')$q$, pg_temp.mq('d_ok')), 'KT001');
select pg_temp.assert('mark: id inexistente = not_found', (select outcome = 'not_found' and status is null and next_attempt_at is null from public.mark_email_result(gen_random_uuid(), 'sent')));
do $c$ begin perform pg_temp.mk_user('qnoq'); perform pg_temp.mk_mail('noq', 'qnoq', 'delivery', pg_temp.mk_paid('qnoq', 'QNOQ'), interval '1 day'); end $c$;
select pg_temp.assert('mark: linha que não está em envio (queued) = noop e nada muda',
  (select outcome = 'noop' and status = 'queued' from public.mark_email_result(pg_temp.mq('noq'), 'sent'))
  and pg_temp.mqs('noq') = 'queued/-' and (select sent_at is null from public.email_outbox where id = pg_temp.mq('noq')));

-- sent
do $c$ begin
  insert into got select 'k1', to_jsonb(r) from public.mark_email_result(pg_temp.mq('d_ok'), 'sent', 'brevo-msg-1') r;
  insert into got select 'k2', to_jsonb(r) from public.mark_email_result(pg_temp.mq('d_ok'), 'sent', 'brevo-msg-1') r;
  insert into got select 'k3', to_jsonb(r) from public.mark_email_result(pg_temp.mq('d_ok'), 'failed', null, 'depois do sent') r;
  insert into got select 'k4', to_jsonb(r) from public.mark_email_result(pg_temp.mq('m_ok'), 'sent', null) r;
end $c$;
select pg_temp.assert('mark: sent = applied, grava sent_at e a mensagem do provedor e solta o travamento',
  (select j->>'outcome' = 'applied' and j->>'status' = 'sent' and j->'next_attempt_at' = 'null'::jsonb from got where k = 'k1')
  and (select status = 'sent' and sent_at >= now() - interval '1 minute' and provider_message_id = 'brevo-msg-1' and locked_at is null and last_error is null
       from public.email_outbox where id = pg_temp.mq('d_ok')));
select pg_temp.assert('mark: repetir o resultado (sent de novo, ou failed depois do sent) = noop e nada muda',
  (select j->>'outcome' = 'noop' and j->>'status' = 'sent' from got where k = 'k2') and (select j->>'outcome' = 'noop' and j->>'status' = 'sent' from got where k = 'k3')
  and (select attempts = 0 and last_error is null from public.email_outbox where id = pg_temp.mq('d_ok')));
select pg_temp.assert('mark: sent da entrega grava o funil delivery_sent, uma vez, no pedido',
  (select count(*) = 1 from public.funnel_events f join public.email_outbox x on x.order_id = f.order_id where x.id = pg_temp.mq('d_ok') and f.type = 'delivery_sent'));
select pg_temp.assert('mark: sent de marketing não grava funil de entrega', (select count(*) = 0 from public.funnel_events f join public.email_outbox x on x.order_id = f.order_id
  where x.id = pg_temp.mq('m_ok') and f.type = 'delivery_sent'));
select pg_temp.assert('mark: o que já foi enviado nunca mais é pego pela fila',
  (select count(*) = 0 from pg_temp.mq m cross join lateral public.claim_email_batch(1, m.id, now() + interval '48 hours') r where m.k in ('d_ok', 'm_ok')));

-- failed: volta para a fila adiado em 5 min x tentativas², até a 5ª falha
do $c$
declare i integer; r record;
begin
  perform pg_temp.mk_user('qrty');
  perform pg_temp.mk_mail('rty', 'qrty', 'delivery', pg_temp.mk_paid('qrty', 'QRTY'));
  for i in 1..5 loop
    perform * from public.claim_email_batch(1, pg_temp.mq('rty'), now() + (i * interval '3 hours'));
    select * into r from public.mark_email_result(pg_temp.mq('rty'), 'failed', null, 'erro ' || i);
    insert into got values ('rty' || i, to_jsonb(r));
  end loop;
end $c$;
select pg_temp.assert('mark: 1ª falha volta a queued, com tentativa 1, erro e adiada 5 min',
  (select j->>'outcome' = 'applied' and j->>'status' = 'queued' and (j->>'next_attempt_at')::timestamptz between now() + interval '4 minutes 59 seconds' and now() + interval '5 minutes 1 second' from got where k = 'rty1'));
select pg_temp.assert('mark: 2ª, 3ª e 4ª falhas adiam 20, 45 e 80 min (5 x tentativas²)',
  (select (j->>'next_attempt_at')::timestamptz between now() + interval '19 minutes 59 seconds' and now() + interval '20 minutes 1 second' from got where k = 'rty2')
  and (select (j->>'next_attempt_at')::timestamptz between now() + interval '44 minutes 59 seconds' and now() + interval '45 minutes 1 second' from got where k = 'rty3')
  and (select (j->>'next_attempt_at')::timestamptz between now() + interval '79 minutes 59 seconds' and now() + interval '80 minutes 1 second' from got where k = 'rty4'));
select pg_temp.assert('mark: a 5ª falha é final (failed, sem nova data), com 5 tentativas e o último erro',
  (select j->>'outcome' = 'applied' and j->>'status' = 'failed' and j->'next_attempt_at' = 'null'::jsonb from got where k = 'rty5')
  and (select status = 'failed' and attempts = 5 and last_error = 'erro 5' and locked_at is null from public.email_outbox where id = pg_temp.mq('rty')));
select pg_temp.assert('mark: depois da falha final a fila não pega mais a linha', (select count(*) = 0 from public.claim_email_batch(1, pg_temp.mq('rty'), now() + interval '7 days')));

-- a volta para a fila só sai quando vence
do $c$
begin
  perform pg_temp.mk_user('qbk');
  perform pg_temp.mk_mail('bk', 'qbk', 'delivery', pg_temp.mk_paid('qbk', 'QBK'));
  perform * from public.claim_email_batch(1, pg_temp.mq('bk'));
  perform * from public.mark_email_result(pg_temp.mq('bk'), 'failed', null, 'timeout do provedor');
end $c$;
select pg_temp.assert('mark: depois de falhar, a linha só sai quando passa a data adiada',
  (select count(*) = 0 from public.claim_email_batch(200, pg_temp.mq('bk'), now() + interval '4 minutes') r)
  and (select count(*) = 1 from public.claim_email_batch(200, pg_temp.mq('bk'), now() + interval '6 minutes') r));
select pg_temp.assert('mark: o reenvio chega com attempts = 1', (select attempts = 1 from public.email_outbox where id = pg_temp.mq('bk')));

-- rejected e erro grande
do $c$
begin
  perform pg_temp.mk_user('qrj'); perform pg_temp.mk_user('qlong');
  perform pg_temp.mk_mail('rj', 'qrj', 'delivery', pg_temp.mk_paid('qrj', 'QRJ'));
  perform pg_temp.mk_mail('long', 'qlong', 'delivery', pg_temp.mk_paid('qlong', 'QLONG'));
  perform * from public.claim_email_batch(2, pg_temp.mq('rj'));
  perform * from public.claim_email_batch(2, pg_temp.mq('long'));
  insert into got select 'rj', to_jsonb(r) from public.mark_email_result(pg_temp.mq('rj'), 'rejected', null, 'e-mail inexistente') r;
  insert into got select 'long', to_jsonb(r) from public.mark_email_result(pg_temp.mq('long'), 'failed', null, repeat('x', 900)) r;
end $c$;
select pg_temp.assert('mark: rejected vai direto a failed (1 tentativa, erro gravado)', (select j->>'outcome' = 'applied' and j->>'status' = 'failed' from got where k = 'rj')
  and (select status = 'failed' and attempts = 1 and last_error = 'e-mail inexistente' and locked_at is null from public.email_outbox where id = pg_temp.mq('rj')));
select pg_temp.assert('mark: erro com mais de 500 caracteres é cortado em 500 (e o resultado ainda é aplicado)',
  (select j->>'outcome' = 'applied' from got where k = 'long') and (select char_length(last_error) = 500 from public.email_outbox where id = pg_temp.mq('long')));

-- ===== de ponta a ponta: fulfill -> claim -> mark; a fila não envia duas vezes ===========================
do $c$
declare o uuid;
begin
  perform pg_temp.mk_user('qe2e');
  o := pg_temp.open_order(pg_temp.uid('qe2e'), array['CS1']);
  insert into got select 'e2e_f', to_jsonb(r) from pg_temp.fulfill(o, array[1500]) r;
  insert into pg_temp.oids values ('e2e', o);
  insert into got select 'e2e_c1', to_jsonb(r) from public.claim_email_batch(5, (select (j->>'outbox_id')::uuid from got where k = 'e2e_f')) r;
  insert into got select 'e2e_c2', to_jsonb(r) from public.claim_email_batch(5) r where r.order_id = o;
  insert into got select 'e2e_m1', to_jsonb(r) from public.mark_email_result((select (j->>'outbox_id')::uuid from got where k = 'e2e_f'), 'sent', 'msg-e2e') r;
  insert into got select 'e2e_c3', to_jsonb(r) from public.claim_email_batch(5, null, now() + interval '30 days') r where r.order_id = o;
  insert into got select 'e2e_f2', to_jsonb(r) from pg_temp.fulfill(o, array[1500], '{"source": "return_page"}') r;
end $c$;
select pg_temp.assert('e2e: o fulfill enfileira a entrega e o claim por p_outbox_id a entrega ao despachante, com o payload por jogo e sem token',
  (select (j->>'send_delivery')::boolean from got where k = 'e2e_f')
  and (select count(*) = 1 and bool_and(j->>'kind' = 'delivery' and j->>'to_email' = 'qe2e@pgtap.test' and jsonb_array_length(j->'payload'->'games') = 1
          and (j->'payload')::text !~ '(token|https?:)' and (j->'payload'->'games'->0 ?& array['entitlement_id', 'game_id', 'code', 'name'])) from got where k = 'e2e_c1'));
select pg_temp.assert('e2e: depois de pega, a entrega não é pega de novo (nem pelo lote, nem pelo reenvio da página de retorno)',
  (select count(*) = 0 from got where k = 'e2e_c2') and (select not (j->>'send_delivery')::boolean from got where k = 'e2e_f2'));
select pg_temp.assert('e2e: mark sent grava o envio e o funil; depois de sent, nem 30 dias adiante a fila pega',
  (select j->>'status' = 'sent' from got where k = 'e2e_m1') and (select count(*) = 0 from got where k = 'e2e_c3')
  and (select count(*) = 1 from public.funnel_events where order_id = pg_temp.oid('e2e') and type = 'delivery_sent')
  and (select count(*) = 1 from public.email_outbox where order_id = pg_temp.oid('e2e')));

-- ===== papel da API: as duas RPCs terminam sem erro como service_role ===================================
do $c$ begin
  perform pg_temp.mk_user('qapi'); perform pg_temp.mk_mail('api', 'qapi', 'delivery', pg_temp.mk_paid('qapi', 'QAPI'));
end $c$;
select pg_temp.expect_as('claim: service_role executa', 'service_role', format($q$select * from public.claim_email_batch(5, %L)$q$, pg_temp.mq('api')), 'OK');
select pg_temp.expect_as('mark: service_role executa', 'service_role', format($q$select * from public.mark_email_result(%L, 'sent', 'msg-api')$q$, pg_temp.mq('api')), 'OK');
select pg_temp.expect_as('claim: anon não executa', 'anon', $q$select * from public.claim_email_batch(5)$q$, '42501');
select pg_temp.expect_as('claim: authenticated não executa', 'authenticated', $q$select * from public.claim_email_batch(5)$q$, '42501');
select pg_temp.expect_as('mark: anon não executa', 'anon', format($q$select * from public.mark_email_result(%L, 'sent')$q$, pg_temp.mq('api')), '42501');
select pg_temp.expect_as('mark: authenticated não executa', 'authenticated', format($q$select * from public.mark_email_result(%L, 'sent')$q$, pg_temp.mq('api')), '42501');
select pg_temp.assert('API: o envio terminou sent', pg_temp.mqs('api') = 'sent/-');

select * from finish();
rollback;
