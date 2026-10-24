-- 04_cart: carrinho isolado por usuário, version, posse sobreposta, catálogo (docs/data-contract.md v0.3.3, seção 6.2).
-- Roda com `supabase test db` (pgTAP). Dados de teste só existem dentro da transação (rollback no fim).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp): supabase/tests/database/helpers ===========
\ir helpers/base.psql
\ir helpers/fixtures.psql

-- enche o carrinho na ordem dada
create function pg_temp.fill_cart_04(p_user uuid, p_codes text[]) returns void language plpgsql as $$
declare c text;
begin
  foreach c in array p_codes loop perform public.cart_add(p_user, c); end loop;
end $$;

do $fx$
declare v_pk bigint; v_sg1 bigint; v_sg2 bigint; v_ov bigint; v_pt bigint; a uuid; o uuid;
begin
  v_pk  := pg_temp.mk_product('PK1', 'bundle', 3);      -- jogos GM-PK1-1..3
  v_sg1 := pg_temp.mk_product('SG1', 'single', 1);      -- jogo GM-SG1-1
  v_sg2 := pg_temp.mk_product('SG2', 'single', 1);      -- jogo GM-SG2-1
  -- OV1: avulso que contém o jogo 1 do PK1 (sobreposição total com o pacote)
  insert into public.products (code, slug, kind, name, status, stripe_price_id, games_expected)
  values ('OV1', 'ov1', 'single', 'Avulso OV1 [TESTE]', 'active', 'price_PGTAP_OV1', 1) returning id into v_ov;
  insert into public.product_games (product_id, game_id, position) select v_ov, id, 1 from public.games where code = 'GM-PK1-1';
  -- PT1: pacote de 2 jogos, um do PK1 e um do SG1 (sobreposição parcial)
  insert into public.products (code, slug, kind, name, status, stripe_price_id, games_expected)
  values ('PT1', 'pt1', 'bundle', 'Pacote PT1 [TESTE]', 'active', 'price_PGTAP_PT1', 2) returning id into v_pt;
  insert into public.product_games (product_id, game_id, position) select v_pt, id, 1 from public.games where code = 'GM-PK1-1';
  insert into public.product_games (product_id, game_id, position) select v_pt, id, 2 from public.games where code = 'GM-SG1-1';
  perform pg_temp.mk_user('ca');
  perform pg_temp.mk_user('cb');
  perform pg_temp.mk_user('cc', false);
  perform pg_temp.mk_user('cd');
end $fx$;

-- ===== isolamento entre usuários e version ========================================================
select pg_temp.assert('carrinho vazio: {"version": 0, "items": [], "owned_products": []}', (select public.get_cart(pg_temp.uid('ca')) = '{"version": 0, "items": [], "owned_products": []}'::jsonb));
select pg_temp.assert('cart_add: added, version 1', (select outcome = 'added' and cart_version = 1 from public.cart_add(pg_temp.uid('ca'), 'SG1')));
select pg_temp.assert('cart_add repetido: noop, version intacta', (select outcome = 'noop' and cart_version = 1 from public.cart_add(pg_temp.uid('ca'), 'SG1')));
select pg_temp.assert('A tem 1 item', (select jsonb_array_length(public.get_cart(pg_temp.uid('ca'))->'items') = 1 and (public.get_cart(pg_temp.uid('ca'))->>'version')::int = 1));
select pg_temp.assert('o carrinho de B segue vazio (isolamento A × B)', (select public.get_cart(pg_temp.uid('cb')) = '{"version": 0, "items": [], "owned_products": []}'::jsonb));
select pg_temp.assert('B adiciona o mesmo produto sem afetar A', (select outcome = 'added' and cart_version = 1 from public.cart_add(pg_temp.uid('cb'), 'SG1'))
  and (select (public.get_cart(pg_temp.uid('ca'))->>'version')::int = 1));
select pg_temp.assert('B remove: o carrinho de A não muda', (select outcome = 'removed' and cart_version = 2 from public.cart_remove(pg_temp.uid('cb'), 'SG1'))
  and (select jsonb_array_length(public.get_cart(pg_temp.uid('ca'))->'items') = 1));
select pg_temp.assert('cart_remove repetido: noop', (select outcome = 'noop' and cart_version = 2 from public.cart_remove(pg_temp.uid('cb'), 'SG1')));
select pg_temp.assert('cart_remove de código desconhecido: noop', (select outcome = 'noop' from public.cart_remove(pg_temp.uid('cb'), 'NAO-EXISTE')));
select pg_temp.assert('cart_remove sem carrinho: noop, version 0', (select outcome = 'noop' and cart_version = 0 from public.cart_remove(pg_temp.uid('cd'), 'SG1')));
select pg_temp.assert('funil: cart_item_added e cart_item_removed com a versão', (select count(*) = 1 from public.funnel_events where user_id = pg_temp.uid('cb') and type = 'cart_item_added' and cart_version = 1)
  and (select count(*) = 1 from public.funnel_events where user_id = pg_temp.uid('cb') and type = 'cart_item_removed' and cart_version = 2)
  and (select count(*) = 1 from public.funnel_events where user_id = pg_temp.uid('ca') and type = 'cart_item_added'));
select pg_temp.assert('a version só sobe quando algo muda', (select outcome = 'noop' and cart_version = 1 from public.cart_add(pg_temp.uid('ca'), 'SG1')));

-- ===== produto indisponível ======================================================================
select pg_temp.assert('cart_add de código inexistente: product_unavailable', (select outcome = 'product_unavailable' from public.cart_add(pg_temp.uid('ca'), 'NAO-EXISTE')));
update public.products set status = 'archived' where code = 'SG2';
select pg_temp.assert('cart_add de produto arquivado: product_unavailable', (select outcome = 'product_unavailable' from public.cart_add(pg_temp.uid('ca'), 'SG2')));
update public.products set status = 'active' where code = 'SG2';
update public.games set status = 'draft' where code = 'GM-SG2-1';
select pg_temp.assert('cart_add com jogo não publicado: product_unavailable', (select outcome = 'product_unavailable' from public.cart_add(pg_temp.uid('ca'), 'SG2')));
update public.games set status = 'published' where code = 'GM-SG2-1';
update public.products set games_expected = 4 where code = 'PK1';
select pg_temp.assert('cart_add com composição incompleta: product_unavailable', (select outcome = 'product_unavailable' from public.cart_add(pg_temp.uid('ca'), 'PK1')));
update public.products set games_expected = 3 where code = 'PK1';
select pg_temp.assert('produto vendável volta a entrar', (select outcome = 'added' from public.cart_add(pg_temp.uid('cd'), 'SG2')));

-- ===== e-mail confirmado (KT009) ==================================================================
select pg_temp.expect('cart_add: usuário não confirmado', format($q$select * from public.cart_add(%L, 'SG1')$q$, pg_temp.uid('cc')), 'KT009');
select pg_temp.expect('cart_remove: usuário não confirmado', format($q$select * from public.cart_remove(%L, 'SG1')$q$, pg_temp.uid('cc')), 'KT009');
select pg_temp.expect('get_cart: usuário não confirmado', format($q$select public.get_cart(%L)$q$, pg_temp.uid('cc')), 'KT009');
select pg_temp.expect('cart_add: usuário inexistente', $q$select * from public.cart_add(gen_random_uuid(), 'SG1')$q$, 'KT009');
select pg_temp.expect('cart_add: p_user_id nulo', $q$select * from public.cart_add(null, 'SG1')$q$, 'KT001');
select pg_temp.expect('cart_add: código vazio', format($q$select * from public.cart_add(%L, '  ')$q$, pg_temp.uid('ca')), 'KT001');
select pg_temp.assert('o usuário não confirmado não ganhou carrinho', (select count(*) = 0 from public.carts where user_id = pg_temp.uid('cc')));

-- ===== posse: o já possuído entra riscado (already_owned); sobreposição parcial é aceita e sinalizada ======
do $own$
declare o uuid;
begin
  o := pg_temp.mk_order(pg_temp.uid('cb'), 'paid', array[(select id from public.products where code = 'PK1')], 'OWN1');
  perform pg_temp.mk_ents(o);
end $own$;
select pg_temp.assert('cart_add aceita o pacote que B já possui, com os jogos possuídos', (select outcome = 'added' and cart_version = 3 and owned_games = '["GM-PK1-1","GM-PK1-2","GM-PK1-3"]'::jsonb from public.cart_add(pg_temp.uid('cb'), 'PK1')));
select pg_temp.assert('cart_add aceita o avulso contido no pacote possuído (OV1 ⊂ PK1)', (select outcome = 'added' and owned_games = '["GM-PK1-1"]'::jsonb from public.cart_add(pg_temp.uid('cb'), 'OV1')));
select pg_temp.assert('get_cart: o já possuído fica na sacola como already_owned, fora do pedido (available false)',
  (select count(*) = 2 from jsonb_array_elements(public.get_cart(pg_temp.uid('cb'))->'items') i
    where i->>'status' = 'already_owned' and not (i->>'available')::boolean));
select pg_temp.assert('get_cart: owned_products traz os vendáveis que B tem por inteiro', (select public.get_cart(pg_temp.uid('cb'))->'owned_products' = '["OV1","PK1"]'::jsonb));
do $c$ begin perform public.cart_remove(pg_temp.uid('cb'), 'PK1'); perform public.cart_remove(pg_temp.uid('cb'), 'OV1'); end $c$;
select pg_temp.assert('sobreposição parcial é aceita e sinalizada (PT1 tem 1 de 2 jogos de B)', (select outcome = 'added' and owned_games = '["GM-PK1-1"]'::jsonb from public.cart_add(pg_temp.uid('cb'), 'PT1')));
select pg_temp.assert('outro usuário sem posse: o mesmo produto entra sem aviso', (select outcome = 'added' and owned_games = '[]'::jsonb from public.cart_add(pg_temp.uid('ca'), 'PT1')));
select pg_temp.assert('get_cart: aviso de sobreposição parcial em owned_games',
  (select (i->>'status' = 'ok') and (i->'owned_games' = '["GM-PK1-1"]'::jsonb)
   from jsonb_array_elements(public.get_cart(pg_temp.uid('cb'))->'items') i where i->>'code' = 'PT1'));
select pg_temp.assert('get_cart: shared_with entre itens do próprio carrinho (SG1 e PT1 dividem o jogo GM-SG1-1)',
  (select (i->'shared_with') = '["PT1"]'::jsonb from jsonb_array_elements(public.get_cart(pg_temp.uid('ca'))->'items') i where i->>'code' = 'SG1')
  and (select (i->'shared_with') = '["SG1"]'::jsonb from jsonb_array_elements(public.get_cart(pg_temp.uid('ca'))->'items') i where i->>'code' = 'PT1'));

-- ===== get_cart: status por item, ordem, campos ===================================================
select pg_temp.assert('get_cart: itens na ordem de added_at', (select jsonb_agg(i->>'code') = '["SG1","PT1"]'::jsonb from jsonb_array_elements(public.get_cart(pg_temp.uid('ca'))->'items') i));
select pg_temp.assert('get_cart: campos do item', (select (i ? 'code') and (i ? 'kind') and (i ? 'name') and (i ? 'stripe_price_id') and (i ? 'games') and (i ? 'available') and (i ? 'status') and (i ? 'owned_games') and (i ? 'included_in') and (i ? 'shared_with')
  from jsonb_array_elements(public.get_cart(pg_temp.uid('ca'))->'items') i limit 1));
select pg_temp.assert('get_cart: jogos do item por position, com o Price do avulso de cada um', (select i->'games' = '[{"code":"GM-PK1-1","name":"Jogo GM-PK1-1 [TESTE]","single_price_id":"price_PGTAP_OV1"},{"code":"GM-SG1-1","name":"Jogo GM-SG1-1 [TESTE]","single_price_id":"price_PGTAP_SG1"}]'::jsonb
  from jsonb_array_elements(public.get_cart(pg_temp.uid('ca'))->'items') i where i->>'code' = 'PT1'));
update public.products set status = 'archived' where code = 'SG1';
select pg_temp.assert('get_cart: item que deixou de ser vendável vira unavailable', (select i->>'status' = 'unavailable' and (i->>'available')::boolean = false
  from jsonb_array_elements(public.get_cart(pg_temp.uid('ca'))->'items') i where i->>'code' = 'SG1'));
update public.products set status = 'active' where code = 'SG1';
do $own2$
declare o uuid;
begin
  o := pg_temp.mk_order(pg_temp.uid('ca'), 'paid', array[(select id from public.products where code = 'SG1')], 'OWN2');
  perform pg_temp.mk_ents(o);
end $own2$;
select pg_temp.assert('liberar um jogo tira da sacola o que a pessoa passou a ter por inteiro (o PT1, com 1 de 2 jogos, fica)',
  (select jsonb_agg(i->>'code') = '["PT1"]'::jsonb from jsonb_array_elements(public.get_cart(pg_temp.uid('ca'))->'items') i));

-- ===== included: o avulso que já está num pacote da sacola =========================================
do $c$ begin perform pg_temp.mk_user('ce'); perform pg_temp.fill_cart_04(pg_temp.uid('ce'), array['OV1', 'PK1', 'SG1']); end $c$;
select pg_temp.assert('included: o avulso cujo jogo está num pacote da sacola fica fora do pedido, apontando o pacote',
  (select i->>'status' = 'included' and i->'included_in' = '["PK1"]'::jsonb and not (i->>'available')::boolean
     from jsonb_array_elements(public.get_cart(pg_temp.uid('ce'))->'items') i where i->>'code' = 'OV1'));
select pg_temp.assert('included: o pacote e o avulso de fora seguem ok',
  (select jsonb_object_agg(i->>'code', i->>'status') = '{"OV1": "included", "PK1": "ok", "SG1": "ok"}'::jsonb
     from jsonb_array_elements(public.get_cart(pg_temp.uid('ce'))->'items') i));
update public.products set status = 'archived' where code = 'PK1';
select pg_temp.assert('included: pacote que deixou de ser vendável não esconde o avulso',
  (select i->>'status' = 'ok' and i->'included_in' = '[]'::jsonb
     from jsonb_array_elements(public.get_cart(pg_temp.uid('ce'))->'items') i where i->>'code' = 'OV1'));
update public.products set status = 'active' where code = 'PK1';
select pg_temp.assert('included: pacote que a pessoa já tem por inteiro deixa os dois como already_owned (cart_lines)',
  (select jsonb_object_agg(l.code, l.status) = '{"OV1": "already_owned", "PK1": "already_owned"}'::jsonb
     from private.cart_lines(pg_temp.uid('cb'), array(select id from public.products where code in ('OV1', 'PK1'))) l));

-- ===== quote_cart: a sacola de quem ainda não entrou ===============================================
select pg_temp.assert('quote_cart: mesmas regras sem dono, na ordem dada, com os códigos desconhecidos à parte',
  (select jsonb_path_query_array(q->'items', '$[*].code') = '["PK1","OV1","SG1"]'::jsonb
      and jsonb_path_query_array(q->'items', '$[*].status') = '["ok","included","ok"]'::jsonb
      and q->'unknown' = '["NAO-EXISTE"]'::jsonb
     from public.quote_cart(array['PK1', 'OV1', 'NAO-EXISTE', 'SG1', 'PK1']) q));
select pg_temp.assert('quote_cart: ninguém possui nada (owned_games vazio mesmo para o que B tem)',
  (select bool_and(i->'owned_games' = '[]'::jsonb) from jsonb_array_elements(public.quote_cart(array['PK1', 'OV1'])->'items') i));
select pg_temp.assert('quote_cart: vazio', (select public.quote_cart('{}') = '{"items": [], "unknown": []}'::jsonb));
select pg_temp.expect('quote_cart: nulo', $q$select public.quote_cart(null)$q$, 'KT001');
select pg_temp.expect('quote_cart: mais de 20 códigos', $q$select public.quote_cart(array(select 'X' || g from generate_series(1, 21) g))$q$, 'KT001');

-- ===== get_catalog =================================================================================
select pg_temp.assert('get_catalog: lista só produtos ativos e vendáveis, com preço e jogos por position',
  (select (c->>'stripe_price_id' = 'price_PGTAP_PK1') and jsonb_array_length(c->'games') = 3 and (c->'games'->0->>'code') = 'GM-PK1-1' and (c->>'kind') = 'bundle'
   from jsonb_array_elements(public.get_catalog()) c where c->>'code' = 'PK1'));
update public.products set status = 'archived' where code = 'SG2';
select pg_temp.assert('get_catalog: arquivado some', (select count(*) = 0 from jsonb_array_elements(public.get_catalog()) c where c->>'code' = 'SG2'));
update public.products set status = 'active' where code = 'SG2';
update public.games set status = 'draft' where code = 'GM-SG2-1';
select pg_temp.assert('get_catalog: produto com jogo não publicado some', (select count(*) = 0 from jsonb_array_elements(public.get_catalog()) c where c->>'code' = 'SG2'));
update public.games set status = 'published' where code = 'GM-SG2-1';
select pg_temp.assert('get_catalog: volta quando fica vendável', (select count(*) = 1 from jsonb_array_elements(public.get_catalog()) c where c->>'code' = 'SG2'));
select pg_temp.assert('get_catalog: sem chave do B2 nem URL', (select public.get_catalog()::text !~ '(object_key|bucket|https?:)'));

-- ===== o service_role (papel da API) chama as RPCs ================================================
select pg_temp.expect_as('service_role: cart_add', 'service_role', format($q$select * from public.cart_add(%L, 'PK1')$q$, pg_temp.uid('cd')), 'OK');
select pg_temp.expect_as('service_role: get_cart', 'service_role', format($q$select public.get_cart(%L)$q$, pg_temp.uid('cd')), 'OK');

select * from finish();
rollback;
