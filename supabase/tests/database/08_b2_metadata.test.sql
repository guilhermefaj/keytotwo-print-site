-- 08_b2_metadata: metadados do B2 sem URL (docs/data-contract.md v0.3.3, seção 7). A chave do B2 nunca sai do banco.
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

do $fx$
declare v_gid bigint; v_fid uuid;
begin
  perform pg_temp.mk_product('PK1', 'bundle', 2);
  insert into public.games (code, slug, name, access, status) values ('PG-FREE', 'pg-free', 'Grátis [TESTE]', 'free', 'draft') returning id into v_gid;
  insert into public.files (game_id, kind, access, version, filename, size_bytes, sha256)
  values (v_gid, 'pdf', 'free', '0.1', 'PG-FREE-v0.1.pdf', 1024, repeat('0', 64)) returning id into v_fid;
  -- um rascunho pago sem objeto ainda
  select id into v_gid from public.games where code = 'GM-PK1-1';
  insert into public.files (game_id, kind, access, version, filename, size_bytes, sha256)
  values (v_gid, 'pdf', 'paid', '2.0', 'GM-PK1-1-v2.0.pdf', 2048, repeat('2', 64));
end $fx$;

-- ===== chave do objeto: lista branca, sem URL, prefixo = acesso ====================================
select pg_temp.expect('object_key: URL', $q$insert into public.file_objects (file_id,access,bucket,object_key) select id,access,'bucket-pgtap-teste','https://x/y.pdf' from public.files where filename='PG-FREE-v0.1.pdf'$q$, '23514');
select pg_temp.expect('object_key: ..', $q$insert into public.file_objects (file_id,access,bucket,object_key) select id,access,'bucket-pgtap-teste','free/a/../b.pdf' from public.files where filename='PG-FREE-v0.1.pdf'$q$, '23514');
select pg_temp.expect('object_key: barra inicial', $q$insert into public.file_objects (file_id,access,bucket,object_key) select id,access,'bucket-pgtap-teste','/free/a.pdf' from public.files where filename='PG-FREE-v0.1.pdf'$q$, '23514');
select pg_temp.expect('object_key: espaço', $q$insert into public.file_objects (file_id,access,bucket,object_key) select id,access,'bucket-pgtap-teste','free/a b.pdf' from public.files where filename='PG-FREE-v0.1.pdf'$q$, '23514');
select pg_temp.expect('object_key: querystring (URL assinada)', $q$insert into public.file_objects (file_id,access,bucket,object_key) select id,access,'bucket-pgtap-teste','free/a.pdf?X-Amz-Signature=1' from public.files where filename='PG-FREE-v0.1.pdf'$q$, '23514');
select pg_temp.expect('object_key: dois-pontos (esquema)', $q$insert into public.file_objects (file_id,access,bucket,object_key) select id,access,'bucket-pgtap-teste','free/s3:bucket/a.pdf' from public.files where filename='PG-FREE-v0.1.pdf'$q$, '23514');
select pg_temp.expect('object_key: prefixo diferente de access (pago em arquivo grátis)', $q$insert into public.file_objects (file_id,access,bucket,object_key) select id,access,'bucket-pgtap-teste','paid/a.pdf' from public.files where filename='PG-FREE-v0.1.pdf'$q$, '23514');
select pg_temp.expect('object_key: sem prefixo', $q$insert into public.file_objects (file_id,access,bucket,object_key) select id,access,'bucket-pgtap-teste','a.pdf' from public.files where filename='PG-FREE-v0.1.pdf'$q$, '23514');
select pg_temp.expect('bucket: nome curto', $q$insert into public.file_objects (file_id,access,bucket,object_key) select id,access,'ab','free/a.pdf' from public.files where filename='PG-FREE-v0.1.pdf'$q$, '23514');
select pg_temp.expect('file_objects: access diferente do arquivo (FK composta)', $q$insert into public.file_objects (file_id,access,bucket,object_key) select id,'paid','bucket-pgtap-teste','paid/zzz/1.0/z.pdf' from public.files where filename='PG-FREE-v0.1.pdf'$q$, '23503');
select pg_temp.expect('file_objects: chave válida do arquivo grátis passa', $q$insert into public.file_objects (file_id,access,bucket,object_key) select id,access,'bucket-pgtap-teste','free/PG-FREE/0.1/PG-FREE-v0.1.pdf' from public.files where filename='PG-FREE-v0.1.pdf'$q$, 'OK');
select pg_temp.expect('file_objects: (bucket, object_key) único', $q$insert into public.file_objects (file_id,access,bucket,object_key) select id,access,'bucket-pgtap-teste','paid/GM-PK1-1/1.0/GM-PK1-1-v1.0.pdf' from public.files where filename='GM-PK1-1-v2.0.pdf'$q$, '23505');
select pg_temp.expect('file_objects: o mesmo arquivo não tem dois objetos', $q$insert into public.file_objects (file_id,access,bucket,object_key) select id,access,'bucket-pgtap-teste','free/outra-chave.pdf' from public.files where filename='PG-FREE-v0.1.pdf'$q$, '23505');

-- ===== metadados do arquivo ========================================================================
select pg_temp.expect('files: sha256 curto', $q$insert into public.files (game_id,kind,access,version,filename,size_bytes,sha256) select id,'pdf','paid','3.0','a-v3.0.pdf',10,'abc' from public.games where code='GM-PK1-1'$q$, '23514');
select pg_temp.expect('files: sha256 em maiúsculas', $q$insert into public.files (game_id,kind,access,version,filename,size_bytes,sha256) select id,'pdf','paid','3.0','a-v3.0.pdf',10,repeat('A',64) from public.games where code='GM-PK1-1'$q$, '23514');
select pg_temp.expect('files: tamanho zero', $q$insert into public.files (game_id,kind,access,version,filename,size_bytes,sha256) select id,'pdf','paid','3.0','a-v3.0.pdf',0,repeat('a',64) from public.games where code='GM-PK1-1'$q$, '23514');
select pg_temp.expect('files: nome com barra', $q$insert into public.files (game_id,kind,access,version,filename,size_bytes,sha256) select id,'pdf','paid','3.0','a/b.pdf',10,repeat('a',64) from public.games where code='GM-PK1-1'$q$, '23514');
select pg_temp.expect('files: extensão diferente do tipo', $q$insert into public.files (game_id,kind,access,version,filename,size_bytes,sha256) select id,'pdf','paid','3.0','a-v3.0.zip',10,repeat('a',64) from public.games where code='GM-PK1-1'$q$, '23514');
select pg_temp.expect('files: versão inválida', $q$insert into public.files (game_id,kind,access,version,filename,size_bytes,sha256) select id,'pdf','paid','v3','a-v3.pdf',10,repeat('a',64) from public.games where code='GM-PK1-1'$q$, '23514');
select pg_temp.expect('files: dono duplo (jogo e produto)', $q$insert into public.files (game_id,product_id,kind,access,version,filename,size_bytes,sha256) select g.id,p.id,'zip','paid','1.0','d.zip',10,repeat('a',64) from public.games g, public.products p where g.code='GM-PK1-1' and p.code='PK1'$q$, '23514');
select pg_temp.expect('files: sem dono', $q$insert into public.files (kind,access,version,filename,size_bytes,sha256) values ('zip','paid','1.0','d.zip',10,repeat('a',64))$q$, '23514');
select pg_temp.expect('files: ZIP de produto grátis', $q$insert into public.files (product_id,kind,access,version,filename,size_bytes,sha256) select id,'zip','free','1.0','e.zip',10,repeat('a',64) from public.products where code='PK1'$q$, '23514');
select pg_temp.expect('files: published sem published_at (inserção direta)', $q$insert into public.files (game_id,kind,access,version,filename,size_bytes,sha256,status) select id,'pdf','paid','5.0','f-v5.0.pdf',10,repeat('a',64),'published' from public.games where code='GM-PK1-2'$q$, '23514');
select pg_temp.expect('files: arquivo grátis em jogo pago (FK composta)', $q$insert into public.files (game_id,kind,access,version,filename,size_bytes,sha256) select id,'pdf','free','0.1','x-v0.1.pdf',10,repeat('a',64) from public.games where code='GM-PK1-1'$q$, '23503');
select pg_temp.expect('files: a mesma versão não se repete', $q$insert into public.files (game_id,kind,access,version,filename,size_bytes,sha256) select id,'pdf','paid','1.0','outro-v1.0.pdf',10,repeat('a',64) from public.games where code='GM-PK1-1'$q$, '23505');
select pg_temp.expect('files: ZIP do pacote em rascunho passa', $q$insert into public.files (product_id,kind,access,version,filename,size_bytes,sha256) select id,'zip','paid','1.0','PK1-v1.0.zip',10,repeat('0',64) from public.products where code='PK1'$q$, 'OK');

-- ===== um publicado por (jogo, tipo, acesso); publicar novo exige aposentar o anterior ==============
select pg_temp.expect('publicar o novo sem aposentar o anterior', $q$update public.files set status='published' where filename='GM-PK1-1-v2.0.pdf'$q$, '23505');
select pg_temp.expect('sequência aposentar → publicar na mesma transação passa', $q$update public.files set status='retired' where filename='GM-PK1-1-v1.0.pdf'; update public.files set status='published' where filename='GM-PK1-1-v2.0.pdf'$q$, 'OK');
select pg_temp.assert('exatamente um publicado por jogo e tipo', (select count(*) = 1 from public.files where game_id = (select id from public.games where code='GM-PK1-1') and kind='pdf' and access='paid' and status='published'));
select pg_temp.expect('um segundo jogo grátis publicado não existe', $q$update public.games set status='published' where code='PG-FREE'; insert into public.games (code,slug,name,access,status) values ('PG-FREE2','pg-free2','Outro grátis [TESTE]','free','published')$q$, '23505');

-- ===== bucket e chave imutáveis depois de draft ======================================================
select pg_temp.expect('rascunho: a chave ainda pode mudar', $q$update public.file_objects set object_key = 'free/PG-FREE/0.1/novo.pdf' where file_id = (select id from public.files where filename='PG-FREE-v0.1.pdf')$q$, 'OK');
select pg_temp.expect('aposentado: o bucket não muda', $q$update public.file_objects set bucket = 'outro-bucket-pgtap' where file_id = (select id from public.files where filename='GM-PK1-1-v1.0.pdf')$q$, 'KT010');
select pg_temp.expect('aposentado: a chave não muda', $q$update public.file_objects set object_key = 'paid/GM-PK1-1/1.0/mudou.pdf' where file_id = (select id from public.files where filename='GM-PK1-1-v1.0.pdf')$q$, 'KT010');
select pg_temp.expect('aposentado: o objeto não se apaga', $q$delete from public.file_objects where file_id = (select id from public.files where filename='GM-PK1-1-v1.0.pdf')$q$, 'KT010');
select pg_temp.expect('rascunho com objeto: apagar o arquivo leva o objeto em cascata', $q$delete from public.files where filename='PG-FREE-v0.1.pdf'$q$, 'OK');
select pg_temp.assert('o objeto do rascunho apagado sumiu', (select count(*) = 0 from public.file_objects where object_key like 'free/PG-FREE/%'));

-- ===== a chave do B2 não aparece em nenhuma saída da API ===========================================
select pg_temp.assert('get_catalog não traz chave do B2', (select public.get_catalog()::text !~ '(object_key|bucket|paid/|free/)'));

select * from finish();
rollback;
