-- Blog no admin (2026-10-23, pedido do responsável): listar, criar e editar posts pelo admin.keytotwo.com.br.
-- Os posts saem dos arquivos do repositório e passam a ficar aqui. O build do site (VPS) lê os publicados pela API
-- e gera as páginas; a VPS confere a versão a cada 2 minutos e reconstrói o site quando ela muda (deploy/blog).
-- Ficam em private: nenhum papel da API enxerga as tabelas; só as RPCs abaixo, com EXECUTE só para service_role.
-- As RPCs de admin conferem o admin no banco (private.is_admin) e registram cada mudança em admin_events.
-- Migração nova: só cria tabelas e funções; nenhum dado é alterado.

-- ===== 1. Posts ==================================================================================
-- Rascunho guarda o que estiver pronto (título e endereço bastam); publicar exige resumo, autor e texto.
-- O endereço (slug) fica fixo depois da primeira publicação: mudar quebraria links e a busca do Google.
create table private.blog_posts (
  id           uuid        primary key default gen_random_uuid(),
  slug         text        not null unique,
  title        text        not null,
  description  text        not null default '',
  author       text        not null default '',
  post_date    date        not null,
  cover        text,
  cover_alt    text        not null default '',
  tags         text[]      not null default '{}',
  body         text        not null default '',
  status       text        not null default 'draft',
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  created_by   uuid        not null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid        not null,
  constraint blog_posts_slug_check        check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  constraint blog_posts_title_check       check (char_length(btrim(title)) between 1 and 120),
  constraint blog_posts_description_check check (char_length(description) <= 300),
  constraint blog_posts_author_check      check (char_length(author) <= 80),
  constraint blog_posts_cover_check       check (cover is null or (cover ~* '^/images/blog/([a-z0-9_-]+/)*[a-z0-9_.-]+\.(avif|webp|png|jpe?g|gif)$' and cover !~ '\.\.')),
  constraint blog_posts_cover_alt_check   check (char_length(cover_alt) <= 300 and (cover is null or btrim(cover_alt) <> '')),
  constraint blog_posts_tags_check        check (cardinality(tags) <= 10),
  constraint blog_posts_body_check        check (char_length(body) <= 100000),
  constraint blog_posts_status_check      check (status in ('draft', 'published')),
  constraint blog_posts_published_check   check (status = 'draft' or (published_at is not null and btrim(description) <> '' and btrim(author) <> '' and btrim(body) <> ''))
);
revoke all on table private.blog_posts from public, anon, authenticated, service_role;

-- ===== 2. Histórico do admin: quem fez o quê, e quando =================================================
create table private.admin_events (
  id         bigint      generated always as identity primary key,
  user_id    uuid        not null,
  action     text        not null,
  target_id  uuid,
  details    jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint admin_events_action_check check (action in ('blog_create', 'blog_update', 'blog_publish', 'blog_unpublish', 'blog_delete', 'blog_image'))
);
create index admin_events_created_at_idx on private.admin_events (created_at desc);
revoke all on table private.admin_events from public, anon, authenticated, service_role;
revoke all on sequence private.admin_events_id_seq from public, anon, authenticated, service_role;

-- ===== 3. Ajudantes ================================================================================
create function private.blog_post_json(p private.blog_posts, p_with_body boolean) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'title', p.title, 'description', p.description, 'author', p.author,
    'date', p.post_date, 'cover', p.cover, 'cover_alt', p.cover_alt, 'tags', to_jsonb(p.tags), 'status', p.status,
    'published_at', p.published_at, 'created_at', p.created_at, 'updated_at', p.updated_at)
    || case when p_with_body then jsonb_build_object('body', p.body) else '{}'::jsonb end
$$;
revoke all on function private.blog_post_json(private.blog_posts, boolean) from public, anon, authenticated, service_role;

-- Versão do que está publicado: muda quando um post entra, sai ou é editado publicado. Rascunho não mexe nela.
create function private.blog_version() returns text
language sql stable set search_path = '' as $$
  select md5(coalesce(string_agg(b.id::text || ':' || b.updated_at::text, ',' order by b.id), ''))
    from private.blog_posts b where b.status = 'published'
$$;
revoke all on function private.blog_version() from public, anon, authenticated, service_role;

-- ===== 4. Site: os publicados (build) e a versão (VPS) ==================================================
create function public.list_published_blog_posts() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'version', private.blog_version(),
    'posts', coalesce((select jsonb_agg(private.blog_post_json(b, true) order by b.post_date desc, b.slug)
                         from private.blog_posts b where b.status = 'published'), '[]'::jsonb))
$$;

create function public.get_blog_version() returns text
language sql stable security definer set search_path = '' as $$
  select private.blog_version()
$$;

-- ===== 5. Admin: listar, abrir, salvar e excluir ==========================================================
create function public.admin_list_blog_posts(p_user_id uuid) returns table (outcome text, result jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_user_id is null then
    raise exception 'admin_list_blog_posts: p_user_id é obrigatório' using errcode = 'KT001';
  end if;
  perform private.require_confirmed_email(p_user_id);
  if not private.is_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  return query select 'ok'::text, jsonb_build_object(
    'version', private.blog_version(),
    'posts', coalesce((select jsonb_agg(private.blog_post_json(b, false) order by b.updated_at desc, b.slug)
                         from private.blog_posts b), '[]'::jsonb));
end $$;

create function public.admin_get_blog_post(p_user_id uuid, p_post_id uuid) returns table (outcome text, post jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_post private.blog_posts%rowtype;
begin
  if p_user_id is null or p_post_id is null then
    raise exception 'admin_get_blog_post: p_user_id e p_post_id são obrigatórios' using errcode = 'KT001';
  end if;
  perform private.require_confirmed_email(p_user_id);
  if not private.is_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  select * into v_post from private.blog_posts b where b.id = p_post_id;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  return query select 'ok'::text, private.blog_post_json(v_post, true);
end $$;

-- p_post_id nulo cria; com id, só grava se p_expected_updated_at ainda for o do banco (outra aba pode ter salvo antes).
-- p_post: { slug, title, description, author, date, cover, cover_alt, tags, body, status } já validado pela API.
-- outcome: ok | forbidden | not_found | conflict (devolve o post atual) | slug_taken | slug_locked.
create function public.admin_save_blog_post(p_user_id uuid, p_post_id uuid, p_post jsonb, p_expected_updated_at timestamptz)
  returns table (outcome text, post jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  v_old    private.blog_posts%rowtype;
  v_row    private.blog_posts%rowtype;
  v_status text := p_post->>'status';
  v_tags   text[];
  v_action text;
begin
  if p_user_id is null or p_post is null or jsonb_typeof(p_post) <> 'object'
     or jsonb_typeof(coalesce(p_post->'tags', '[]'::jsonb)) <> 'array' or v_status not in ('draft', 'published')
     or coalesce(p_post->>'slug', '') = '' or coalesce(p_post->>'title', '') = '' or coalesce(p_post->>'date', '') = ''
     or (p_post_id is not null and p_expected_updated_at is null) then
    raise exception 'admin_save_blog_post: post inválido' using errcode = 'KT001';
  end if;
  perform private.require_confirmed_email(p_user_id);
  if not private.is_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  v_tags := array(select jsonb_array_elements_text(coalesce(p_post->'tags', '[]'::jsonb)));

  if p_post_id is not null then
    select * into v_old from private.blog_posts b where b.id = p_post_id for update;
    if not found then
      return query select 'not_found'::text, null::jsonb;
      return;
    end if;
    if v_old.updated_at <> p_expected_updated_at then
      return query select 'conflict'::text, private.blog_post_json(v_old, true);
      return;
    end if;
    if v_old.published_at is not null and v_old.slug <> p_post->>'slug' then
      return query select 'slug_locked'::text, null::jsonb;
      return;
    end if;
  end if;
  if exists (select 1 from private.blog_posts b where b.slug = p_post->>'slug' and b.id is distinct from p_post_id) then
    return query select 'slug_taken'::text, null::jsonb;
    return;
  end if;

  begin
    if p_post_id is null then
      insert into private.blog_posts (slug, title, description, author, post_date, cover, cover_alt, tags, body, status,
                                      published_at, created_by, updated_by)
      values (p_post->>'slug', p_post->>'title', coalesce(p_post->>'description', ''), coalesce(p_post->>'author', ''),
              (p_post->>'date')::date, nullif(p_post->>'cover', ''), coalesce(p_post->>'cover_alt', ''), v_tags,
              coalesce(p_post->>'body', ''), v_status, case when v_status = 'published' then now() end, p_user_id, p_user_id)
      returning * into v_row;
      v_action := 'blog_create';
    else
      update private.blog_posts b
         set slug = p_post->>'slug', title = p_post->>'title', description = coalesce(p_post->>'description', ''),
             author = coalesce(p_post->>'author', ''), post_date = (p_post->>'date')::date, cover = nullif(p_post->>'cover', ''),
             cover_alt = coalesce(p_post->>'cover_alt', ''), tags = v_tags, body = coalesce(p_post->>'body', ''),
             status = v_status, published_at = coalesce(b.published_at, case when v_status = 'published' then now() end),
             updated_at = clock_timestamp(), updated_by = p_user_id
       where b.id = p_post_id
      returning * into v_row;
      v_action := case when v_old.status = v_row.status then 'blog_update'
                       when v_row.status = 'published' then 'blog_publish' else 'blog_unpublish' end;
    end if;
  exception when unique_violation then
    -- outro salvamento levou o mesmo endereço entre a conferência e a gravação
    return query select 'slug_taken'::text, null::jsonb;
    return;
  end;

  insert into private.admin_events (user_id, action, target_id, details)
  values (p_user_id, v_action, v_row.id, jsonb_build_object('slug', v_row.slug, 'status', v_row.status));
  return query select 'ok'::text, private.blog_post_json(v_row, true);
end $$;

create function public.admin_delete_blog_post(p_user_id uuid, p_post_id uuid) returns table (outcome text)
language plpgsql security definer set search_path = '' as $$
declare
  v_post private.blog_posts%rowtype;
begin
  if p_user_id is null or p_post_id is null then
    raise exception 'admin_delete_blog_post: p_user_id e p_post_id são obrigatórios' using errcode = 'KT001';
  end if;
  perform private.require_confirmed_email(p_user_id);
  if not private.is_admin(p_user_id) then
    return query select 'forbidden'::text;
    return;
  end if;
  delete from private.blog_posts b where b.id = p_post_id returning * into v_post;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;
  insert into private.admin_events (user_id, action, target_id, details)
  values (p_user_id, 'blog_delete', v_post.id, jsonb_build_object('slug', v_post.slug, 'status', v_post.status, 'title', v_post.title));
  return query select 'ok'::text;
end $$;

-- Antes de a API mandar uma imagem para o bucket público: confere o admin e registra o envio no histórico.
create function public.admin_register_blog_image(p_user_id uuid, p_path text) returns table (outcome text)
language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or p_path is null or p_path !~* '^/images/blog/([a-z0-9_-]+/)*[a-z0-9_.-]+\.(avif|webp|png|jpe?g|gif)$' or p_path ~ '\.\.' then
    raise exception 'admin_register_blog_image: p_user_id e p_path (em /images/blog) são obrigatórios' using errcode = 'KT001';
  end if;
  perform private.require_confirmed_email(p_user_id);
  if not private.is_admin(p_user_id) then
    return query select 'forbidden'::text;
    return;
  end if;
  insert into private.admin_events (user_id, action, details) values (p_user_id, 'blog_image', jsonb_build_object('path', p_path));
  return query select 'ok'::text;
end $$;

-- ===== EXECUTE só para service_role ================================================================
revoke all on function public.list_published_blog_posts() from public, anon, authenticated, service_role;
grant execute on function public.list_published_blog_posts() to service_role;
revoke all on function public.get_blog_version() from public, anon, authenticated, service_role;
grant execute on function public.get_blog_version() to service_role;
revoke all on function public.admin_list_blog_posts(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_blog_posts(uuid) to service_role;
revoke all on function public.admin_get_blog_post(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_blog_post(uuid, uuid) to service_role;
revoke all on function public.admin_save_blog_post(uuid, uuid, jsonb, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.admin_save_blog_post(uuid, uuid, jsonb, timestamptz) to service_role;
revoke all on function public.admin_delete_blog_post(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_blog_post(uuid, uuid) to service_role;
revoke all on function public.admin_register_blog_image(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_register_blog_image(uuid, text) to service_role;
