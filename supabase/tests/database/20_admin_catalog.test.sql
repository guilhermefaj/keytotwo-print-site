-- 20_admin_catalog: o catálogo no admin (migração 20261024200000): a lista, pausar e voltar a vender, o preço novo, o
-- preço riscado, montar o pacote (com o presente para quem já tem) e a versão do catálogo que o vigia da VPS confere.
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
-- o outcome da RPC (as de uma coluna só voltam como o valor, não como objeto)
create function pg_temp.out(p_k text) returns text language sql as $$
  select case jsonb_typeof(pg_temp.res(p_k)) when 'object' then pg_temp.res(p_k)->>'outcome' else pg_temp.res(p_k) #>> '{}' end
$$;
-- o produto do catálogo público e o da lista do admin
create function pg_temp.public_item(p_code text) returns jsonb language sql as $$
  select item from jsonb_array_elements(public.get_catalog()) item where item->>'code' = p_code
$$;
create function pg_temp.admin_item(p_code text) returns jsonb language sql as $$
  select item from public.admin_list_catalog(pg_temp.uid('cadm'), false) l, jsonb_array_elements(l.result->'products') item
   where item->>'code' = p_code
$$;
create function pg_temp.pack_games(p_code text) returns text language sql as $$
  select string_agg(g.code || '@' || pg.position, ',' order by pg.position)
    from public.product_games pg join public.games g on g.id = pg.game_id join public.products p on p.id = pg.product_id
   where p.code = p_code
$$;

-- ===== fixtures ====================================================================================
do $$
declare v_game bigint;
begin
  perform pg_temp.mk_user('cadm');
  update auth.users set raw_app_meta_data = jsonb_build_object('provider', 'email', 'admin', true) where id = pg_temp.uid('cadm');
  perform pg_temp.mk_user('cana');
  perform pg_temp.mk_user('cbia');
  perform pg_temp.mk_product('CPACK', 'bundle', 3);
  perform pg_temp.mk_product('CSOLO', 'single', 1);
  -- jogo publicado, com PDF, sem avulso: entra no pacote, mas não dá para presentear
  insert into public.games (code, slug, name, status) values ('GM-SEMAVULSO', 'gm-semavulso', 'Jogo sem avulso [TESTE]', 'published')
  returning id into v_game;
  insert into public.files (game_id, kind, access, version, filename, size_bytes, sha256, status, published_at)
  values (v_game, 'pdf', 'paid', '1.0', 'sem-avulso.pdf', 1000, repeat('0', 64), 'published', now());
  -- rascunho sem preço: não volta a vender
  insert into public.products (code, slug, kind, name, status, games_expected) values ('CRASCUNHO', 'crascunho', 'single', 'Rascunho [TESTE]', 'draft', 1);
  -- a Ana tem o pacote; a Bia tem o pacote e o avulso que vai entrar nele
  perform pg_temp.buy(pg_temp.uid('cana'), array['CPACK'], array[2990]);
  perform pg_temp.buy(pg_temp.uid('cbia'), array['CPACK', 'CSOLO'], array[2990, 990]);
  insert into private.stripe_prices (price_id, unit_amount, currency, product, active)
  values ('price_PGTAP_CSOLO', 990, 'brl', 'prod_PGTAP_CSOLO', true);
end $$;
insert into pg_temp.res values ('versão 0', to_jsonb(public.get_catalog_version()));

-- ===== lista do admin ==============================================================================
select pg_temp.assert('lista: forbidden para quem não é admin',
  (select outcome = 'forbidden' and result is null from public.admin_list_catalog(pg_temp.uid('cana'), false)));
select pg_temp.assert('lista: traz a versão do catálogo público',
  (select result->>'version' = public.get_catalog_version() from public.admin_list_catalog(pg_temp.uid('cadm'), false)));
select pg_temp.assert('lista: o pacote pronto e à venda, com os jogos, os pedidos pagos e quem tem',
  (select item->>'status' = 'active' and (item->>'ready')::boolean and (item->>'sellable')::boolean and item->>'kind' = 'bundle'
          and jsonb_array_length(item->'games') = 3 and (item->>'paid_orders')::int = 2 and (item->>'owners')::int = 2
          and item->'list_price' = 'null'::jsonb
     from pg_temp.admin_item('CPACK') item));
select pg_temp.assert('lista: os jogos com a versão do PDF, o avulso e os pacotes; o rascunho sem preço não está pronto',
  (select bool_or(g->>'code' = 'GM-CSOLO-1' and g->>'single' = 'CSOLO' and g->'packs' = '[]'::jsonb and g->'file'->>'version' = '1.0')
          and bool_or(g->>'code' = 'GM-CPACK-1' and g->'packs' = '["CPACK"]'::jsonb)
          and bool_or(g->>'code' = 'GM-SEMAVULSO' and g->'single' = 'null'::jsonb)
     from public.admin_list_catalog(pg_temp.uid('cadm'), false) l, jsonb_array_elements(l.result->'games') g)
  and (select not (item->>'ready')::boolean and item->>'status' = 'draft' from pg_temp.admin_item('CRASCUNHO') item));

-- ===== pausar e voltar a vender ====================================================================
select pg_temp.expect('situação: status desconhecido é KT001',
  $$select * from public.admin_set_product_status(pg_temp.uid('cadm'), 'CSOLO', 'draft', 'Pausa de teste')$$, 'KT001');
select pg_temp.expect('situação: sem motivo é KT001',
  $$select * from public.admin_set_product_status(pg_temp.uid('cadm'), 'CSOLO', 'archived', 'a')$$, 'KT001');
insert into pg_temp.res select 'pausar', to_jsonb(r) from public.admin_set_product_status(pg_temp.uid('cadm'), 'CSOLO', 'archived', 'Revisão do PDF') r;
select pg_temp.assert('pausado: sai do catálogo e da venda; quem comprou continua com o jogo; o histórico guarda',
  pg_temp.out('pausar') = 'ok' and pg_temp.public_item('CSOLO') is null
  and not private.product_is_sellable((select id from public.products where code = 'CSOLO'))
  and exists (select 1 from public.entitlements e join public.products p on p.id = e.product_id
               where p.code = 'CSOLO' and e.user_id = pg_temp.uid('cbia') and e.status = 'active')
  and exists (select 1 from private.admin_events where action = 'product_status' and details->>'product' = 'CSOLO'
                 and details->>'from' = 'active' and details->>'to' = 'archived' and details->>'reason' = 'Revisão do PDF'));
insert into pg_temp.res select 'pausar de novo', to_jsonb(r) from public.admin_set_product_status(pg_temp.uid('cadm'), 'CSOLO', 'archived', 'Revisão do PDF') r;
insert into pg_temp.res select 'rascunho', to_jsonb(r) from public.admin_set_product_status(pg_temp.uid('cadm'), 'CRASCUNHO', 'active', 'Lançar') r;
insert into pg_temp.res select 'não existe', to_jsonb(r) from public.admin_set_product_status(pg_temp.uid('cadm'), 'NAOEXISTE', 'active', 'Lançar') r;
insert into pg_temp.res select 'não admin', to_jsonb(r) from public.admin_set_product_status(pg_temp.uid('cana'), 'CSOLO', 'active', 'Lançar') r;
select pg_temp.assert('situação: repetido unchanged, rascunho sem preço not_ready, código errado not_found, não admin forbidden',
  pg_temp.out('pausar de novo') = 'unchanged' and pg_temp.out('rascunho') = 'not_ready'
  and pg_temp.out('não existe') = 'not_found' and pg_temp.out('não admin') = 'forbidden'
  and (select status = 'draft' from public.products where code = 'CRASCUNHO'));
insert into pg_temp.res select 'voltar', to_jsonb(r) from public.admin_set_product_status(pg_temp.uid('cadm'), 'CSOLO', 'active', 'PDF revisado') r;
select pg_temp.assert('voltar a vender: o avulso volta ao catálogo',
  pg_temp.out('voltar') = 'ok' and pg_temp.public_item('CSOLO') is not null);

-- ===== preço ======================================================================================
select pg_temp.expect('preço: id de Price inválido é KT001',
  $$select * from public.admin_set_product_price(pg_temp.uid('cadm'), 'CSOLO', 'preco_1', 1490, 'brl', 'prod_PGTAP_CSOLO', 'Reajuste')$$, 'KT001');
insert into pg_temp.res select 'preço', to_jsonb(r)
  from public.admin_set_product_price(pg_temp.uid('cadm'), 'CSOLO', 'price_PGTAP_NOVO', 1490, 'brl', 'prod_PGTAP_CSOLO', 'Reajuste de lançamento') r;
select pg_temp.assert('preço novo: o produto passa para o Price novo; o novo entra na memória e o antigo fica inativo',
  pg_temp.out('preço') = 'ok' and pg_temp.res('preço')->>'previous_price_id' = 'price_PGTAP_CSOLO'
  and (select stripe_price_id = 'price_PGTAP_NOVO' from public.products where code = 'CSOLO')
  and (select active and unit_amount = 1490 and product = 'prod_PGTAP_CSOLO' from private.stripe_prices where price_id = 'price_PGTAP_NOVO')
  and (select not active from private.stripe_prices where price_id = 'price_PGTAP_CSOLO')
  and exists (select 1 from private.admin_events where action = 'product_price' and details->>'product' = 'CSOLO'
                 and (details->>'from_amount')::int = 990 and (details->>'to_amount')::int = 1490 and details->>'to_price' = 'price_PGTAP_NOVO'));
insert into pg_temp.res select 'preço repetido', to_jsonb(r)
  from public.admin_set_product_price(pg_temp.uid('cadm'), 'CSOLO', 'price_PGTAP_NOVO', 1490, 'brl', 'prod_PGTAP_CSOLO', 'Reajuste de lançamento') r;
select pg_temp.assert('preço: o mesmo Price é unchanged; o pedido antigo guarda o Price da compra',
  pg_temp.out('preço repetido') = 'unchanged'
  and exists (select 1 from public.order_items oi join public.products p on p.id = oi.product_id
               where p.code = 'CSOLO' and oi.stripe_price_id = 'price_PGTAP_CSOLO'));

-- ===== preço riscado ==============================================================================
select pg_temp.expect('riscado: valor sem rótulo é KT001',
  $$select * from public.admin_set_list_price(pg_temp.uid('cadm'), 'CPACK', 3990, ' ', 'Promoção')$$, 'KT001');
insert into pg_temp.res select 'riscado', to_jsonb(r)
  from public.admin_set_list_price(pg_temp.uid('cadm'), 'CPACK', 3990, ' Preço de lançamento ', 'Lançamento do pacote') r;
select pg_temp.assert('riscado: o catálogo público mostra o valor e o rótulo; a versão do catálogo muda',
  pg_temp.out('riscado') = 'ok'
  and pg_temp.public_item('CPACK')->'list_price' = '{"amount": 3990, "label": "Preço de lançamento"}'::jsonb
  and public.get_catalog_version() <> pg_temp.res('versão 0') #>> '{}');
insert into pg_temp.res select 'tirar riscado', to_jsonb(r) from public.admin_set_list_price(pg_temp.uid('cadm'), 'CPACK', null, null, 'Fim da promoção') r;
insert into pg_temp.res select 'tirar de novo', to_jsonb(r) from public.admin_set_list_price(pg_temp.uid('cadm'), 'CPACK', null, null, 'Fim da promoção') r;
select pg_temp.assert('riscado: tirar volta a nada; repetir é unchanged; o histórico guarda os dois',
  pg_temp.out('tirar riscado') = 'ok' and pg_temp.out('tirar de novo') = 'unchanged'
  and pg_temp.public_item('CPACK')->'list_price' = 'null'::jsonb
  and (select count(*) = 2 from private.admin_events where action = 'product_list_price' and details->>'product' = 'CPACK'));

-- ===== montar o pacote ============================================================================
insert into pg_temp.res select 'sem avulso', to_jsonb(r)
  from public.admin_add_pack_game(pg_temp.uid('cadm'), 'CPACK', 'GM-SEMAVULSO', true, true, 'Jogo novo no pacote', false) r;
insert into pg_temp.res select 'num avulso', to_jsonb(r)
  from public.admin_add_pack_game(pg_temp.uid('cadm'), 'CSOLO', 'GM-SEMAVULSO', false, false, 'Jogo novo no pacote', false) r;
select pg_temp.assert('pacote: presentear sem avulso à venda é no_single; avulso não vira pacote; nada mudou',
  pg_temp.out('sem avulso') = 'no_single' and pg_temp.out('num avulso') = 'not_allowed'
  and pg_temp.pack_games('CPACK') = 'GM-CPACK-1@1,GM-CPACK-2@2,GM-CPACK-3@3');

insert into pg_temp.res select 'pôr com presente', to_jsonb(r)
  from public.admin_add_pack_game(pg_temp.uid('cadm'), 'CPACK', 'GM-CSOLO-1', true, true, 'Jogo novo para o pacote', false) r;
select pg_temp.assert('pacote: o jogo entra no fim, a contagem sobe e continua à venda',
  pg_temp.out('pôr com presente') = 'ok'
  and pg_temp.pack_games('CPACK') = 'GM-CPACK-1@1,GM-CPACK-2@2,GM-CPACK-3@3,GM-CSOLO-1@4'
  and (select games_expected = 4 from public.products where code = 'CPACK')
  and jsonb_array_length(pg_temp.public_item('CPACK')->'games') = 4);
select pg_temp.assert('presente: só a Ana ganha (a Bia já tinha o avulso), com pedido de cortesia, e-mail e histórico',
  (pg_temp.res('pôr com presente')->>'gifted')::int = 1
  and jsonb_array_length(pg_temp.res('pôr com presente')->'outbox_ids') = 1
  and exists (select 1 from public.orders o join public.entitlements e on e.order_id = o.id join public.products p on p.id = e.product_id
               where o.kind = 'courtesy' and o.user_id = pg_temp.uid('cana') and p.code = 'CSOLO' and e.status = 'active')
  and not exists (select 1 from public.orders o where o.kind = 'courtesy' and o.user_id = pg_temp.uid('cbia'))
  and exists (select 1 from public.email_outbox x where x.kind = 'gift' and x.user_id = pg_temp.uid('cana'))
  and exists (select 1 from private.admin_events where action = 'pack_add_game' and details->>'product' = 'CPACK'
                 and details->>'game' = 'GM-CSOLO-1' and (details->>'gifted')::int = 1)
  and exists (select 1 from private.admin_events where action = 'user_gift' and target_id = pg_temp.uid('cana')));
insert into pg_temp.res select 'pôr de novo', to_jsonb(r)
  from public.admin_add_pack_game(pg_temp.uid('cadm'), 'CPACK', 'GM-CSOLO-1', false, false, 'Jogo novo para o pacote', false) r;
insert into pg_temp.res select 'pôr sem presente', to_jsonb(r)
  from public.admin_add_pack_game(pg_temp.uid('cadm'), 'CPACK', 'GM-SEMAVULSO', false, false, 'Mais um jogo', false) r;
select pg_temp.assert('pacote: o mesmo jogo é unchanged; sem presente entra sem dar nada',
  pg_temp.out('pôr de novo') = 'unchanged' and pg_temp.out('pôr sem presente') = 'ok'
  and (pg_temp.res('pôr sem presente')->>'gifted')::int = 0
  and pg_temp.pack_games('CPACK') = 'GM-CPACK-1@1,GM-CPACK-2@2,GM-CPACK-3@3,GM-CSOLO-1@4,GM-SEMAVULSO@5');

insert into pg_temp.res select 'tirar', to_jsonb(r) from public.admin_remove_pack_game(pg_temp.uid('cadm'), 'CPACK', 'GM-CPACK-2', 'Saiu da coleção') r;
select pg_temp.assert('tirar do pacote: as posições se ajustam, a contagem desce, continua à venda e quem comprou continua com o jogo',
  pg_temp.out('tirar') = 'ok'
  and pg_temp.pack_games('CPACK') = 'GM-CPACK-1@1,GM-CPACK-3@2,GM-CSOLO-1@3,GM-SEMAVULSO@4'
  and (select games_expected = 4 from public.products where code = 'CPACK')
  and private.product_is_sellable((select id from public.products where code = 'CPACK'))
  and exists (select 1 from public.entitlement_games eg join public.entitlements e on e.id = eg.entitlement_id
                join public.games g on g.id = eg.game_id
               where e.user_id = pg_temp.uid('cana') and g.code = 'GM-CPACK-2' and e.status = 'active'));
insert into pg_temp.res select 'tirar fora', to_jsonb(r) from public.admin_remove_pack_game(pg_temp.uid('cadm'), 'CPACK', 'GM-CPACK-2', 'Saiu da coleção') r;
insert into pg_temp.res select 'tirar 1', to_jsonb(r) from public.admin_remove_pack_game(pg_temp.uid('cadm'), 'CPACK', 'GM-SEMAVULSO', 'Enxugar') r;
insert into pg_temp.res select 'tirar 2', to_jsonb(r) from public.admin_remove_pack_game(pg_temp.uid('cadm'), 'CPACK', 'GM-CSOLO-1', 'Enxugar') r;
insert into pg_temp.res select 'tirar 3', to_jsonb(r) from public.admin_remove_pack_game(pg_temp.uid('cadm'), 'CPACK', 'GM-CPACK-3', 'Enxugar') r;
select pg_temp.assert('tirar: jogo fora do pacote é unchanged; o pacote fica com pelo menos dois',
  pg_temp.out('tirar fora') = 'unchanged' and pg_temp.out('tirar 1') = 'ok' and pg_temp.out('tirar 2') = 'ok'
  and pg_temp.out('tirar 3') = 'not_allowed' and pg_temp.pack_games('CPACK') = 'GM-CPACK-1@1,GM-CPACK-3@2');

-- ===== a lista mostra o histórico =================================================================
select pg_temp.assert('lista: o histórico do produto, do mais novo, com quem fez',
  (select item->'history'->0->>'action' = 'pack_remove_game' and item->'history'->0->>'by' = 'cadm@pgtap.test'
          and jsonb_array_length(item->'history') = 7
     from pg_temp.admin_item('CPACK') item));

select * from finish();
rollback;
