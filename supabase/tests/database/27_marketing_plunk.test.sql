-- 27_marketing_plunk: a migração 20261031180000 (fase 4 da troca da Brevo pelo Plunk): o 2º toque da sacola e a trava
-- da abertura das vendas nos lembretes; a fila dos contatos de marketing no Plunk (claim_marketing_contacts,
-- mark_marketing_contact e as triggers); o descadastro feito no Plunk (record_plunk_unsubscribe).
-- Roda com `supabase test db` (pgTAP). Dados de teste só existem dentro da transação (rollback no fim). Dentro da
-- transação o now() não anda: as horas entram relativas a ele.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp): supabase/tests/database/helpers ===========
\ir helpers/base.psql
\ir helpers/fixtures.psql

create function pg_temp.mk_opt(p_name text) returns uuid language plpgsql as $$
declare v uuid := pg_temp.mk_user(p_name);
begin
  insert into public.marketing_consents (user_id, email, action, source, text_version) values (v, p_name || '@pgtap.test', 'granted', 'account', 'v1-pgtap');
  return v;
end $$;
-- o 1º lembrete da version atual do carrinho, enviado há p_ago
create function pg_temp.sent_reminder(p_user text, p_ago interval) returns void language sql as $$
  insert into public.email_outbox (user_id, kind, category, to_email, payload, scheduled_at, dedupe_key, status, sent_at, attempts)
  select c.user_id, 'cart_reminder', 'marketing', p_user || '@pgtap.test', jsonb_build_object('cart_version', c.version),
         now() - p_ago, 'cart_reminder:' || c.user_id::text || ':' || c.version::text, 'sent', now() - p_ago, 1
    from public.carts c where c.user_id = pg_temp.uid(p_user)
$$;
-- cortesia (presente dos admins), como admin_gift_products, sem mexer no carrinho
create function pg_temp.mk_courtesy(p_user text, p_code text) returns void language plpgsql as $$
declare v uuid;
begin
  insert into public.orders (user_id, email, kind, cart_version, livemode, amount_subtotal, amount_discount, amount_total, currency)
  values (pg_temp.uid(p_user), p_user || '@pgtap.test', 'courtesy', 0, false, 0, 0, 0, 'brl') returning id into v;
  insert into public.order_items (order_id, product_id, position, stripe_price_id, unit_amount, currency)
  select v, p.id, 1, p.stripe_price_id, 0, 'brl' from public.products p where p.code = p_code;
  update public.orders o set status = 'paid', paid_at = now() where o.id = v;
  perform pg_temp.mk_ents(v);
end $$;
create function pg_temp.second(p_user text) returns bigint language sql as $$
  select count(*) from public.email_outbox where user_id = pg_temp.uid(p_user) and kind = 'cart_reminder_2'
$$;
create function pg_temp.mc(p_user text) returns private.marketing_contacts language sql as $$
  select * from private.marketing_contacts where user_id = pg_temp.uid(p_user)
$$;
create temp table lot as select * from public.claim_marketing_contacts(1) limit 0;
create function pg_temp.claimed(p_user text) returns pg_temp.lot language sql as $$
  select * from pg_temp.lot where user_id = pg_temp.uid(p_user)
$$;

-- Este arquivo é dono da fila, das supressões e da abertura: quem já existia (seed, dados de QA) fica fora de toda
-- elegibilidade, só dentro desta transação.
insert into public.email_suppressions (email, reason, source)
select private.normalize_email(u.email), 'hard_bounce', 'brevo_webhook' from auth.users u on conflict do nothing;
delete from private.sales_opening;
update public.email_outbox set status = 'canceled', skip_reason = 'order_not_paid', locked_at = null where status in ('queued', 'sending');
update private.marketing_contacts set dirty_at = null;

do $fx$
begin
  perform pg_temp.mk_product('MP1', 'single', 1);
  perform pg_temp.mk_product('MP2', 'single', 1);
end $fx$;

-- ===== 1. 2º toque da sacola ==========================================================================================
do $c$
begin
  perform pg_temp.mk_opt('s1'); perform public.cart_add(pg_temp.uid('s1'), 'MP1'); perform pg_temp.sent_reminder('s1', '25 hours');   -- elegível
  perform pg_temp.mk_opt('s2'); perform public.cart_add(pg_temp.uid('s2'), 'MP1'); perform pg_temp.sent_reminder('s2', '23 hours');   -- cedo
  perform pg_temp.mk_opt('s3'); perform public.cart_add(pg_temp.uid('s3'), 'MP1'); perform pg_temp.sent_reminder('s3', '73 hours');   -- velho
  perform pg_temp.mk_opt('s4'); perform public.cart_add(pg_temp.uid('s4'), 'MP1'); perform pg_temp.sent_reminder('s4', '25 hours');   -- já comprou
  perform pg_temp.mk_ents(pg_temp.mk_order(pg_temp.uid('s4'), 'paid', array[(select id from public.products where code = 'MP2')], 'S4'));
  perform pg_temp.mk_opt('s5'); perform public.cart_add(pg_temp.uid('s5'), 'MP1'); perform pg_temp.sent_reminder('s5', '25 hours');   -- mudou depois do 1º
  perform public.cart_add(pg_temp.uid('s5'), 'MP2');
  perform pg_temp.mk_user('s6'); perform public.cart_add(pg_temp.uid('s6'), 'MP1'); perform pg_temp.sent_reminder('s6', '25 hours');  -- sem opt-in
  perform pg_temp.mk_opt('s7'); perform public.cart_add(pg_temp.uid('s7'), 'MP1'); perform pg_temp.sent_reminder('s7', '25 hours');   -- só cortesia
  perform pg_temp.mk_courtesy('s7', 'MP2');
  -- com a compra fechada nada entra
  insert into private.sales_opening (opens_at) values (now() + interval '1 day');
  perform private.enqueue_followups(now());
end $c$;
select pg_temp.assert('vendas fechadas: nenhum lembrete de sacola entra (nem o 1º, nem o 2º)',
  pg_temp.second('s1') = 0
  and (select count(*) = 0 from public.email_outbox where kind = 'cart_reminder' and status = 'queued' and to_email like '%@pgtap.test'));
select pg_temp.assert('vendas fechadas: o 1º lembrete também espera (carrinho parado há 3 h)',
  (select private.enqueue_followups(now() + interval '4 hours') = 0)
  and (select count(*) = 0 from public.email_outbox where kind like 'cart_reminder%' and status = 'queued' and to_email like '%@pgtap.test'));

delete from private.sales_opening;
do $c$ begin perform private.enqueue_followups(now()); end $c$;
select pg_temp.assert('2º toque: entra para quem recebeu o 1º há 24 h, com o carrinho igual e sem compra; payload com os itens',
  pg_temp.second('s1') = 1
  and (select category = 'marketing' and status = 'queued' and scheduled_at = now()
          and dedupe_key = 'cart_reminder_2:' || user_id::text || ':1'
          and payload = '{"cart_version": 1, "items": [{"code": "MP1", "name": "Produto MP1 [TESTE]"}]}'::jsonb
         from public.email_outbox where user_id = pg_temp.uid('s1') and kind = 'cart_reminder_2'));
select pg_temp.assert('2º toque: não entra cedo (23 h), velho (73 h), para quem já comprou, com o carrinho mudado ou sem opt-in',
  pg_temp.second('s2') = 0 and pg_temp.second('s3') = 0 and pg_temp.second('s4') = 0 and pg_temp.second('s5') = 0 and pg_temp.second('s6') = 0);
select pg_temp.assert('2º toque: cortesia não conta como compra', pg_temp.second('s7') = 1);
select pg_temp.assert('2º toque: rodar de novo não duplica', (select private.enqueue_followups(now()) = 0) and pg_temp.second('s1') = 1);

-- o envio: compra entre o enfileiramento e o envio cancela (já comprou); o resto sai
do $c$
begin
  perform pg_temp.mk_order(pg_temp.uid('s7'), 'paid', array[(select id from public.products where code = 'MP2')], 'S7B');
  create temp table claimed_mail as select * from public.claim_email_batch(50, null, now());
end $c$;
select pg_temp.assert('envio do 2º toque: sai para s1; para s7 (comprou entre um e outro) é pulado como already_purchased',
  (select count(*) = 1 from claimed_mail where kind = 'cart_reminder_2' and user_id = pg_temp.uid('s1'))
  and (select status = 'skipped' and skip_reason = 'already_purchased' from public.email_outbox where user_id = pg_temp.uid('s7') and kind = 'cart_reminder_2'));

-- ===== 2. Contatos de marketing no Plunk ==============================================================================
do $c$
begin
  perform pg_temp.mk_opt('c1');                                   -- opt-in agora
  perform pg_temp.mk_user('c2');                                  -- nunca deu opt-in
  perform pg_temp.mk_opt('c3');                                   -- compra e jogos
  perform pg_temp.mk_ents(pg_temp.mk_order(pg_temp.uid('c3'), 'paid', array[(select id from public.products where code = 'MP1')], 'C3'));
end $c$;
select pg_temp.assert('contato: o opt-in marca a pessoa; quem nunca deu opt-in não entra',
  (pg_temp.mc('c1')).dirty_at is not null and (pg_temp.mc('c2')).user_id is null);
select pg_temp.assert('contato: compra (pedido pago) e direito novo marcam de novo; sem opt-in, nada',
  (pg_temp.mc('c3')).dirty_at is not null
  and not exists (select 1 from private.marketing_contacts where user_id = pg_temp.uid('c2')));

update private.marketing_contacts set dirty_at = null where user_id not in (pg_temp.uid('c1'), pg_temp.uid('c3'));
insert into private.sales_opening (opens_at) values (now() + interval '10 days');
insert into pg_temp.lot select * from public.claim_marketing_contacts(10);
select pg_temp.assert('claim: pega só os marcados e trava a linha',
  (select count(*) = 2 from pg_temp.lot)
  and (pg_temp.mc('c1')).locked_at = now() and (pg_temp.mc('c3')).locked_at = now());
select pg_temp.assert('claim: primeira inscrição = inscrito, manda a inscrição e as boas-vindas, sem e-mail antigo',
  (select email = 'c1@pgtap.test' and subscribed and push_subscribed and welcome and previous_email is null from pg_temp.claimed('c1')));
select pg_temp.assert('claim: data com comprou, os códigos dos jogos e a trava do lançamento (inscrição 10 dias antes da abertura)',
  (select data = '{"comprou": false, "jogos": [], "boas_vindas_no_lancamento": true}'::jsonb from pg_temp.claimed('c1'))
  and (select data = '{"comprou": true, "jogos": ["GM-MP1-1"], "boas_vindas_no_lancamento": true}'::jsonb from pg_temp.claimed('c3')));
select pg_temp.assert('claim: linha travada não sai de novo', (select count(*) = 0 from public.claim_marketing_contacts(10)));

-- a chamada e a conferência em comandos separados: o subselect do mesmo comando ainda veria a linha de antes
create temp table marks (k text primary key, v text);
insert into marks values ('c1', public.mark_marketing_contact(pg_temp.uid('c1'), 'C1@pgtap.test', true, true));
insert into marks values ('c3', public.mark_marketing_contact(pg_temp.uid('c3'), null, null, false, 'plunk_http_503'));
select pg_temp.assert('resultado: deu certo guarda o que o Plunk tem e limpa a marca',
  (select v = 'applied' from marks where k = 'c1')
  and (select synced_email = 'c1@pgtap.test' and synced_subscribed and welcomed_at = now() and dirty_at is null
              and locked_at is null and synced_at = now() from private.marketing_contacts where user_id = pg_temp.uid('c1')));
select pg_temp.assert('resultado: erro tenta de novo com espera (2 min na 1ª) e guarda o erro',
  (select v = 'applied' from marks where k = 'c3')
  and (select attempts = 1 and next_try_at = now() + interval '2 minutes' and last_error = 'plunk_http_503' and locked_at is null
              and dirty_at is not null from private.marketing_contacts where user_id = pg_temp.uid('c3')));
select pg_temp.assert('resultado: sem a linha = missing; sem e-mail nem erro = KT001',
  public.mark_marketing_contact(gen_random_uuid(), 'x@pgtap.test') = 'missing');
select pg_temp.expect('resultado: sem e-mail nem erro', $q$select public.mark_marketing_contact(gen_random_uuid())$q$, 'KT001');
select pg_temp.assert('claim: quem errou espera o next_try_at', (select count(*) = 0 from public.claim_marketing_contacts(10)));

-- uma mudança durante o envio fica para o próximo lote
update private.marketing_contacts set dirty_at = now(), locked_at = now() - interval '1 second' where user_id = pg_temp.uid('c1');
select pg_temp.assert('resultado: mudou depois do lote = continua marcado',
  public.mark_marketing_contact(pg_temp.uid('c1'), 'c1@pgtap.test', null, false) = 'applied'
  and (pg_temp.mc('c1')).dirty_at is not null and (pg_temp.mc('c1')).welcomed_at = now());

-- já sincronizado como inscrito: a inscrição não vai de novo (respeita a pausa pedida no Plunk); as boas-vindas não repetem
truncate pg_temp.lot;
insert into pg_temp.lot select * from public.claim_marketing_contacts(10);
select pg_temp.assert('claim: já inscrito no Plunk = não manda a inscrição nem as boas-vindas de novo',
  (select subscribed and not push_subscribed and not welcome from pg_temp.claimed('c1')));
do $c$ begin perform public.mark_marketing_contact(pg_temp.uid('c1'), 'c1@pgtap.test', null, false); end $c$;

-- troca de e-mail: marca, o antigo sai e a inscrição vai para o novo
update auth.users set email = 'c1novo@pgtap.test' where id = pg_temp.uid('c1');
truncate pg_temp.lot;
insert into pg_temp.lot select * from public.claim_marketing_contacts(10);
select pg_temp.assert('troca de e-mail: marca; o lote traz o novo, o antigo e manda a inscrição',
  (select email = 'c1novo@pgtap.test' and previous_email = 'c1@pgtap.test' and push_subscribed and not welcome from pg_temp.claimed('c1')));
do $c$ begin perform public.mark_marketing_contact(pg_temp.uid('c1'), 'c1novo@pgtap.test', true, false); end $c$;

-- descadastro no site: marca e manda "não inscrito"
insert into public.marketing_consents (user_id, email, action, source) values (pg_temp.uid('c1'), 'c1novo@pgtap.test', 'revoked', 'account');
truncate pg_temp.lot;
insert into pg_temp.lot select * from public.claim_marketing_contacts(10);
select pg_temp.assert('revogação: marca; o lote manda não inscrito',
  (select not subscribed and push_subscribed and not welcome from pg_temp.claimed('c1')));
do $c$ begin perform public.mark_marketing_contact(pg_temp.uid('c1'), 'c1novo@pgtap.test', false, false); end $c$;

-- supressão (bounce) marca pelo e-mail
insert into public.email_suppressions (email, reason, source) values ('c3@pgtap.test', 'hard_bounce', 'ses_events');
select pg_temp.assert('supressão: marca a conta do e-mail (e zera a espera)',
  (select dirty_at is not null and attempts = 0 and next_try_at is null from private.marketing_contacts where user_id = pg_temp.uid('c3')));

-- exclusão da conta: a linha sai e nada volta ao Plunk
do $c$ begin perform public.delete_account_data(pg_temp.uid('c3')); end $c$;
truncate pg_temp.lot;
insert into pg_temp.lot select * from public.claim_marketing_contacts(10);
select pg_temp.assert('exclusão da conta: a linha sai (na hora ou no claim) e não vai ao Plunk',
  (pg_temp.mc('c3')).user_id is null and (pg_temp.claimed('c3')).user_id is null);

-- ===== 3. Descadastro feito no Plunk ==================================================================================
do $c$
begin
  perform pg_temp.mk_opt('p1');
  create temp table pu (k text primary key, v jsonb);
  insert into pu select 'eco', to_jsonb(r) from public.record_plunk_unsubscribe('c1novo@pgtap.test') r;   -- o site já tinha tirado
  insert into pu select 'fora', to_jsonb(r) from public.record_plunk_unsubscribe('ninguem@pgtap.test') r;
  insert into pu select 'p1', to_jsonb(r) from public.record_plunk_unsubscribe(' P1@pgtap.test ') r;
  insert into pu select 'p1b', to_jsonb(r) from public.record_plunk_unsubscribe('p1@pgtap.test') r;
end $c$;
select pg_temp.assert('Plunk: eco do descadastro do site e e-mail sem conta = noop, sem supressão nova',
  (select v->>'outcome' = 'noop' from pu where k = 'eco') and (select v->>'outcome' = 'noop' from pu where k = 'fora')
  and not exists (select 1 from public.email_suppressions where email in ('c1novo@pgtap.test', 'ninguem@pgtap.test')));
select pg_temp.assert('Plunk: inscrito no site = applied; revoga com a origem plunk_webhook, suprime e marca o contato',
  (select v->>'outcome' = 'applied' and v->>'user_id' = pg_temp.uid('p1')::text from pu where k = 'p1')
  and (select action = 'revoked' and source = 'plunk_webhook' from public.marketing_consents where user_id = pg_temp.uid('p1') order by id desc limit 1)
  and (select reason = 'unsubscribe_all' and source = 'plunk_webhook' from public.email_suppressions where email = 'p1@pgtap.test')
  and not (select marketing_opt_in from public.profiles where user_id = pg_temp.uid('p1'))
  and (pg_temp.mc('p1')).dirty_at is not null);
select pg_temp.assert('Plunk: o segundo aviso = noop', (select v->>'outcome' = 'noop' from pu where k = 'p1b'));
select pg_temp.expect('record_email_event: origem desconhecida ainda é KT001',
  $q$select * from public.record_email_event('x@pgtap.test', 'unsubscribe', null, now(), 'plunk')$q$, 'KT001');

select * from finish();
rollback;
