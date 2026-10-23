-- Blog: apagar imagens da galeria (2026-10-23, pedido do responsável), depois de 20261023160000_blog_galeria.sql.
-- A galeria mostra onde cada imagem é usada, e o admin apaga do bucket só o que nenhum post usa, rascunho incluído:
-- uma imagem de post publicado que sumisse do bucket travaria a atualização do site (o build baixa todas).
-- admin_blog_access (só conferia o admin) dá lugar a admin_blog_image_usage, que confere e devolve o uso.
-- Migração nova: troca uma função, cria duas e aceita a ação nova no histórico; nenhum dado é alterado.

alter table private.admin_events drop constraint admin_events_action_check;
alter table private.admin_events add constraint admin_events_action_check
  check (action in ('blog_create', 'blog_update', 'blog_publish', 'blog_unpublish', 'blog_delete', 'blog_image', 'blog_image_delete'));

-- Caminho da imagem → posts que a usam ({ id, title, status }, o editado mais recente primeiro), pela capa ou no texto.
create function private.blog_image_usage() returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_object_agg(u.path, u.posts), '{}'::jsonb)
  from (
    select i.path, jsonb_agg(jsonb_build_object('id', b.id, 'title', b.title, 'status', b.status) order by b.updated_at desc) as posts
    from private.blog_posts b
    cross join lateral (
      select b.cover as path where b.cover is not null
      union
      select m[1] from regexp_matches(b.body, '(/images/blog/[A-Za-z0-9_./-]+)', 'g') as m
    ) i
    group by i.path
  ) u
$$;
revoke all on function private.blog_image_usage() from public, anon, authenticated, service_role;

drop function public.admin_blog_access(uuid);

create function public.admin_blog_image_usage(p_user_id uuid) returns table (outcome text, usage jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_user_id is null then
    raise exception 'admin_blog_image_usage: p_user_id é obrigatório' using errcode = 'KT001';
  end if;
  perform private.require_confirmed_email(p_user_id);
  if not private.is_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  return query select 'ok'::text, private.blog_image_usage();
end $$;

-- Libera a imagem para sair do bucket (a API apaga em seguida) e registra no histórico; em uso, diz por quem.
create function public.admin_delete_blog_image(p_user_id uuid, p_path text) returns table (outcome text, used_by jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  v_used jsonb;
begin
  if p_user_id is null or p_path is null or p_path !~* '^/images/blog/([a-z0-9_-]+/)*[a-z0-9_.-]+\.(avif|webp|png|jpe?g|gif)$' or p_path ~ '\.\.' then
    raise exception 'admin_delete_blog_image: p_user_id e p_path (em /images/blog) são obrigatórios' using errcode = 'KT001';
  end if;
  perform private.require_confirmed_email(p_user_id);
  if not private.is_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  v_used := private.blog_image_usage() -> p_path;
  if v_used is not null then
    return query select 'in_use'::text, v_used;
    return;
  end if;
  insert into private.admin_events (user_id, action, details) values (p_user_id, 'blog_image_delete', jsonb_build_object('path', p_path));
  return query select 'ok'::text, null::jsonb;
end $$;

revoke all on function public.admin_blog_image_usage(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_blog_image_usage(uuid) to service_role;
revoke all on function public.admin_delete_blog_image(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_blog_image(uuid, text) to service_role;
