-- Link público dos gratuitos (responsável, 2026-11-05): keytotwo.com.br/baixar/<slug> baixa o PDF direto, sem conta,
-- para quem recebe o link de quem está testando os jogos. Só jogo gratuito publicado com arquivo gratuito publicado;
-- slug de jogo pago, rascunho ou inexistente é not_found (a api leva para /gratuitos). O download conta como 'free'
-- sem user_id, como no painel do admin. A página /gratuitos continua pedindo conta e aceite dos e-mails.
create function public.resolve_free_link(p_slug text)
  returns table (outcome text, bucket text, object_key text, filename text, content_type text, size_bytes bigint)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_file uuid;
begin
  if p_slug is null or btrim(p_slug) = '' then
    raise exception 'resolve_free_link: p_slug é obrigatório' using errcode = 'KT001';
  end if;

  -- o PDF mais novo publicado do jogo, se houver mais de uma versão
  select f.id into v_file
    from public.games g
    join public.files f on f.game_id = g.id and f.kind = 'pdf' and f.access = 'free' and f.status = 'published'
   where g.slug = p_slug and g.access = 'free' and g.status = 'published'
     and exists (select 1 from public.file_objects o where o.file_id = f.id)
   order by f.created_at desc, f.id desc
   limit 1;
  if not found then
    return query select * from private.no_file('not_found');
    return;
  end if;
  return query select * from private.serve_file(null, v_file, 'free');
end $$;

revoke all on function public.resolve_free_link(text) from public, anon, authenticated, service_role;
grant execute on function public.resolve_free_link(text) to service_role;
