-- 21_discounts_partners: cupons, parceiros e indicações (migração 20261024220000): parceiros e cupons do admin, a faixa
-- do topo, o cupom agendado, a visita pelo link, a indicação do pedido, de quem é a venda (o código vence o link), os
-- números e a comissão por mês, o repasse e a origem na ficha do pedido.
-- Roda com `supabase test db` (pgTAP). Dados de teste só existem dentro da transação (rollback no fim). Cada RPC roda
-- numa instrução própria (res): a conferência na mesma instrução não veria o que ela gravou.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp): supabase/tests/database/helpers ===========
\ir helpers/base.psql
\ir helpers/fixtures.psql
\ir helpers/checkout.psql

create temp table res (k text primary key, j jsonb);
create function pg_temp.res(p_k text) returns jsonb language sql as $$ select j from pg_temp.res where k = p_k $$;
create function pg_temp.out(p_k text) returns text language sql as $$
  select case jsonb_typeof(pg_temp.res(p_k)) when 'object' then pg_temp.res(p_k)->>'outcome' else pg_temp.res(p_k) #>> '{}' end
$$;
create function pg_temp.partner(p_slug text) returns uuid language sql as $$ select id from private.partners where slug = p_slug $$;
create function pg_temp.discount(p_code text) returns private.discounts language sql as $$ select * from private.discounts where code = p_code $$;
-- cupom criado como a API faz depois da Stripe. Devolve "cupom <chave>: <resultado>", nunca "ok" sozinho: o pg_prove
-- leria a linha como um teste.
create function pg_temp.new_discount(p_k text, p_body jsonb) returns text language sql as $$
  insert into pg_temp.res select p_k, to_jsonb(r) from public.admin_create_discount(pg_temp.uid('dadm'),
    p_body, 'coupon_' || lower(p_body->>'code'), 'promo_' || (p_body->>'code'), 'Campanha de teste') r returning 'cupom ' || k || ': ' || (j->>'outcome')
$$;

-- ===== fixtures ====================================================================================
do $$
declare o uuid;
begin
  perform pg_temp.mk_user('dadm');
  update auth.users set raw_app_meta_data = jsonb_build_object('provider', 'email', 'admin', true) where id = pg_temp.uid('dadm');
  perform pg_temp.mk_user('dana');
  perform pg_temp.mk_user('dbia');
  perform pg_temp.mk_user('dcris');
  perform pg_temp.mk_product('DSOLO', 'single', 1);
  perform pg_temp.mk_product('DSOLO2', 'single', 1);
  perform pg_temp.mk_product('DSOLO3', 'single', 1);
end $$;

-- ===== parceiros ==================================================================================
insert into pg_temp.res select 'ana', to_jsonb(r) from public.admin_save_partner(pg_temp.uid('dadm'), null,
  '{"slug": "ana-souza", "name": "Ana Souza", "handle": "@anasouza", "commission_percent": 10}', 'Parceria do lançamento') r;
insert into pg_temp.res select 'amigo', to_jsonb(r) from public.admin_save_partner(pg_temp.uid('dadm'), null,
  '{"slug": "amigo", "name": "Amigo", "commission_percent": 0}', 'Amigo da casa') r;
insert into pg_temp.res select 'apelido repetido', to_jsonb(r) from public.admin_save_partner(pg_temp.uid('dadm'), null,
  '{"slug": "ana-souza", "name": "Outra"}', 'Parceria do lançamento') r;
insert into pg_temp.res select 'não admin', to_jsonb(r) from public.admin_save_partner(pg_temp.uid('dana'), null,
  '{"slug": "dana", "name": "Dana"}', 'Parceria do lançamento') r;
select pg_temp.assert('parceiros: cria, o apelido é único, só admin; o histórico guarda',
  pg_temp.out('ana') = 'ok' and pg_temp.out('amigo') = 'ok' and pg_temp.out('apelido repetido') = 'slug_taken' and pg_temp.out('não admin') = 'forbidden'
  and (select commission_percent = 10 and status = 'active' and handle = '@anasouza' from private.partners where slug = 'ana-souza')
  and exists (select 1 from private.admin_events where action = 'partner_save' and details->>'partner' = 'ana-souza' and (details->>'created')::boolean));
insert into pg_temp.res select 'editar', to_jsonb(r) from public.admin_save_partner(pg_temp.uid('dadm'), pg_temp.partner('ana-souza'),
  '{"slug": "outro-apelido", "name": "Ana Souza", "handle": "@ana", "commission_percent": 12.5, "status": "active"}', 'Ajuste da comissão') r;
select pg_temp.assert('editar: muda os dados, mas não o apelido do link (links já divulgados)',
  pg_temp.out('editar') = 'ok'
  and (select slug = 'ana-souza' and handle = '@ana' and commission_percent = 12.5 from private.partners where id = pg_temp.partner('ana-souza')));

-- ===== cupons =====================================================================================
select pg_temp.new_discount('ana10', '{"code": "ana10", "percent_off": 10, "partner": "ana-souza"}');
select pg_temp.new_discount('black', '{"code": "BLACK26", "percent_off": 30, "banner": "Black Friday: 30% em tudo com {cupom}", "campaign": "Black Friday 2026"}');
-- a Black Friday foi criada antes (dentro da transação o now() não anda)
update private.discounts set created_at = now() - interval '1 day' where code = 'BLACK26';
select pg_temp.new_discount('natal', '{"code": "NATAL26", "percent_off": 20, "banner": "Natal: 20% com {cupom}", "starts_at": "2099-12-01T03:00:00Z", "ends_at": "2099-12-26T03:00:00Z"}');
select pg_temp.new_discount('código repetido', '{"code": "BLACK26", "percent_off": 10}');
select pg_temp.new_discount('sem parceiro', '{"code": "XPTO10", "percent_off": 10, "partner": "nao-existe"}');
select pg_temp.assert('cupons: o código em maiúsculas, único para sempre; parceiro precisa existir; início no futuro fica agendado',
  pg_temp.out('ana10') = 'ok' and pg_temp.out('black') = 'ok' and pg_temp.out('código repetido') = 'code_taken' and pg_temp.out('sem parceiro') = 'partner_not_found'
  and (pg_temp.discount('ANA10')).partner_id = pg_temp.partner('ana-souza') and (pg_temp.discount('ANA10')).state = 'active'
  and (pg_temp.discount('NATAL26')).state = 'scheduled');
select pg_temp.assert('faixa do topo: o cupom ativo com faixa, sem parceiro e no prazo; a versão do catálogo cobre a faixa',
  public.get_promo_banner() = '{"code": "BLACK26", "text": "Black Friday: 30% em tudo com {cupom}"}'::jsonb
  and public.get_catalog_version() = md5(public.get_catalog()::text || public.get_promo_banner()::text));

insert into pg_temp.res select 'pausar', to_jsonb(r) from public.admin_set_discount_state(pg_temp.uid('dadm'), (pg_temp.discount('BLACK26')).id, 'paused', 'Fim de semana') r;
select pg_temp.assert('pausado: sai da faixa',
  pg_temp.out('pausar') = 'ok' and public.get_promo_banner() is null);
insert into pg_temp.res select 'voltar', to_jsonb(r) from public.admin_set_discount_state(pg_temp.uid('dadm'), (pg_temp.discount('BLACK26')).id, 'active', 'Voltou') r;
insert into pg_temp.res select 'voltar natal', to_jsonb(r) from public.admin_set_discount_state(pg_temp.uid('dadm'), (pg_temp.discount('NATAL26')).id, 'active', 'Ainda não') r;
insert into pg_temp.res select 'pausar natal', to_jsonb(r) from public.admin_set_discount_state(pg_temp.uid('dadm'), (pg_temp.discount('NATAL26')).id, 'paused', 'Revisar') r;
insert into pg_temp.res select 'voltar natal 2', to_jsonb(r) from public.admin_set_discount_state(pg_temp.uid('dadm'), (pg_temp.discount('NATAL26')).id, 'active', 'Revisado') r;
select pg_temp.assert('voltar a valer: o ativo volta; antes do início volta a agendado; o agendado não vira ativo à mão',
  pg_temp.out('voltar') = 'ok' and (pg_temp.discount('BLACK26')).state = 'active'
  and pg_temp.out('voltar natal') = 'unchanged' and pg_temp.out('pausar natal') = 'ok'
  and pg_temp.out('voltar natal 2') = 'ok' and pg_temp.res('voltar natal 2')->>'state' = 'scheduled');

-- o início chegou: a agenda vê e a API marca como ativo
update private.discounts set starts_at = now() - interval '1 minute' where code = 'NATAL26';
select pg_temp.assert('agendado no início: aparece para ligar',
  exists (select 1 from public.due_discounts() where code = 'NATAL26'));
insert into pg_temp.res select 'ligou', to_jsonb(r) from public.mark_discount_started((pg_temp.discount('NATAL26')).id) r;
insert into pg_temp.res select 'ligou de novo', to_jsonb(r) from public.mark_discount_started((pg_temp.discount('NATAL26')).id) r;
select pg_temp.assert('a API liga o agendado uma vez; ele entra na faixa (o mais novo)',
  pg_temp.out('ligou') = 'ok' and pg_temp.out('ligou de novo') = 'unchanged' and (pg_temp.discount('NATAL26')).state = 'active'
  and public.get_promo_banner()->>'code' = 'NATAL26'
  and not exists (select 1 from public.due_discounts() where code = 'NATAL26'));
insert into pg_temp.res select 'encerrar', to_jsonb(r) from public.admin_set_discount_state(pg_temp.uid('dadm'), (pg_temp.discount('NATAL26')).id, 'ended', 'Acabou o Natal') r;
insert into pg_temp.res select 'reabrir', to_jsonb(r) from public.admin_set_discount_state(pg_temp.uid('dadm'), (pg_temp.discount('NATAL26')).id, 'active', 'Reabrir') r;
select pg_temp.assert('encerrado é para sempre; a faixa volta para o da Black Friday',
  pg_temp.out('encerrar') = 'ok' and pg_temp.out('reabrir') = 'unchanged' and (pg_temp.discount('NATAL26')).ended_at is not null
  and public.get_promo_banner()->>'code' = 'BLACK26');

-- a agenda chama a API só com um agendado que começou, e no endereço da função api
select pg_temp.new_discount('ano novo', '{"code": "ANONOVO", "percent_off": 15, "starts_at": "2099-01-01T03:00:00Z"}');
update private.discounts set starts_at = now() - interval '1 minute' where code = 'ANONOVO';
delete from vault.secrets where name in ('email_dispatch_url', 'email_dispatch_key');
do $c$ begin perform vault.create_secret('http://exemplo.invalid/functions/v1/email-dispatch', 'email_dispatch_url', 'teste'); end $c$;
do $c$ begin perform vault.create_secret('chave-de-teste-nao-secreta', 'email_dispatch_key', 'teste'); end $c$;
select private.discounts_tick();
select pg_temp.assert('a agenda chama /api/internal/discounts/tick quando um agendado começou',
  exists (select 1 from net.http_request_queue where url = 'http://exemplo.invalid/functions/v1/api/internal/discounts/tick'));

-- ===== visita e indicação =========================================================================
insert into pg_temp.res select 'visita', to_jsonb(r) from public.record_partner_visit('ana-souza') r;
insert into pg_temp.res select 'visita 2', to_jsonb(r) from public.record_partner_visit('ana-souza') r;
insert into pg_temp.res select 'visita errada', to_jsonb(r) from public.record_partner_visit('Ana Souza') r;
select pg_temp.assert('visita pelo link: conta o dia e devolve o nome e o código ativo do parceiro',
  pg_temp.res('visita') @> '{"outcome": "ok", "slug": "ana-souza", "name": "Ana Souza", "code": "ANA10", "percent_off": 10.00}'::jsonb
  and pg_temp.out('visita errada') = 'not_found'
  and (select visits = 2 from private.partner_visits where partner_id = pg_temp.partner('ana-souza')));
update private.partners set status = 'paused' where slug = 'amigo';
insert into pg_temp.res select 'pausado', to_jsonb(r) from public.record_partner_visit('amigo') r;
update private.partners set status = 'active' where slug = 'amigo';
select pg_temp.assert('parceiro pausado: o link não vale', pg_temp.out('pausado') = 'not_found');

do $$
declare o uuid;
begin
  -- Ana chegou pelo link da Ana e comprou sem cupom; Bia chegou pelo link do amigo, mas usou o cupom da Ana; Cris
  -- chegou por um link de campanha velho (um pedido aberto por pessoa: a sacola entra inteira no pedido)
  o := pg_temp.open_order(pg_temp.uid('dana'), array['DSOLO']); insert into pg_temp.oids values ('link', o);
  o := pg_temp.open_order(pg_temp.uid('dbia'), array['DSOLO']); insert into pg_temp.oids values ('codigo', o);
  o := pg_temp.open_order(pg_temp.uid('dcris'), array['DSOLO2']); insert into pg_temp.oids values ('velho', o);
end $$;
insert into pg_temp.res select 'indicação', to_jsonb(r) from public.set_order_referral(pg_temp.uid('dana'), pg_temp.oid('link'),
  jsonb_build_object('partner', 'ana-souza', 'landed_at', now() - interval '2 days', 'path', '/loja', 'utm_source', 'instagram', 'utm_campaign', 'lancamento', 'email', 'x@y.z')) r;
insert into pg_temp.res select 'indicação de novo', to_jsonb(r) from public.set_order_referral(pg_temp.uid('dana'), pg_temp.oid('link'),
  jsonb_build_object('partner', 'amigo', 'landed_at', now())) r;
insert into pg_temp.res select 'de outra pessoa', to_jsonb(r) from public.set_order_referral(pg_temp.uid('dana'), pg_temp.oid('codigo'),
  jsonb_build_object('partner', 'amigo', 'landed_at', now())) r;
insert into pg_temp.res select 'bia', to_jsonb(r) from public.set_order_referral(pg_temp.uid('dbia'), pg_temp.oid('codigo'),
  jsonb_build_object('partner', 'amigo', 'landed_at', now() - interval '1 hour')) r;
insert into pg_temp.res select 'velho', to_jsonb(r) from public.set_order_referral(pg_temp.uid('dcris'), pg_temp.oid('velho'),
  jsonb_build_object('partner', 'amigo', 'landed_at', now() - interval '40 days', 'utm_source', 'newsletter')) r;
select pg_temp.assert('indicação: grava o parceiro e as campanhas, sem campo estranho; uma vez, só no pedido da pessoa; link velho vale só a campanha',
  pg_temp.out('indicação') = 'ok' and pg_temp.out('indicação de novo') = 'not_found' and pg_temp.out('de outra pessoa') = 'not_found'
  and pg_temp.out('bia') = 'ok' and pg_temp.out('velho') = 'ok'
  and (select referral->>'partner_id' = pg_temp.partner('ana-souza')::text and referral->>'utm_source' = 'instagram'
              and referral->>'path' = '/loja' and not referral ? 'email' from public.orders where id = pg_temp.oid('link'))
  and (select referral = '{"utm_source": "newsletter"}'::jsonb from public.orders where id = pg_temp.oid('velho')));

-- pagamentos: a da Ana sem cupom; a da Bia com o cupom da Ana (vence o link do amigo); a velha do amigo... sem parceiro
select 'pagamento: ' || f.outcome from pg_temp.fulfill(pg_temp.oid('link'), array[990]) f;
select 'pagamento: ' || f.outcome from pg_temp.fulfill(pg_temp.oid('codigo'), array[990], '{"code": "ana10", "discount": 99}') f;
select 'pagamento: ' || f.outcome from pg_temp.fulfill(pg_temp.oid('velho'), array[990], '{"code": "BLACK26", "discount": 297}') f;
select pg_temp.assert('de quem é a venda: o código do parceiro vence o link; sem parceiro, ninguém',
  private.order_partner((select promotion_code from public.orders where id = pg_temp.oid('codigo')), (select referral from public.orders where id = pg_temp.oid('codigo'))) = pg_temp.partner('ana-souza')
  and private.order_partner(null, (select referral from public.orders where id = pg_temp.oid('link'))) = pg_temp.partner('ana-souza')
  and private.order_partner('BLACK26', '{"utm_source": "newsletter"}') is null);

-- ===== listas e números ===========================================================================
select pg_temp.assert('lista de cupons: uso, receita e desconto dos pedidos pagos; o estado do momento',
  (select bool_or(d->>'code' = 'ANA10' and d->'stats' = '{"orders": 1, "revenue": 891, "discount": 99}'::jsonb and d->'partner'->>'slug' = 'ana-souza')
          and bool_or(d->>'code' = 'BLACK26' and (d->'stats'->>'orders')::int = 1 and d->>'effective_state' = 'active')
          and bool_or(d->>'code' = 'NATAL26' and d->>'effective_state' = 'ended')
     from public.admin_list_discounts(pg_temp.uid('dadm'), false) l, jsonb_array_elements(l.result->'discounts') d)
  and (select outcome = 'forbidden' from public.admin_list_discounts(pg_temp.uid('dana'), false)));
select pg_temp.assert('lista de parceiros: visitas, vendas e receita de cada um, com os códigos',
  (select bool_or(p->>'slug' = 'ana-souza' and (p->>'orders')::int = 2 and (p->>'revenue')::int = 1881 and (p->>'visits_30d')::int = 2 and p->'codes' = '["ANA10"]'::jsonb)
          and bool_or(p->>'slug' = 'amigo' and (p->>'orders')::int = 0)
     from public.admin_list_partners(pg_temp.uid('dadm'), false) l, jsonb_array_elements(l.result) p));
select pg_temp.assert('ficha do parceiro: o mês corrente aberto, com a comissão (12,5% de R$ 18,81), as vendas e por onde vieram',
  (select r.result->'months'->0 @> '{"orders": 2, "revenue": 1881, "commission": 235, "closed": false}'::jsonb
          and jsonb_array_length(r.result->'orders') = 2
          and r.result->'orders' @> '[{"source": "code", "promotion_code": "ANA10"}, {"source": "link"}]'::jsonb
     from public.admin_get_partner(pg_temp.uid('dadm'), pg_temp.partner('ana-souza'), false) r));

-- repasse: o mês corrente não fecha; o mês passado sim, uma vez; comissão 0% não tem o que pagar
update public.orders set paid_at = date_trunc('month', now()) - interval '10 days' where id = pg_temp.oid('link');
insert into pg_temp.res select 'mês aberto', to_jsonb(r) from public.admin_mark_partner_paid(pg_temp.uid('dadm'), pg_temp.partner('ana-souza'),
  date_trunc('month', now() at time zone 'America/Sao_Paulo')::date, null, 'Pix de outubro', false) r;
insert into pg_temp.res select 'pagar', to_jsonb(r) from public.admin_mark_partner_paid(pg_temp.uid('dadm'), pg_temp.partner('ana-souza'),
  (date_trunc('month', (date_trunc('month', now()) - interval '10 days') at time zone 'America/Sao_Paulo'))::date, 'Pix 12345', 'Pix do mês', false) r;
insert into pg_temp.res select 'pagar de novo', to_jsonb(r) from public.admin_mark_partner_paid(pg_temp.uid('dadm'), pg_temp.partner('ana-souza'),
  (date_trunc('month', (date_trunc('month', now()) - interval '10 days') at time zone 'America/Sao_Paulo'))::date, null, 'Pix do mês', false) r;
insert into pg_temp.res select 'repasse amigo', to_jsonb(r) from public.admin_mark_partner_paid(pg_temp.uid('dadm'), pg_temp.partner('amigo'),
  (date_trunc('month', (date_trunc('month', now()) - interval '10 days') at time zone 'America/Sao_Paulo'))::date, null, 'Pix do mês', false) r;
select pg_temp.assert('repasse: o valor do mês fechado fica guardado; mês aberto, repetido e 0% não pagam',
  pg_temp.out('mês aberto') = 'not_closed' and pg_temp.out('pagar') = 'ok' and (pg_temp.res('pagar')->>'amount')::int = 124
  and pg_temp.out('pagar de novo') = 'already_paid' and pg_temp.out('repasse amigo') = 'nothing_due'
  and exists (select 1 from private.partner_payouts where partner_id = pg_temp.partner('ana-souza') and amount = 124 and orders = 1 and note = 'Pix 12345'));
select pg_temp.assert('planilha do mês: as vendas, sem e-mail de ninguém',
  (select jsonb_array_length(r.result->'orders') = 1 and r.result::text not like '%@pgtap.test%'
     from public.admin_partner_orders(pg_temp.uid('dadm'), pg_temp.partner('ana-souza'),
            (date_trunc('month', (date_trunc('month', now()) - interval '10 days') at time zone 'America/Sao_Paulo'))::date, false) r));
select pg_temp.assert('métricas: cupons, parceiros e campanhas no período',
  (select r.result->'codes' @> '[{"code": "ANA10", "orders": 1}, {"code": "BLACK26", "orders": 1}]'::jsonb
          and r.result->'partners' @> '[{"slug": "ana-souza", "orders": 1}]'::jsonb
          and r.result->'campaigns' @> '[{"source": "newsletter", "orders": 1}]'::jsonb
     from public.admin_marketing_metrics(pg_temp.uid('dadm'), 7, false) r));
select pg_temp.assert('ficha do pedido: a origem com o parceiro, por onde e a campanha',
  (select r.result->'origin' @> '{"partner": {"slug": "ana-souza"}, "source": "code"}'::jsonb from public.admin_get_order(pg_temp.uid('dadm'), pg_temp.oid('codigo')) r)
  and (select r.result->'origin' @> '{"partner": {"slug": "ana-souza"}, "source": "link", "utm_campaign": "lancamento"}'::jsonb from public.admin_get_order(pg_temp.uid('dadm'), pg_temp.oid('link')) r));

select * from finish();
rollback;
