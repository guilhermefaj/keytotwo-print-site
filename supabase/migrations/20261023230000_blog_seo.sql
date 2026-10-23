-- Blog: título e descrição para o Google (2026-10-23, pedido do responsável), depois de
-- 20261023220000_admin_equipe_acompanhamento.sql. Opcionais: em branco, o site usa o título e o resumo do post no
-- <title>, na descrição e no compartilhamento. O admin mostra a prévia do Google e recomenda até 60 e 155 caracteres;
-- o banco aceita até 80 e 200. blog_post_json e admin_save_blog_post passam a levar os dois campos (o resto igual a
-- 20261023120000_blog_admin.sql).
-- Migração nova: duas colunas com padrão vazio e duas funções reescritas; nenhum dado muda.

alter table private.blog_posts
  add column seo_title       text not null default '',
  add column seo_description text not null default '',
  add constraint blog_posts_seo_title_check       check (char_length(seo_title) <= 80),
  add constraint blog_posts_seo_description_check check (char_length(seo_description) <= 200);

create or replace function private.blog_post_json(p private.blog_posts, p_with_body boolean) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'title', p.title, 'description', p.description, 'author', p.author,
    'date', p.post_date, 'cover', p.cover, 'cover_alt', p.cover_alt, 'tags', to_jsonb(p.tags), 'status', p.status,
    'seo_title', p.seo_title, 'seo_description', p.seo_description,
    'published_at', p.published_at, 'created_at', p.created_at, 'updated_at', p.updated_at)
    || case when p_with_body then jsonb_build_object('body', p.body) else '{}'::jsonb end
$$;

-- p_post: { slug, title, description, author, date, cover, cover_alt, tags, body, status, seo_title?, seo_description? }
-- já validado pela API (sem os campos do Google, ficam vazios). Resto igual a 20261023120000.
create or replace function public.admin_save_blog_post(p_user_id uuid, p_post_id uuid, p_post jsonb, p_expected_updated_at timestamptz)
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
                                      seo_title, seo_description, published_at, created_by, updated_by)
      values (p_post->>'slug', p_post->>'title', coalesce(p_post->>'description', ''), coalesce(p_post->>'author', ''),
              (p_post->>'date')::date, nullif(p_post->>'cover', ''), coalesce(p_post->>'cover_alt', ''), v_tags,
              coalesce(p_post->>'body', ''), v_status, coalesce(p_post->>'seo_title', ''), coalesce(p_post->>'seo_description', ''),
              case when v_status = 'published' then now() end, p_user_id, p_user_id)
      returning * into v_row;
      v_action := 'blog_create';
    else
      update private.blog_posts b
         set slug = p_post->>'slug', title = p_post->>'title', description = coalesce(p_post->>'description', ''),
             author = coalesce(p_post->>'author', ''), post_date = (p_post->>'date')::date, cover = nullif(p_post->>'cover', ''),
             cover_alt = coalesce(p_post->>'cover_alt', ''), tags = v_tags, body = coalesce(p_post->>'body', ''),
             seo_title = coalesce(p_post->>'seo_title', ''), seo_description = coalesce(p_post->>'seo_description', ''),
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
