-- Blog: galeria de imagens e site atualizado mais depressa (2026-10-23, pedido do responsável), depois de
-- 20261023120000_blog_admin.sql.
-- 1. admin_blog_access: a API confere o admin no banco antes de listar o bucket das imagens. A lista vem do bucket
--    (keytotwo-print-blog), não daqui; esta função só responde se a pessoa pode ver.
-- 2. get_blog_version também para anon: o vigia da VPS confere a versão a cada 10 s pela API de dados do Supabase, sem
--    gastar as invocações das funções. É o mesmo dado de GET /blog/version (pública): um md5 do que já está publicado.
--    Única RPC com EXECUTE para anon; não lê nada além do que o site já mostra.
-- Migração nova: só cria uma função e um GRANT; nenhum dado é alterado.

create function public.admin_blog_access(p_user_id uuid) returns table (outcome text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_user_id is null then
    raise exception 'admin_blog_access: p_user_id é obrigatório' using errcode = 'KT001';
  end if;
  perform private.require_confirmed_email(p_user_id);
  if not private.is_admin(p_user_id) then
    return query select 'forbidden'::text;
    return;
  end if;
  return query select 'ok'::text;
end $$;

revoke all on function public.admin_blog_access(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_blog_access(uuid) to service_role;

grant execute on function public.get_blog_version() to anon;
