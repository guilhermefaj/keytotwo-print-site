-- 10_downloads: resolve_download, resolve_delivery, get_free_game e resolve_free_download (docs/data-contract.md v0.3.4, seção 6.8).
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

-- A chave do B2 só sai por estas RPCs, para a API (service_role); o cliente nunca a vê.

-- ===== ajudantes ====================================================================================
-- arquivo de um jogo (ou de um produto, se p_product) no estado pedido, com o objeto no B2
create function pg_temp.mk_file(p_owner text, p_version text, p_status text default 'published', p_kind text default 'pdf', p_access text default 'paid',
                                p_product boolean default false) returns uuid language plpgsql as $$
declare v_id uuid; v_name text := p_owner || '-v' || p_version || '.' || p_kind;
begin
  if p_product then
    insert into public.files (product_id, kind, access, version, filename, size_bytes, sha256)
    select id, p_kind, p_access, p_version, v_name, 2000, repeat('b', 64) from public.products where code = p_owner returning id into v_id;
  else
    insert into public.files (game_id, kind, access, version, filename, size_bytes, sha256)
    select id, p_kind, p_access, p_version, v_name, 2000, repeat('b', 64) from public.games where code = p_owner returning id into v_id;
  end if;
  insert into public.file_objects (file_id, access, bucket, object_key)
  values (v_id, p_access, 'bucket-pgtap-teste', p_access || '/' || p_owner || '/' || p_version || '/' || v_name);
  if p_status in ('published', 'retired') then update public.files set status = 'published' where id = v_id; end if;
  if p_status = 'retired' then update public.files set status = 'retired' where id = v_id; end if;
  return v_id;
end $$;
create function pg_temp.fid(p_filename text) returns uuid language sql as $$ select id from public.files where filename = p_filename $$;
create function pg_temp.events() returns bigint language sql as $$ select count(*) from public.download_events $$;
create temp table fx (k text primary key, v text);
create function pg_temp.fxv(p_k text) returns text language sql as $$ select v from pg_temp.fx where k = p_k $$;

-- ===== fixtures ====================================================================================
do $fx$
declare v_pk bigint; v_sg bigint; v_ov bigint; v_o uuid;
begin
  v_pk := pg_temp.mk_product('PK1', 'bundle', 3);   -- GM-PK1-1..3, cada um com PDF v1.0 publicado
  v_sg := pg_temp.mk_product('SG1', 'single', 1);   -- GM-SG1-1
  insert into public.products (code, slug, kind, name, status, stripe_price_id, games_expected)
  values ('OV1', 'ov1', 'single', 'Avulso OV1 [TESTE]', 'active', 'price_PGTAP_OV1', 1) returning id into v_ov;
  insert into public.product_games (product_id, game_id, position) select v_ov, id, 1 from public.games where code = 'GM-PK1-1';   -- o mesmo jogo por outro produto

  perform pg_temp.mk_user('da'); perform pg_temp.mk_user('db'); perform pg_temp.mk_user('dc'); perform pg_temp.mk_user('dd');
  perform pg_temp.mk_user('dov'); perform pg_temp.mk_user('dsg'); perform pg_temp.mk_user('de', false);

  v_o := pg_temp.mk_order(pg_temp.uid('da'), 'paid', array[v_pk], 'DA1');      perform pg_temp.mk_ents(v_o);
  insert into fx select 'ent_da', e.id::text from public.entitlements e where e.order_id = v_o;
  v_o := pg_temp.mk_order(pg_temp.uid('dov'), 'paid', array[v_ov], 'DOV1');    perform pg_temp.mk_ents(v_o);
  v_o := pg_temp.mk_order(pg_temp.uid('dsg'), 'paid', array[v_sg], 'DSG1');    perform pg_temp.mk_ents(v_o);
  insert into fx select 'ent_dsg', e.id::text from public.entitlements e where e.order_id = v_o;
  v_o := pg_temp.mk_order(pg_temp.uid('dc'), 'refunded', array[v_pk], 'DC1');  perform pg_temp.mk_ents(v_o, 'revoked', 'refund');
  insert into fx select 'ent_dc', e.id::text from public.entitlements e where e.order_id = v_o;
  v_o := pg_temp.mk_order(pg_temp.uid('dd'), 'disputed', array[v_pk], 'DD1');  perform pg_temp.mk_ents(v_o, 'revoked', 'dispute');
  insert into fx select 'ent_dd', e.id::text from public.entitlements e where e.order_id = v_o;
  insert into fx select 'g_' || lower(replace(code, 'GM-', '')), id::text from public.games where code in ('GM-SG1-1', 'GM-PK1-1', 'GM-PK1-2', 'GM-PK1-3');

  -- GM-PK1-1: nova versão publicada; a 1.0 fica aposentada COM sucessor
  perform pg_temp.mk_file('GM-PK1-1', '1.1', 'draft');
  update public.files set status = 'retired' where filename = 'GM-PK1-1-v1.0.pdf';
  update public.files set status = 'published' where filename = 'GM-PK1-1-v1.1.pdf';
  -- GM-PK1-2: rascunho de uma versão futura (o publicado segue sendo a 1.0)
  perform pg_temp.mk_file('GM-PK1-2', '2.0', 'draft');
  -- GM-PK1-3: aposentado SEM sucessor
  update public.files set status = 'retired' where filename = 'GM-PK1-3-v1.0.pdf';
  -- ZIP do pacote PK1, publicado
  perform pg_temp.mk_file('PK1', '1.0', 'published', 'zip', 'paid', true);
  -- jogo gratuito: tudo em rascunho
  insert into public.games (code, slug, name, access, status) values ('FG-1', 'fg-1', 'Jogo gratuito [TESTE]', 'free', 'draft');
  perform pg_temp.mk_file('FG-1', '0.1', 'draft', 'pdf', 'free');
end $fx$;

-- ===== T100 resolve_download ========================================================================
select pg_temp.assert('download: o dono recebe ok, com bucket, chave, nome, tipo e tamanho do arquivo vigente',
  (select outcome = 'ok' and bucket = 'bucket-pgtap-teste' and object_key = 'paid/GM-PK1-2/1.0/GM-PK1-2-v1.0.pdf' and filename = 'GM-PK1-2-v1.0.pdf'
          and content_type = 'application/pdf' and size_bytes = 1002
   from public.resolve_download(pg_temp.uid('da'), pg_temp.fid('GM-PK1-2-v1.0.pdf'))));
select pg_temp.assert('download: ok grava download_events (pago, com o usuário e o arquivo)',
  (select count(*) = 1 and bool_and(kind = 'paid' and user_id = pg_temp.uid('da') and file_id = pg_temp.fid('GM-PK1-2-v1.0.pdf') and created_at >= now() - interval '1 minute')
   from public.download_events));
do $c$ begin perform * from public.resolve_download(pg_temp.uid('da'), pg_temp.fid('GM-PK1-2-v1.0.pdf')); end $c$;
select pg_temp.assert('download: cada download fica registrado (2 eventos)', pg_temp.events() = 2);

-- o direito vem do JOGO: o dono de outro produto com o mesmo jogo baixa; o dono de outro jogo não
select pg_temp.assert('download: dono de OUTRO produto que contém o jogo (OV1) também baixa',
  (select outcome = 'ok' from public.resolve_download(pg_temp.uid('dov'), pg_temp.fid('GM-PK1-1-v1.1.pdf'))));
select pg_temp.assert('download: dono de outro jogo (SG1) pedindo o arquivo do PK1 = not_entitled, sem localização',
  (select outcome = 'not_entitled' and bucket is null and object_key is null and filename is null and content_type is null and size_bytes is null
   from public.resolve_download(pg_temp.uid('dsg'), pg_temp.fid('GM-PK1-2-v1.0.pdf'))));
select pg_temp.assert('download: quem não comprou = not_entitled (arquivo publicado)',
  (select outcome = 'not_entitled' and object_key is null from public.resolve_download(pg_temp.uid('db'), pg_temp.fid('GM-PK1-2-v1.0.pdf'))));
select pg_temp.assert('download: direito revogado por reembolso não resolve (not_entitled)',
  (select outcome = 'not_entitled' and object_key is null from public.resolve_download(pg_temp.uid('dc'), pg_temp.fid('GM-PK1-2-v1.0.pdf'))));
select pg_temp.assert('download: direito revogado por contestação não resolve (not_entitled)',
  (select outcome = 'not_entitled' and object_key is null from public.resolve_download(pg_temp.uid('dd'), pg_temp.fid('GM-PK1-2-v1.0.pdf'))));
select pg_temp.assert('download: id inexistente = not_found', (select outcome = 'not_found' and object_key is null from public.resolve_download(pg_temp.uid('da'), gen_random_uuid())));

-- estados do arquivo, COM direito
select pg_temp.assert('download: aposentado COM sucessor publicado = not_found (o site recarrega a biblioteca e recebe o id novo)',
  (select outcome = 'not_found' and object_key is null from public.resolve_download(pg_temp.uid('da'), pg_temp.fid('GM-PK1-1-v1.0.pdf'))));
select pg_temp.assert('download: ... e o sucessor (1.1) baixa', (select outcome = 'ok' and filename = 'GM-PK1-1-v1.1.pdf' and object_key = 'paid/GM-PK1-1/1.1/GM-PK1-1-v1.1.pdf'
  from public.resolve_download(pg_temp.uid('da'), pg_temp.fid('GM-PK1-1-v1.1.pdf'))));
select pg_temp.assert('download: aposentado SEM sucessor = unavailable', (select outcome = 'unavailable' and object_key is null from public.resolve_download(pg_temp.uid('da'), pg_temp.fid('GM-PK1-3-v1.0.pdf'))));
select pg_temp.assert('download: rascunho = unavailable', (select outcome = 'unavailable' and object_key is null from public.resolve_download(pg_temp.uid('da'), pg_temp.fid('GM-PK1-2-v2.0.pdf'))));
-- estados do arquivo, SEM direito: só o publicado confirma que existe
select pg_temp.assert('download: sem direito, rascunho = not_found (não vaza que existe)', (select outcome = 'not_found' from public.resolve_download(pg_temp.uid('db'), pg_temp.fid('GM-PK1-2-v2.0.pdf'))));
select pg_temp.assert('download: sem direito, aposentado (com ou sem sucessor) = not_found', (select outcome = 'not_found' from public.resolve_download(pg_temp.uid('db'), pg_temp.fid('GM-PK1-3-v1.0.pdf')))
  and (select outcome = 'not_found' from public.resolve_download(pg_temp.uid('db'), pg_temp.fid('GM-PK1-1-v1.0.pdf'))));
select pg_temp.assert('download: arquivo GRATUITO nunca sai por esta rota (not_found), nem com direito', (select outcome = 'not_found' from public.resolve_download(pg_temp.uid('da'), pg_temp.fid('FG-1-v0.1.pdf'))));

-- ZIP do pacote: o direito é do produto
select pg_temp.assert('download: ZIP do pacote para o dono do PK1 (application/zip)', (select outcome = 'ok' and content_type = 'application/zip' and filename = 'PK1-v1.0.zip' and size_bytes = 2000
  from public.resolve_download(pg_temp.uid('da'), pg_temp.fid('PK1-v1.0.zip'))));
select pg_temp.assert('download: ZIP do pacote para quem tem só um jogo avulso = not_entitled', (select outcome = 'not_entitled' from public.resolve_download(pg_temp.uid('dov'), pg_temp.fid('PK1-v1.0.zip'))));
select pg_temp.assert('download: ZIP do pacote com o direito revogado = not_entitled', (select outcome = 'not_entitled' from public.resolve_download(pg_temp.uid('dc'), pg_temp.fid('PK1-v1.0.zip'))));

-- nada além do ok grava evento
do $c$ begin insert into fx values ('ev_before', pg_temp.events()::text); end $c$;
select pg_temp.assert('download: as recusas não gravam evento nenhum (nenhuma é ok)', (select count(*) = 0 from (
  select * from public.resolve_download(pg_temp.uid('db'), pg_temp.fid('GM-PK1-2-v1.0.pdf'))
  union all select * from public.resolve_download(pg_temp.uid('dd'), pg_temp.fid('GM-PK1-2-v1.0.pdf'))
  union all select * from public.resolve_download(pg_temp.uid('da'), pg_temp.fid('GM-PK1-3-v1.0.pdf'))
  union all select * from public.resolve_download(pg_temp.uid('da'), pg_temp.fid('GM-PK1-1-v1.0.pdf'))
  union all select * from public.resolve_download(pg_temp.uid('da'), gen_random_uuid())) x where outcome = 'ok'));
select pg_temp.assert('download: ... e a contagem de eventos é a de antes', pg_temp.events() = pg_temp.fxv('ev_before')::bigint);

select pg_temp.expect('download: usuário não confirmado', format($q$select * from public.resolve_download(%L, %L)$q$, pg_temp.uid('de'), pg_temp.fid('GM-PK1-2-v1.0.pdf')), 'KT009');
select pg_temp.expect('download: usuário inexistente', format($q$select * from public.resolve_download(gen_random_uuid(), %L)$q$, pg_temp.fid('GM-PK1-2-v1.0.pdf')), 'KT009');
select pg_temp.expect('download: p_user_id nulo', format($q$select * from public.resolve_download(null, %L)$q$, pg_temp.fid('GM-PK1-2-v1.0.pdf')), 'KT001');
select pg_temp.expect('download: p_file_id nulo', format($q$select * from public.resolve_download(%L, null)$q$, pg_temp.uid('da')), 'KT001');
select pg_temp.expect_as('download: service_role executa', 'service_role', format($q$select * from public.resolve_download(%L, %L)$q$, pg_temp.uid('da'), pg_temp.fid('GM-PK1-2-v1.0.pdf')), 'OK');
select pg_temp.expect_as('download: anon não executa', 'anon', format($q$select * from public.resolve_download(%L, %L)$q$, pg_temp.uid('da'), pg_temp.fid('GM-PK1-2-v1.0.pdf')), '42501');
select pg_temp.expect_as('download: authenticated não executa', 'authenticated', format($q$select * from public.resolve_download(%L, %L)$q$, pg_temp.uid('da'), pg_temp.fid('GM-PK1-2-v1.0.pdf')), '42501');

-- download_events: sem IP, sem agente, sem e-mail; só inserção
select pg_temp.assert('download_events: só id, user_id, file_id, kind e created_at (sem IP, agente nem e-mail)',
  (select array_agg(column_name::text order by column_name) = array['created_at', 'file_id', 'id', 'kind', 'user_id']
   from information_schema.columns where table_schema = 'public' and table_name = 'download_events'));
select pg_temp.expect('download_events: só inserção (UPDATE)', $q$update public.download_events set kind = 'free'$q$, 'KT008');
select pg_temp.expect('download_events: só inserção (DELETE)', $q$delete from public.download_events$q$, 'KT008');

-- a chave do B2 não vaza por nenhuma outra RPC
select pg_temp.assert('chave do B2: get_library, get_account e get_catalog não trazem bucket nem chave',
  (select (public.get_library(pg_temp.uid('da'))::text || public.get_account(pg_temp.uid('da'))::text || public.get_catalog()::text) !~ '(object_key|bucket|paid/GM)'));

-- ===== T101 resolve_delivery ========================================================================
select pg_temp.assert('entrega: direito ativo e jogo da fotografia = ok, com a versão VIGENTE (1.1) e o tamanho',
  (select outcome = 'ok' and filename = 'GM-PK1-1-v1.1.pdf' and object_key = 'paid/GM-PK1-1/1.1/GM-PK1-1-v1.1.pdf' and bucket = 'bucket-pgtap-teste'
          and content_type = 'application/pdf' and size_bytes = 2000
   from public.resolve_delivery(pg_temp.fxv('ent_da')::uuid, pg_temp.fxv('g_pk1-1')::bigint)));
do $c$ begin insert into fx values ('ev_deliv', pg_temp.events()::text); end $c$;
select pg_temp.assert('entrega: o clique de agora grava download_events pago com o usuário do DIREITO',
  (select outcome = 'ok' from public.resolve_delivery(pg_temp.fxv('ent_da')::uuid, pg_temp.fxv('g_pk1-1')::bigint)));
select pg_temp.assert('entrega: ... exatamente 1 evento a mais, do dono do direito e do arquivo vigente',
  pg_temp.events() = pg_temp.fxv('ev_deliv')::bigint + 1
  and (select kind = 'paid' and user_id = pg_temp.uid('da') and file_id = pg_temp.fid('GM-PK1-1-v1.1.pdf') from public.download_events order by id desc limit 1));
select pg_temp.assert('entrega: jogo fora da fotografia do direito = not_found, sem localização',
  (select outcome = 'not_found' and object_key is null and bucket is null from public.resolve_delivery(pg_temp.fxv('ent_da')::uuid, pg_temp.fxv('g_sg1-1')::bigint)));
select pg_temp.assert('entrega: direito inexistente = not_found', (select outcome = 'not_found' from public.resolve_delivery(gen_random_uuid(), pg_temp.fxv('g_pk1-1')::bigint)));
select pg_temp.assert('entrega: jogo inexistente = not_found', (select outcome = 'not_found' from public.resolve_delivery(pg_temp.fxv('ent_da')::uuid, -1)));
select pg_temp.assert('entrega: direito revogado por reembolso = revoked, sem localização',
  (select outcome = 'revoked' and object_key is null from public.resolve_delivery(pg_temp.fxv('ent_dc')::uuid, pg_temp.fxv('g_pk1-2')::bigint)));
select pg_temp.assert('entrega: direito revogado por contestação = revoked (o link de pedido contestado não baixa)',
  (select outcome = 'revoked' and object_key is null from public.resolve_delivery(pg_temp.fxv('ent_dd')::uuid, pg_temp.fxv('g_pk1-2')::bigint)));
select pg_temp.assert('entrega: jogo sem PDF pago publicado = unavailable (direito ativo)',
  (select outcome = 'unavailable' and object_key is null from public.resolve_delivery(pg_temp.fxv('ent_da')::uuid, pg_temp.fxv('g_pk1-3')::bigint)));
select pg_temp.assert('entrega: not_found vem antes de revoked (jogo fora da fotografia de direito revogado)',
  (select outcome = 'not_found' from public.resolve_delivery(pg_temp.fxv('ent_dc')::uuid, pg_temp.fxv('g_sg1-1')::bigint)));
select pg_temp.assert('entrega: as recusas não gravaram evento (só o clique ok de antes)', pg_temp.events() = pg_temp.fxv('ev_deliv')::bigint + 1);
select pg_temp.expect('entrega: direito nulo', format($q$select * from public.resolve_delivery(null, %L)$q$, pg_temp.fxv('g_pk1-1')::bigint), 'KT001');
select pg_temp.expect('entrega: jogo nulo', format($q$select * from public.resolve_delivery(%L, null)$q$, pg_temp.fxv('ent_da')::uuid), 'KT001');
select pg_temp.expect_as('entrega: service_role executa', 'service_role', format($q$select * from public.resolve_delivery(%L, %s)$q$, pg_temp.fxv('ent_da')::uuid, pg_temp.fxv('g_pk1-1')), 'OK');
select pg_temp.expect_as('entrega: anon não executa', 'anon', format($q$select * from public.resolve_delivery(%L, %s)$q$, pg_temp.fxv('ent_da')::uuid, pg_temp.fxv('g_pk1-1')), '42501');
select pg_temp.expect_as('entrega: authenticated não executa', 'authenticated', format($q$select * from public.resolve_delivery(%L, %s)$q$, pg_temp.fxv('ent_da')::uuid, pg_temp.fxv('g_pk1-1')), '42501');

-- ===== T102 jogo gratuito ============================================================================
select pg_temp.assert('grátis: sem jogo publicado, available = false (e nada mais)', public.get_free_game() = '{"available": false}'::jsonb);
update public.games set status = 'published' where code = 'FG-1';
select pg_temp.assert('grátis: jogo publicado mas arquivo em rascunho = available false', public.get_free_game() = '{"available": false}'::jsonb);
update public.games set status = 'draft' where code = 'FG-1';
update public.files set status = 'published' where filename = 'FG-1-v0.1.pdf';
select pg_temp.assert('grátis: arquivo publicado mas jogo em rascunho = available false', public.get_free_game() = '{"available": false}'::jsonb);
select pg_temp.assert('grátis: resolve_free_download não serve arquivo publicado de jogo em rascunho (not_found)',
  (select outcome = 'not_found' and object_key is null from public.resolve_free_download(pg_temp.fid('FG-1-v0.1.pdf'))));
update public.games set status = 'published' where code = 'FG-1';
select pg_temp.assert('grátis: jogo e arquivo publicados = available true, com jogo e arquivo',
  (select (j->>'available')::boolean and j->'game' = '{"code": "FG-1", "name": "Jogo gratuito [TESTE]"}'::jsonb
          and (j->'file'->>'id')::uuid = pg_temp.fid('FG-1-v0.1.pdf') and j->'file'->>'version' = '0.1' and (j->'file'->>'size_bytes')::int = 2000
          and j->'file'->>'filename' = 'FG-1-v0.1.pdf'
   from (select public.get_free_game() j) s));
select pg_temp.assert('grátis: get_free_game não traz bucket nem chave', public.get_free_game()::text !~ '(object_key|bucket|free/FG)');
select pg_temp.assert('grátis: resolve_free_download ok (sem login), com localização, tipo e tamanho',
  (select outcome = 'ok' and bucket = 'bucket-pgtap-teste' and object_key = 'free/FG-1/0.1/FG-1-v0.1.pdf' and filename = 'FG-1-v0.1.pdf'
          and content_type = 'application/pdf' and size_bytes = 2000 from public.resolve_free_download(pg_temp.fid('FG-1-v0.1.pdf'))));
select pg_temp.assert('grátis: o evento é free, SEM usuário (e sem e-mail, IP ou contato)',
  (select count(*) = 1 and bool_and(kind = 'free' and user_id is null) from public.download_events where kind = 'free' and file_id = pg_temp.fid('FG-1-v0.1.pdf')));
select pg_temp.assert('grátis: arquivo PAGO pelo id = not_found, sem localização', (select outcome = 'not_found' and object_key is null from public.resolve_free_download(pg_temp.fid('GM-PK1-2-v1.0.pdf'))));
select pg_temp.assert('grátis: id inexistente = not_found', (select outcome = 'not_found' from public.resolve_free_download(gen_random_uuid())));
select pg_temp.assert('grátis: as recusas não gravam evento', (select count(*) = 1 from public.download_events where kind = 'free'));
select pg_temp.expect('grátis: id nulo', $q$select * from public.resolve_free_download(null)$q$, 'KT001');
select pg_temp.expect_as('grátis: service_role executa', 'service_role', $q$select public.get_free_game()$q$, 'OK');
select pg_temp.expect_as('grátis: anon não executa get_free_game', 'anon', $q$select public.get_free_game()$q$, '42501');
select pg_temp.expect_as('grátis: authenticated não executa resolve_free_download', 'authenticated', format($q$select * from public.resolve_free_download(%L)$q$, pg_temp.fid('FG-1-v0.1.pdf')), '42501');
update public.games set status = 'draft' where code = 'FG-1';
select pg_temp.assert('grátis: voltando o jogo a rascunho, available = false de novo', public.get_free_game() = '{"available": false}'::jsonb);

select * from finish();
rollback;
