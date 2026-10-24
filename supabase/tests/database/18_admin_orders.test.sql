-- 18_admin_orders: pedidos e reembolsos no admin (migração 20261024150000, Fase 3): lista e busca, ficha do pedido, o
-- que a API precisa para falar com a Stripe, o reembolso pela origem admin com o aviso por e-mail (um por pedido, também
-- quando o webhook chega depois), a fila que envia o aviso de pedido reembolsado e o histórico do admin.
-- Roda com `supabase test db` (pgTAP). Dados de teste só existem dentro da transação (rollback no fim).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp): supabase/tests/database/helpers ===========
\ir helpers/base.psql
\ir helpers/fixtures.psql
\ir helpers/checkout.psql

create temp table res (k text primary key, j jsonb);

-- ===== fixtures ====================================================================================
do $$
declare o uuid;
begin
  perform pg_temp.mk_user('padm');
  update auth.users set raw_app_meta_data = jsonb_build_object('provider', 'email', 'admin', true) where id = pg_temp.uid('padm');
  perform pg_temp.mk_user('pana');
  perform pg_temp.mk_user('pbia');
  perform pg_temp.mk_user('pcris');
  perform pg_temp.mk_product('PSOLO', 'single', 1);
  perform pg_temp.mk_product('PPACK', 'bundle', 2);
  -- pago (ana), aberto com sessão (bia), pago de outra pessoa (cris), pago e depois reembolsado pela Stripe (cris)
  o := pg_temp.buy(pg_temp.uid('pana'), array['PSOLO'], array[990]); insert into pg_temp.oids values ('pago', o);
  o := pg_temp.open_order(pg_temp.uid('pbia'), array['PPACK']); insert into pg_temp.oids values ('aberto', o);
  -- pago no modo produção (cris): não aparece na lista do modo teste
  select c.order_id into o from public.create_order_from_cart(pg_temp.uid('pcris'), true, pg_temp.fill_cart(pg_temp.uid('pcris'), array['PPACK']), 'v-pgtap', true) c;
  perform public.attach_checkout_session(o, 'cs_live_PGTAP_' || replace(o::text, '-', ''));
  perform * from pg_temp.fulfill(o, array[2990], jsonb_build_object('livemode', true, 'session', 'cs_live_PGTAP_' || replace(o::text, '-', '')));
  insert into pg_temp.oids values ('pago2', o);
end $$;

-- ===== admin_list_orders =========================================================================
select pg_temp.assert('lista: quem não é admin recebe forbidden',
  (select outcome = 'forbidden' and result is null from public.admin_list_orders(pg_temp.uid('pana'), null, 'all', false, 0)));
select pg_temp.expect('lista: filtro desconhecido é KT001',
  $$select * from public.admin_list_orders(pg_temp.uid('padm'), null, 'tudo', false, 0)$$, 'KT001');
select pg_temp.expect('lista: sem o modo da Stripe é KT001',
  $$select * from public.admin_list_orders(pg_temp.uid('padm'), null, 'all', null, 0)$$, 'KT001');
-- Dentro da transação o now() não anda: os pedidos têm o mesmo created_at e a ordem entre eles é a do id.
select pg_temp.assert('lista: só os pedidos do modo pedido, com itens, e-mail e código',
  (select outcome = 'ok' and (result->>'total')::int = 2 and (result->>'limit')::int = 50
          and result->'orders' @> jsonb_build_array(jsonb_build_object('id', pg_temp.oid('aberto')))
          and result->'orders' @> jsonb_build_array(jsonb_build_object(
                'id', pg_temp.oid('pago'), 'email', 'pana@pgtap.test', 'items', '["Produto PSOLO [TESTE]"]'::jsonb,
                'ref', private.order_ref(pg_temp.oid('pago')), 'status', 'paid', 'amount_total', 990))
     from public.admin_list_orders(pg_temp.uid('padm'), null, 'all', false, 0)));
select pg_temp.assert('lista: o modo produção mostra só o pedido de produção',
  (select (result->>'total')::int = 1 and result->'orders'->0->>'id' = pg_temp.oid('pago2')::text
     from public.admin_list_orders(pg_temp.uid('padm'), null, 'all', true, 0)));
select pg_temp.assert('lista: filtros pago e em andamento',
  (select (result->>'total')::int = 1 and result->'orders'->0->>'id' = pg_temp.oid('pago')::text
     from public.admin_list_orders(pg_temp.uid('padm'), null, 'paid', false, 0))
  and (select (result->>'total')::int = 1 and result->'orders'->0->>'id' = pg_temp.oid('aberto')::text
     from public.admin_list_orders(pg_temp.uid('padm'), null, 'pending', false, 0))
  and (select (result->>'total')::int = 0 from public.admin_list_orders(pg_temp.uid('padm'), null, 'refunded', false, 0)));
select pg_temp.assert('lista: busca pelo código (com #, em minúsculas) e por parte do e-mail',
  (select (result->>'total')::int = 1 and result->'orders'->0->>'id' = pg_temp.oid('pago')::text
     from public.admin_list_orders(pg_temp.uid('padm'), '#' || lower(private.order_ref(pg_temp.oid('pago'))), 'all', false, 0))
  and (select (result->>'total')::int = 1 and result->'orders'->0->>'id' = pg_temp.oid('aberto')::text
     from public.admin_list_orders(pg_temp.uid('padm'), 'PBIA@', 'all', false, 0)));

-- ===== admin_get_order ===========================================================================
select pg_temp.assert('ficha: forbidden para quem não é admin; not_found para pedido que não existe',
  (select outcome = 'forbidden' from public.admin_get_order(pg_temp.uid('pana'), pg_temp.oid('pago')))
  and (select outcome = 'not_found' from public.admin_get_order(pg_temp.uid('padm'), gen_random_uuid())));
select pg_temp.assert('ficha do pago: valores, pessoa, itens, linha do tempo e jogos; dá para reembolsar e reenviar',
  (select outcome = 'ok'
          and result->'order'->>'status' = 'paid' and (result->'order'->>'amount_total')::bigint = 990
          and (result->'order'->>'refundable')::boolean and (result->'order'->>'deliverable')::boolean
          and not (result->'order'->>'reconcilable')::boolean
          and result->'person'->>'email' = 'pana@pgtap.test' and (result->'person'->>'exists')::boolean
          and jsonb_array_length(result->'items') = 1 and result->'items'->0->>'code' = 'PSOLO'
          and result->'events'->-1->>'to_status' = 'paid'
          and jsonb_array_length(result->'entitlements') = 1 and result->'entitlements'->0->>'status' = 'active'
          and (result->'downloads'->>'count')::int = 0
          and jsonb_array_length(result->'emails') = 1 and result->'emails'->0->>'kind' = 'delivery'
          and result->'history' = '[]'::jsonb
     from public.admin_get_order(pg_temp.uid('padm'), pg_temp.oid('pago'))));
select pg_temp.assert('ficha do aberto: dá para conferir com a Stripe, não para reembolsar',
  (select (result->'order'->>'reconcilable')::boolean and not (result->'order'->>'refundable')::boolean
          and result->'order'->>'stripe_checkout_session_id' like 'cs_test_PGTAP_%'
     from public.admin_get_order(pg_temp.uid('padm'), pg_temp.oid('aberto'))));

-- ===== admin_order_stripe =======================================================================
select pg_temp.assert('stripe: o intent, a sessão e o valor do pedido; forbidden para quem não é admin',
  (select outcome = 'ok' and status = 'paid' and kind = 'purchase' and not livemode and user_id = pg_temp.uid('pana')
          and payment_intent_id like 'pi_PGTAP_%' and amount_total = 990 and currency = 'brl'
          and ref = private.order_ref(pg_temp.oid('pago'))
     from public.admin_order_stripe(pg_temp.uid('padm'), pg_temp.oid('pago')))
  and (select outcome = 'forbidden' from public.admin_order_stripe(pg_temp.uid('pana'), pg_temp.oid('pago')))
  and (select outcome = 'not_found' from public.admin_order_stripe(pg_temp.uid('padm'), gen_random_uuid())));

-- ===== reembolso pela origem admin =============================================================
do $$ begin
  insert into res select 'adm', to_jsonb(r) from pg_temp.setst(pg_temp.oid('pago'), 'refunded', '{"source": "admin", "reason": "admin_refund"}') r;
  -- o webhook do mesmo reembolso chega depois: nada muda e o aviso não duplica
  insert into res select 'wh', to_jsonb(r) from pg_temp.setst(pg_temp.oid('pago'), 'refunded', '{"event": "evt_PGTAP_F3R", "event_type": "charge.refunded", "reason": "manual_refund"}') r;
end $$;
select pg_temp.assert('reembolso pelo admin: aplica, revoga por refund e registra a origem admin',
  (select j->>'outcome' = 'applied' and j->>'order_status' = 'refunded' and j->>'entitlement_status' = 'revoked' from res where k = 'adm')
  and (select source = 'admin' and reason = 'admin_refund' and to_status = 'refunded'
         from public.order_events where order_id = pg_temp.oid('pago') order by id desc limit 1)
  and (select bool_and(status = 'revoked' and revoke_reason = 'refund') from public.entitlements where order_id = pg_temp.oid('pago')));
select pg_temp.assert('reembolso: o webhook depois vira noop e o aviso de reembolso é um só, na fila',
  (select j->>'outcome' = 'noop' from res where k = 'wh')
  and (select count(*) = 1 and bool_and(status = 'queued' and category = 'transactional' and to_email = 'pana@pgtap.test'
                                        and (payload->>'amount_total')::bigint = 990
                                        and payload->'items'->0->>'code' = 'PSOLO')
         from public.email_outbox where order_id = pg_temp.oid('pago') and kind = 'refund')
  and (select status = 'canceled' from public.email_outbox where order_id = pg_temp.oid('pago') and kind = 'delivery'));
select pg_temp.assert('reembolso: a lista filtra o reembolsado e a ficha mostra o aviso',
  (select (result->>'total')::int = 1 from public.admin_list_orders(pg_temp.uid('padm'), null, 'refunded', false, 0))
  and (select not (result->'order'->>'refundable')::boolean and not (result->'order'->>'deliverable')::boolean
              and result->'emails' @> '[{"kind": "refund", "status": "queued"}]'::jsonb
         from public.admin_get_order(pg_temp.uid('padm'), pg_temp.oid('pago'))));
select pg_temp.expect('a origem desconhecida continua KT001',
  $$select * from public.set_order_status(pg_temp.oid('pago2'), 'refunded', 'painel')$$, 'KT001');

-- ===== histórico do admin =====================================================================
select pg_temp.expect('histórico: ação desconhecida é KT001',
  $$select * from public.admin_log_order_action(pg_temp.uid('padm'), pg_temp.oid('pago'), 'order_delete', 'pedido da pessoa', '{}')$$, 'KT001');
select pg_temp.expect('histórico: motivo curto é KT001',
  $$select * from public.admin_log_order_action(pg_temp.uid('padm'), pg_temp.oid('pago'), 'order_refund', 'oi', '{}')$$, 'KT001');
select pg_temp.assert('histórico: forbidden para quem não é admin; not_found para pedido que não existe',
  (select outcome = 'forbidden' from public.admin_log_order_action(pg_temp.uid('pana'), pg_temp.oid('pago'), 'order_refund', 'pedido da pessoa', '{}'))
  and (select outcome = 'not_found' from public.admin_log_order_action(pg_temp.uid('padm'), gen_random_uuid(), 'order_refund', 'pedido da pessoa', '{}')));
do $$ begin
  insert into res select 'log', to_jsonb(r) from public.admin_log_order_action(pg_temp.uid('padm'), pg_temp.oid('pago'), 'order_refund', 'Pedido da pessoa por e-mail', '{"refund_id": "re_PGTAP"}') r;
end $$;
select pg_temp.assert('histórico: grava a ação com o motivo, o pedido e o dono, e devolve o aviso que está na fila',
  (select j->>'outcome' = 'ok' and (j->>'outbox_id')::uuid = (select id from public.email_outbox where dedupe_key = 'refund:' || pg_temp.oid('pago'))
     from res where k = 'log')
  and (select count(*) = 1 and bool_and(a.user_id = pg_temp.uid('padm') and a.target_id = pg_temp.uid('pana')
                                        and a.details->>'reason' = 'Pedido da pessoa por e-mail' and a.details->>'refund_id' = 're_PGTAP'
                                        and a.details->>'order_ref' = private.order_ref(pg_temp.oid('pago')))
         from private.admin_events a where a.action = 'order_refund')
  and (select result->'history'->0->>'action' = 'order_refund' and result->'history'->0->>'by' = 'padm@pgtap.test'
         from public.admin_get_order(pg_temp.uid('padm'), pg_temp.oid('pago')))
  and (select result->'history' @> '[{"action": "order_refund"}]'::jsonb from public.admin_get_user(pg_temp.uid('padm'), pg_temp.uid('pana'))));

-- ===== a fila envia o aviso do pedido reembolsado =============================================
do $$ begin
  insert into res select 'claim', jsonb_agg(to_jsonb(c)) from public.claim_email_batch(20, (select id from public.email_outbox where dedupe_key = 'refund:' || pg_temp.oid('pago'))) c;
end $$;
select pg_temp.assert('fila: o aviso de reembolso sai (sending), mesmo com o pedido reembolsado',
  (select jsonb_array_length(j) = 1 and j->0->>'kind' = 'refund' and j->0->'payload'->>'order_ref' = private.order_ref(pg_temp.oid('pago'))
     from res where k = 'claim')
  and (select status = 'sending' from public.email_outbox where dedupe_key = 'refund:' || pg_temp.oid('pago')));
select pg_temp.assert('histórico: sem aviso na fila, o reembolso devolve outbox_id nulo',
  (select outcome = 'ok' and outbox_id is null
     from public.admin_log_order_action(pg_temp.uid('padm'), pg_temp.oid('pago'), 'order_refund', 'Registro de novo', '{}')));

-- ===== conta apagada não recebe aviso =========================================================
do $$ begin
  update auth.users set deleted_at = now() where id = pg_temp.uid('pcris');
  perform pg_temp.setst(pg_temp.oid('pago2'), 'refunded', '{"source": "admin", "reason": "admin_refund"}');
end $$;
select pg_temp.assert('reembolso de conta apagada: o pedido reembolsa e nenhum aviso entra na fila',
  (select status = 'refunded' from public.orders where id = pg_temp.oid('pago2'))
  and (select count(*) = 0 from public.email_outbox where order_id = pg_temp.oid('pago2') and kind = 'refund'));

select * from finish();
rollback;
