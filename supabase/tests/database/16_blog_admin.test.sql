-- 16_blog_admin: posts do blog no banco, RPCs do admin e do site, e o histórico do admin (migração 20261023120000).
-- Roda com `supabase test db` (pgTAP). Dados de teste só existem dentro da transação (rollback no fim).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp): supabase/tests/database/helpers ===========
\ir helpers/base.psql

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
          jsonb_build_object('provider', 'email', 'admin', p_admin), '{}');
  insert into pg_temp.ids values (p_name, v_id);
  return v_id;
end $$;

-- Um post a partir do básico; os campos de p_extra substituem os padrões.
create function pg_temp.post(p_slug text, p_status text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('slug', p_slug, 'title', 'Título ' || p_slug, 'description', 'Resumo', 'author', 'Equipe KeyToTwo',
                            'date', '2026-10-23', 'cover', null, 'cover_alt', '', 'tags', jsonb_build_array('Jogos'),
                            'body', 'Texto do post.', 'status', p_status) || p_extra
$$;

create temp table saved (name text primary key, outcome text, post jsonb);
create function pg_temp.save(p_name text, p_user text, p_id uuid, p_post jsonb, p_expected timestamptz) returns text
language plpgsql as $$
declare r record;
begin
  select * into r from public.admin_save_blog_post(pg_temp.uid(p_user), p_id, p_post, p_expected);
  insert into pg_temp.saved values (p_name, r.outcome, r.post) on conflict (name) do update set outcome = excluded.outcome, post = excluded.post;
  return r.outcome;
end $$;
create function pg_temp.saved_id(p_name text) returns uuid language sql as $$ select (post->>'id')::uuid from pg_temp.saved where name = p_name $$;
create function pg_temp.saved_at(p_name text) returns timestamptz language sql as $$ select (post->>'updated_at')::timestamptz from pg_temp.saved where name = p_name $$;

do $fx$ begin
  perform pg_temp.mk_user('adm', true);
  perform pg_temp.mk_user('comum', false);
  perform pg_temp.mk_user('naoconf', true, false);
end $fx$;

create temp table base (version text);
insert into pg_temp.base select public.get_blog_version();

-- ===== criar rascunho ================================================================================
select pg_temp.assert('rascunho só com título e endereço: ok',
  pg_temp.save('rasc', 'adm', null, pg_temp.post('rascunho-pgtap', 'draft', '{"description": "", "author": "", "body": ""}'), null) = 'ok');
select pg_temp.assert('rascunho: status draft e sem published_at',
  (select post->>'status' = 'draft' and post->'published_at' = 'null'::jsonb and post->>'body' = '' from pg_temp.saved where name = 'rasc'));
select pg_temp.assert('rascunho não muda a versão do site', public.get_blog_version() = (select version from pg_temp.base));
select pg_temp.assert('criação registrada no histórico',
  exists (select 1 from private.admin_events e where e.action = 'blog_create' and e.target_id = pg_temp.saved_id('rasc') and e.user_id = pg_temp.uid('adm')));

-- ===== publicar ======================================================================================
select pg_temp.expect('publicar sem resumo: o banco recusa (a API confere antes)',
  format($q$select * from public.admin_save_blog_post(%L, %L, %L, %L)$q$, pg_temp.uid('adm'), pg_temp.saved_id('rasc'),
         pg_temp.post('rascunho-pgtap', 'published', '{"description": ""}'), pg_temp.saved_at('rasc')), '23514');
select pg_temp.assert('publicar completo: ok',
  pg_temp.save('pub', 'adm', pg_temp.saved_id('rasc'), pg_temp.post('rascunho-pgtap', 'published'), pg_temp.saved_at('rasc')) = 'ok');
select pg_temp.assert('publicado: published_at preenchido e updated_at novo',
  (select post->>'status' = 'published' and post->>'published_at' is not null and (post->>'updated_at')::timestamptz > pg_temp.saved_at('rasc')
     from pg_temp.saved where name = 'pub'));
select pg_temp.assert('publicação registrada como blog_publish',
  exists (select 1 from private.admin_events e where e.action = 'blog_publish' and e.target_id = pg_temp.saved_id('pub')));
select pg_temp.assert('a versão do site muda ao publicar', public.get_blog_version() <> (select version from pg_temp.base));
select pg_temp.assert('o site recebe o publicado com o texto',
  (select (r->'posts') @> jsonb_build_array(jsonb_build_object('slug', 'rascunho-pgtap', 'body', 'Texto do post.', 'author', 'Equipe KeyToTwo'))
          and r->>'version' = public.get_blog_version()
     from public.list_published_blog_posts() r));

-- ===== edição concorrente, endereço fixo e repetido ====================================================
-- Cada gravação num comando e a conferência no seguinte: o mesmo comando não enxerga o que a função gravou.
select pg_temp.assert('salvar com a versão antiga: conflict',
  pg_temp.save('velho', 'adm', pg_temp.saved_id('pub'), pg_temp.post('rascunho-pgtap', 'published', '{"title": "Outro"}'), pg_temp.saved_at('rasc')) = 'conflict');
select pg_temp.assert('conflict devolve o post atual, sem gravar',
  (select post->>'title' = 'Título rascunho-pgtap' and (post->>'updated_at')::timestamptz = pg_temp.saved_at('pub') from pg_temp.saved where name = 'velho'));
select pg_temp.assert('mudar o endereço depois de publicado: slug_locked',
  pg_temp.save('slug', 'adm', pg_temp.saved_id('pub'), pg_temp.post('outro-endereco', 'published'), pg_temp.saved_at('pub')) = 'slug_locked');
select pg_temp.assert('endereço de outro post: slug_taken',
  pg_temp.save('dup', 'adm', null, pg_temp.post('rascunho-pgtap', 'draft'), null) = 'slug_taken');
create temp table published_version as select public.get_blog_version() as version;
select pg_temp.assert('editar publicado: ok',
  pg_temp.save('edit', 'adm', pg_temp.saved_id('pub'), pg_temp.post('rascunho-pgtap', 'published', '{"title": "Novo título", "tags": ["A", "B"]}'), pg_temp.saved_at('pub')) = 'ok');
select pg_temp.assert('editar publicado: grava os campos e muda a versão',
  (select post->'tags' = '["A", "B"]'::jsonb and post->>'title' = 'Novo título' from pg_temp.saved where name = 'edit')
  and public.get_blog_version() <> (select version from pg_temp.published_version));
select pg_temp.expect('capa sem descrição: o banco recusa',
  format($q$select * from public.admin_save_blog_post(%L, null, %L, null)$q$, pg_temp.uid('adm'),
         pg_temp.post('com-capa', 'draft', '{"cover": "/images/blog/2026/10/capa.webp", "cover_alt": ""}')), '23514');
select pg_temp.expect('capa fora de /images/blog: o banco recusa',
  format($q$select * from public.admin_save_blog_post(%L, null, %L, null)$q$, pg_temp.uid('adm'),
         pg_temp.post('capa-fora', 'draft', '{"cover": "https://exemplo.test/capa.webp", "cover_alt": "Capa"}')), '23514');
select pg_temp.expect('editar sem a versão esperada: KT001',
  format($q$select * from public.admin_save_blog_post(%L, %L, %L, null)$q$, pg_temp.uid('adm'), pg_temp.saved_id('pub'), pg_temp.post('rascunho-pgtap', 'draft')), 'KT001');

-- ===== despublicar, abrir, listar e excluir ===============================================================
select pg_temp.assert('voltar para rascunho: ok',
  pg_temp.save('despub', 'adm', pg_temp.saved_id('pub'), pg_temp.post('rascunho-pgtap', 'draft'), pg_temp.saved_at('edit')) = 'ok');
select pg_temp.assert('voltar para rascunho: blog_unpublish e versão de antes',
  exists (select 1 from private.admin_events e where e.action = 'blog_unpublish' and e.target_id = pg_temp.saved_id('pub'))
  and public.get_blog_version() = (select version from pg_temp.base));
select pg_temp.assert('despublicado mantém o published_at (o endereço continua fixo)',
  (select post->>'published_at' is not null from pg_temp.saved where name = 'despub'));
select pg_temp.assert('abrir: ok com o texto',
  (select outcome = 'ok' and post->>'body' = 'Texto do post.' from public.admin_get_blog_post(pg_temp.uid('adm'), pg_temp.saved_id('pub'))));
select pg_temp.assert('abrir id inexistente: not_found',
  (select outcome = 'not_found' and post is null from public.admin_get_blog_post(pg_temp.uid('adm'), gen_random_uuid())));
select pg_temp.assert('listar: ok, com a versão e sem o texto',
  (select outcome = 'ok' and result->>'version' = public.get_blog_version()
          and exists (select 1 from jsonb_array_elements(result->'posts') p where p->>'slug' = 'rascunho-pgtap' and not p ? 'body')
     from public.admin_list_blog_posts(pg_temp.uid('adm'))));
select pg_temp.assert('excluir: ok',
  (select outcome = 'ok' from public.admin_delete_blog_post(pg_temp.uid('adm'), pg_temp.saved_id('pub'))));
select pg_temp.assert('exclusão registrada no histórico, sem o post',
  not exists (select 1 from private.blog_posts where id = pg_temp.saved_id('pub'))
  and exists (select 1 from private.admin_events e where e.action = 'blog_delete' and e.details->>'slug' = 'rascunho-pgtap'));
select pg_temp.assert('excluir de novo: not_found',
  (select outcome = 'not_found' from public.admin_delete_blog_post(pg_temp.uid('adm'), pg_temp.saved_id('pub'))));

-- ===== imagens ============================================================================================
select pg_temp.assert('imagem: admin recebe ok',
  (select outcome = 'ok' from public.admin_register_blog_image(pg_temp.uid('adm'), '/images/blog/2026/10/ab12cd-capa.webp')));
select pg_temp.assert('imagem registrada no histórico com o caminho',
  exists (select 1 from private.admin_events e where e.action = 'blog_image' and e.details->>'path' = '/images/blog/2026/10/ab12cd-capa.webp'));
select pg_temp.assert('imagem: quem não é admin recebe forbidden e nada é registrado',
  (select outcome = 'forbidden' from public.admin_register_blog_image(pg_temp.uid('comum'), '/images/blog/2026/10/x.webp')));
select pg_temp.assert('imagem recusada não entra no histórico',
  not exists (select 1 from private.admin_events e where e.details->>'path' = '/images/blog/2026/10/x.webp'));
select pg_temp.expect('imagem fora de /images/blog: KT001',
  format($q$select * from public.admin_register_blog_image(%L, '/images/blog/../segredo.webp')$q$, pg_temp.uid('adm')), 'KT001');

-- ===== campos do Google (migração 20261023230000) =========================================================
select pg_temp.assert('campos do Google: gravam com o post',
  pg_temp.save('seo', 'adm', null, pg_temp.post('com-seo', 'draft', '{"seo_title": "Título curto", "seo_description": "Descrição para o Google"}'), null) = 'ok');
select pg_temp.assert('campos do Google voltam no JSON do post e ficam na tabela',
  (select post->>'seo_title' = 'Título curto' and post->>'seo_description' = 'Descrição para o Google' from pg_temp.saved where name = 'seo')
  and exists (select 1 from private.blog_posts b where b.slug = 'com-seo' and b.seo_title = 'Título curto' and b.seo_description = 'Descrição para o Google'));
select pg_temp.assert('sem os campos do Google, ficam vazios', (select post->>'seo_title' = '' and post->>'seo_description' = '' from pg_temp.saved where name = 'rasc'));
select pg_temp.expect('título do Google com mais de 80 caracteres: 23514',
  $q$update private.blog_posts set seo_title = repeat('x', 81) where slug = 'com-seo'$q$, '23514');

-- ===== galeria e apagar imagens (migrações 20261023160000 e 20261023180000) ===============================
select pg_temp.assert('galeria: rascunho com a capa repetida no texto e outra imagem',
  pg_temp.save('img', 'adm', null, pg_temp.post('com-imagens', 'draft', jsonb_build_object(
    'cover', '/images/blog/2026/10/aa11bb22-capa.webp', 'cover_alt', 'Capa',
    'body', E'Texto.\n\n![Mesa](/images/blog/2026/10/cc33dd44-mesa.webp)\n\n![Capa de novo](/images/blog/2026/10/aa11bb22-capa.webp "Título")')), null) = 'ok');
select pg_temp.assert('galeria: admin recebe onde cada imagem é usada, uma vez por post',
  (select outcome = 'ok'
          and usage -> '/images/blog/2026/10/aa11bb22-capa.webp' = jsonb_build_array(jsonb_build_object('id', pg_temp.saved_id('img'), 'title', 'Título com-imagens', 'status', 'draft'))
          and usage -> '/images/blog/2026/10/cc33dd44-mesa.webp' -> 0 ->> 'title' = 'Título com-imagens'
          and not usage ? '/images/blog/2026/10/livre.webp'
   from public.admin_blog_image_usage(pg_temp.uid('adm'))));
select pg_temp.assert('galeria: quem não é admin recebe forbidden, sem o uso',
  (select outcome = 'forbidden' and usage is null from public.admin_blog_image_usage(pg_temp.uid('comum'))));
select pg_temp.expect('galeria sem pessoa: KT001', $q$select * from public.admin_blog_image_usage(null)$q$, 'KT001');
select pg_temp.expect('galeria: admin sem e-mail confirmado: KT009',
  format($q$select * from public.admin_blog_image_usage(%L)$q$, pg_temp.uid('naoconf')), 'KT009');

select pg_temp.assert('apagar imagem usada num rascunho: in_use com o post',
  (select outcome = 'in_use' and used_by -> 0 ->> 'id' = pg_temp.saved_id('img')::text
   from public.admin_delete_blog_image(pg_temp.uid('adm'), '/images/blog/2026/10/cc33dd44-mesa.webp')));
select pg_temp.assert('imagem em uso não entra no histórico',
  not exists (select 1 from private.admin_events e where e.action = 'blog_image_delete'));
select pg_temp.assert('apagar imagem que nenhum post usa: ok',
  (select outcome = 'ok' and used_by is null from public.admin_delete_blog_image(pg_temp.uid('adm'), '/images/blog/2026/10/livre.webp')));
select pg_temp.assert('imagem apagada fica no histórico, com quem apagou',
  exists (select 1 from private.admin_events e where e.action = 'blog_image_delete' and e.details->>'path' = '/images/blog/2026/10/livre.webp' and e.user_id = pg_temp.uid('adm')));
select pg_temp.assert('apagar imagem: quem não é admin recebe forbidden',
  (select outcome = 'forbidden' from public.admin_delete_blog_image(pg_temp.uid('comum'), '/images/blog/2026/10/outra.webp')));
select pg_temp.assert('recusada não entra no histórico',
  not exists (select 1 from private.admin_events e where e.details->>'path' = '/images/blog/2026/10/outra.webp'));
select pg_temp.expect('apagar imagem fora de /images/blog: KT001',
  format($q$select * from public.admin_delete_blog_image(%L, '/images/blog/../segredo.webp')$q$, pg_temp.uid('adm')), 'KT001');
select pg_temp.expect('apagar imagem: admin sem e-mail confirmado: KT009',
  format($q$select * from public.admin_delete_blog_image(%L, '/images/blog/2026/10/x.webp')$q$, pg_temp.uid('naoconf')), 'KT009');

-- ===== quem não é admin ===================================================================================
select pg_temp.assert('não admin: forbidden em listar, abrir, salvar e excluir',
  (select outcome = 'forbidden' and result is null from public.admin_list_blog_posts(pg_temp.uid('comum')))
  and (select outcome = 'forbidden' from public.admin_get_blog_post(pg_temp.uid('comum'), gen_random_uuid()))
  and pg_temp.save('comum', 'comum', null, pg_temp.post('post-comum', 'draft'), null) = 'forbidden'
  and (select outcome = 'forbidden' from public.admin_delete_blog_post(pg_temp.uid('comum'), gen_random_uuid())));
select pg_temp.assert('não admin não grava nada', not exists (select 1 from private.blog_posts where slug = 'post-comum'));
select pg_temp.expect('admin sem e-mail confirmado: KT009',
  format($q$select * from public.admin_list_blog_posts(%L)$q$, pg_temp.uid('naoconf')), 'KT009');

-- ===== privilégios ========================================================================================
select pg_temp.assert('tabelas em private, sem privilégio para os papéis da API',
  not has_table_privilege('anon', 'private.blog_posts', 'SELECT') and not has_table_privilege('authenticated', 'private.blog_posts', 'SELECT')
  and not has_table_privilege('service_role', 'private.blog_posts', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('service_role', 'private.admin_events', 'SELECT,INSERT,UPDATE,DELETE'));
select pg_temp.expect_as('anon não executa list_published_blog_posts', 'anon', $q$select public.list_published_blog_posts()$q$, '42501');
select pg_temp.expect_as('authenticated não executa admin_list_blog_posts', 'authenticated', $q$select * from public.admin_list_blog_posts(gen_random_uuid())$q$, '42501');
select pg_temp.expect_as('service_role executa get_blog_version', 'service_role', $q$select public.get_blog_version()$q$, 'OK');

select * from finish();
rollback;
