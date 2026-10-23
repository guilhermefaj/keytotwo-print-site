-- 17_admin_users: gestão de usuários no admin (migrações 20261023200000 e 20261023220000): lista, ficha, presente
-- (pedido de cortesia, de um ou vários jogos), retirar jogo, reenviar acesso, tirar das novidades, bloqueio, equipe
-- (promover e tirar admin), acompanhamento, exportar e excluir; o presente fica fora das métricas de vendas.
-- Roda com `supabase test db` (pgTAP). Dados de teste só existem dentro da transação (rollback no fim).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp) ============================================
create function pg_temp.expect(p_label text, p_sql text, p_state text) returns text language plpgsql as $$
declare st text := 'OK';
begin
  begin execute p_sql; exception when others then get stacked diagnostics st = returned_sqlstate; end;
  return extensions.is(st, p_state, p_label);
end $$;

create function pg_temp.assert(p_label text, p_cond boolean) returns text language sql as $$
  select extensions.ok(coalesce(p_cond, false), p_label)
$$;

create temp table ids (name text primary key, id uuid);
create function pg_temp.uid(p_name text) returns uuid language sql as $$ select id from pg_temp.ids where name = p_name $$;

create function pg_temp.mk_user(p_name text, p_admin boolean, p_confirmed boolean default true) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_name || '@pgtap.test', null,
          case when p_confirmed then now() end, '', '', '', '', now(), now(),
          jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'admin', p_admin), '{}');
  insert into pg_temp.ids values (p_name, v_id);
  return v_id;
end $$;

-- produto ativo com N jogos (os arquivos não importam aqui)
create function pg_temp.mk_product(p_code text, p_kind text, p_games int) returns bigint
language plpgsql as $$
declare v_pid bigint; v_gid bigint; i int;
begin
  insert into public.products (code, slug, kind, name, status, stripe_price_id, games_expected)
  values (p_code, lower(p_code), p_kind, 'Produto ' || p_code, 'active', 'price_PGTAP_' || p_code, p_games)
  returning id into v_pid;
  for i in 1..p_games loop
    insert into public.games (code, slug, name, status) values ('GU-' || p_code || '-' || i, lower('gu-' || p_code || '-' || i), 'Jogo ' || p_code || ' ' || i, 'published')
    returning id into v_gid;
    insert into public.product_games (product_id, game_id, position) values (v_pid, v_gid, i);
  end loop;
  return v_pid;
end $$;

do $$ begin
  perform pg_temp.mk_user('adm', true);
  perform pg_temp.mk_user('adm2', true);
  perform pg_temp.mk_user('ana', false);
  perform pg_temp.mk_user('bia', false, false);
  perform pg_temp.mk_user('comum', false);
  perform pg_temp.mk_user('admnc', true, false);
  perform pg_temp.mk_user('cris', false);
  perform pg_temp.mk_user('dani', false);
  perform pg_temp.mk_user('eva', false);
  perform pg_temp.mk_product('USOLO', 'single', 1);
  perform pg_temp.mk_product('UPACK', 'bundle', 2);
  perform pg_temp.mk_product('UOUTRO', 'single', 1);
  -- pacote com os jogos de USOLO e UOUTRO: dar junto com um deles repete jogo
  insert into public.products (code, slug, kind, name, status, stripe_price_id, games_expected)
  values ('UCOMBO', 'ucombo', 'bundle', 'Produto UCOMBO', 'active', 'price_PGTAP_UCOMBO', 2);
  insert into public.product_games (product_id, game_id, position)
  select (select id from public.products where code = 'UCOMBO'), pg.game_id, row_number() over (order by p.code)
    from public.product_games pg join public.products p on p.id = pg.product_id where p.code in ('USOLO', 'UOUTRO');
  insert into public.products (code, slug, kind, status) values ('URASC', 'urasc', 'single', 'draft');
end $$;

-- ===== lista e ficha ==============================================================================
select pg_temp.assert('lista: admin vê as contas, a mais nova primeiro, com o e-mail procurado',
  (select outcome = 'ok' and (result->>'total')::int = 1 and result->'users'->0->>'email' = 'ana@pgtap.test'
          and result->'users'->0->'providers' = '["email"]'::jsonb and (result->'users'->0->>'purchases')::int = 0
   from public.admin_list_users(pg_temp.uid('adm'), ' ANA@pgtap ', 'all', 0)));
select pg_temp.assert('lista: filtro de bloqueados começa vazio',
  (select (result->>'total')::int = 0 from public.admin_list_users(pg_temp.uid('adm'), '@pgtap.test', 'blocked', 0)));
select pg_temp.assert('lista: quem não é admin recebe forbidden',
  (select outcome = 'forbidden' and result is null from public.admin_list_users(pg_temp.uid('comum'), null, 'all', 0)));
select pg_temp.expect('lista: filtro desconhecido é KT001',
  format($q$select * from public.admin_list_users(%L, null, 'todos', 0)$q$, pg_temp.uid('adm')), 'KT001');
select pg_temp.expect('lista: admin sem e-mail confirmado é KT009',
  format($q$select * from public.admin_list_users(%L, null, 'all', 0)$q$, pg_temp.uid('admnc')), 'KT009');

select pg_temp.assert('ficha: conta, nada ainda e o que dá para dar de presente (sem o rascunho)',
  (select outcome = 'ok' and result->'account'->>'email' = 'ana@pgtap.test' and (result->'account'->>'self')::boolean = false
          and result->'library' = '[]'::jsonb and result->'orders' = '[]'::jsonb
          and (select array_agg(g->>'code' order by g->>'code') from jsonb_array_elements(result->'giftable') g
                where g->>'code' like 'U%') = array['UCOMBO', 'UOUTRO', 'UPACK', 'USOLO']
   from public.admin_get_user(pg_temp.uid('adm'), pg_temp.uid('ana'))));
select pg_temp.assert('ficha: conta inexistente é not_found; quem não é admin, forbidden',
  (select outcome = 'not_found' from public.admin_get_user(pg_temp.uid('adm'), gen_random_uuid()))
  and (select outcome = 'forbidden' from public.admin_get_user(pg_temp.uid('comum'), pg_temp.uid('ana'))));

-- ===== presente (pedido de cortesia) ==============================================================
-- as métricas antes do presente: o seed do CI pode ter pedidos pagos de teste
create temp table m0 as select metrics from public.get_admin_metrics(pg_temp.uid('adm'), 7, false);
create temp table gift (name text primary key, outcome text, order_id uuid, outbox_id uuid, products text[]);
insert into pg_temp.gift select 'ana', g.* from public.admin_gift_products(pg_temp.uid('adm'), pg_temp.uid('ana'), array['USOLO'], '  Compensação pelo atraso  ', true, false) g;
create function pg_temp.gift_order(p_name text) returns uuid language sql as $$ select order_id from pg_temp.gift where name = p_name $$;

select pg_temp.assert('presente: ok, com pedido e e-mail', (select outcome = 'ok' and order_id is not null and outbox_id is not null from pg_temp.gift where name = 'ana'));
select pg_temp.assert('presente: pedido de cortesia pago, de R$ 0, sem Stripe nem termos',
  exists (select 1 from public.orders o
           where o.id = pg_temp.gift_order('ana') and o.kind = 'courtesy' and o.status = 'paid' and o.paid_at is not null
             and o.user_id = pg_temp.uid('ana') and o.email = 'ana@pgtap.test' and not o.livemode
             and o.amount_total = 0 and o.amount_subtotal = 0 and o.amount_discount = 0 and o.currency = 'brl'
             and o.terms_version is null and o.terms_accepted_at is null and o.stripe_checkout_session_id is null));
select pg_temp.assert('presente: um item a R$ 0 com o Price do produto e o direito ativo com o jogo',
  exists (select 1 from public.order_items i where i.order_id = pg_temp.gift_order('ana') and i.unit_amount = 0 and i.stripe_price_id = 'price_PGTAP_USOLO')
  and exists (select 1 from public.entitlements e join public.entitlement_games eg on eg.entitlement_id = e.id
               where e.order_id = pg_temp.gift_order('ana') and e.user_id = pg_temp.uid('ana') and e.status = 'active'));
select pg_temp.assert('presente: transições open e paid com origem admin',
  (select array_agg(e.to_status order by e.id) from public.order_events e where e.order_id = pg_temp.gift_order('ana')) = array['open', 'paid']
  and not exists (select 1 from public.order_events e where e.order_id = pg_temp.gift_order('ana') and e.source <> 'admin'));
select pg_temp.assert('presente: e-mail do presente transacional, com os jogos para os links',
  exists (select 1 from public.email_outbox x
           where x.id = (select outbox_id from pg_temp.gift where name = 'ana') and x.kind = 'gift' and x.category = 'transactional'
             and x.to_email = 'ana@pgtap.test' and x.dedupe_key = 'gift:' || pg_temp.gift_order('ana')::text
             and jsonb_array_length(x.payload->'games') = 1 and x.payload->'games'->0 ? 'entitlement_id'));
select pg_temp.assert('presente: histórico com o produto, o motivo aparado e o aviso',
  exists (select 1 from private.admin_events a
           where a.action = 'user_gift' and a.user_id = pg_temp.uid('adm') and a.target_id = pg_temp.uid('ana')
             and a.details->'products' = '["USOLO"]'::jsonb and a.details->>'reason' = 'Compensação pelo atraso' and (a.details->>'notify')::boolean));
select pg_temp.expect('presente: pedido e direito coerentes (I-5)', 'set constraints all immediate', 'OK');
set constraints all deferred;

select pg_temp.assert('presente de novo do mesmo jogo: already_owned',
  (select outcome = 'already_owned' from public.admin_gift_products(pg_temp.uid('adm'), pg_temp.uid('ana'), array['USOLO'], 'De novo', false, false)));
select pg_temp.assert('presente de produto fora da venda ou desconhecido: product_unavailable',
  (select outcome = 'product_unavailable' from public.admin_gift_products(pg_temp.uid('adm'), pg_temp.uid('ana'), array['URASC'], 'Teste', false, false))
  and (select outcome = 'product_unavailable' from public.admin_gift_products(pg_temp.uid('adm'), pg_temp.uid('ana'), array['NAOEXISTE'], 'Teste', false, false)));
select pg_temp.assert('presente para conta inexistente: not_found; quem não é admin: forbidden',
  (select outcome = 'not_found' from public.admin_gift_products(pg_temp.uid('adm'), gen_random_uuid(), array['UPACK'], 'Teste', false, false))
  and (select outcome = 'forbidden' from public.admin_gift_products(pg_temp.uid('comum'), pg_temp.uid('ana'), array['UPACK'], 'Teste', false, false)));
select pg_temp.expect('presente sem motivo: KT001',
  format($q$select * from public.admin_gift_products(%L, %L, array['UPACK'], '  ', false, false)$q$, pg_temp.uid('adm'), pg_temp.uid('ana')), 'KT001');
insert into pg_temp.gift select 'adm2', g.* from public.admin_gift_products(pg_temp.uid('adm'), pg_temp.uid('adm2'), array['UPACK'], 'Teste do admin', false, false) g;
select pg_temp.assert('presente sem aviso: sem e-mail na fila',
  (select outcome = 'ok' and outbox_id is null from pg_temp.gift where name = 'adm2')
  and not exists (select 1 from public.email_outbox x where x.order_id = pg_temp.gift_order('adm2')));

select pg_temp.expect('o tipo do pedido não muda', format($q$update public.orders set kind = 'purchase' where id = %L$q$, pg_temp.gift_order('ana')), 'KT010');
select pg_temp.expect('cortesia só de R$ 0',
  format($q$insert into public.orders (user_id, email, kind, cart_version, livemode, amount_subtotal, amount_discount, amount_total, currency)
            values (%L, 'ana@pgtap.test', 'courtesy', 0, false, 500, 0, 500, 'brl')$q$, pg_temp.uid('ana')), '23514');
select pg_temp.expect('compra sem aceite dos termos não entra',
  format($q$insert into public.orders (user_id, email, cart_version, livemode) values (%L, 'ana@pgtap.test', 0, false)$q$, pg_temp.uid('ana')), '23514');

select pg_temp.assert('presente fora das vendas, da receita e do funil pago nas métricas',
  (select m.metrics->'sales' = (select metrics->'sales' from pg_temp.m0) and m.metrics->'funnel'->'paid' = (select metrics->'funnel'->'paid' from pg_temp.m0)
   from public.get_admin_metrics(pg_temp.uid('adm'), 7, false) m));
select pg_temp.assert('Minha conta mostra o pedido como cortesia',
  (select public.get_account(pg_temp.uid('ana'))->'orders'->0->>'kind') = 'courtesy');
select pg_temp.assert('lista: presente não conta como compra, mas o jogo conta',
  (select (result->'users'->0->>'purchases')::int = 0 and (result->'users'->0->>'games')::int = 1
   from public.admin_list_users(pg_temp.uid('adm'), 'ana@', 'all', 0))
  and (select (result->>'total')::int = 0 from public.admin_list_users(pg_temp.uid('adm'), 'ana@', 'buyers', 0)));
select pg_temp.assert('ficha: o jogo veio do presente, o pedido pode ser reenviado e o produto já é dela',
  (select result->'library'->0->'order'->>'kind' = 'courtesy' and (result->'orders'->0->>'deliverable')::boolean
          and (select (g->>'owned')::boolean from jsonb_array_elements(result->'giftable') g where g->>'code' = 'USOLO')
          and result->'history'->0->>'action' = 'user_gift' and result->'history'->0->>'by' = 'adm@pgtap.test'
   from public.admin_get_user(pg_temp.uid('adm'), pg_temp.uid('ana'))));

-- ===== reenviar o e-mail de acesso ===============================================================
select pg_temp.assert('reenviar com o e-mail ainda na fila: already_queued',
  (select outcome = 'already_queued' from public.admin_resend_delivery(pg_temp.uid('adm'), pg_temp.uid('ana'), pg_temp.gift_order('ana'))));
update public.email_outbox set status = 'sent', sent_at = now() where order_id = pg_temp.gift_order('ana');
create temp table resend as select * from public.admin_resend_delivery(pg_temp.uid('adm'), pg_temp.uid('ana'), pg_temp.gift_order('ana'));
select pg_temp.assert('reenviar: ok, outro e-mail do presente na fila e no histórico',
  (select outcome = 'ok' from pg_temp.resend)
  and exists (select 1 from public.email_outbox x
               where x.id = (select outbox_id from pg_temp.resend) and x.kind = 'gift' and x.status = 'queued' and x.dedupe_key like 'resend:%')
  and exists (select 1 from private.admin_events a where a.action = 'user_resend' and a.target_id = pg_temp.uid('ana')));
select pg_temp.assert('reenviar pedido de outra pessoa: not_found',
  (select outcome = 'not_found' from public.admin_resend_delivery(pg_temp.uid('adm'), pg_temp.uid('bia'), pg_temp.gift_order('ana'))));

-- ===== retirar um jogo ===========================================================================
create temp table ents as select e.id, e.user_id from public.entitlements e where e.order_id in (pg_temp.gift_order('ana'), pg_temp.gift_order('adm2'));
create function pg_temp.ent(p_name text) returns uuid language sql as $$ select id from pg_temp.ents where user_id = pg_temp.uid(p_name) $$;
select pg_temp.assert('retirar jogo de admin ou da própria conta: protected',
  (select outcome = 'protected' from public.admin_revoke_entitlement(pg_temp.uid('adm'), pg_temp.uid('adm2'), pg_temp.ent('adm2'), 'Teste'))
  and (select outcome = 'protected' from public.admin_revoke_entitlement(pg_temp.uid('adm'), pg_temp.uid('adm'), pg_temp.ent('adm2'), 'Teste')));
select pg_temp.assert('retirar jogo: ok',
  (select outcome = 'ok' from public.admin_revoke_entitlement(pg_temp.uid('adm'), pg_temp.uid('ana'), pg_temp.ent('ana'), 'Pedido por engano')));
select pg_temp.assert('jogo retirado com motivo manual, o pedido segue pago e o histórico tem o motivo',
  exists (select 1 from public.entitlements e where e.id = pg_temp.ent('ana') and e.status = 'revoked' and e.revoke_reason = 'manual' and e.revoked_at is not null)
  and (select o.status from public.orders o where o.id = pg_temp.gift_order('ana')) = 'paid'
  and exists (select 1 from private.admin_events a where a.action = 'user_revoke' and a.details->>'reason' = 'Pedido por engano' and a.details->>'product' = 'USOLO'));
select pg_temp.expect('pedido pago com jogo retirado pelo atendimento segue coerente (I-5)', 'set constraints all immediate', 'OK');
set constraints all deferred;
select pg_temp.assert('retirar de novo: not_active; direito de outra pessoa: not_found',
  (select outcome = 'not_active' from public.admin_revoke_entitlement(pg_temp.uid('adm'), pg_temp.uid('ana'), pg_temp.ent('ana'), 'De novo'))
  and (select outcome = 'not_found' from public.admin_revoke_entitlement(pg_temp.uid('adm'), pg_temp.uid('bia'), pg_temp.ent('ana'), 'Teste')));
select pg_temp.assert('reenviar depois de retirar: not_deliverable',
  (select outcome = 'not_deliverable' from public.admin_resend_delivery(pg_temp.uid('adm'), pg_temp.uid('ana'), pg_temp.gift_order('ana'))));
select pg_temp.assert('o produto volta a dar para presentear',
  (select outcome = 'ok' from public.admin_gift_products(pg_temp.uid('adm'), pg_temp.uid('ana'), array['USOLO'], 'Devolvendo o jogo', false, false)));

-- ===== novidades =================================================================================
select pg_temp.assert('tirar das novidades quem não está: not_subscribed',
  (select outcome = 'not_subscribed' from public.admin_newsletter_off(pg_temp.uid('adm'), pg_temp.uid('ana'), 'Pedido por e-mail')));
select pg_temp.assert('ana aceita as novidades', (select outcome = 'applied' from public.set_marketing_consent(pg_temp.uid('ana'), true, 'account', 'v1')));
select pg_temp.assert('tirar das novidades: ok', (select outcome = 'ok' from public.admin_newsletter_off(pg_temp.uid('adm'), pg_temp.uid('ana'), 'Pedido por e-mail')));
select pg_temp.assert('novidades desligadas, pela origem support, com o motivo no histórico',
  not (select pf.marketing_opt_in from public.profiles pf where pf.user_id = pg_temp.uid('ana'))
  and (select c.source from public.marketing_consents c where c.user_id = pg_temp.uid('ana') order by c.occurred_at desc, c.id desc limit 1) = 'support'
  and exists (select 1 from private.admin_events a where a.action = 'user_newsletter_off' and a.details->>'reason' = 'Pedido por e-mail'));

-- ===== bloqueio ==================================================================================
select pg_temp.assert('bloqueio: confere a conta e diz o estado atual',
  (select outcome = 'ok' and blocked = false from public.admin_check_user_block(pg_temp.uid('adm'), pg_temp.uid('ana'))));
update auth.users set banned_until = now() + interval '100 years' where id = pg_temp.uid('ana');
select pg_temp.assert('bloqueio: conta bloqueada aparece como bloqueada (conferência, lista e ficha)',
  (select blocked from public.admin_check_user_block(pg_temp.uid('adm'), pg_temp.uid('ana')))
  and (select (result->>'total')::int = 1 from public.admin_list_users(pg_temp.uid('adm'), 'ana@', 'blocked', 0))
  and (select (result->'account'->>'blocked')::boolean from public.admin_get_user(pg_temp.uid('adm'), pg_temp.uid('ana'))));
select pg_temp.assert('bloqueio de admin ou da própria conta: protected',
  (select outcome = 'protected' from public.admin_check_user_block(pg_temp.uid('adm'), pg_temp.uid('adm2')))
  and (select outcome = 'protected' from public.admin_check_user_block(pg_temp.uid('adm'), pg_temp.uid('adm'))));
select pg_temp.assert('bloqueio registrado no histórico',
  (select outcome = 'ok' from public.admin_log_user_block(pg_temp.uid('adm'), pg_temp.uid('ana'), true, 'Abuso no cupom')));
select pg_temp.assert('histórico do bloqueio com o motivo',
  exists (select 1 from private.admin_events a where a.action = 'user_block' and a.target_id = pg_temp.uid('ana') and a.details->>'reason' = 'Abuso no cupom'));

-- ===== presente de vários jogos ==================================================================
insert into pg_temp.gift select 'cris', g.* from public.admin_gift_products(pg_temp.uid('adm'), pg_temp.uid('cris'), array['UOUTRO', 'UPACK'], 'Sorteio do Instagram', true, false) g;
select pg_temp.assert('vários jogos: um pedido de cortesia com os itens na ordem escolhida, um direito por produto e um e-mail só',
  (select outcome = 'ok' and products = array['UOUTRO', 'UPACK'] from pg_temp.gift where name = 'cris')
  and (select array_agg(p.code order by i.position) from public.order_items i join public.products p on p.id = i.product_id
        where i.order_id = pg_temp.gift_order('cris')) = array['UOUTRO', 'UPACK']
  and (select count(*) from public.entitlements e where e.order_id = pg_temp.gift_order('cris') and e.status = 'active') = 2
  and (select count(*) from public.email_outbox x where x.order_id = pg_temp.gift_order('cris')) = 1
  and (select jsonb_array_length(x.payload->'games') from public.email_outbox x where x.order_id = pg_temp.gift_order('cris')) = 3);
select pg_temp.expect('vários jogos: pedido e direitos coerentes (I-5)', 'set constraints all immediate', 'OK');
set constraints all deferred;
select pg_temp.assert('vários jogos: o pacote e um jogo que já vem nele, overlap com os dois',
  (select outcome = 'overlap' and products = array['UCOMBO', 'USOLO'] from public.admin_gift_products(pg_temp.uid('adm'), pg_temp.uid('eva'), array['USOLO', 'UCOMBO'], 'Teste', false, false)));
select pg_temp.assert('vários jogos: já tem um deles inteiro, already_owned com o código',
  (select outcome = 'already_owned' and products = array['UOUTRO'] from public.admin_gift_products(pg_temp.uid('adm'), pg_temp.uid('cris'), array['USOLO', 'UOUTRO'], 'Teste', false, false)));
select pg_temp.assert('vários jogos: fora da venda, product_unavailable com o código',
  (select outcome = 'product_unavailable' and products = array['URASC'] from public.admin_gift_products(pg_temp.uid('adm'), pg_temp.uid('eva'), array['USOLO', 'URASC'], 'Teste', false, false)));
select pg_temp.expect('vários jogos: lista vazia é KT001',
  format($q$select * from public.admin_gift_products(%L, %L, array[]::text[], 'Teste', false, false)$q$, pg_temp.uid('adm'), pg_temp.uid('eva')), 'KT001');
select pg_temp.expect('vários jogos: produto repetido é KT001',
  format($q$select * from public.admin_gift_products(%L, %L, array['USOLO', 'USOLO'], 'Teste', false, false)$q$, pg_temp.uid('adm'), pg_temp.uid('eva')), 'KT001');
select pg_temp.expect('vários jogos: mais de 10 é KT001',
  format($q$select * from public.admin_gift_products(%L, %L, array['A','B','C','D','E','F','G','H','I','J','K'], 'Teste', false, false)$q$, pg_temp.uid('adm'), pg_temp.uid('eva')), 'KT001');

-- ===== equipe ====================================================================================
select pg_temp.assert('equipe: promover uma conta confirmada', (select outcome = 'ok' from public.admin_set_admin(pg_temp.uid('adm'), pg_temp.uid('cris'), true, 'Entrou para a equipe')));
select pg_temp.assert('equipe: o admin vale no banco na hora, sem perder o resto do app_metadata, e fica no histórico',
  private.is_admin(pg_temp.uid('cris'))
  and (select u.raw_app_meta_data -> 'providers' = '["email"]'::jsonb from auth.users u where u.id = pg_temp.uid('cris'))
  and exists (select 1 from private.admin_events a where a.action = 'user_admin_grant' and a.target_id = pg_temp.uid('cris') and a.details->>'reason' = 'Entrou para a equipe'));
select pg_temp.assert('equipe: lista da equipe com o filtro admins',
  -- collate "C": a ordem não depende do idioma do banco (no CI, a pontuação é ignorada e adm@ vem antes de adm2@).
  (select (select array_agg(u->>'email' order by u->>'email' collate "C") from jsonb_array_elements(result->'users') u)
          = array['adm2@pgtap.test', 'adm@pgtap.test', 'admnc@pgtap.test', 'cris@pgtap.test']
   from public.admin_list_users(pg_temp.uid('adm'), '@pgtap.test', 'admins', 0)));
select pg_temp.assert('equipe: promover de novo é unchanged; sem confirmação, not_confirmed; bloqueada, blocked',
  (select outcome = 'unchanged' from public.admin_set_admin(pg_temp.uid('adm'), pg_temp.uid('cris'), true, 'De novo'))
  and (select outcome = 'not_confirmed' from public.admin_set_admin(pg_temp.uid('adm'), pg_temp.uid('bia'), true, 'Teste')));
update auth.users set banned_until = now() + interval '100 years' where id = pg_temp.uid('dani');
select pg_temp.assert('equipe: conta bloqueada não vira admin', (select outcome = 'blocked' from public.admin_set_admin(pg_temp.uid('adm'), pg_temp.uid('dani'), true, 'Teste')));
select pg_temp.assert('equipe: ninguém tira o próprio admin', (select outcome = 'self' from public.admin_set_admin(pg_temp.uid('adm'), pg_temp.uid('adm'), false, 'Teste')));
select pg_temp.assert('equipe: quem não é admin recebe forbidden', (select outcome = 'forbidden' from public.admin_set_admin(pg_temp.uid('comum'), pg_temp.uid('comum'), true, 'Teste')));
select pg_temp.assert('equipe: tirar o admin de outra conta', (select outcome = 'ok' from public.admin_set_admin(pg_temp.uid('cris'), pg_temp.uid('adm2'), false, 'Saiu da equipe')));
select pg_temp.assert('equipe: o admin sai do app_metadata e o histórico registra quem tirou',
  not private.is_admin(pg_temp.uid('adm2'))
  and not (select u.raw_app_meta_data ? 'admin' from auth.users u where u.id = pg_temp.uid('adm2'))
  and exists (select 1 from private.admin_events a where a.action = 'user_admin_revoke' and a.user_id = pg_temp.uid('cris') and a.target_id = pg_temp.uid('adm2')));
select pg_temp.expect('equipe: sem motivo é KT001',
  format($q$select * from public.admin_set_admin(%L, %L, true, '')$q$, pg_temp.uid('adm'), pg_temp.uid('eva')), 'KT001');
select pg_temp.assert('equipe: tirar o admin devolve as proteções da conta (adm2 pode ter jogo retirado)',
  (select outcome = 'ok' from public.admin_revoke_entitlement(pg_temp.uid('adm'), pg_temp.uid('adm2'), pg_temp.ent('adm2'), 'Teste depois de sair da equipe')));

-- ===== acompanhamento ============================================================================
insert into public.carts (user_id) values (pg_temp.uid('eva')) on conflict (user_id) do nothing;
insert into public.cart_items (user_id, product_id, added_at) values (pg_temp.uid('eva'), (select id from public.products where code = 'USOLO'), now() - interval '2 days');
update public.orders set paid_at = now() - interval '3 days' where id = pg_temp.gift_order('cris');
insert into public.email_outbox (user_id, order_id, kind, category, to_email, payload, dedupe_key, status, attempts, last_error)
values (pg_temp.uid('cris'), pg_temp.gift_order('cris'), 'gift', 'transactional', 'cris@pgtap.test', '{}', 'pgtap-falhou', 'failed', 5, 'teste');
update public.email_outbox set status = 'canceled', skip_reason = 'entitlement_revoked'
 where order_id = pg_temp.gift_order('cris') and dedupe_key <> 'pgtap-falhou';
update auth.users set created_at = now() - interval '2 hours' where id = pg_temp.uid('bia');
create temp table follow as select * from public.admin_follow_up(pg_temp.uid('adm'));
create function pg_temp.follow_emails(p_list text) returns text[] language sql as $$
  select coalesce(array_agg(i->>'email' order by i->>'email' collate "C"), '{}') from pg_temp.follow f, jsonb_array_elements(f.result->p_list->'items') i
   where i->>'email' like '%@pgtap.test'
$$;
select pg_temp.assert('acompanhamento: ok', (select outcome = 'ok' from pg_temp.follow));
select pg_temp.assert('acompanhamento: sacola esquecida há mais de 1 dia, com os itens',
  pg_temp.follow_emails('cart') = array['eva@pgtap.test']
  and (select i->'items' = '["Produto USOLO"]'::jsonb and not (i->>'reminded')::boolean
       from pg_temp.follow f, jsonb_array_elements(f.result->'cart'->'items') i where i->>'email' = 'eva@pgtap.test'));
select pg_temp.assert('acompanhamento: comprou (ou ganhou) há 2 dias e não baixou',
  pg_temp.follow_emails('no_download') = array['cris@pgtap.test']
  and (select i->>'order_kind' = 'courtesy' from pg_temp.follow f, jsonb_array_elements(f.result->'no_download'->'items') i where i->>'email' = 'cris@pgtap.test'));
select pg_temp.assert('acompanhamento: entrega que falhou e nunca saiu',
  pg_temp.follow_emails('delivery') = array['cris@pgtap.test']
  and (select i->>'problem' = 'failed' and i->>'order_id' = pg_temp.gift_order('cris')::text
       from pg_temp.follow f, jsonb_array_elements(f.result->'delivery'->'items') i where i->>'email' = 'cris@pgtap.test'));
select pg_temp.assert('acompanhamento: conta sem confirmação há mais de 1 hora (a recém-criada ainda não)',
  pg_temp.follow_emails('unconfirmed') = array['bia@pgtap.test']);
select pg_temp.assert('acompanhamento: quem não é admin recebe forbidden',
  (select outcome = 'forbidden' and result is null from public.admin_follow_up(pg_temp.uid('comum'))));

-- ===== exportar e excluir ========================================================================
select pg_temp.assert('exportar: a cópia dos dados, registrada no histórico',
  (select outcome = 'ok' and data ? 'orders' and data ? 'library' from public.admin_export_user(pg_temp.uid('adm'), pg_temp.uid('ana'))));
select pg_temp.assert('exportação no histórico', exists (select 1 from private.admin_events a where a.action = 'user_export' and a.target_id = pg_temp.uid('ana')));
select pg_temp.assert('exportar conta sem e-mail confirmado: not_confirmed',
  (select outcome = 'not_confirmed' from public.admin_export_user(pg_temp.uid('adm'), pg_temp.uid('bia'))));

select pg_temp.assert('excluir com o e-mail errado: confirmation_mismatch',
  (select outcome = 'confirmation_mismatch' from public.admin_delete_user(pg_temp.uid('adm'), pg_temp.uid('ana'), 'Pedido da pessoa', 'outra@pgtap.test')));
select pg_temp.assert('excluir admin ou a própria conta: protected; sem e-mail confirmado: not_confirmed',
  (select outcome = 'protected' from public.admin_delete_user(pg_temp.uid('adm'), pg_temp.uid('cris'), 'Teste', 'cris@pgtap.test'))
  and (select outcome = 'protected' from public.admin_delete_user(pg_temp.uid('adm'), pg_temp.uid('adm'), 'Teste', 'adm@pgtap.test'))
  and (select outcome = 'not_confirmed' from public.admin_delete_user(pg_temp.uid('adm'), pg_temp.uid('bia'), 'Teste', 'bia@pgtap.test')));
insert into public.orders (user_id, email, status, cart_version, terms_version, terms_accepted_at, livemode, amount_subtotal, amount_discount, amount_total, currency)
values (pg_temp.uid('comum'), 'comum@pgtap.test', 'pending_payment', 0, 'v1', now(), false, 100, 0, 100, 'brl');
select pg_temp.assert('excluir com pagamento em andamento: blocked, com o motivo',
  (select outcome = 'blocked' and reason = 'payment_pending' from public.admin_delete_user(pg_temp.uid('adm'), pg_temp.uid('comum'), 'Teste', 'comum@pgtap.test')));
create temp table removed as select * from public.admin_delete_user(pg_temp.uid('adm'), pg_temp.uid('ana'), 'Pedido da pessoa por e-mail', ' ANA@pgtap.test ');
select pg_temp.assert('excluir: deleted, com os pedidos anonimizados',
  (select outcome = 'deleted' and orders_anonymized = 2 from pg_temp.removed)
  and not exists (select 1 from public.orders o where o.user_id = pg_temp.uid('ana')));
select pg_temp.assert('exclusão no histórico sem o e-mail da pessoa',
  exists (select 1 from private.admin_events a where a.action = 'user_delete' and a.target_id = pg_temp.uid('ana')
                                                 and a.details->>'reason' = 'Pedido da pessoa por e-mail' and position('ana@' in a.details::text) = 0));

-- ===== quem não é admin e privilégios ============================================================
select pg_temp.assert('não admin: forbidden em todas as ações',
  (select outcome = 'forbidden' from public.admin_revoke_entitlement(pg_temp.uid('comum'), pg_temp.uid('adm2'), pg_temp.ent('adm2'), 'Teste'))
  and (select outcome = 'forbidden' from public.admin_resend_delivery(pg_temp.uid('comum'), pg_temp.uid('adm2'), pg_temp.gift_order('adm2')))
  and (select outcome = 'forbidden' from public.admin_newsletter_off(pg_temp.uid('comum'), pg_temp.uid('adm2'), 'Teste'))
  and (select outcome = 'forbidden' from public.admin_check_user_block(pg_temp.uid('comum'), pg_temp.uid('adm2')))
  and (select outcome = 'forbidden' from public.admin_log_user_block(pg_temp.uid('comum'), pg_temp.uid('adm2'), true, 'Teste'))
  and (select outcome = 'forbidden' from public.admin_export_user(pg_temp.uid('comum'), pg_temp.uid('adm2')))
  and (select outcome = 'forbidden' from public.admin_delete_user(pg_temp.uid('comum'), pg_temp.uid('adm2'), 'Teste', 'adm2@pgtap.test')));
select pg_temp.assert('nada gravado pelas tentativas de quem não é admin',
  not exists (select 1 from private.admin_events a where a.user_id = pg_temp.uid('comum')));

select * from finish();
rollback;
