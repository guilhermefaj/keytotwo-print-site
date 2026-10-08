-- I4: downloads, entrega pelo link do e-mail, jogo gratuito e fila de e-mail (docs/data-contract.md v0.3.4, seções 6.7 e 6.8).
-- Migração nova: só acrescenta (nenhuma tabela muda; as tabelas e os índices do I2b e do I3 já cobrem tudo).
-- RPCs: resolve_download, resolve_delivery, get_free_game, resolve_free_download, claim_email_batch, mark_email_result.
-- Todas SECURITY DEFINER, search_path vazio, EXECUTE só para service_role. A chave do B2 (bucket e object_key) sai apenas destas RPCs, para a
-- API, que assina a URL no servidor; nenhuma outra função nem tabela devolve a chave e o banco nunca guarda URL (I-10, I-11).
-- Fora desta migração, de propósito (sem stub): record_email_event e private.enqueue_followups (I5).

-- ===== 1. resolve_download: baixar um arquivo da biblioteca ==========================================
create function public.resolve_download(p_user_id uuid, p_file_id uuid)
  returns table (outcome text, bucket text, object_key text, filename text, content_type text, size_bytes bigint)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_file     public.files%rowtype;
  v_entitled boolean;
  v_bucket   text;
  v_key      text;
begin
  perform private.require_confirmed_email(p_user_id);
  if p_file_id is null then
    raise exception 'resolve_download: p_file_id é obrigatório' using errcode = 'KT001';
  end if;

  select * into v_file from public.files f where f.id = p_file_id;
  -- 1. inexistente ou gratuito (o gratuito tem a sua própria rota): não existe para esta rota
  if not found or v_file.access = 'free' then
    return query select 'not_found'::text, null::text, null::text, null::text, null::text, null::bigint;
    return;
  end if;

  -- 2. direito ativo do usuário: a fotografia do direito contém o jogo do arquivo (ou o produto do ZIP é o do direito)
  if v_file.game_id is not null then
    v_entitled := exists (select 1 from private.owned_game_ids(p_user_id) g where g = v_file.game_id);
  else
    v_entitled := exists (select 1 from public.entitlements e
                           where e.user_id = p_user_id and e.status = 'active' and e.product_id = v_file.product_id);
  end if;
  if not v_entitled then
    -- só diz que o arquivo existe se ele está publicado (rascunho e aposentado não vazam)
    return query select (case when v_file.status = 'published' then 'not_entitled' else 'not_found' end)::text,
                        null::text, null::text, null::text, null::text, null::bigint;
    return;
  end if;

  -- 3. com direito: só o publicado baixa
  if v_file.status = 'retired' then
    if exists (select 1 from public.files s
                where s.status = 'published' and s.kind = v_file.kind and s.access = v_file.access
                  and s.game_id is not distinct from v_file.game_id
                  and s.product_id is not distinct from v_file.product_id) then
      -- há versão nova: o site recarrega a biblioteca e recebe o id novo
      return query select 'not_found'::text, null::text, null::text, null::text, null::text, null::bigint;
    else
      return query select 'unavailable'::text, null::text, null::text, null::text, null::text, null::bigint;
    end if;
    return;
  elsif v_file.status = 'draft' then
    return query select 'unavailable'::text, null::text, null::text, null::text, null::text, null::bigint;
    return;
  end if;

  select o.bucket, o.object_key into v_bucket, v_key from public.file_objects o where o.file_id = v_file.id;
  if not found then
    return query select 'unavailable'::text, null::text, null::text, null::text, null::text, null::bigint;
    return;
  end if;

  insert into public.download_events (user_id, file_id, kind) values (p_user_id, v_file.id, 'paid');
  return query select 'ok'::text, v_bucket, v_key, v_file.filename,
                      (case v_file.kind when 'pdf' then 'application/pdf' else 'application/zip' end)::text, v_file.size_bytes;
end $$;

-- ===== 2. resolve_delivery: o link do e-mail (o direito é conferido de novo no clique) ===============
create function public.resolve_delivery(p_entitlement_id uuid, p_game_id bigint)
  returns table (outcome text, bucket text, object_key text, filename text, content_type text, size_bytes bigint)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_user   uuid;
  v_status text;
  v_file   public.files%rowtype;
  v_bucket text;
  v_key    text;
begin
  if p_entitlement_id is null or p_game_id is null then
    raise exception 'resolve_delivery: argumentos obrigatórios' using errcode = 'KT001';
  end if;

  select e.user_id, e.status into v_user, v_status from public.entitlements e where e.id = p_entitlement_id;
  if not found
     or not exists (select 1 from public.entitlement_games eg where eg.entitlement_id = p_entitlement_id and eg.game_id = p_game_id) then
    return query select 'not_found'::text, null::text, null::text, null::text, null::text, null::bigint;
    return;
  end if;
  if v_status <> 'active' then
    return query select 'revoked'::text, null::text, null::text, null::text, null::text, null::bigint;
    return;
  end if;

  -- serve a versão vigente do jogo (P-2)
  select * into v_file from public.files f
   where f.game_id = p_game_id and f.kind = 'pdf' and f.access = 'paid' and f.status = 'published';
  if found then
    select o.bucket, o.object_key into v_bucket, v_key from public.file_objects o where o.file_id = v_file.id;
  end if;
  if v_file.id is null or v_key is null then
    return query select 'unavailable'::text, null::text, null::text, null::text, null::text, null::bigint;
    return;
  end if;

  insert into public.download_events (user_id, file_id, kind) values (v_user, v_file.id, 'paid');
  return query select 'ok'::text, v_bucket, v_key, v_file.filename, 'application/pdf'::text, v_file.size_bytes;
end $$;

-- ===== 3. jogo gratuito (sem login, sem captura de contato) ==========================================
create function public.get_free_game() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object(
             'available', true,
             'game', jsonb_build_object('code', g.code, 'name', g.name),
             'file', jsonb_build_object('id', f.id, 'version', f.version, 'size_bytes', f.size_bytes, 'filename', f.filename))
      from public.games g
      join public.files f on f.game_id = g.id and f.kind = 'pdf' and f.access = 'free' and f.status = 'published'
     where g.access = 'free' and g.status = 'published'
       and exists (select 1 from public.file_objects o where o.file_id = f.id)
     order by g.id
     limit 1), jsonb_build_object('available', false))
$$;

create function public.resolve_free_download(p_file_id uuid)
  returns table (outcome text, bucket text, object_key text, filename text, content_type text, size_bytes bigint)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_file   public.files%rowtype;
  v_bucket text;
  v_key    text;
begin
  if p_file_id is null then
    raise exception 'resolve_free_download: p_file_id é obrigatório' using errcode = 'KT001';
  end if;

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

  insert into public.download_events (user_id, file_id, kind) values (null, v_file.id, 'free');
  return query select 'ok'::text, v_bucket, v_key, v_file.filename,
                      (case v_file.kind when 'pdf' then 'application/pdf' else 'application/zip' end)::text, v_file.size_bytes;
end $$;

-- ===== 4. claim_email_batch: o despachante pega o que vai enviar ======================================
-- Constantes da proposta D3 (P-18): reclaim de 'sending' parado há 10 minutos, 5 tentativas, 1 e-mail de marketing por 24 h.
create function public.claim_email_batch(
  p_limit     integer default 20,
  p_outbox_id uuid default null,
  p_now       timestamptz default now()
) returns table (
  id       uuid,
  kind     text,
  category text,
  user_id  uuid,
  order_id uuid,
  to_email text,
  payload  jsonb,
  attempts integer
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  r              record;
  v_attempts     integer;
  v_reason       text;
  v_order_status text;
  v_cart_version integer;
  v_cart_items   integer;
  v_last         timestamptz;
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 or p_now is null then
    raise exception 'claim_email_batch: p_limit deve estar entre 1 e 200 e p_now é obrigatório' using errcode = 'KT001';
  end if;

  for r in
    select x.* from public.email_outbox x
     where (p_outbox_id is null or x.id = p_outbox_id)
       and x.scheduled_at <= p_now
       and (x.status = 'queued' or (x.status = 'sending' and x.locked_at < p_now - interval '10 minutes'))
     order by x.scheduled_at, x.created_at, x.id
     limit p_limit
     for update skip locked
  loop
    v_attempts := r.attempts;

    -- 'sending' parado há mais de 10 minutos (o despachante caiu): conta uma tentativa; na 5ª, falha de vez
    if r.status = 'sending' then
      v_attempts := v_attempts + 1;
      if v_attempts >= 5 then
        update public.email_outbox x
           set status = 'failed', attempts = v_attempts, locked_at = null, last_error = 'despachante não respondeu (timeout)'
         where x.id = r.id;
        continue;
      end if;
    end if;

    v_reason := null;
    if r.category = 'marketing' then
      -- marketing é rechecado AQUI: opt-in vigente, e-mail confirmado, sem supressão
      if not private.marketing_allowed(r.user_id) then
        v_reason := case
          when not coalesce((select p.marketing_opt_in from public.profiles p where p.user_id = r.user_id), false) then 'no_opt_in'
          when private.confirmed_email(r.user_id) is null then 'email_not_confirmed'
          else 'suppressed' end;
      elsif r.kind = 'cart_reminder' then
        select c.version into v_cart_version from public.carts c where c.user_id = r.user_id;
        select count(*) into v_cart_items from public.cart_items ci where ci.user_id = r.user_id;
        if v_cart_items = 0 then
          v_reason := 'cart_empty';
        elsif v_cart_version is distinct from (r.payload->>'cart_version')::integer then
          v_reason := 'cart_changed';
        end if;
      elsif r.kind = 'post_purchase' then
        select o.status into v_order_status from public.orders o where o.id = r.order_id;
        if v_order_status is distinct from 'paid' then
          v_reason := 'order_not_paid';
        end if;
      end if;

      if v_reason is not null then
        update public.email_outbox x
           set status = 'skipped', skip_reason = v_reason, attempts = v_attempts, locked_at = null
         where x.id = r.id;
        continue;
      end if;

      -- no máximo 1 e-mail de marketing por pessoa a cada 24 h: o excedente vai para depois, sem ser pulado
      select max(coalesce(m.sent_at, m.locked_at)) into v_last
        from public.email_outbox m
       where m.user_id = r.user_id and m.category = 'marketing' and m.id <> r.id
         and ((m.status = 'sent' and m.sent_at > p_now - interval '24 hours')
              or (m.status = 'sending' and m.locked_at >= p_now - interval '10 minutes'));
      if v_last is not null then
        update public.email_outbox x
           set status = 'queued', attempts = v_attempts, locked_at = null,
               scheduled_at = greatest(r.scheduled_at, v_last + interval '24 hours')
         where x.id = r.id;
        continue;
      end if;
    else
      -- transacional (entrega): só sai se o pedido segue pago e nenhum direito foi revogado
      select o.status into v_order_status from public.orders o where o.id = r.order_id;
      if v_order_status in ('disputed', 'dispute_lost', 'refunded') then
        v_reason := 'entitlement_revoked';
      elsif v_order_status is distinct from 'paid' then
        v_reason := 'order_not_paid';
      elsif exists (select 1 from public.entitlements e where e.order_id = r.order_id and e.status <> 'active') then
        v_reason := 'entitlement_revoked';
      end if;
      if v_reason is not null then
        update public.email_outbox x
           set status = 'canceled', skip_reason = v_reason, attempts = v_attempts, locked_at = null
         where x.id = r.id;
        continue;
      end if;
    end if;

    update public.email_outbox x
       set status = 'sending', locked_at = p_now, attempts = v_attempts
     where x.id = r.id;
    id := r.id; kind := r.kind; category := r.category; user_id := r.user_id; order_id := r.order_id;
    to_email := r.to_email; payload := r.payload; attempts := v_attempts;
    return next;
  end loop;
end $$;

-- ===== 5. mark_email_result: o resultado do envio; o banco decide a nova tentativa ====================
create function public.mark_email_result(
  p_id                  uuid,
  p_status              text,
  p_provider_message_id text default null,
  p_error               text default null
) returns table (outcome text, status text, next_attempt_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_row      public.email_outbox%rowtype;
  v_attempts integer;
  v_error    text := nullif(left(btrim(coalesce(p_error, '')), 500), '');
  v_next     timestamptz;
begin
  if p_id is null or p_status is null or p_status not in ('sent', 'failed', 'rejected') then
    raise exception 'mark_email_result: argumentos inválidos' using errcode = 'KT001';
  end if;

  select * into v_row from public.email_outbox x where x.id = p_id for update;
  if not found then
    return query select 'not_found'::text, null::text, null::timestamptz;
    return;
  end if;
  -- só vale para linha em envio; repetir o resultado de uma linha que já saiu de 'sending' não muda nada
  if v_row.status <> 'sending' then
    return query select 'noop'::text, v_row.status, null::timestamptz;
    return;
  end if;

  if p_status = 'sent' then
    update public.email_outbox x
       set status = 'sent', sent_at = now(), locked_at = null, last_error = null,
           provider_message_id = left(nullif(btrim(coalesce(p_provider_message_id, '')), ''), 200)
     where x.id = p_id;
    if v_row.kind = 'delivery' then
      insert into public.funnel_events (user_id, type, order_id) values (v_row.user_id, 'delivery_sent', v_row.order_id)
      on conflict do nothing;
    end if;
    return query select 'applied'::text, 'sent'::text, null::timestamptz;
    return;
  end if;

  v_attempts := v_row.attempts + 1;
  if p_status = 'failed' and v_attempts < 5 then
    -- erro transitório: volta para a fila, adiado em 5 min x tentativas²
    v_next := now() + (5 * v_attempts * v_attempts) * interval '1 minute';
    update public.email_outbox x
       set status = 'queued', attempts = v_attempts, locked_at = null, last_error = v_error, scheduled_at = v_next
     where x.id = p_id;
    return query select 'applied'::text, 'queued'::text, v_next;
    return;
  end if;

  -- rejeição definitiva do provedor, ou a 5ª falha
  update public.email_outbox x
     set status = 'failed', attempts = v_attempts, locked_at = null, last_error = v_error
   where x.id = p_id;
  return query select 'applied'::text, 'failed'::text, null::timestamptz;
end $$;

-- ===== EXECUTE só para service_role (repetir se a função for recriada) ===============================
do $$
declare sig text;
begin
  foreach sig in array array[
    'resolve_download(uuid, uuid)',
    'resolve_delivery(uuid, bigint)',
    'get_free_game()',
    'resolve_free_download(uuid)',
    'claim_email_batch(integer, uuid, timestamptz)',
    'mark_email_result(uuid, text, text, text)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', sig);
    execute format('grant execute on function public.%s to service_role', sig);
  end loop;
end $$;
