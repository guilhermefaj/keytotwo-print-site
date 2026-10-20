-- Gratuitos (2026-10-20, decisão do responsável): mais de um jogo gratuito publicado ao mesmo tempo, baixados só por
-- quem tem conta confirmada e já aceitou receber e-mails de novidades alguma vez. Quem sai da lista depois continua
-- baixando: o desbloqueio olha o histórico de consentimento (append-only, guardado enquanto a conta existir).
-- Migração nova: troca funções e CHECKs; nenhum dado é alterado.

-- ===== 1. Mais de um gratuito publicado ===========================================================
drop index public.games_one_published_free;

-- ===== 2. Origem free_games: o convite da página Gratuitos, que só concede ===========================
alter table public.marketing_consents
  drop constraint marketing_consents_source_check,
  drop constraint marketing_consents_source_action_check;
alter table public.marketing_consents
  add constraint marketing_consents_source_check check (source in
    ('signup_prompt', 'account', 'cart', 'free_games', 'unsubscribe_link', 'brevo_webhook', 'support')),
  add constraint marketing_consents_source_action_check check (
    (source in ('signup_prompt', 'cart', 'free_games') and action = 'granted')
    or (source in ('unsubscribe_link', 'brevo_webhook') and action = 'revoked')
    or source in ('account', 'support'));

-- ===== 3. Desbloqueio dos gratuitos: algum aceite registrado, mesmo que retirado depois ==============
create function private.free_games_unlocked(p_user_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.marketing_consents c where c.user_id = p_user_id and c.action = 'granted')
$$;
revoke all on function private.free_games_unlocked(uuid) from public, anon, authenticated, service_role;

-- ===== 4. list_free_games: todos os gratuitos publicados com PDF no B2 (substitui get_free_game) ======
drop function public.get_free_game();
create function public.list_free_games() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'code', g.code,
             'name', g.name,
             'file', jsonb_build_object('id', f.id, 'version', f.version, 'size_bytes', f.size_bytes, 'filename', f.filename))
           order by g.code), '[]'::jsonb)
    from public.games g
    join public.files f on f.game_id = g.id and f.kind = 'pdf' and f.access = 'free' and f.status = 'published'
   where g.access = 'free' and g.status = 'published'
     and exists (select 1 from public.file_objects o where o.file_id = f.id)
$$;

-- ===== 5. resolve_free_download: agora com conta e desbloqueio ======================================
-- not_found vem antes de locked: quem não desbloqueou não descobre quais ids existem.
drop function public.resolve_free_download(uuid);
create function public.resolve_free_download(p_user_id uuid, p_file_id uuid)
  returns table (outcome text, bucket text, object_key text, filename text, content_type text, size_bytes bigint)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_file   public.files%rowtype;
  v_bucket text;
  v_key    text;
begin
  if p_user_id is null or p_file_id is null then
    raise exception 'resolve_free_download: p_user_id e p_file_id são obrigatórios' using errcode = 'KT001';
  end if;
  perform private.require_confirmed_email(p_user_id);

  select f.* into v_file
    from public.files f
    join public.games g on g.id = f.game_id
   where f.id = p_file_id and f.access = 'free' and f.status = 'published'
     and g.access = 'free' and g.status = 'published';
  if found then
    select o.bucket, o.object_key into v_bucket, v_key from public.file_objects o where o.file_id = v_file.id;
  end if;
  -- qualquer outro id (inclusive de arquivo pago) é not_found
  if v_file.id is null or v_key is null then
    return query select 'not_found'::text, null::text, null::text, null::text, null::text, null::bigint;
    return;
  end if;
  if not private.free_games_unlocked(p_user_id) then
    return query select 'locked'::text, null::text, null::text, null::text, null::text, null::bigint;
    return;
  end if;

  insert into public.download_events (user_id, file_id, kind) values (p_user_id, v_file.id, 'free');
  return query select 'ok'::text, v_bucket, v_key, v_file.filename,
                      (case v_file.kind when 'pdf' then 'application/pdf' else 'application/zip' end)::text, v_file.size_bytes;
end $$;

-- ===== 6. get_account (versão do I3, com cupom): diz se os gratuitos estão liberados (free_games_unlocked) =====
create or replace function public.get_account(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_confirmed_email(p_user_id);

  return jsonb_build_object(
    'email', (select u.email from auth.users u where u.id = p_user_id),
    'marketing', coalesce((
      select jsonb_build_object(
               'opted_in', p.marketing_opt_in,
               'updated_at', (select c.occurred_at from public.marketing_consents c
                              where c.user_id = p_user_id order by c.occurred_at desc, c.id desc limit 1),
               'text_version', case when p.marketing_opt_in then
                                 (select c.text_version from public.marketing_consents c
                                  where c.user_id = p_user_id and c.action = 'granted'
                                  order by c.occurred_at desc, c.id desc limit 1)
                               end,
               'prompted_at', p.marketing_prompted_at)
      from public.profiles p where p.user_id = p_user_id),
      jsonb_build_object('opted_in', false, 'updated_at', null, 'text_version', null, 'prompted_at', null)),
    'free_games_unlocked', private.free_games_unlocked(p_user_id),
    'orders', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'ref', upper(left(replace(o.id::text, '-', ''), 8)),
                 'created_at', o.created_at,
                 'paid_at', o.paid_at,
                 'status', o.status,
                 'amount_subtotal', o.amount_subtotal,
                 'amount_discount', o.amount_discount,
                 'amount_total', o.amount_total,
                 'currency', o.currency,
                 'promotion_code', o.promotion_code,
                 'items', coalesce((
                   select jsonb_agg(
                            jsonb_build_object('code', p.code, 'name', p.name,
                                               'unit_amount', i.unit_amount, 'currency', i.currency)
                            order by i.position)
                   from public.order_items i
                   join public.products p on p.id = i.product_id
                   where i.order_id = o.id), '[]'::jsonb))
               order by o.created_at desc, o.id desc)
      from public.orders o
      where o.user_id = p_user_id and o.status not in ('open', 'expired')), '[]'::jsonb));
end $$;

-- ===== 7. set_marketing_consent aceita a origem free_games (só concede) =============================
create or replace function public.set_marketing_consent(p_user_id uuid, p_granted boolean, p_source text,
                                                        p_text_version text default null)
  returns table (outcome text, opted_in boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_email   text;
  v_current boolean;
begin
  v_email := private.require_confirmed_email(p_user_id);
  if p_granted is null or p_source is null or p_source not in ('signup_prompt', 'account', 'cart', 'free_games') then
    raise exception 'set_marketing_consent: argumentos inválidos' using errcode = 'KT001';
  end if;
  if p_granted and (p_text_version is null or btrim(p_text_version) = '') then
    raise exception 'set_marketing_consent: conceder exige a versão do texto' using errcode = 'KT001';
  end if;
  if not p_granted and p_source in ('signup_prompt', 'cart', 'free_games') then
    raise exception 'set_marketing_consent: a origem % só concede', p_source using errcode = 'KT001';
  end if;

  select p.marketing_opt_in into v_current from public.profiles p where p.user_id = p_user_id for update;
  if not found then
    raise exception 'set_marketing_consent: usuário sem perfil' using errcode = 'KT001';
  end if;

  -- O convite foi exibido: registra a 1ª vez (vale entre aparelhos). Ver ou dispensar o convite NÃO é consentimento.
  if p_source = 'signup_prompt' then
    update public.profiles p set marketing_prompted_at = now()
     where p.user_id = p_user_id and p.marketing_prompted_at is null;
  end if;

  -- mesmo estado: nada novo no histórico
  if v_current = p_granted then
    return query select 'noop'::text, v_current;
    return;
  end if;

  insert into public.marketing_consents (user_id, email, action, source, text_version)
  values (p_user_id, v_email, case when p_granted then 'granted' else 'revoked' end, p_source,
          case when p_granted then p_text_version end);   -- a trigger atualiza profiles

  if not p_granted then
    perform private.cancel_queued_marketing(p_user_id);
  end if;
  return query select 'applied'::text, p_granted;
end $$;

-- ===== EXECUTE só para service_role (as recriadas com create or replace mantêm o ACL) ===============
do $$
declare sig text;
begin
  foreach sig in array array['list_free_games()', 'resolve_free_download(uuid, uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', sig);
    execute format('grant execute on function public.%s to service_role', sig);
  end loop;
end $$;
