-- Limpeza do banco (2026-10-24, revisão de qualidade pedida pelo responsável). Não muda o que as RPCs devolvem nem os
-- SQLSTATEs; muda o que estava repetido ou sem uso:
--   1. ajudantes privados no lugar de cópias: o portão de admin (20 RPCs), o código curto do pedido (13 cópias), a linha
--      vazia e o fim dos downloads (3 RPCs), os direitos e a sacola de um pedido pago (compra e presente), o livro-razão
--      dos eventos da Stripe e a situação dos direitos de um pedido;
--   2. fulfill_order monta a entrega com private.delivery_payload (era uma cópia dela); private.access_effect sai;
--   3. sai o que ninguém usa: mark_marketing_prompt (o convite do site saiu em 2026-10-10), o ZIP do pacote
--      (files.product_id: nenhuma RPC entrega ZIP), o índice orders_stale_idx e os valores nunca gravados
--      (consentimento 'cart', supressão 'unsubscribe_link'/'support', descadastro 'support', evento 'system');
--   4. set_stripe_customer troca o Customer guardado quando a Stripe diz que ele foi apagado (p_replaces).
-- Antes de aplicar no hospedado: as conferências só leitura do responsável (nenhuma linha com os valores que saem).
-- As funções recriadas com create or replace mantêm os privilégios; a única recriada com drop é set_stripe_customer.

-- ===== 1. Ajudantes ===============================================================================
-- Portão das RPCs de admin: exige e-mail confirmado (KT001 sem usuário, KT009 sem confirmação) e diz se a conta é admin.
-- Quem chama devolve forbidden quando não é.
create function private.confirmed_admin(p_user_id uuid) returns boolean
language plpgsql stable set search_path = '' as $$
begin
  perform private.require_confirmed_email(p_user_id);
  return private.is_admin(p_user_id);
end $$;

-- Código curto do pedido nos e-mails, na conta e no admin: os 8 primeiros dígitos do id, em maiúsculas.
create function private.order_ref(p_order_id uuid) returns text
language sql immutable set search_path = '' as $$
  select upper(left(replace(p_order_id::text, '-', ''), 8))
$$;

-- Linha sem arquivo das RPCs de download (not_found, not_entitled, revoked, unavailable, locked).
create function private.no_file(p_outcome text)
  returns table (outcome text, bucket text, object_key text, filename text, content_type text, size_bytes bigint)
language sql immutable set search_path = '' as $$
  select p_outcome, null::text, null::text, null::text, null::text, null::bigint
$$;

-- O fim de todo download (biblioteca, link do e-mail, gratuito): o objeto no B2, o registro do download e a linha ok.
-- Sem o objeto, nenhuma linha (quem chama decide o outcome). Só as RPCs de download devolvem a chave do B2 (I-10, I-11).
create function private.serve_file(p_user_id uuid, p_file_id uuid, p_kind text)
  returns table (outcome text, bucket text, object_key text, filename text, content_type text, size_bytes bigint)
language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare
  v_bucket text;
  v_key    text;
begin
  select o.bucket, o.object_key into v_bucket, v_key from public.file_objects o where o.file_id = p_file_id;
  if not found then
    return;
  end if;
  insert into public.download_events (user_id, file_id, kind) values (p_user_id, p_file_id, p_kind);
  return query select 'ok'::text, v_bucket, v_key, f.filename, 'application/pdf'::text, f.size_bytes
                 from public.files f where f.id = p_file_id;
end $$;

-- Um direito por item do pedido pago (compra ou presente), com a fotografia da composição de cada produto. Repetir não
-- duplica: o item que já tem direito fica como está. Produto sem jogos é defeito do catálogo (KT003).
create function private.grant_order_entitlements(p_order_id uuid, p_user_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_ent  uuid;
  v_rows integer;
  r      record;
begin
  for r in select oi.product_id, p.code from public.order_items oi join public.products p on p.id = oi.product_id
            where oi.order_id = p_order_id order by oi.position loop
    v_ent := null;
    insert into public.entitlements (order_id, product_id, user_id)
    values (p_order_id, r.product_id, p_user_id)
    on conflict (order_id, product_id) do nothing
    returning id into v_ent;
    if v_ent is not null then
      insert into public.entitlement_games (entitlement_id, game_id, position)
      select v_ent, pg.game_id, pg.position from public.product_games pg where pg.product_id = r.product_id;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        raise exception 'o produto % não tem jogos na composição', r.code using errcode = 'KT003';
      end if;
    end if;
  end loop;
end $$;

-- Depois do pedido pago (compra ou presente): os produtos dele saem da sacola e a versão sobe. Trava a sacola antes dos
-- itens, na mesma ordem do trigger entitlement_games_prune_cart (T127).
create function private.drop_order_from_cart(p_order_id uuid, p_user_id uuid) returns void
language plpgsql set search_path = '' as $$
begin
  perform 1 from public.carts c where c.user_id = p_user_id for update;
  if found then
    delete from public.cart_items ci
     where ci.user_id = p_user_id
       and ci.product_id in (select oi.product_id from public.order_items oi where oi.order_id = p_order_id);
    update public.carts c set version = c.version + 1 where c.user_id = p_user_id;
  end if;
end $$;

-- Livro-razão dos eventos da Stripe: um registro por evento, com o que a RPC fez dele. Sem evento (página de retorno),
-- nada. Na mesma transação da mudança: o evento só fica gravado se ela ficar.
create function private.log_stripe_event(p_event_id text, p_type text, p_livemode boolean, p_object_id text,
                                         p_order_id uuid, p_outcome text) returns void
language plpgsql set search_path = '' as $$
begin
  if p_event_id is not null then
    insert into public.stripe_events (id, type, livemode, stripe_object_id, order_id, outcome)
    values (p_event_id, p_type, p_livemode, p_object_id, p_order_id, p_outcome);
  end if;
end $$;

-- Situação dos direitos de um pedido: null sem direitos, active com algum ativo, revoked com todos revogados.
create function private.order_access(p_order_id uuid) returns text
language sql stable set search_path = '' as $$
  select case when count(*) = 0 then null
              when count(*) filter (where e.status = 'active') > 0 then 'active'
              else 'revoked' end
    from public.entitlements e where e.order_id = p_order_id
$$;

do $$
declare sig text;
begin
  foreach sig in array array[
    'confirmed_admin(uuid)', 'order_ref(uuid)', 'no_file(text)', 'serve_file(uuid, uuid, text)',
    'grant_order_entitlements(uuid, uuid)', 'drop_order_from_cart(uuid, uuid)',
    'log_stripe_event(text, text, boolean, text, uuid, text)', 'order_access(uuid)']
  loop
    execute format('revoke all on function private.%s from public, anon, authenticated, service_role', sig);
  end loop;
end $$;

-- ===== 2. Sem uso ==================================================================================
-- O convite pós-login do site saiu em 2026-10-10 (a rota da api sai junto). profiles.marketing_prompted_at fica: o
-- consentimento com origem signup_prompt ainda grava a primeira vez, e a conta e a exportação mostram.
drop function public.mark_marketing_prompt(uuid);

-- Nenhuma consulta procura pedido aberto ou pendente por data (não há rotina de reconciliação).
drop index public.orders_stale_idx;

-- Valores que nenhum caminho grava: consentimento pela sacola, supressão por link ou suporte (só a Brevo suprime) e
-- evento 'system' no pedido. 'support' no consentimento fica: é o que o admin grava ao tirar das novidades.
alter table public.marketing_consents
  drop constraint marketing_consents_source_check,
  drop constraint marketing_consents_source_action_check;
alter table public.marketing_consents
  add constraint marketing_consents_source_check check (source in
    ('signup_prompt', 'account', 'free_games', 'unsubscribe_link', 'brevo_webhook', 'support')),
  add constraint marketing_consents_source_action_check check (
    (source in ('signup_prompt', 'free_games') and action = 'granted')
    or (source in ('unsubscribe_link', 'brevo_webhook') and action = 'revoked')
    or source in ('account', 'support'));
alter table public.email_suppressions drop constraint email_suppressions_source_check;
alter table public.email_suppressions add constraint email_suppressions_source_check check (source = 'brevo_webhook');
alter table public.order_events drop constraint order_events_source_check;
alter table public.order_events
  add constraint order_events_source_check check (source in ('checkout', 'webhook', 'return_page', 'reconcile', 'admin'));

create or replace function public.set_marketing_consent(p_user_id uuid, p_granted boolean, p_source text,
                                                        p_text_version text default null)
  returns table (outcome text, opted_in boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_email   text;
  v_current boolean;
begin
  v_email := private.require_confirmed_email(p_user_id);
  if p_granted is null or p_source is null or p_source not in ('signup_prompt', 'account', 'free_games') then
    raise exception 'set_marketing_consent: argumentos inválidos' using errcode = 'KT001';
  end if;
  if p_granted and (p_text_version is null or btrim(p_text_version) = '') then
    raise exception 'set_marketing_consent: conceder exige a versão do texto' using errcode = 'KT001';
  end if;
  if not p_granted and p_source in ('signup_prompt', 'free_games') then
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

create or replace function public.unsubscribe(p_user_id uuid, p_source text default 'unsubscribe_link')
  returns table (outcome text, opted_in boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_email   text;
  v_current boolean;
begin
  if p_user_id is null or p_source is null or p_source <> 'unsubscribe_link' then
    raise exception 'unsubscribe: argumentos inválidos' using errcode = 'KT001';
  end if;
  select private.normalize_email(u.email) into v_email from auth.users u where u.id = p_user_id and u.deleted_at is null;
  if v_email is null then
    raise exception 'unsubscribe: usuário sem e-mail' using errcode = 'KT001';
  end if;

  select p.marketing_opt_in into v_current from public.profiles p where p.user_id = p_user_id for update;
  if not found then
    raise exception 'unsubscribe: usuário sem perfil' using errcode = 'KT001';
  end if;

  -- o efeito é imediato: o marketing que sobrou na fila sai mesmo que o estado já fosse "sem opt-in"
  perform private.cancel_queued_marketing(p_user_id);
  if not v_current then
    return query select 'noop'::text, false;
    return;
  end if;

  insert into public.marketing_consents (user_id, email, action, source)
  values (p_user_id, v_email, 'revoked', p_source);
  return query select 'applied'::text, false;
end $$;

-- ===== 3. Customer apagado na Stripe ==============================================================
-- Sem p_replaces, só grava quando não há Customer (como antes). Com ele, troca o guardado se ainda for o apagado: a api
-- só manda depois que a Stripe respondeu resource_missing para esse id.
drop function public.set_stripe_customer(uuid, text);
create function public.set_stripe_customer(p_user_id uuid, p_stripe_customer_id text, p_replaces text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_current text;
begin
  perform private.require_confirmed_email(p_user_id);
  if p_stripe_customer_id is null or p_stripe_customer_id !~ '^cus_[A-Za-z0-9_]+$'
     or (p_replaces is not null and p_replaces !~ '^cus_[A-Za-z0-9_]+$') then
    raise exception 'set_stripe_customer: cliente da Stripe inválido' using errcode = 'KT001';
  end if;

  update public.profiles p set stripe_customer_id = p_stripe_customer_id
   where p.user_id = p_user_id and (p.stripe_customer_id is null or p.stripe_customer_id = p_replaces);
  select p.stripe_customer_id into v_current from public.profiles p where p.user_id = p_user_id;
  if not found then
    raise exception 'set_stripe_customer: usuário sem perfil' using errcode = 'KT001';
  end if;
  return v_current;
end $$;
revoke all on function public.set_stripe_customer(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.set_stripe_customer(uuid, text, text) to service_role;

-- ===== 4. Sem o ZIP do pacote =====================================================================
-- Nenhuma RPC entrega ZIP: todo arquivo é o PDF de um jogo. As funções que liam files.product_id mudam antes da coluna
-- sair (plpgsql só confere o nome da coluna na hora de rodar).

create or replace function private.guard_file_changes() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'files: só rascunho pode ser apagado; use retired' using errcode = 'KT010';
    end if;
    return old;
  end if;

  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status = 'published')
         or (old.status = 'published' and new.status = 'retired')) then
      raise exception 'files: transição % -> % não permitida', old.status, new.status using errcode = 'KT006';
    end if;
    if new.status = 'published' then
      new.published_at := coalesce(new.published_at, now());
    elsif new.status = 'retired' then
      new.retired_at := coalesce(new.retired_at, now());
    end if;
  end if;

  if old.status <> 'draft' and (
       new.game_id    is distinct from old.game_id
    or new.kind       is distinct from old.kind
    or new.access     is distinct from old.access
    or new.version    is distinct from old.version
    or new.filename   is distinct from old.filename
    or new.size_bytes is distinct from old.size_bytes
    or new.sha256     is distinct from old.sha256
    or new.published_at is distinct from old.published_at) then
    raise exception 'files: conteúdo imutável depois de draft (conteúdo novo = versão nova)' using errcode = 'KT010';
  end if;
  return new;
end $$;

create or replace function public.resolve_download(p_user_id uuid, p_file_id uuid)
  returns table (outcome text, bucket text, object_key text, filename text, content_type text, size_bytes bigint)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_file public.files%rowtype;
begin
  perform private.require_confirmed_email(p_user_id);
  if p_file_id is null then
    raise exception 'resolve_download: p_file_id é obrigatório' using errcode = 'KT001';
  end if;

  select * into v_file from public.files f where f.id = p_file_id;
  -- 1. inexistente ou gratuito (o gratuito tem a sua própria rota): não existe para esta rota
  if not found or v_file.access = 'free' then
    return query select * from private.no_file('not_found');
    return;
  end if;

  -- 2. direito ativo do usuário: a fotografia do direito contém o jogo do arquivo
  if not exists (select 1 from private.owned_game_ids(p_user_id) g where g = v_file.game_id) then
    -- só diz que o arquivo existe se ele está publicado (rascunho e aposentado não vazam)
    return query select * from private.no_file(case when v_file.status = 'published' then 'not_entitled' else 'not_found' end);
    return;
  end if;

  -- 3. com direito: só o publicado baixa. Aposentado com versão nova: o site recarrega a biblioteca e recebe o id novo.
  if v_file.status = 'retired' then
    return query select * from private.no_file(case when exists (
        select 1 from public.files s
         where s.status = 'published' and s.kind = v_file.kind and s.access = v_file.access and s.game_id = v_file.game_id)
      then 'not_found' else 'unavailable' end);
    return;
  elsif v_file.status = 'draft' then
    return query select * from private.no_file('unavailable');
    return;
  end if;

  return query select * from private.serve_file(p_user_id, v_file.id, 'paid');
  if not found then
    return query select * from private.no_file('unavailable');
  end if;
end $$;

drop index public.files_product_version_key;
drop index public.files_one_published_per_product;
alter table public.files
  drop constraint files_owner_check,
  drop constraint files_kind_check;
alter table public.files drop column product_id;
alter table public.files alter column game_id set not null;
alter table public.files add constraint files_kind_check check (kind = 'pdf');

-- ===== 5. Downloads: a linha vazia e o fim do download em um lugar =================================
create or replace function public.resolve_delivery(p_entitlement_id uuid, p_game_id bigint)
  returns table (outcome text, bucket text, object_key text, filename text, content_type text, size_bytes bigint)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_user   uuid;
  v_status text;
  v_file   uuid;
begin
  if p_entitlement_id is null or p_game_id is null then
    raise exception 'resolve_delivery: argumentos obrigatórios' using errcode = 'KT001';
  end if;

  select e.user_id, e.status into v_user, v_status from public.entitlements e where e.id = p_entitlement_id;
  if not found
     or not exists (select 1 from public.entitlement_games eg where eg.entitlement_id = p_entitlement_id and eg.game_id = p_game_id) then
    return query select * from private.no_file('not_found');
    return;
  end if;
  if v_status <> 'active' then
    return query select * from private.no_file('revoked');
    return;
  end if;

  -- serve a versão vigente do jogo (P-2)
  select f.id into v_file from public.files f
   where f.game_id = p_game_id and f.kind = 'pdf' and f.access = 'paid' and f.status = 'published';
  if found then
    return query select * from private.serve_file(v_user, v_file, 'paid');
  end if;
  if not found then
    return query select * from private.no_file('unavailable');
  end if;
end $$;

-- not_found vem antes de locked: quem não desbloqueou não descobre quais ids existem.
create or replace function public.resolve_free_download(p_user_id uuid, p_file_id uuid)
  returns table (outcome text, bucket text, object_key text, filename text, content_type text, size_bytes bigint)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_file uuid;
begin
  if p_user_id is null or p_file_id is null then
    raise exception 'resolve_free_download: p_user_id e p_file_id são obrigatórios' using errcode = 'KT001';
  end if;
  perform private.require_confirmed_email(p_user_id);

  -- qualquer outro id (inclusive de arquivo pago ou sem o objeto no B2) é not_found
  select f.id into v_file
    from public.files f
    join public.games g on g.id = f.game_id
   where f.id = p_file_id and f.access = 'free' and f.status = 'published'
     and g.access = 'free' and g.status = 'published'
     and exists (select 1 from public.file_objects o where o.file_id = f.id);
  if not found then
    return query select * from private.no_file('not_found');
    return;
  end if;
  if not private.free_games_unlocked(p_user_id) then
    return query select * from private.no_file('locked');
    return;
  end if;
  return query select * from private.serve_file(p_user_id, v_file, 'free');
end $$;

-- ===== 6. Pagamento: os mesmos passos, com os ajudantes ===========================================

create or replace function public.fulfill_order(
  p_order_id            uuid,
  p_checkout_session_id text,
  p_payment_status      text,      -- 'paid'; 'no_payment_required' só com total 0 e desconto > 0 (cupom de 100%, D-25)
  p_amount_subtotal     bigint,    -- da sessão, antes do desconto
  p_amount_discount     bigint,    -- total_details.amount_discount da sessão (0 sem cupom)
  p_amount_total        bigint,
  p_currency            text,
  p_promotion_code      text,      -- texto do código promocional; NULL sem código
  p_payment_intent_id   text,      -- NULL permitido (cupom de 100% não tem intent); nunca apaga nem sobrescreve o gravado
  p_customer_id         text,
  p_livemode            boolean,
  p_items               jsonb,     -- [ { "stripe_price_id", "quantity", "unit_amount" (preço cheio), "currency" } ]
  p_source              text default 'webhook',
  p_stripe_event_id     text default null,
  p_event_type          text default null
) returns table (
  outcome           text,
  order_id          uuid,
  order_status      text,
  entitlement_count integer,
  outbox_id         uuid,
  send_delivery     boolean
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_order      public.orders%rowtype;
  v_code       text := nullif(btrim(p_promotion_code), '');
  v_event_type text := coalesce(nullif(btrim(p_event_type), ''), 'unspecified');
  v_outcome    text;
  v_customer   text;
  v_count      integer;
  v_outbox_id  uuid;
  v_send       boolean := false;
  v_rows       integer;
  v_item_count integer;
  v_sum        bigint;
  v_to_email   text;
begin
  -- 1. argumentos
  if p_order_id is null or p_checkout_session_id is null or p_checkout_session_id !~ '^cs_(test|live)_[A-Za-z0-9_]+$'
     or p_payment_status is null
     or p_amount_subtotal is null or p_amount_discount is null or p_amount_total is null
     or p_amount_subtotal < 0 or p_amount_discount < 0 or p_amount_total < 0
     or p_currency is null or p_currency !~ '^[a-z]{3}$'
     or p_livemode is null
     or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
     or p_source is null or p_source not in ('webhook', 'return_page', 'reconcile')
     or (p_stripe_event_id is not null and p_stripe_event_id !~ '^evt_[A-Za-z0-9_]+$')
     or (p_payment_intent_id is not null and p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$')
     or (p_customer_id is not null and p_customer_id !~ '^cus_[A-Za-z0-9_]+$')
     or (v_code is not null and char_length(v_code) > 200)
     or char_length(v_event_type) > 100 then
    raise exception 'fulfill_order: argumentos inválidos' using errcode = 'KT001';
  end if;
  if p_payment_status not in ('paid', 'no_payment_required')
     or (p_payment_status = 'no_payment_required' and not (p_amount_total = 0 and p_amount_discount > 0)) then
    raise exception 'fulfill_order: pagamento não confirmado (payment_status=%, total=%, desconto=%)',
      p_payment_status, p_amount_total, p_amount_discount using errcode = 'KT002';
  end if;

  -- 2. trava o pedido
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    if p_stripe_event_id is not null then
      insert into public.stripe_events (id, type, livemode, stripe_object_id, order_id, outcome)
      values (p_stripe_event_id, v_event_type, p_livemode, p_checkout_session_id, null, 'not_found')
      on conflict (id) do nothing;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        return query select 'duplicate_event'::text, null::uuid, null::text, null::integer, null::uuid, false;
        return;
      end if;
    end if;
    return query select 'not_found'::text, null::uuid, null::text, null::integer, null::uuid, false;
    return;
  end if;

  -- 3. ambiente
  if v_order.livemode is distinct from p_livemode
     or (left(p_checkout_session_id, 8) = 'cs_live_') is distinct from v_order.livemode then
    raise exception 'fulfill_order: livemode do pedido (%) diferente do evento (%)', v_order.livemode, p_livemode
      using errcode = 'KT005';
  end if;

  select count(*)::integer into v_count from public.entitlements e where e.order_id = p_order_id;
  select x.id into v_outbox_id from public.email_outbox x where x.dedupe_key = 'delivery:' || p_order_id::text;

  -- 4. evento repetido: nada muda
  if p_stripe_event_id is not null and exists (select 1 from public.stripe_events e where e.id = p_stripe_event_id) then
    return query select 'duplicate_event'::text, p_order_id, v_order.status, v_count, v_outbox_id, false;
    return;
  end if;

  -- 5. sessão, intent e cliente têm de ser os já associados ao pedido
  if v_order.stripe_checkout_session_id is not null and v_order.stripe_checkout_session_id <> p_checkout_session_id then
    raise exception 'fulfill_order: o pedido já está associado a outra sessão' using errcode = 'KT004';
  end if;
  if p_payment_intent_id is not null and v_order.stripe_payment_intent_id is not null
     and v_order.stripe_payment_intent_id <> p_payment_intent_id then
    raise exception 'fulfill_order: o pedido já está associado a outro payment_intent' using errcode = 'KT004';
  end if;
  if p_customer_id is not null then
    select pf.stripe_customer_id into v_customer from public.profiles pf where pf.user_id = v_order.user_id;
    if v_customer is not null and v_customer <> p_customer_id then
      raise exception 'fulfill_order: o perfil já está associado a outro cliente da Stripe' using errcode = 'KT004';
    end if;
  end if;

  -- 6. estado: paid = noop; open e pending_payment seguem; os demais são ignorados
  if v_order.status not in ('open', 'pending_payment') then
    v_outcome := case when v_order.status = 'paid' then 'noop' else 'ignored' end;
    perform private.log_stripe_event(p_stripe_event_id, v_event_type, p_livemode, p_checkout_session_id, p_order_id, v_outcome);
    return query select v_outcome, p_order_id, v_order.status, v_count, v_outbox_id, false;
    return;
  end if;

  -- 7. itens da sessão = itens do pedido; valores fecham (D-24)
  select count(*)::integer into v_item_count from public.order_items oi where oi.order_id = p_order_id;
  if (select count(*) from jsonb_array_elements(p_items)) <> v_item_count
     or (select count(distinct e->>'stripe_price_id') from jsonb_array_elements(p_items) e) <> v_item_count
     or exists (select 1 from jsonb_array_elements(p_items) e
                 where jsonb_typeof(e) <> 'object'
                    or e->>'stripe_price_id' is null
                    or (e->>'quantity') is distinct from '1'
                    or coalesce(e->>'unit_amount', '') !~ '^[0-9]{1,15}$'
                    or (e->>'currency') is distinct from p_currency)
     or exists (select 1 from public.order_items oi
                 where oi.order_id = p_order_id
                   and not exists (select 1 from jsonb_array_elements(p_items) e
                                    where e->>'stripe_price_id' = oi.stripe_price_id)) then
    raise exception 'fulfill_order: as line_items da sessão não batem com os itens do pedido' using errcode = 'KT012';
  end if;
  select sum((e->>'unit_amount')::bigint) into v_sum from jsonb_array_elements(p_items) e;
  if v_sum <> p_amount_subtotal or p_amount_discount > p_amount_subtotal
     or p_amount_subtotal - p_amount_discount <> p_amount_total then
    raise exception 'fulfill_order: valores da sessão não fecham (itens=%, subtotal=%, desconto=%, total=%)',
      v_sum, p_amount_subtotal, p_amount_discount, p_amount_total using errcode = 'KT012';
  end if;
  -- valores já gravados em pending_payment não mudam
  if (v_order.amount_total is not null
      and (v_order.amount_total <> p_amount_total
           or v_order.amount_subtotal is distinct from p_amount_subtotal
           or v_order.amount_discount is distinct from p_amount_discount
           or v_order.currency is distinct from p_currency))
     or (v_order.promotion_code is not null and v_code is not null and v_order.promotion_code <> v_code) then
    raise exception 'fulfill_order: valores da sessão diferentes dos já gravados no pedido' using errcode = 'KT012';
  end if;

  update public.order_items oi
     set unit_amount = (e.val->>'unit_amount')::bigint, currency = p_currency
    from jsonb_array_elements(p_items) as e(val)
   where oi.order_id = p_order_id and oi.stripe_price_id = e.val->>'stripe_price_id';

  -- 8. pedido
  update public.orders o
     set status = 'paid',
         paid_at = now(),
         amount_subtotal = p_amount_subtotal,
         amount_discount = p_amount_discount,
         amount_total = p_amount_total,
         currency = p_currency,
         promotion_code = coalesce(o.promotion_code, v_code),
         stripe_checkout_session_id = coalesce(o.stripe_checkout_session_id, p_checkout_session_id),
         stripe_payment_intent_id = coalesce(o.stripe_payment_intent_id, p_payment_intent_id)
   where o.id = p_order_id;
  if p_customer_id is not null then
    update public.profiles pf set stripe_customer_id = p_customer_id
     where pf.user_id = v_order.user_id and pf.stripe_customer_id is null;
  end if;

  -- 9. um direito por item, com a fotografia da composição
  perform private.grant_order_entitlements(p_order_id, v_order.user_id);
  select count(*)::integer into v_count from public.entitlements e where e.order_id = p_order_id;

  -- 10. carrinho: tira os produtos pagos e sobe a version (trava o carrinho depois do pedido)
  perform private.drop_order_from_cart(p_order_id, v_order.user_id);
  update public.email_outbox x
     set status = 'canceled', skip_reason = 'already_purchased'
   where x.user_id = v_order.user_id and x.kind = 'cart_reminder' and x.status = 'queued';

  -- 11. entrega: uma por pedido (dedupe_key), com um jogo por direito, sem token
  select private.normalize_email(u.email) into v_to_email from auth.users u where u.id = v_order.user_id;
  v_to_email := coalesce(v_to_email, v_order.email);

  v_outbox_id := null;
  insert into public.email_outbox (user_id, order_id, kind, category, to_email, payload, dedupe_key)
  values (v_order.user_id, p_order_id, 'delivery', 'transactional', v_to_email, private.delivery_payload(p_order_id), 'delivery:' || p_order_id::text)
  on conflict (dedupe_key) do nothing
  returning id into v_outbox_id;
  v_send := v_outbox_id is not null;
  if not v_send then
    select x.id into v_outbox_id from public.email_outbox x where x.dedupe_key = 'delivery:' || p_order_id::text;
  end if;

  -- 12. trilha, funil e livro-razão do evento (na mesma transação)
  insert into public.order_events (order_id, from_status, to_status, source, stripe_event_id)
  values (p_order_id, v_order.status, 'paid', p_source, p_stripe_event_id);
  insert into public.funnel_events (user_id, type, order_id) values (v_order.user_id, 'order_paid', p_order_id);
  perform private.log_stripe_event(p_stripe_event_id, v_event_type, p_livemode, p_checkout_session_id, p_order_id, 'applied');

  return query select 'applied'::text, p_order_id, 'paid'::text, v_count, v_outbox_id, v_send;
end $$;

create or replace function public.set_order_status(
  p_order_id          uuid,
  p_new_status        text,
  p_source            text default 'webhook',
  p_stripe_event_id   text default null,
  p_reason            text default null,
  p_amount_total      bigint default null,
  p_currency          text default null,
  p_payment_intent_id text default null,
  p_amount_subtotal   bigint default null,
  p_amount_discount   bigint default null,
  p_promotion_code    text default null,
  p_event_type        text default null
) returns table (
  outcome            text,
  order_id           uuid,
  previous_status    text,
  order_status       text,
  entitlement_status text
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_order      public.orders%rowtype;
  v_code       text := nullif(btrim(p_promotion_code), '');
  v_event_type text := coalesce(nullif(btrim(p_event_type), ''), 'unspecified');
  v_outcome    text;
  v_ent_status text;
begin
  if p_order_id is null or p_new_status is null
     or p_new_status not in ('pending_payment', 'failed', 'expired', 'disputed', 'dispute_lost', 'refunded', 'paid')
     or p_source is null or p_source not in ('webhook', 'return_page', 'reconcile')
     or (p_stripe_event_id is not null and p_stripe_event_id !~ '^evt_[A-Za-z0-9_]+$')
     or (p_reason is not null and char_length(p_reason) > 200)
     or (p_payment_intent_id is not null and p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$')
     or (p_currency is not null and p_currency !~ '^[a-z]{3}$')
     or p_amount_total < 0 or p_amount_subtotal < 0 or p_amount_discount < 0
     or (v_code is not null and char_length(v_code) > 200)
     or char_length(v_event_type) > 100 then
    raise exception 'set_order_status: argumentos inválidos' using errcode = 'KT001';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    -- sem o pedido não há livemode para o livro-razão: o evento não é gravado; a rota registra no log
    return query select 'not_found'::text, null::uuid, null::text, null::text, null::text;
    return;
  end if;

  v_ent_status := private.order_access(p_order_id);

  -- evento repetido
  if p_stripe_event_id is not null and exists (select 1 from public.stripe_events e where e.id = p_stripe_event_id) then
    return query select 'duplicate_event'::text, p_order_id, v_order.status, v_order.status, v_ent_status;
    return;
  end if;

  -- mesmo estado
  if v_order.status = p_new_status then
    perform private.log_stripe_event(p_stripe_event_id, v_event_type, v_order.livemode, v_order.stripe_checkout_session_id, p_order_id, 'noop');
    return query select 'noop'::text, p_order_id, v_order.status, v_order.status, v_ent_status;
    return;
  end if;

  -- 'paid' a partir de open/pending_payment é da fulfill_order (cria os direitos)
  if p_new_status = 'paid' and v_order.status in ('open', 'pending_payment') then
    raise exception 'set_order_status: use fulfill_order para pagar um pedido %', v_order.status using errcode = 'KT001';
  end if;

  -- o evento de cobrança chegou antes da liberação: a Stripe reenvia (não grava o evento)
  if (p_new_status in ('disputed', 'dispute_lost', 'refunded') and v_order.status in ('open', 'pending_payment'))
     or (p_new_status = 'dispute_lost' and v_order.status = 'paid') then
    return query select 'deferred'::text, p_order_id, v_order.status, v_order.status, v_ent_status;
    return;
  end if;

  -- aresta inexistente
  if not private.order_transition_allowed(v_order.status, p_new_status) then
    perform private.log_stripe_event(p_stripe_event_id, v_event_type, v_order.livemode, v_order.stripe_checkout_session_id, p_order_id, 'ignored');
    return query select 'ignored'::text, p_order_id, v_order.status, v_order.status, v_ent_status;
    return;
  end if;

  -- aplicar
  if p_new_status = 'pending_payment' then
    if p_amount_total is null or p_amount_subtotal is null or p_amount_discount is null or p_currency is null then
      raise exception 'set_order_status: pending_payment exige subtotal, desconto, total e moeda' using errcode = 'KT007';
    end if;
    if p_amount_discount > p_amount_subtotal or p_amount_subtotal - p_amount_discount <> p_amount_total then
      raise exception 'set_order_status: valores da sessão não fecham (subtotal=%, desconto=%, total=%)',
        p_amount_subtotal, p_amount_discount, p_amount_total using errcode = 'KT012';
    end if;
    update public.orders o
       set status = 'pending_payment', amount_subtotal = p_amount_subtotal, amount_discount = p_amount_discount,
           amount_total = p_amount_total, currency = p_currency, promotion_code = v_code,
           stripe_payment_intent_id = coalesce(o.stripe_payment_intent_id, p_payment_intent_id)
     where o.id = p_order_id;

  elsif p_new_status = 'failed' then
    update public.orders o set status = 'failed' where o.id = p_order_id;

  elsif p_new_status = 'expired' then
    update public.orders o set status = 'expired' where o.id = p_order_id;
    insert into public.funnel_events (user_id, type, order_id) values (v_order.user_id, 'checkout_expired', p_order_id);

  elsif p_new_status = 'disputed' then
    update public.orders o set status = 'disputed' where o.id = p_order_id;
    update public.entitlements e
       set status = 'revoked', revoked_at = now(), revoke_reason = 'dispute'
     where e.order_id = p_order_id and e.status = 'active';
    perform private.cancel_order_emails(p_order_id, 'entitlement_revoked');
    insert into public.funnel_events (user_id, type, order_id) values (v_order.user_id, 'dispute_opened', p_order_id);

  elsif p_new_status = 'paid' then   -- disputed -> paid: reativa só o que a contestação revogou
    update public.orders o set status = 'paid' where o.id = p_order_id;
    update public.entitlements e
       set status = 'active', revoked_at = null, revoke_reason = null
     where e.order_id = p_order_id and e.status = 'revoked' and e.revoke_reason = 'dispute';
    insert into public.funnel_events (user_id, type, order_id) values (v_order.user_id, 'dispute_closed', p_order_id);

  elsif p_new_status = 'dispute_lost' then   -- os direitos seguem revogados (dispute)
    update public.orders o set status = 'dispute_lost' where o.id = p_order_id;
    insert into public.funnel_events (user_id, type, order_id) values (v_order.user_id, 'dispute_closed', p_order_id);

  elsif p_new_status = 'refunded' then
    update public.orders o set status = 'refunded', refunded_at = now() where o.id = p_order_id;
    update public.entitlements e
       set status = 'revoked', revoked_at = coalesce(e.revoked_at, now()), revoke_reason = 'refund'
     where e.order_id = p_order_id and (e.status = 'active' or e.revoke_reason = 'dispute');
    perform private.cancel_order_emails(p_order_id, 'entitlement_revoked');
  end if;

  insert into public.order_events (order_id, from_status, to_status, source, stripe_event_id, reason)
  values (p_order_id, v_order.status, p_new_status, p_source, p_stripe_event_id, p_reason);
  perform private.log_stripe_event(p_stripe_event_id, v_event_type, v_order.livemode, v_order.stripe_checkout_session_id, p_order_id, 'applied');

  v_ent_status := private.order_access(p_order_id);
  v_outcome := 'applied';
  return query select v_outcome, p_order_id, v_order.status, p_new_status, v_ent_status;
end $$;

-- O motivo da revogação ('dispute', 'refund') fica escrito em set_order_status, o único que revoga por pagamento.
drop function private.access_effect(text);

-- ===== 7. Código curto do pedido em um lugar =======================================================

create or replace function private.delivery_payload(p_order_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'order_ref', private.order_ref(p_order_id),
    'items', coalesce((select jsonb_agg(jsonb_build_object('code', pr.code, 'name', pr.name) order by oi.position)
                         from public.order_items oi
                         join public.products pr on pr.id = oi.product_id
                        where oi.order_id = p_order_id), '[]'::jsonb),
    'games', coalesce((select jsonb_agg(jsonb_build_object('entitlement_id', t.entitlement_id, 'game_id', t.game_id,
                                                           'code', t.code, 'name', t.name)
                                        order by t.item_position, t.game_position, t.game_id)
                         from (select distinct on (g.id)
                                      e.id as entitlement_id, g.id as game_id, g.code, g.name,
                                      oi.position as item_position, eg.position as game_position
                                 from public.entitlements e
                                 join public.order_items oi on oi.order_id = e.order_id and oi.product_id = e.product_id
                                 join public.entitlement_games eg on eg.entitlement_id = e.id
                                 join public.games g on g.id = eg.game_id
                                where e.order_id = p_order_id
                                order by g.id, oi.position) t), '[]'::jsonb))
$$;

create or replace function public.get_library(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_confirmed_email(p_user_id);

  return (
    with ent as (
      select e.id, e.product_id, e.granted_at
      from public.entitlements e
      where e.user_id = p_user_id and e.status = 'active'
    ),
    owned as (
      select eg.game_id, ent.product_id, ent.granted_at, eg.position
      from ent
      join public.entitlement_games eg on eg.entitlement_id = ent.id
    ),
    per_game as (
      select o.game_id, min(o.granted_at) as acquired_at, min(o.position) as pos
      from owned o
      group by o.game_id
    )
    select jsonb_build_object(
      'games', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'code', g.code,
                   'name', g.name,
                   'acquired_at', pgm.acquired_at,
                   'products', (
                     select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name) order by p.code)
                     from public.products p
                     where p.id in (select o.product_id from owned o where o.game_id = pgm.game_id)),
                   'files', coalesce((
                     select jsonb_agg(
                              jsonb_build_object('id', f.id, 'kind', f.kind, 'version', f.version,
                                                 'size_bytes', f.size_bytes)
                              order by f.kind, f.version)
                     from public.files f
                     where f.game_id = g.id and f.access = 'paid' and f.status = 'published'), '[]'::jsonb))
                 order by pgm.acquired_at, pgm.pos, g.code)
        from per_game pgm
        join public.games g on g.id = pgm.game_id), '[]'::jsonb),
      'pending', coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'ref', private.order_ref(o.id),
                   'created_at', o.created_at,
                   'products', (
                     select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name) order by i.position)
                     from public.order_items i
                     join public.products p on p.id = i.product_id
                     where i.order_id = o.id))
                 order by o.created_at desc, o.id desc)
        from public.orders o
        where o.user_id = p_user_id and o.status = 'pending_payment'), '[]'::jsonb)
    )
  );
end $$;

create or replace function private.enqueue_followups(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  c_reminder_after constant interval := interval '3 hours';   -- lembrete de carrinho: sem mudança há 3 h (D3)
  c_post_after     constant interval := interval '3 days';    -- pós-compra em D+3 (D3)
  c_post_until     constant interval := interval '14 days';   -- janela do pós-compra: não dispara pedido velho quando a agenda liga
  v_sched timestamptz := least(coalesce(p_now, now()), now());   -- igual a p_now em produção; deixa o teste adiantar o relógio
  v_now   timestamptz := coalesce(p_now, now());
  v_n     integer := 0;
  v_rows  integer;
begin
  -- lembrete de carrinho: itens vendáveis e ainda não possuídos, carrinho parado, uma vez por version
  insert into public.email_outbox (user_id, kind, category, to_email, payload, scheduled_at, dedupe_key)
  select c.user_id, 'cart_reminder', 'marketing', private.normalize_email(u.email),
         jsonb_build_object('cart_version', c.version, 'items', it.items),
         v_sched, 'cart_reminder:' || c.user_id::text || ':' || c.version::text
    from public.carts c
    join auth.users u on u.id = c.user_id
   cross join lateral (
     select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name) order by ci.added_at, p.id) as items, count(*) as n
       from public.cart_items ci
       join public.products p on p.id = ci.product_id
      where ci.user_id = c.user_id
        and private.product_is_sellable(p.id)
        and not (exists (select 1 from public.product_games pg where pg.product_id = p.id)
                 and not exists (select 1 from public.product_games pg
                                  where pg.product_id = p.id
                                    and pg.game_id not in (select o from private.owned_game_ids(c.user_id) o)))
   ) it
   where c.updated_at <= v_now - c_reminder_after
     and it.n > 0
     and not exists (select 1 from public.orders o where o.user_id = c.user_id and o.status = 'pending_payment')
     and private.marketing_allowed(c.user_id)
  on conflict (dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  v_n := v_n + v_rows;

  -- pós-compra: pedido pago entre D+3 e D+14, com direito ativo, uma vez por pedido
  insert into public.email_outbox (user_id, order_id, kind, category, to_email, payload, scheduled_at, dedupe_key)
  select o.user_id, o.id, 'post_purchase', 'marketing', private.normalize_email(u.email),
         jsonb_build_object('order_ref', private.order_ref(o.id), 'games', gm.games),
         v_sched, 'post_purchase:' || o.id::text
    from public.orders o
    join auth.users u on u.id = o.user_id
   cross join lateral (
     select jsonb_agg(jsonb_build_object('code', t.code, 'name', t.name) order by t.item_pos, t.game_pos, t.gid) as games, count(*) as n
       from (select distinct on (g.id) g.id as gid, g.code, g.name, oi.position as item_pos, eg.position as game_pos
               from public.entitlements e
               join public.order_items oi on oi.order_id = e.order_id and oi.product_id = e.product_id
               join public.entitlement_games eg on eg.entitlement_id = e.id
               join public.games g on g.id = eg.game_id
              where e.order_id = o.id and e.status = 'active'
              order by g.id, oi.position) t
   ) gm
   where o.status = 'paid'
     and o.paid_at <= v_now - c_post_after
     and o.paid_at >  v_now - c_post_until
     and gm.n > 0
     and private.marketing_allowed(o.user_id)
  on conflict (dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  v_n := v_n + v_rows;

  return v_n;
end $$;

create or replace function public.export_account_data(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_email text;
begin
  v_email := private.require_confirmed_email(p_user_id);

  return jsonb_build_object(
    'generated_at', now(),
    'account', (
      select jsonb_build_object(
               'email', v_email,
               'created_at', u.created_at,
               'email_confirmed_at', u.email_confirmed_at,
               'last_sign_in_at', u.last_sign_in_at,
               'sign_in_methods', coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb),
               'name', coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
               'avatar_url', coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture'),
               'has_password', coalesce(u.encrypted_password, '') <> '',
               'stripe_customer_id', p.stripe_customer_id)
        from auth.users u
        left join public.profiles p on p.user_id = u.id
       where u.id = p_user_id),
    'marketing', (
      select jsonb_build_object('opted_in', p.marketing_opt_in, 'opted_in_at', p.marketing_opt_in_at, 'prompted_at', p.marketing_prompted_at)
        from public.profiles p where p.user_id = p_user_id),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object('action', c.action, 'source', c.source, 'text_version', c.text_version,
                                          'email', c.email, 'occurred_at', c.occurred_at) order by c.occurred_at, c.id)
        from public.marketing_consents c where c.user_id = p_user_id), '[]'::jsonb),
    'cart', coalesce((
      select jsonb_agg(jsonb_build_object('code', pr.code, 'name', pr.name, 'added_at', ci.added_at) order by ci.added_at, pr.id)
        from public.cart_items ci join public.products pr on pr.id = ci.product_id
       where ci.user_id = p_user_id), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'ref', private.order_ref(o.id),
               'status', o.status,
               'email', o.email,
               'created_at', o.created_at,
               'paid_at', o.paid_at,
               'refunded_at', o.refunded_at,
               'amount_subtotal', o.amount_subtotal,
               'amount_discount', o.amount_discount,
               'amount_total', o.amount_total,
               'currency', o.currency,
               'promotion_code', o.promotion_code,
               'terms_version', o.terms_version,
               'terms_accepted_at', o.terms_accepted_at,
               'items', coalesce((
                 select jsonb_agg(jsonb_build_object('code', pr.code, 'name', pr.name, 'unit_amount', i.unit_amount, 'currency', i.currency)
                                  order by i.position)
                   from public.order_items i join public.products pr on pr.id = i.product_id
                  where i.order_id = o.id), '[]'::jsonb))
             order by o.created_at, o.id)
        from public.orders o where o.user_id = p_user_id), '[]'::jsonb),
    'library', coalesce((
      select jsonb_agg(jsonb_build_object(
               'order_ref', private.order_ref(e.order_id),
               'product', jsonb_build_object('code', pr.code, 'name', pr.name),
               'status', e.status,
               'granted_at', e.granted_at,
               'revoked_at', e.revoked_at,
               'revoke_reason', e.revoke_reason,
               'games', coalesce((
                 select jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name) order by eg.position)
                   from public.entitlement_games eg join public.games g on g.id = eg.game_id
                  where eg.entitlement_id = e.id), '[]'::jsonb))
             order by e.granted_at, e.id)
        from public.entitlements e join public.products pr on pr.id = e.product_id
       where e.user_id = p_user_id), '[]'::jsonb),
    'downloads', coalesce((
      select jsonb_agg(jsonb_build_object('game', g.code, 'file', f.filename, 'version', f.version, 'at', d.created_at)
                       order by d.created_at, d.id)
        from public.download_events d
        join public.files f on f.id = d.file_id
        left join public.games g on g.id = f.game_id
       where d.user_id = p_user_id), '[]'::jsonb),
    'emails', coalesce((
      select jsonb_agg(jsonb_build_object('kind', x.kind, 'category', x.category, 'to', x.to_email, 'status', x.status,
                                          'created_at', x.created_at, 'sent_at', x.sent_at) order by x.created_at, x.id)
        from public.email_outbox x where x.user_id = p_user_id), '[]'::jsonb),
    'email_suppressions', coalesce((
      select jsonb_agg(jsonb_build_object('reason', s.reason, 'source', s.source, 'occurred_at', s.occurred_at) order by s.occurred_at, s.reason)
        from public.email_suppressions s where s.email = v_email), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(jsonb_build_object(
               'type', fe.type,
               'at', fe.occurred_at,
               'product', pr.code,
               'order_ref', case when fe.order_id is not null then private.order_ref(fe.order_id) end)
             order by fe.occurred_at, fe.id)
        from public.funnel_events fe left join public.products pr on pr.id = fe.product_id
       where fe.user_id = p_user_id), '[]'::jsonb));
end $$;

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
                 'ref', private.order_ref(o.id),
                 'kind', o.kind,
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

-- ===== 8. RPCs de admin com o portão em um lugar ===================================================

create or replace function public.admin_get_user(p_user_id uuid, p_target uuid) returns table (outcome text, result jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user  auth.users%rowtype;
  v_email text;
begin
  if p_user_id is null or p_target is null then
    raise exception 'admin_get_user: p_user_id e p_target são obrigatórios' using errcode = 'KT001';
  end if;
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  select * into v_user from auth.users u where u.id = p_target and u.deleted_at is null;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  v_email := private.normalize_email(v_user.email);

  return query select 'ok'::text, jsonb_build_object(
    'account', jsonb_build_object(
      'id', v_user.id, 'email', v_user.email, 'created_at', v_user.created_at,
      'confirmed_at', v_user.email_confirmed_at, 'last_sign_in_at', v_user.last_sign_in_at,
      'providers', coalesce(v_user.raw_app_meta_data -> 'providers', jsonb_build_array(v_user.raw_app_meta_data ->> 'provider')),
      'name', coalesce(v_user.raw_user_meta_data ->> 'full_name', v_user.raw_user_meta_data ->> 'name'),
      'blocked', coalesce(v_user.banned_until > now(), false), 'banned_until', v_user.banned_until,
      'admin', coalesce(v_user.raw_app_meta_data -> 'admin' = 'true'::jsonb, false),
      'self', p_target = p_user_id,
      'stripe_customer_id', (select pf.stripe_customer_id from public.profiles pf where pf.user_id = p_target)),
    'newsletter', jsonb_build_object(
      'opted_in', coalesce((select pf.marketing_opt_in from public.profiles pf where pf.user_id = p_target), false),
      'opted_in_at', (select pf.marketing_opt_in_at from public.profiles pf where pf.user_id = p_target),
      'history', coalesce((select jsonb_agg(jsonb_build_object('action', c.action, 'source', c.source, 'occurred_at', c.occurred_at)
                                            order by c.occurred_at desc, c.id desc)
                             from (select * from public.marketing_consents c where c.user_id = p_target
                                    order by c.occurred_at desc, c.id desc limit 20) c), '[]'::jsonb)),
    'library', coalesce((select jsonb_agg(jsonb_build_object(
        'entitlement_id', e.id, 'status', e.status, 'revoke_reason', e.revoke_reason,
        'granted_at', e.granted_at, 'revoked_at', e.revoked_at,
        'product', jsonb_build_object('code', p.code, 'name', p.name, 'kind', p.kind),
        'order', jsonb_build_object('id', o.id, 'ref', private.order_ref(o.id), 'kind', o.kind),
        'games', coalesce((select jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name) order by eg.position)
                             from public.entitlement_games eg join public.games g on g.id = eg.game_id
                            where eg.entitlement_id = e.id), '[]'::jsonb))
        order by e.granted_at desc, e.id)
      from public.entitlements e
      join public.products p on p.id = e.product_id
      join public.orders o on o.id = e.order_id
     where e.user_id = p_target), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'ref', private.order_ref(o.id), 'kind', o.kind, 'status', o.status,
        'created_at', o.created_at, 'paid_at', o.paid_at, 'refunded_at', o.refunded_at,
        'amount_total', o.amount_total, 'amount_discount', o.amount_discount, 'currency', o.currency,
        'promotion_code', o.promotion_code, 'livemode', o.livemode,
        'deliverable', o.status = 'paid'
                       and not exists (select 1 from public.entitlements x where x.order_id = o.id and x.status <> 'active'),
        'items', coalesce((select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'unit_amount', i.unit_amount)
                                            order by i.position)
                             from public.order_items i join public.products p on p.id = i.product_id
                            where i.order_id = o.id), '[]'::jsonb))
        order by o.created_at desc, o.id)
      from public.orders o where o.user_id = p_target), '[]'::jsonb),
    'emails', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', x.kind, 'status', x.status, 'skip_reason', x.skip_reason, 'created_at', x.created_at, 'sent_at', x.sent_at,
        'order_ref', case when x.order_id is not null then private.order_ref(x.order_id) end)
        order by x.created_at desc, x.id)
      from (select * from public.email_outbox x where x.user_id = p_target order by x.created_at desc, x.id limit 20) x), '[]'::jsonb),
    'suppressions', coalesce((select jsonb_agg(jsonb_build_object('reason', s.reason, 'source', s.source, 'occurred_at', s.occurred_at)
                                               order by s.occurred_at desc)
                                from public.email_suppressions s where s.email = v_email), '[]'::jsonb),
    'downloads', jsonb_build_object(
      'count', (select count(*) from public.download_events d where d.user_id = p_target),
      'last_at', (select max(d.created_at) from public.download_events d where d.user_id = p_target)),
    'history', coalesce((select jsonb_agg(jsonb_build_object(
        'action', a.action, 'created_at', a.created_at, 'details', a.details,
        'by', (select u.email from auth.users u where u.id = a.user_id))
        order by a.created_at desc, a.id desc)
      from (select * from private.admin_events a where a.target_id = p_target order by a.created_at desc, a.id desc limit 50) a), '[]'::jsonb),
    'giftable', coalesce((select jsonb_agg(jsonb_build_object(
        'code', p.code, 'name', p.name, 'kind', p.kind,
        'owned', not exists (select 1 from public.product_games pg
                              where pg.product_id = p.id
                                and not exists (select 1 from public.entitlements e
                                                  join public.entitlement_games eg on eg.entitlement_id = e.id
                                                 where e.user_id = p_target and e.status = 'active' and eg.game_id = pg.game_id)))
        order by p.kind, p.code)
      from public.products p where p.status = 'active'), '[]'::jsonb));
end $$;

create or replace function public.admin_revoke_entitlement(p_user_id uuid, p_target uuid, p_entitlement_id uuid, p_reason text)
  returns table (outcome text)
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_target text;
  v_ent    public.entitlements%rowtype;
begin
  if p_user_id is null or p_target is null or p_entitlement_id is null then
    raise exception 'admin_revoke_entitlement: argumentos obrigatórios' using errcode = 'KT001';
  end if;
  v_reason := private.admin_reason(p_reason);
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text;
    return;
  end if;
  v_target := private.admin_target(p_user_id, p_target, true);
  if v_target <> 'ok' then
    return query select v_target;
    return;
  end if;
  select * into v_ent from public.entitlements e where e.id = p_entitlement_id and e.user_id = p_target for update;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;
  if v_ent.status <> 'active' then
    return query select 'not_active'::text;
    return;
  end if;
  update public.entitlements e set status = 'revoked', revoke_reason = 'manual', revoked_at = now() where e.id = v_ent.id;
  insert into private.admin_events (user_id, action, target_id, details)
  values (p_user_id, 'user_revoke', p_target, jsonb_build_object(
    'entitlement_id', v_ent.id, 'order_id', v_ent.order_id,
    'product', (select p.code from public.products p where p.id = v_ent.product_id), 'reason', v_reason));
  return query select 'ok'::text;
end $$;

create or replace function public.admin_resend_delivery(p_user_id uuid, p_target uuid, p_order_id uuid)
  returns table (outcome text, outbox_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_order  public.orders%rowtype;
  v_email  text;
  v_outbox uuid;
begin
  if p_user_id is null or p_target is null or p_order_id is null then
    raise exception 'admin_resend_delivery: argumentos obrigatórios' using errcode = 'KT001';
  end if;
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::uuid;
    return;
  end if;
  select * into v_order from public.orders o where o.id = p_order_id and o.user_id = p_target for update;
  select private.normalize_email(u.email) into v_email from auth.users u where u.id = p_target and u.deleted_at is null;
  if v_order.id is null or v_email is null then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  if v_order.status <> 'paid' or exists (select 1 from public.entitlements e where e.order_id = p_order_id and e.status <> 'active') then
    return query select 'not_deliverable'::text, null::uuid;
    return;
  end if;
  if exists (select 1 from public.email_outbox x
              where x.order_id = p_order_id and x.kind in ('delivery', 'gift') and x.status in ('queued', 'sending')) then
    return query select 'already_queued'::text, null::uuid;
    return;
  end if;
  insert into public.email_outbox (user_id, order_id, kind, category, to_email, payload, dedupe_key)
  values (p_target, p_order_id, case v_order.kind when 'courtesy' then 'gift' else 'delivery' end, 'transactional', v_email,
          private.delivery_payload(p_order_id),
          'resend:' || p_order_id::text || ':' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text)
  returning id into v_outbox;
  insert into private.admin_events (user_id, action, target_id, details)
  values (p_user_id, 'user_resend', p_target, jsonb_build_object('order_id', p_order_id, 'outbox_id', v_outbox));
  return query select 'ok'::text, v_outbox;
end $$;

create or replace function public.admin_newsletter_off(p_user_id uuid, p_target uuid, p_reason text) returns table (outcome text)
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_target text;
  v_opted  boolean;
begin
  if p_user_id is null or p_target is null then
    raise exception 'admin_newsletter_off: argumentos obrigatórios' using errcode = 'KT001';
  end if;
  v_reason := private.admin_reason(p_reason);
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text;
    return;
  end if;
  v_target := private.admin_target(p_user_id, p_target, false);
  if v_target <> 'ok' then
    return query select v_target;
    return;
  end if;
  select pf.marketing_opt_in into v_opted from public.profiles pf where pf.user_id = p_target for update;
  if not coalesce(v_opted, false) then
    return query select 'not_subscribed'::text;
    return;
  end if;
  insert into public.marketing_consents (user_id, email, action, source, text_version)
  select p_target, private.normalize_email(u.email), 'revoked', 'support', null from auth.users u where u.id = p_target;
  perform private.cancel_queued_marketing(p_target);
  insert into private.admin_events (user_id, action, target_id, details)
  values (p_user_id, 'user_newsletter_off', p_target, jsonb_build_object('reason', v_reason));
  return query select 'ok'::text;
end $$;

create or replace function public.admin_check_user_block(p_user_id uuid, p_target uuid) returns table (outcome text, blocked boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_target text;
begin
  if p_user_id is null or p_target is null then
    raise exception 'admin_check_user_block: argumentos obrigatórios' using errcode = 'KT001';
  end if;
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::boolean;
    return;
  end if;
  v_target := private.admin_target(p_user_id, p_target, true);
  return query select v_target,
    case when v_target = 'ok' then coalesce((select u.banned_until > now() from auth.users u where u.id = p_target), false) end;
end $$;

create or replace function public.admin_log_user_block(p_user_id uuid, p_target uuid, p_blocked boolean, p_reason text)
  returns table (outcome text)
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
begin
  if p_user_id is null or p_target is null or p_blocked is null then
    raise exception 'admin_log_user_block: argumentos obrigatórios' using errcode = 'KT001';
  end if;
  v_reason := private.admin_reason(p_reason);
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text;
    return;
  end if;
  insert into private.admin_events (user_id, action, target_id, details)
  values (p_user_id, case when p_blocked then 'user_block' else 'user_unblock' end, p_target, jsonb_build_object('reason', v_reason));
  return query select 'ok'::text;
end $$;

create or replace function public.admin_export_user(p_user_id uuid, p_target uuid) returns table (outcome text, data jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  v_target text;
begin
  if p_user_id is null or p_target is null then
    raise exception 'admin_export_user: argumentos obrigatórios' using errcode = 'KT001';
  end if;
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  v_target := private.admin_target(p_user_id, p_target, false);
  if v_target <> 'ok' then
    return query select v_target, null::jsonb;
    return;
  end if;
  if private.confirmed_email(p_target) is null then
    return query select 'not_confirmed'::text, null::jsonb;
    return;
  end if;
  insert into private.admin_events (user_id, action, target_id) values (p_user_id, 'user_export', p_target);
  return query select 'ok'::text, public.export_account_data(p_target);
end $$;

create or replace function public.admin_delete_user(p_user_id uuid, p_target uuid, p_reason text, p_confirm_email text)
  returns table (outcome text, reason text, orders_anonymized integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_target text;
  r        record;
begin
  if p_user_id is null or p_target is null then
    raise exception 'admin_delete_user: argumentos obrigatórios' using errcode = 'KT001';
  end if;
  v_reason := private.admin_reason(p_reason);
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::text, null::integer;
    return;
  end if;
  v_target := private.admin_target(p_user_id, p_target, true);
  if v_target <> 'ok' then
    return query select v_target, null::text, null::integer;
    return;
  end if;
  if private.normalize_email(p_confirm_email) is distinct from
     (select private.normalize_email(u.email) from auth.users u where u.id = p_target) then
    return query select 'confirmation_mismatch'::text, null::text, null::integer;
    return;
  end if;
  if private.confirmed_email(p_target) is null then
    return query select 'not_confirmed'::text, null::text, null::integer;
    return;
  end if;
  select * into r from public.delete_account_data(p_target);
  if r.outcome <> 'deleted' then
    return query select r.outcome, r.reason, null::integer;
    return;
  end if;
  insert into private.admin_events (user_id, action, target_id, details)
  values (p_user_id, 'user_delete', p_target, jsonb_build_object('reason', v_reason, 'orders_anonymized', r.orders_anonymized));
  return query select 'deleted'::text, null::text, r.orders_anonymized;
end $$;

create or replace function public.get_admin_metrics(p_user_id uuid, p_days integer, p_livemode boolean)
  returns table (outcome text, metrics jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_first date;
  v_since timestamptz;
begin
  if p_user_id is null or p_days is null or p_days not between 1 and 366 or p_livemode is null then
    raise exception 'get_admin_metrics: p_user_id, p_days (1 a 366) e p_livemode são obrigatórios' using errcode = 'KT001';
  end if;
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  v_first := v_today - (p_days - 1);
  v_since := v_first::timestamp at time zone 'America/Sao_Paulo';

  return query
  with sales as (
    select o.user_id, o.amount_total, (o.paid_at at time zone 'America/Sao_Paulo')::date as day
      from public.orders o
     where o.paid_at >= v_since and o.livemode = p_livemode and o.currency = 'brl' and o.status in ('paid', 'disputed')
       and o.kind = 'purchase'
  ), accounts as (
    select (e.occurred_at at time zone 'America/Sao_Paulo')::date as day
      from public.funnel_events e
     where e.type = 'account_confirmed' and e.occurred_at >= v_since
  ), days as (
    select d::date as day from generate_series(v_first::timestamp, v_today::timestamp, interval '1 day') d
  )
  select 'ok'::text, jsonb_build_object(
    'days', p_days,
    'since', v_first,
    'until', v_today,
    'livemode', p_livemode,
    'sales', jsonb_build_object(
      'orders', (select count(*) from sales),
      'revenue', (select coalesce(sum(s.amount_total), 0) from sales s),
      'currency', 'brl'),
    'accounts', (select count(*) from accounts),
    'funnel', jsonb_build_object(
      'cart', (select count(distinct e.user_id) from public.funnel_events e where e.type = 'cart_item_added' and e.occurred_at >= v_since),
      'checkout', (select count(distinct e.user_id) from public.funnel_events e where e.type = 'checkout_started' and e.occurred_at >= v_since),
      'paid', (select count(distinct s.user_id) from sales s)),
    'downloads', jsonb_build_object(
      'paid', (select count(*) from public.download_events d where d.kind = 'paid' and d.created_at >= v_since),
      'free', (select count(*) from public.download_events d where d.kind = 'free' and d.created_at >= v_since)),
    'free_unlocks', (select count(*) from (
      select c.user_id from public.marketing_consents c where c.action = 'granted'
       group by c.user_id having min(c.occurred_at) >= v_since) f),
    'newsletter', jsonb_build_object('subscribed', (select count(*) from public.profiles p where p.marketing_opt_in)),
    'daily', (select jsonb_agg(jsonb_build_object(
        'date', d.day,
        'orders', (select count(*) from sales s where s.day = d.day),
        'revenue', (select coalesce(sum(s.amount_total), 0) from sales s where s.day = d.day),
        'accounts', (select count(*) from accounts a where a.day = d.day)) order by d.day)
      from days d));
end $$;

create or replace function public.admin_list_blog_posts(p_user_id uuid) returns table (outcome text, result jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  return query select 'ok'::text, jsonb_build_object(
    'version', private.blog_version(),
    'posts', coalesce((select jsonb_agg(private.blog_post_json(b, false) order by b.updated_at desc, b.slug)
                         from private.blog_posts b), '[]'::jsonb));
end $$;

create or replace function public.admin_get_blog_post(p_user_id uuid, p_post_id uuid) returns table (outcome text, post jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_post private.blog_posts%rowtype;
begin
  if p_user_id is null or p_post_id is null then
    raise exception 'admin_get_blog_post: p_user_id e p_post_id são obrigatórios' using errcode = 'KT001';
  end if;
  if not private.confirmed_admin(p_user_id) then
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

create or replace function public.admin_delete_blog_post(p_user_id uuid, p_post_id uuid) returns table (outcome text)
language plpgsql security definer set search_path = '' as $$
declare
  v_post private.blog_posts%rowtype;
begin
  if p_user_id is null or p_post_id is null then
    raise exception 'admin_delete_blog_post: p_user_id e p_post_id são obrigatórios' using errcode = 'KT001';
  end if;
  if not private.confirmed_admin(p_user_id) then
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

create or replace function public.admin_register_blog_image(p_user_id uuid, p_path text) returns table (outcome text)
language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or p_path is null or p_path !~* '^/images/blog/([a-z0-9_-]+/)*[a-z0-9_.-]+\.(avif|webp|png|jpe?g|gif)$' or p_path ~ '\.\.' then
    raise exception 'admin_register_blog_image: p_user_id e p_path (em /images/blog) são obrigatórios' using errcode = 'KT001';
  end if;
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text;
    return;
  end if;
  insert into private.admin_events (user_id, action, details) values (p_user_id, 'blog_image', jsonb_build_object('path', p_path));
  return query select 'ok'::text;
end $$;

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
  if not private.confirmed_admin(p_user_id) then
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

create or replace function public.admin_blog_image_usage(p_user_id uuid) returns table (outcome text, usage jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  return query select 'ok'::text, private.blog_image_usage();
end $$;

create or replace function public.admin_delete_blog_image(p_user_id uuid, p_path text) returns table (outcome text, used_by jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  v_used jsonb;
begin
  if p_user_id is null or p_path is null or p_path !~* '^/images/blog/([a-z0-9_-]+/)*[a-z0-9_.-]+\.(avif|webp|png|jpe?g|gif)$' or p_path ~ '\.\.' then
    raise exception 'admin_delete_blog_image: p_user_id e p_path (em /images/blog) são obrigatórios' using errcode = 'KT001';
  end if;
  if not private.confirmed_admin(p_user_id) then
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

create or replace function public.admin_list_users(p_user_id uuid, p_query text, p_filter text, p_offset integer)
  returns table (outcome text, result jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_query text := nullif(lower(btrim(coalesce(p_query, ''))), '');
begin
  if p_user_id is null or p_filter is null or p_filter not in ('all', 'buyers', 'newsletter', 'blocked', 'admins')
     or p_offset is null or p_offset not between 0 and 1000000 or char_length(coalesce(p_query, '')) > 200 then
    raise exception 'admin_list_users: argumentos inválidos' using errcode = 'KT001';
  end if;
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;

  return query
  with people as (
    select u.id, u.email, u.created_at, u.last_sign_in_at, u.email_confirmed_at,
           coalesce(u.banned_until > now(), false) as blocked,
           coalesce(u.raw_app_meta_data -> 'admin' = 'true'::jsonb, false) as is_admin,
           coalesce(u.raw_app_meta_data -> 'providers', jsonb_build_array(u.raw_app_meta_data ->> 'provider')) as providers,
           coalesce(pf.marketing_opt_in, false) as newsletter,
           (select count(*) from public.orders o where o.user_id = u.id and o.kind = 'purchase' and o.paid_at is not null) as purchases,
           (select count(distinct eg.game_id) from public.entitlements e
              join public.entitlement_games eg on eg.entitlement_id = e.id
             where e.user_id = u.id and e.status = 'active') as games
      from auth.users u
      left join public.profiles pf on pf.user_id = u.id
     where u.deleted_at is null and not coalesce(u.is_anonymous, false)
       and (v_query is null or position(v_query in lower(coalesce(u.email, ''))) > 0)
  ), chosen as (
    select * from people p
     where case p_filter when 'buyers' then p.purchases > 0 when 'newsletter' then p.newsletter
                         when 'blocked' then p.blocked when 'admins' then p.is_admin else true end
  )
  select 'ok'::text, jsonb_build_object(
    'total', (select count(*) from chosen),
    'offset', p_offset,
    'limit', 50,
    'users', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'email', c.email, 'created_at', c.created_at, 'last_sign_in_at', c.last_sign_in_at,
        'confirmed', c.email_confirmed_at is not null, 'blocked', c.blocked, 'admin', c.is_admin,
        'providers', c.providers, 'newsletter', c.newsletter, 'purchases', c.purchases, 'games', c.games)
        order by c.created_at desc, c.id)
      from (select * from chosen order by created_at desc, id limit 50 offset p_offset) c), '[]'::jsonb));
end $$;

create or replace function public.admin_set_admin(p_user_id uuid, p_target uuid, p_admin boolean, p_reason text) returns table (outcome text)
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_user   auth.users%rowtype;
  v_is     boolean;
begin
  if p_user_id is null or p_target is null or p_admin is null then
    raise exception 'admin_set_admin: argumentos obrigatórios' using errcode = 'KT001';
  end if;
  v_reason := private.admin_reason(p_reason);
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text;
    return;
  end if;
  -- uma mudança de equipe por vez: dois admins tirando o admin um do outro ao mesmo tempo não esvaziam a equipe
  perform 1 from auth.users u where u.raw_app_meta_data -> 'admin' = 'true'::jsonb and u.deleted_at is null for update;
  select * into v_user from auth.users u where u.id = p_target and u.deleted_at is null for update;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;
  v_is := coalesce(v_user.raw_app_meta_data -> 'admin' = 'true'::jsonb, false);
  if v_is = p_admin then
    return query select 'unchanged'::text;
    return;
  end if;
  if p_admin then
    if v_user.email_confirmed_at is null then
      return query select 'not_confirmed'::text;
      return;
    end if;
    if coalesce(v_user.banned_until > now(), false) then
      return query select 'blocked'::text;
      return;
    end if;
  else
    if p_target = p_user_id then
      return query select 'self'::text;
      return;
    end if;
    if (select count(*) from auth.users u where u.raw_app_meta_data -> 'admin' = 'true'::jsonb and u.deleted_at is null) <= 1 then
      return query select 'last_admin'::text;
      return;
    end if;
  end if;
  update auth.users u
     set raw_app_meta_data = case when p_admin then coalesce(u.raw_app_meta_data, '{}'::jsonb) || '{"admin": true}'::jsonb
                                  else coalesce(u.raw_app_meta_data, '{}'::jsonb) - 'admin' end
   where u.id = p_target;
  insert into private.admin_events (user_id, action, target_id, details)
  values (p_user_id, case when p_admin then 'user_admin_grant' else 'user_admin_revoke' end, p_target, jsonb_build_object('reason', v_reason));
  return query select 'ok'::text;
end $$;

create or replace function public.admin_gift_products(p_user_id uuid, p_target uuid, p_product_codes text[], p_reason text,
                                           p_notify boolean, p_livemode boolean)
  returns table (outcome text, order_id uuid, outbox_id uuid, products text[])
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_email  text;
  v_codes  text[];
  v_bad    text[];
  v_order  uuid;
  v_outbox uuid;
begin
  if p_user_id is null or p_target is null or p_product_codes is null or p_notify is null or p_livemode is null
     or cardinality(p_product_codes) not between 1 and 10
     or (select count(distinct c) from unnest(p_product_codes) c) <> cardinality(p_product_codes)
     or exists (select 1 from unnest(p_product_codes) c where c is null) then
    raise exception 'admin_gift_products: de 1 a 10 produtos, sem repetir' using errcode = 'KT001';
  end if;
  v_codes := p_product_codes;
  v_reason := private.admin_reason(p_reason);
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::uuid, null::uuid, null::text[];
    return;
  end if;
  select private.normalize_email(u.email) into v_email from auth.users u where u.id = p_target and u.deleted_at is null;
  if not found or v_email is null then
    return query select 'not_found'::text, null::uuid, null::uuid, null::text[];
    return;
  end if;

  select array_agg(c order by c) into v_bad from unnest(v_codes) c
   where not exists (select 1 from public.products p where p.code = c and p.status = 'active');
  if v_bad is not null then
    return query select 'product_unavailable'::text, null::uuid, null::uuid, v_bad;
    return;
  end if;
  -- produto que a pessoa já tem inteiro (todos os jogos com acesso)
  select array_agg(p.code order by p.code) into v_bad from public.products p
   where p.code = any(v_codes)
     and not exists (select 1 from public.product_games pg
                      where pg.product_id = p.id
                        and not exists (select 1 from public.entitlements e
                                          join public.entitlement_games eg on eg.entitlement_id = e.id
                                         where e.user_id = p_target and e.status = 'active' and eg.game_id = pg.game_id));
  if v_bad is not null then
    return query select 'already_owned'::text, null::uuid, null::uuid, v_bad;
    return;
  end if;
  -- dois produtos com o mesmo jogo (o pacote e um jogo dele): um só basta
  select array_agg(distinct p.code order by p.code) into v_bad
    from public.products p join public.product_games pg on pg.product_id = p.id
   where p.code = any(v_codes)
     and pg.game_id in (select pg2.game_id from public.product_games pg2 join public.products p2 on p2.id = pg2.product_id
                         where p2.code = any(v_codes) group by pg2.game_id having count(*) > 1);
  if v_bad is not null then
    return query select 'overlap'::text, null::uuid, null::uuid, v_bad;
    return;
  end if;

  -- itens só entram em pedido open; depois o pedido passa a paid, como na compra
  insert into public.orders (user_id, email, kind, cart_version, livemode, amount_subtotal, amount_discount, amount_total, currency)
  values (p_target, v_email, 'courtesy', 0, p_livemode, 0, 0, 0, 'brl')
  returning id into v_order;
  insert into public.order_items (order_id, product_id, position, stripe_price_id, unit_amount, currency)
  select v_order, p.id, c.position::smallint, p.stripe_price_id, 0, 'brl'
    from unnest(v_codes) with ordinality as c(code, position)
    join public.products p on p.code = c.code;
  insert into public.order_events (order_id, from_status, to_status, source) values (v_order, null, 'open', 'admin');
  update public.orders o set status = 'paid', paid_at = now() where o.id = v_order;
  insert into public.order_events (order_id, from_status, to_status, source) values (v_order, 'open', 'paid', 'admin');

  perform private.grant_order_entitlements(v_order, p_target);
  -- sacola: os produtos dados saem e a versão sobe (como depois da compra)
  perform private.drop_order_from_cart(v_order, p_target);

  if p_notify then
    insert into public.email_outbox (user_id, order_id, kind, category, to_email, payload, dedupe_key)
    values (p_target, v_order, 'gift', 'transactional', v_email, private.delivery_payload(v_order), 'gift:' || v_order::text)
    returning id into v_outbox;
  end if;

  insert into private.admin_events (user_id, action, target_id, details)
  values (p_user_id, 'user_gift', p_target,
          jsonb_build_object('order_id', v_order, 'products', to_jsonb(v_codes), 'reason', v_reason, 'notify', p_notify));
  return query select 'ok'::text, v_order, v_outbox, v_codes;
end $$;

create or replace function public.admin_follow_up(p_user_id uuid) returns table (outcome text, result jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;

  return query
  with people as (
    select u.id, u.email, u.created_at, u.email_confirmed_at, private.normalize_email(u.email) as normalized
      from auth.users u
     where u.deleted_at is null and not coalesce(u.is_anonymous, false) and not coalesce(u.banned_until > now(), false)
  ), cart as (
    -- a última coisa posta na sacola tem mais de 1 dia
    select pe.id, pe.email, min(ci.added_at) as since, max(ci.added_at) as last_added,
           jsonb_agg(coalesce(p.name, p.code) order by ci.added_at) as items,
           exists (select 1 from public.email_outbox x where x.user_id = pe.id and x.kind = 'cart_reminder' and x.status = 'sent'
                    and x.sent_at >= min(ci.added_at)) as reminded
      from people pe
      join public.cart_items ci on ci.user_id = pe.id
      join public.products p on p.id = ci.product_id
     group by pe.id, pe.email
    having max(ci.added_at) <= now() - interval '1 day'
  ), no_download as (
    -- pedido pago (compra ou presente) há 2 dias ou mais, nos últimos 90 dias, sem download nenhum depois do pagamento
    select pe.id, pe.email, o.id as order_id, private.order_ref(o.id) as order_ref, o.kind, o.paid_at,
           (select jsonb_agg(coalesce(p.name, p.code) order by i.position) from public.order_items i
              join public.products p on p.id = i.product_id where i.order_id = o.id) as items
      from people pe
      join public.orders o on o.user_id = pe.id
     where o.status = 'paid' and o.paid_at <= now() - interval '2 days' and o.paid_at > now() - interval '90 days'
       and not exists (select 1 from public.entitlements e where e.order_id = o.id and e.status <> 'active')
       and not exists (select 1 from public.download_events d where d.user_id = pe.id and d.created_at >= o.paid_at)
  ), delivery as (
    -- e-mail de acesso que falhou e nunca saiu para o pedido pago
    select pe.id, pe.email, o.id as order_id, private.order_ref(o.id) as order_ref,
           'failed'::text as problem, null::text as reason, max(x.updated_at) as at
      from people pe
      join public.orders o on o.user_id = pe.id and o.status = 'paid'
      join public.email_outbox x on x.order_id = o.id and x.kind in ('delivery', 'gift') and x.status = 'failed'
     where not exists (select 1 from public.email_outbox s where s.order_id = o.id and s.kind in ('delivery', 'gift')
                                                              and s.status in ('sent', 'queued', 'sending'))
     group by pe.id, pe.email, o.id
    union all
    -- endereço que a Brevo bloqueou (devolução permanente ou spam) numa conta que tem jogos
    select pe.id, pe.email, null::uuid, null::text, 'suppressed'::text, s.reason, s.occurred_at
      from people pe
      join public.email_suppressions s on s.email = pe.normalized and s.reason in ('hard_bounce', 'complaint')
     where exists (select 1 from public.entitlements e where e.user_id = pe.id and e.status = 'active')
  ), unconfirmed as (
    select pe.id, pe.email, pe.created_at from people pe
     where pe.email_confirmed_at is null and pe.created_at <= now() - interval '1 hour'
  )
  select 'ok'::text, jsonb_build_object(
    'cart', jsonb_build_object('total', (select count(*) from cart), 'items', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', c.id, 'email', c.email, 'since', c.since, 'last_added', c.last_added, 'items', c.items, 'reminded', c.reminded)
        order by c.last_added desc) from (select * from cart order by last_added desc limit 100) c), '[]'::jsonb)),
    'no_download', jsonb_build_object('total', (select count(*) from no_download), 'items', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', n.id, 'email', n.email, 'order_id', n.order_id, 'order_ref', n.order_ref, 'order_kind', n.kind,
        'paid_at', n.paid_at, 'items', n.items)
        order by n.paid_at desc) from (select * from no_download order by paid_at desc limit 100) n), '[]'::jsonb)),
    'delivery', jsonb_build_object('total', (select count(*) from delivery), 'items', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', d.id, 'email', d.email, 'order_id', d.order_id, 'order_ref', d.order_ref, 'problem', d.problem,
        'reason', d.reason, 'at', d.at)
        order by d.at desc) from (select * from delivery order by at desc limit 100) d), '[]'::jsonb)),
    'unconfirmed', jsonb_build_object('total', (select count(*) from unconfirmed), 'items', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', u.id, 'email', u.email, 'created_at', u.created_at)
        order by u.created_at desc) from (select * from unconfirmed order by created_at desc limit 100) u), '[]'::jsonb)));
end $$;
