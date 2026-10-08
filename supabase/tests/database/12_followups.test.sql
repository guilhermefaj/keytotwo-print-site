-- 12_followups: record_email_event, private.enqueue_followups, private.dispatch_tick e o job do pg_cron (docs/data-contract.md v0.3.5, T65, T88 e T89).
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

-- ===== ajudantes do checkout (05_checkout_fulfill e 90_concurrency) =================================
create temp table oids (name text primary key, id uuid);
create function pg_temp.oid(p_name text) returns uuid language sql as $$ select id from pg_temp.oids where name = p_name $$;

-- preenche o carrinho pelas RPCs e devolve a version
create function pg_temp.fill_cart(p_user uuid, p_codes text[]) returns integer language plpgsql as $$
declare c text;
begin
  foreach c in array p_codes loop perform public.cart_add(p_user, c); end loop;
  return coalesce((select ca.version from public.carts ca where ca.user_id = p_user), 0);
end $$;

-- pedido open pelas RPCs (carrinho -> create_order_from_cart -> attach_checkout_session)
create function pg_temp.open_order(p_user uuid, p_codes text[], p_attach boolean default true) returns uuid language plpgsql as $$
declare v_ver integer; v_order uuid;
begin
  v_ver := pg_temp.fill_cart(p_user, p_codes);
  select c.order_id into v_order from public.create_order_from_cart(p_user, false, v_ver, 'v-pgtap', true) c;
  if p_attach then
    perform public.attach_checkout_session(v_order, 'cs_test_PGTAP_' || replace(v_order::text, '-', ''));
  end if;
  return v_order;
end $$;

-- line_items da sessão para os itens do pedido (preço cheio por position)
create function pg_temp.sess_items(p_order uuid, p_amounts bigint[]) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('stripe_price_id', oi.stripe_price_id, 'quantity', 1,
                                      'unit_amount', p_amounts[oi.position], 'currency', 'brl') order by oi.position)
  from public.order_items oi where oi.order_id = p_order
$$;

-- fulfill_order com valores coerentes por padrão; p_over troca campos: discount, subtotal, total, code, intent, customer,
-- event, event_type, status, session, source, livemode, currency, items
create function pg_temp.fulfill(p_order uuid, p_amounts bigint[], p_over jsonb default '{}'::jsonb)
returns table (outcome text, order_id uuid, order_status text, entitlement_count integer, outbox_id uuid, send_delivery boolean)
language plpgsql as $$
declare
  v_sub  bigint := coalesce((select sum(a) from unnest(p_amounts) a), 0);
  v_disc bigint := coalesce((p_over->>'discount')::bigint, 0);
begin
  return query select * from public.fulfill_order(
    p_order_id => p_order,
    p_checkout_session_id => coalesce(p_over->>'session', 'cs_test_PGTAP_' || replace(p_order::text, '-', '')),
    p_payment_status => coalesce(p_over->>'status', 'paid'),
    p_amount_subtotal => coalesce((p_over->>'subtotal')::bigint, v_sub),
    p_amount_discount => v_disc,
    p_amount_total => coalesce((p_over->>'total')::bigint, v_sub - v_disc),
    p_currency => coalesce(p_over->>'currency', 'brl'),
    p_promotion_code => p_over->>'code',
    p_payment_intent_id => case when p_over ? 'intent' then p_over->>'intent' else 'pi_PGTAP_' || replace(p_order::text, '-', '') end,
    p_customer_id => p_over->>'customer',
    p_livemode => coalesce((p_over->>'livemode')::boolean, false),
    p_items => coalesce(p_over->'items', pg_temp.sess_items(p_order, p_amounts)),
    p_source => coalesce(p_over->>'source', 'webhook'),
    p_stripe_event_id => p_over->>'event',
    p_event_type => p_over->>'event_type');
end $$;

-- set_order_status: p_over troca: event, event_type, reason, source, subtotal, discount, total, currency, code, intent
create function pg_temp.setst(p_order uuid, p_new text, p_over jsonb default '{}'::jsonb)
returns table (outcome text, order_id uuid, previous_status text, order_status text, entitlement_status text)
language plpgsql as $$
begin
  return query select * from public.set_order_status(
    p_order_id => p_order, p_new_status => p_new,
    p_source => coalesce(p_over->>'source', 'webhook'),
    p_stripe_event_id => p_over->>'event',
    p_reason => p_over->>'reason',
    p_amount_total => (p_over->>'total')::bigint,
    p_currency => p_over->>'currency',
    p_payment_intent_id => p_over->>'intent',
    p_amount_subtotal => (p_over->>'subtotal')::bigint,
    p_amount_discount => (p_over->>'discount')::bigint,
    p_promotion_code => p_over->>'code',
    p_event_type => p_over->>'event_type');
end $$;

-- compra completa pelas RPCs; devolve o pedido
create function pg_temp.buy(p_user uuid, p_codes text[], p_amounts bigint[], p_over jsonb default '{}'::jsonb) returns uuid language plpgsql as $$
declare v_order uuid;
begin
  v_order := pg_temp.open_order(p_user, p_codes);
  perform * from pg_temp.fulfill(v_order, p_amounts, p_over);
  return v_order;
end $$;

-- I-5 no estado atual: dispara os gatilhos diferidos agora e volta ao modo diferido
create function pg_temp.i5(p_label text) returns text language plpgsql as $$
declare st text := 'OK';
begin
  begin set constraints all immediate; exception when others then get stacked diagnostics st = returned_sqlstate; end;
  set constraints all deferred;
  return extensions.is(st, 'OK', p_label);
end $$;

-- contagens de um pedido, para provar que nada mudou
create function pg_temp.footprint(p_order uuid) returns text language sql as $$
  select concat_ws('|',
    (select count(*) from public.entitlements where order_id = p_order),
    (select count(*) from public.entitlement_games eg join public.entitlements e on e.id = eg.entitlement_id where e.order_id = p_order),
    (select count(*) from public.email_outbox where order_id = p_order),
    (select count(*) from public.order_events where order_id = p_order),
    (select count(*) from public.funnel_events where order_id = p_order),
    (select count(*) from public.stripe_events where order_id = p_order),
    (select status from public.orders where id = p_order))
$$;

-- ===== ajudantes ====================================================================================
create function pg_temp.mk_opt(p_name text) returns uuid language plpgsql as $$
declare v uuid := pg_temp.mk_user(p_name);
begin
  insert into public.marketing_consents (user_id, email, action, source, text_version) values (v, p_name || '@pgtap.test', 'granted', 'account', 'v1-pgtap');
  return v;
end $$;
-- e-mail de marketing já na fila
create function pg_temp.mk_q(p_key text, p_user text, p_kind text default 'cart_reminder') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.email_outbox (user_id, kind, category, to_email, payload, scheduled_at, dedupe_key)
  values (pg_temp.uid(p_user), p_kind, 'marketing', p_user || '@pgtap.test', '{}'::jsonb, now() - interval '1 minute', 'f:' || p_key) returning id into v;
  return v;
end $$;
create function pg_temp.supp(p_email text, p_reason text) returns integer language sql as $$
  select count(*)::int from public.email_suppressions where email = p_email and reason = p_reason
$$;
create function pg_temp.outbox(p_user text, p_kind text) returns bigint language sql as $$
  select count(*) from public.email_outbox where user_id = pg_temp.uid(p_user) and kind = p_kind
$$;
create temp table fz (k text primary key, v text);
create function pg_temp.fxv(p_k text) returns text language sql as $$ select v from pg_temp.fz where k = p_k $$;

-- Este arquivo é dono da fila e das supressões: quem já existia (seed, dados de QA) fica fora de toda elegibilidade, só dentro desta transação.
insert into public.email_suppressions (email, reason, source)
select private.normalize_email(u.email), 'hard_bounce', 'support' from auth.users u on conflict do nothing;
update public.email_outbox set status = 'canceled', skip_reason = 'order_not_paid', locked_at = null where status in ('queued', 'sending');

do $fx$
begin
  perform pg_temp.mk_product('FP1', 'single', 1);
  perform pg_temp.mk_product('FP2', 'single', 1);
  perform pg_temp.mk_product('FP3', 'bundle', 2);
end $fx$;

-- ===== T65 record_email_event ========================================================================
select pg_temp.expect('evento: e-mail nulo', $q$select * from public.record_email_event(null, 'hard_bounce')$q$, 'KT001');
select pg_temp.expect('evento: e-mail inválido', $q$select * from public.record_email_event('abc', 'hard_bounce')$q$, 'KT001');
select pg_temp.expect('evento: evento nulo', $q$select * from public.record_email_event('x@pgtap.test', null)$q$, 'KT001');
select pg_temp.expect('evento: evento desconhecido (delivered)', $q$select * from public.record_email_event('x@pgtap.test', 'delivered')$q$, 'KT001');
select pg_temp.expect('evento: soft_bounce não é tratado', $q$select * from public.record_email_event('x@pgtap.test', 'soft_bounce')$q$, 'KT001');

do $c$
begin
  perform pg_temp.mk_opt('ra'); perform pg_temp.mk_opt('rb'); perform pg_temp.mk_opt('rc'); perform pg_temp.mk_user('rd');
  perform pg_temp.mk_q('ra1', 'ra'); perform pg_temp.mk_q('rb1', 'rb'); perform pg_temp.mk_q('rc1', 'rc', 'post_purchase');
  -- a entrega (transacional) de rb, que NÃO pode ser tocada
  insert into public.email_outbox (user_id, order_id, kind, category, to_email, dedupe_key)
  values (pg_temp.uid('rb'), pg_temp.mk_order(pg_temp.uid('rb'), 'paid', array[(select id from public.products where code = 'FP1')], 'RB1'), 'delivery', 'transactional', 'rb@pgtap.test', 'f:rb-delivery');
  insert into fz select 'hb', to_jsonb(r)::text from public.record_email_event('ra@pgtap.test', 'hard_bounce', 'msg-bounce-1', now()) r;
  insert into fz select 'hb2', to_jsonb(r)::text from public.record_email_event('ra@pgtap.test', 'hard_bounce', 'msg-bounce-2') r;
  insert into fz select 'hb3', to_jsonb(r)::text from public.record_email_event('  RA@PGTAP.test ', 'hard_bounce') r;
  insert into fz select 'cp', to_jsonb(r)::text from public.record_email_event('rb@pgtap.test', 'complaint', 'msg-compl-1') r;
  insert into fz select 'un', to_jsonb(r)::text from public.record_email_event('rc@pgtap.test', 'unsubscribe', 'msg-unsub-1') r;
  insert into fz select 'gh', to_jsonb(r)::text from public.record_email_event('ghost@pgtap.test', 'unsubscribe') r;
end $c$;
select pg_temp.assert('evento: hard_bounce = applied, devolve o usuário da conta e grava a supressão com a origem, a mensagem e o horário do evento',
  (select (v::jsonb)->>'outcome' = 'applied' and (v::jsonb)->>'user_id' = pg_temp.uid('ra')::text from fz where k = 'hb')
  and (select reason = 'hard_bounce' and source = 'brevo_webhook' and provider_message_id = 'msg-bounce-1' and occurred_at = now() from public.email_suppressions where email = 'ra@pgtap.test'));
select pg_temp.assert('evento: hard_bounce só suprime: o consentimento segue vigente, o marketing na fila segue queued (barrado no envio) e marketing_allowed vira falso',
  (select marketing_opt_in from public.profiles where user_id = pg_temp.uid('ra'))
  and (select status = 'queued' from public.email_outbox where dedupe_key = 'f:ra1') and not private.marketing_allowed(pg_temp.uid('ra')));
select pg_temp.assert('evento: o mesmo hard_bounce de novo (outra mensagem, ou e-mail com maiúsculas e espaços) = noop, com o usuário, sem 2ª linha',
  (select (v::jsonb)->>'outcome' = 'noop' and (v::jsonb)->>'user_id' = pg_temp.uid('ra')::text from fz where k = 'hb2')
  and (select (v::jsonb)->>'outcome' = 'noop' and (v::jsonb)->>'user_id' = pg_temp.uid('ra')::text from fz where k = 'hb3')
  and pg_temp.supp('ra@pgtap.test', 'hard_bounce') = 1
  and (select provider_message_id = 'msg-bounce-1' from public.email_suppressions where email = 'ra@pgtap.test'));
select pg_temp.assert('evento: complaint = applied: suprime, REVOGA o consentimento (origem brevo_webhook) e cancela o marketing na fila',
  (select (v::jsonb)->>'outcome' = 'applied' and (v::jsonb)->>'user_id' = pg_temp.uid('rb')::text from fz where k = 'cp')
  and pg_temp.supp('rb@pgtap.test', 'complaint') = 1
  and (select not marketing_opt_in and marketing_opt_in_at is null from public.profiles where user_id = pg_temp.uid('rb'))
  and (select action = 'revoked' and source = 'brevo_webhook' and email = 'rb@pgtap.test' from public.marketing_consents where user_id = pg_temp.uid('rb') order by id desc limit 1)
  and (select status = 'canceled' and skip_reason = 'no_opt_in' from public.email_outbox where dedupe_key = 'f:rb1'));
select pg_temp.assert('evento: a entrega transacional na fila NÃO é tocada pela queixa', (select status = 'queued' from public.email_outbox where dedupe_key = 'f:rb-delivery'));
select pg_temp.assert('evento: unsubscribe grava o motivo unsubscribe_all, revoga o consentimento e cancela o marketing na fila',
  (select (v::jsonb)->>'outcome' = 'applied' and (v::jsonb)->>'user_id' = pg_temp.uid('rc')::text from fz where k = 'un')
  and pg_temp.supp('rc@pgtap.test', 'unsubscribe_all') = 1 and pg_temp.supp('rc@pgtap.test', 'unsubscribe') = 0
  and (select not marketing_opt_in from public.profiles where user_id = pg_temp.uid('rc'))
  and (select status = 'canceled' and skip_reason = 'no_opt_in' from public.email_outbox where dedupe_key = 'f:rc1'));
select pg_temp.assert('evento: e-mail sem conta = applied com user_id nulo, e a supressão fica registrada',
  (select (v::jsonb)->>'outcome' = 'applied' and (v::jsonb)->'user_id' = 'null'::jsonb from fz where k = 'gh') and pg_temp.supp('ghost@pgtap.test', 'unsubscribe_all') = 1);

-- o horário que vale é o do evento
do $c$
begin
  perform pg_temp.mk_opt('re');
  insert into fz select 'old', to_jsonb(r)::text from public.record_email_event('re@pgtap.test', 'unsubscribe', null, now() - interval '2 days') r;
  perform pg_temp.mk_user('rg');
  insert into fz select 'fut', to_jsonb(r)::text from public.record_email_event('rg@pgtap.test', 'hard_bounce', null, now() + interval '7 days') r;
end $c$;
select pg_temp.assert('evento: descadastro ANTERIOR ao opt-in fica registrado mas não revoga o opt-in novo nem bloqueia o marketing',
  (select (v::jsonb)->>'outcome' = 'applied' from fz where k = 'old') and pg_temp.supp('re@pgtap.test', 'unsubscribe_all') = 1
  and (select marketing_opt_in from public.profiles where user_id = pg_temp.uid('re')) and private.marketing_allowed(pg_temp.uid('re'))
  and (select occurred_at = now() - interval '2 days' and created_at = now() - interval '2 days' from public.email_suppressions where email = 're@pgtap.test'));
select pg_temp.assert('evento: horário no futuro vira agora', (select occurred_at = now() from public.email_suppressions where email = 'rg@pgtap.test' and reason = 'hard_bounce'));
-- reenvio do mesmo evento velho depois do opt-in: nada acontece
select pg_temp.assert('evento: o reenvio do evento velho continua sem efeito (noop)', (select outcome = 'noop' from public.record_email_event('re@pgtap.test', 'unsubscribe', null, now() - interval '2 days')));
-- opt-in de novo depois de um descadastro, e um NOVO descadastro: vale mesmo com a supressão antiga
do $c$
begin
  perform pg_temp.mk_opt('rf');
  perform public.record_email_event('rf@pgtap.test', 'unsubscribe', 'm1');
  perform public.set_marketing_consent(pg_temp.uid('rf'), true, 'account', 'v2-pgtap');
  insert into fz select 'again', to_jsonb(r)::text from public.record_email_event('rf@pgtap.test', 'unsubscribe', 'm2') r;
end $c$;
select pg_temp.assert('evento: opt-in de novo e um novo descadastro: a supressão é a mesma (1 linha), mas o consentimento é revogado (applied)',
  (select (v::jsonb)->>'outcome' = 'applied' from fz where k = 'again') and pg_temp.supp('rf@pgtap.test', 'unsubscribe_all') = 1
  and (select not marketing_opt_in from public.profiles where user_id = pg_temp.uid('rf'))
  and (select array_agg(action order by id) = array['granted', 'revoked', 'granted', 'revoked'] from public.marketing_consents where user_id = pg_temp.uid('rf')));
update auth.users set deleted_at = now() where id = pg_temp.uid('rd');
select pg_temp.assert('evento: conta removida = user_id nulo', (select user_id is null from public.record_email_event('rd@pgtap.test', 'complaint')));
do $c$ begin
  perform public.record_email_event('rh@pgtap.test', 'complaint', '   ');
  perform public.record_email_event('ri@pgtap.test', 'complaint', repeat('m', 500));
end $c$;
select pg_temp.assert('evento: id da mensagem em branco vira nulo', (select provider_message_id is null from public.email_suppressions where email = 'rh@pgtap.test'));
select pg_temp.assert('evento: id da mensagem com 500 caracteres é cortado em 200', (select char_length(provider_message_id) = 200 from public.email_suppressions where email = 'ri@pgtap.test'));
select pg_temp.expect('evento: a supressão só se insere (UPDATE)', $q$update public.email_suppressions set source = 'support'$q$, 'KT008');
select pg_temp.expect_as('evento: service_role executa', 'service_role', $q$select * from public.record_email_event('rj@pgtap.test', 'hard_bounce')$q$, 'OK');
select pg_temp.expect_as('evento: anon não executa', 'anon', $q$select * from public.record_email_event('rj@pgtap.test', 'hard_bounce')$q$, '42501');
select pg_temp.expect_as('evento: authenticated não executa', 'authenticated', $q$select * from public.record_email_event('rj@pgtap.test', 'hard_bounce')$q$, '42501');

-- ===== T88 enqueue_followups: lembrete de carrinho ========================================================
do $c$
declare o uuid; i integer;
begin
  perform pg_temp.mk_opt('cr1'); perform public.cart_add(pg_temp.uid('cr1'), 'FP1');                                    -- elegível
  perform pg_temp.mk_user('cr2'); perform public.cart_add(pg_temp.uid('cr2'), 'FP1');                                   -- sem opt-in
  perform pg_temp.mk_opt('cr3'); perform public.cart_add(pg_temp.uid('cr3'), 'FP1');
  insert into public.email_suppressions (email, reason, source) values ('cr3@pgtap.test', 'hard_bounce', 'support');    -- bounce
  perform pg_temp.mk_opt('cr4'); perform public.cart_add(pg_temp.uid('cr4'), 'FP1');
  insert into public.email_suppressions (email, reason, source, created_at) values ('cr4@pgtap.test', 'unsubscribe_all', 'support', now() + interval '1 minute');   -- descadastro depois do opt-in
  perform pg_temp.mk_opt('cr5'); perform public.cart_add(pg_temp.uid('cr5'), 'FP1');
  update auth.users set email_confirmed_at = null where id = pg_temp.uid('cr5');                                        -- não confirmado
  perform pg_temp.mk_opt('cr6'); perform public.cart_add(pg_temp.uid('cr6'), 'FP1'); perform public.cart_remove(pg_temp.uid('cr6'), 'FP1');   -- vazio
  perform pg_temp.mk_opt('cr7'); perform public.cart_add(pg_temp.uid('cr7'), 'FP1'); perform public.cart_add(pg_temp.uid('cr7'), 'FP2');     -- FP2 sai do ar depois
  perform pg_temp.mk_opt('cr8'); perform public.cart_add(pg_temp.uid('cr8'), 'FP3');                                    -- já possui o FP3 inteiro
  o := pg_temp.mk_order(pg_temp.uid('cr8'), 'paid', array[(select id from public.products where code = 'FP3')], 'CR8'); perform pg_temp.mk_ents(o);
  perform pg_temp.mk_opt('cr9'); perform public.cart_add(pg_temp.uid('cr9'), 'FP1');                                    -- tem pagamento assíncrono em curso
  perform pg_temp.mk_order(pg_temp.uid('cr9'), 'pending_payment', array[(select id from public.products where code = 'FP1')], 'CR9');
  update public.products set status = 'draft' where code = 'FP2';
  insert into fz select 'n0', private.enqueue_followups(now())::text;
  insert into fz select 'n1', private.enqueue_followups(now() + interval '2 hours 59 minutes')::text;
end $c$;
select pg_temp.assert('lembrete: carrinho que acabou de mudar não é lembrado (p_now = agora, nem 2 h 59 min depois)', (select v = '0' from fz where k = 'n0') and (select v = '0' from fz where k = 'n1')
  and (select count(*) = 0 from public.email_outbox where dedupe_key like 'cart_reminder:%' and to_email like '%@pgtap.test'));
do $c$ begin insert into fz select 'n2', private.enqueue_followups(now() + interval '3 hours')::text; end $c$;
select pg_temp.assert('lembrete: 3 h depois da última mudança (limite inclusivo), enfileira o elegível e o que tem item vendável (cr1 e cr7); devolve a contagem',
  (select v = '2' from fz where k = 'n2') and pg_temp.outbox('cr1', 'cart_reminder') = 1 and pg_temp.outbox('cr7', 'cart_reminder') = 1
  and (select count(*) = 2 from public.email_outbox where dedupe_key like 'cart_reminder:%' and to_email like '%@pgtap.test'));
select pg_temp.assert('lembrete: não enfileira sem opt-in, com bounce, com descadastro depois do opt-in, e-mail não confirmado, carrinho vazio, jogos já possuídos nem com pagamento em curso',
  pg_temp.outbox('cr2', 'cart_reminder') = 0 and pg_temp.outbox('cr3', 'cart_reminder') = 0 and pg_temp.outbox('cr4', 'cart_reminder') = 0 and pg_temp.outbox('cr5', 'cart_reminder') = 0
  and pg_temp.outbox('cr6', 'cart_reminder') = 0 and pg_temp.outbox('cr8', 'cart_reminder') = 0 and pg_temp.outbox('cr9', 'cart_reminder') = 0);
select pg_temp.assert('lembrete: linha de marketing queued, com o e-mail da conta, agendada para agora, dedupe por version e payload {cart_version, items}',
  (select kind = 'cart_reminder' and category = 'marketing' and status = 'queued' and to_email = 'cr1@pgtap.test' and scheduled_at = now() and order_id is null
          and dedupe_key = 'cart_reminder:' || user_id::text || ':1' and payload = '{"cart_version": 1, "items": [{"code": "FP1", "name": "Produto FP1 [TESTE]"}]}'::jsonb
   from public.email_outbox where user_id = pg_temp.uid('cr1') and kind = 'cart_reminder'));
select pg_temp.assert('lembrete: o item fora do ar não entra no payload (cr7 só com o FP1)', (select payload->'items' = '[{"code": "FP1", "name": "Produto FP1 [TESTE]"}]'::jsonb
  from public.email_outbox where user_id = pg_temp.uid('cr7') and kind = 'cart_reminder'));
do $c$ begin insert into fz select 'n3', private.enqueue_followups(now() + interval '3 hours')::text; end $c$;
select pg_temp.assert('lembrete: rodar de novo não duplica (devolve 0): um por version', (select v = '0' from fz where k = 'n3') and (select count(*) = 2 from public.email_outbox where dedupe_key like 'cart_reminder:%' and to_email like '%@pgtap.test'));
do $c$ begin
  perform public.cart_add(pg_temp.uid('cr1'), 'FP3');     -- o carrinho mudou: version 2
  insert into fz select 'n4', private.enqueue_followups(now() + interval '3 hours')::text;
end $c$;
select pg_temp.assert('lembrete: depois de mudar o carrinho (version 2) e esperar de novo, sai um novo lembrete, com os 2 itens',
  (select v = '1' from fz where k = 'n4') and pg_temp.outbox('cr1', 'cart_reminder') = 2
  and (select payload->>'cart_version' = '2' and jsonb_array_length(payload->'items') = 2 from public.email_outbox where dedupe_key = 'cart_reminder:' || pg_temp.uid('cr1')::text || ':2'));

-- o que a compra faz com o lembrete: cancela o da fila e nenhum novo nasce
do $c$
declare o uuid; v integer;
begin
  perform pg_temp.mk_opt('cp1');
  o := pg_temp.open_order(pg_temp.uid('cp1'), array['FP1']);
  perform private.enqueue_followups(now() + interval '3 hours');      -- lembrete da version 1, com o carrinho já com o pedido aberto
  insert into fz select 'cp_before', pg_temp.outbox('cp1', 'cart_reminder')::text;
  perform * from pg_temp.fulfill(o, array[1000]);
  insert into fz select 'n5', private.enqueue_followups(now() + interval '3 hours')::text;
end $c$;
select pg_temp.assert('lembrete: a compra cancela o lembrete que estava na fila (already_purchased)', (select v = '1' from fz where k = 'cp_before')
  and (select status = 'canceled' and skip_reason = 'already_purchased' from public.email_outbox where user_id = pg_temp.uid('cp1') and kind = 'cart_reminder'));
select pg_temp.assert('lembrete: depois de pago o carrinho está vazio e nenhum lembrete novo nasce', pg_temp.outbox('cp1', 'cart_reminder') = 1);

-- ===== T88 enqueue_followups: pós-compra ===================================================================
do $c$
declare o uuid; fp1 bigint := (select id from public.products where code = 'FP1'); fp3 bigint := (select id from public.products where code = 'FP3');
begin
  perform pg_temp.mk_opt('pp1');
  o := pg_temp.mk_order(pg_temp.uid('pp1'), 'paid', array[fp3, fp1], 'PP1'); perform pg_temp.mk_ents(o); insert into fz values ('pp1', o::text);
  o := pg_temp.mk_order(pg_temp.uid('pp1'), 'paid', array[fp1], 'PP1B'); perform pg_temp.mk_ents(o); insert into fz values ('pp1b', o::text);
  perform pg_temp.mk_user('pp2');
  o := pg_temp.mk_order(pg_temp.uid('pp2'), 'paid', array[fp1], 'PP2'); perform pg_temp.mk_ents(o);                                         -- sem opt-in
  perform pg_temp.mk_opt('pp3');
  o := pg_temp.mk_order(pg_temp.uid('pp3'), 'paid', array[fp1], 'PP3'); perform pg_temp.mk_ents(o);
  insert into public.email_suppressions (email, reason, source) values ('pp3@pgtap.test', 'complaint', 'support');                            -- queixa
  perform pg_temp.mk_opt('pp4');
  o := pg_temp.mk_order(pg_temp.uid('pp4'), 'refunded', array[fp1], 'PP4'); perform pg_temp.mk_ents(o, 'revoked', 'refund');                -- reembolsado
  perform pg_temp.mk_opt('pp5');
  o := pg_temp.mk_order(pg_temp.uid('pp5'), 'paid', array[fp1], 'PP5'); perform pg_temp.mk_ents(o, 'revoked', 'manual');                    -- direito revogado à mão
  perform pg_temp.mk_opt('pp6');
  o := pg_temp.mk_order(pg_temp.uid('pp6'), 'disputed', array[fp1], 'PP6'); perform pg_temp.mk_ents(o, 'revoked', 'dispute');              -- contestado
  perform pg_temp.mk_opt('pp7');
  o := pg_temp.mk_order(pg_temp.uid('pp7'), 'pending_payment', array[fp1], 'PP7');                                                          -- ainda não pago
  insert into fz select 'q0', private.enqueue_followups(now() + interval '2 days 23 hours')::text;
  insert into fz select 'q1', private.enqueue_followups(now() + interval '14 days')::text;
  insert into fz select 'q2', private.enqueue_followups(now() + interval '3 days')::text;
end $c$;
select pg_temp.assert('pós-compra: antes de D+3 e a partir de D+14 (exclusive) não enfileira nada; em D+3 (inclusivo) saem os elegíveis e a contagem devolvida é a das linhas criadas',
  (select v = '0' from fz where k = 'q0') and (select v = '0' from fz where k = 'q1')
  and (select v::int = (select count(*) from public.email_outbox where dedupe_key like 'post_purchase:%' and to_email like '%@pgtap.test') from fz where k = 'q2')
  and pg_temp.outbox('pp1', 'post_purchase') = 2 and pg_temp.outbox('cr8', 'post_purchase') = 1 and pg_temp.outbox('cp1', 'post_purchase') = 1);
select pg_temp.assert('pós-compra: um por pedido, com a ordem, o e-mail da conta, agendado para agora e dedupe post_purchase:{pedido}',
  (select count(*) = 2 and bool_and(category = 'marketing' and status = 'queued' and to_email = 'pp1@pgtap.test' and scheduled_at = now() and user_id = pg_temp.uid('pp1')
          and dedupe_key = 'post_purchase:' || order_id::text) from public.email_outbox where kind = 'post_purchase' and user_id = pg_temp.uid('pp1'))
  and (select count(distinct order_id) = 2 from public.email_outbox where kind = 'post_purchase' and user_id = pg_temp.uid('pp1')));
select pg_temp.assert('pós-compra: payload com a referência do pedido e um jogo por jogo comprado (sem repetir), pela ordem dos itens',
  (select payload->>'order_ref' = upper(left(replace(pg_temp.fxv('pp1')::uuid::text, '-', ''), 8)) and jsonb_array_length(payload->'games') = 3
          and payload->'games'->0 ? 'code' and payload->'games'->0 ? 'name'
   from public.email_outbox where order_id = pg_temp.fxv('pp1')::uuid));
select pg_temp.assert('pós-compra: não enfileira sem opt-in, com queixa, pedido reembolsado, direito revogado, pedido contestado nem pedido não pago',
  (select count(*) = 0 from public.email_outbox where kind = 'post_purchase' and user_id in (pg_temp.uid('pp2'), pg_temp.uid('pp3'), pg_temp.uid('pp4'), pg_temp.uid('pp5'), pg_temp.uid('pp6'), pg_temp.uid('pp7'))));
do $c$ begin
  insert into fz select 'pp_total', count(*)::text from public.email_outbox where dedupe_key like 'post_purchase:%' and to_email like '%@pgtap.test';
  insert into fz select 'q3', private.enqueue_followups(now() + interval '3 days')::text;
  insert into fz select 'q4', private.enqueue_followups(now() + interval '13 days')::text;
end $c$;
select pg_temp.assert('pós-compra: rodar de novo não duplica (D+3 e D+13 devolvem 0)', (select v = '0' from fz where k = 'q3') and (select v = '0' from fz where k = 'q4')
  and (select count(*) from public.email_outbox where dedupe_key like 'post_purchase:%' and to_email like '%@pgtap.test') = pg_temp.fxv('pp_total')::bigint);

-- do enfileirar ao enviar: o claim refaz as checagens
do $c$
begin
  perform pg_temp.mk_opt('ce1'); perform public.cart_add(pg_temp.uid('ce1'), 'FP1');      -- vai descadastrar antes do envio
  perform pg_temp.mk_opt('ce2'); perform public.cart_add(pg_temp.uid('ce2'), 'FP1');      -- vai mudar o carrinho antes do envio
  perform pg_temp.mk_opt('ce3'); perform public.cart_add(pg_temp.uid('ce3'), 'FP1');      -- segue igual
  perform private.enqueue_followups(now() + interval '3 hours');
  perform public.unsubscribe(pg_temp.uid('ce1'));
  perform public.cart_add(pg_temp.uid('ce2'), 'FP3');
  insert into fz select 'claim', to_jsonb(r)::text from public.claim_email_batch(200) r where r.user_id in (pg_temp.uid('ce1'), pg_temp.uid('ce2'), pg_temp.uid('ce3'));
end $c$;
select pg_temp.assert('claim depois do enfileirar: descadastrado antes do envio não sai (canceled no_opt_in)', (select status = 'canceled' and skip_reason = 'no_opt_in' from public.email_outbox where user_id = pg_temp.uid('ce1') and kind = 'cart_reminder'));
select pg_temp.assert('claim depois do enfileirar: carrinho que mudou antes do envio é pulado (cart_changed)', (select status = 'skipped' and skip_reason = 'cart_changed' from public.email_outbox where user_id = pg_temp.uid('ce2') and kind = 'cart_reminder'));
select pg_temp.assert('claim depois do enfileirar: o lembrete válido sai para o despachante com user_id, e-mail e payload',
  (select count(*) = 1 and bool_and((v::jsonb)->>'user_id' = pg_temp.uid('ce3')::text and (v::jsonb)->>'kind' = 'cart_reminder' and (v::jsonb)->>'to_email' = 'ce3@pgtap.test'
                                     and (v::jsonb)->'payload'->>'cart_version' = '1' and (v::jsonb)->'payload'->'items'->0->>'code' = 'FP1') from fz where k = 'claim'));

-- ===== T89 agenda: o job e o dispatch_tick ================================================================
select pg_temp.assert('agenda: o job email-dispatch-tick roda a cada 5 minutos e chama private.dispatch_tick, ativo',
  (select count(*) = 1 and bool_and(schedule = '*/5 * * * *' and command = 'select private.dispatch_tick()' and active) from cron.job where jobname = 'email-dispatch-tick'));
select pg_temp.assert('agenda: nenhum papel de API executa enqueue_followups nem dispatch_tick',
  not has_function_privilege('anon', 'private.dispatch_tick()', 'execute') and not has_function_privilege('authenticated', 'private.dispatch_tick()', 'execute')
  and not has_function_privilege('service_role', 'private.dispatch_tick()', 'execute')
  and not has_function_privilege('anon', 'private.enqueue_followups(timestamptz)', 'execute') and not has_function_privilege('authenticated', 'private.enqueue_followups(timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'private.enqueue_followups(timestamptz)', 'execute'));
select pg_temp.expect_as('agenda: service_role não executa dispatch_tick', 'service_role', $q$select private.dispatch_tick()$q$, '42501');

-- sem os segredos no Vault: só enfileira
delete from vault.secrets where name in ('email_dispatch_url', 'email_dispatch_key');
do $c$
declare o uuid;
begin
  perform pg_temp.mk_opt('tk1');
  o := pg_temp.mk_order(pg_temp.uid('tk1'), 'paid', array[(select id from public.products where code = 'FP1')], 'TK1'); perform pg_temp.mk_ents(o);
  update public.orders set paid_at = now() - interval '4 days' where id = o;       -- pago há 4 dias: elegível ao pós-compra agora
  insert into fz select 'http0', count(*)::text from net.http_request_queue where url like '%exemplo.invalid%';
  perform private.dispatch_tick();
end $c$;
select pg_temp.assert('tick sem segredos no Vault: enfileira (o pós-compra de pedido pago há 4 dias) e NÃO chama o despacho (só avisa no log)',
  pg_temp.outbox('tk1', 'post_purchase') = 1 and (select count(*) from net.http_request_queue where url like '%exemplo.invalid%') = pg_temp.fxv('http0')::bigint);
-- só uma das duas chaves: também não chama
do $c$ begin perform vault.create_secret('http://exemplo.invalid/functions/v1/email-dispatch', 'email_dispatch_url', 'teste'); end $c$;
do $c$ begin perform private.dispatch_tick(); end $c$;
select pg_temp.assert('tick com só a URL no Vault (falta a chave): não chama o despacho', (select count(*) from net.http_request_queue where url like '%exemplo.invalid%') = pg_temp.fxv('http0')::bigint);
-- com os dois: chama
do $c$ begin perform vault.create_secret('chave-de-teste-nao-secreta', 'email_dispatch_key', 'teste'); end $c$;
do $c$ begin perform private.dispatch_tick(); end $c$;
select pg_temp.assert('tick com URL e chave no Vault: chama o despacho por pg_net (POST, Content-Type JSON, apikey e {"limit": 20})',
  (select method = 'POST' and headers->>'Content-Type' = 'application/json' and headers->>'apikey' = 'chave-de-teste-nao-secreta'
          and convert_from(body, 'utf8')::jsonb = '{"limit": 20}'::jsonb and url = 'http://exemplo.invalid/functions/v1/email-dispatch'
   from net.http_request_queue where url like '%exemplo.invalid%' order by id desc limit 1));
select pg_temp.assert('tick com os segredos: uma chamada a mais na fila do pg_net', (select count(*)::int = (select v::int from fz where k = 'http0') + 1 from net.http_request_queue where url like '%exemplo.invalid%'));
-- um erro no enfileiramento não impede a chamada do despacho (retirar a fila nunca pode ficar refém)
create or replace function private.enqueue_followups(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$ begin raise exception 'falha simulada do enfileiramento'; end $$;
do $c$ begin perform private.dispatch_tick(); end $c$;
select pg_temp.assert('tick: erro no enfileiramento vira aviso e o despacho ainda é chamado', (select count(*)::int = (select v::int from fz where k = 'http0') + 2 from net.http_request_queue where url like '%exemplo.invalid%'));

select * from finish();
rollback;
