-- 08_b2_metadata: metadados do B2 sem URL (docs/data-contract.md v0.3.3, seção 7). A chave do B2 nunca sai do banco.
-- Roda com `supabase test db` (pgTAP). Dados de teste só existem dentro da transação (rollback no fim).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp): supabase/tests/database/helpers ===========
\ir helpers/base.psql
\ir helpers/fixtures.psql

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
select pg_temp.expect('files: só PDF (o ZIP do pacote saiu em 2026-10-24)', $q$insert into public.files (game_id,kind,access,version,filename,size_bytes,sha256) select id,'zip','paid','1.0','d.zip',10,repeat('a',64) from public.games where code='GM-PK1-1'$q$, '23514');
select pg_temp.expect('files: sem jogo', $q$insert into public.files (kind,access,version,filename,size_bytes,sha256) values ('pdf','paid','1.0','d.pdf',10,repeat('a',64))$q$, '23502');
select pg_temp.expect('files: published sem published_at (inserção direta)', $q$insert into public.files (game_id,kind,access,version,filename,size_bytes,sha256,status) select id,'pdf','paid','5.0','f-v5.0.pdf',10,repeat('a',64),'published' from public.games where code='GM-PK1-2'$q$, '23514');
select pg_temp.expect('files: arquivo grátis em jogo pago (FK composta)', $q$insert into public.files (game_id,kind,access,version,filename,size_bytes,sha256) select id,'pdf','free','0.1','x-v0.1.pdf',10,repeat('a',64) from public.games where code='GM-PK1-1'$q$, '23503');
select pg_temp.expect('files: a mesma versão não se repete', $q$insert into public.files (game_id,kind,access,version,filename,size_bytes,sha256) select id,'pdf','paid','1.0','outro-v1.0.pdf',10,repeat('a',64) from public.games where code='GM-PK1-1'$q$, '23505');

-- ===== um publicado por (jogo, tipo, acesso); publicar novo exige aposentar o anterior ==============
select pg_temp.expect('publicar o novo sem aposentar o anterior', $q$update public.files set status='published' where filename='GM-PK1-1-v2.0.pdf'$q$, '23505');
select pg_temp.expect('sequência aposentar → publicar na mesma transação passa', $q$update public.files set status='retired' where filename='GM-PK1-1-v1.0.pdf'; update public.files set status='published' where filename='GM-PK1-1-v2.0.pdf'$q$, 'OK');
select pg_temp.assert('exatamente um publicado por jogo e tipo', (select count(*) = 1 from public.files where game_id = (select id from public.games where code='GM-PK1-1') and kind='pdf' and access='paid' and status='published'));
-- Desde a migração dos gratuitos (2026-10-20), vários jogos grátis podem estar publicados ao mesmo tempo.
select pg_temp.expect('dois jogos grátis publicados convivem', $q$update public.games set status='published' where code='PG-FREE'; insert into public.games (code,slug,name,access,status) values ('PG-FREE2','pg-free2','Outro grátis [TESTE]','free','published')$q$, 'OK');

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
