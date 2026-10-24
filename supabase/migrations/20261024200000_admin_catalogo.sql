-- Catálogo no admin (2026-10-24, decisões do responsável): ver cada produto com preço e situação, pausar e reativar a
-- venda, trocar o preço (a API cria o Price novo na Stripe; aqui o produto passa para ele), o preço riscado da promoção
-- e montar o pacote, com a opção de dar o jogo novo a quem já tem o pacote. A troca de PDF continua por script.
--   1. products ganha o preço riscado (list_amount e list_label), que sai do código do site;
--   2. product_ready: o que falta para vender, sem olhar o status (o product_is_sellable passa a usá-lo);
--   3. get_catalog leva o preço riscado; get_catalog_version (md5 do catálogo público) para o vigia da VPS
--      reconstruir a loja quando o catálogo muda, como o blog;
--   4. RPCs do admin: admin_list_catalog, admin_set_product_status, admin_set_product_price, admin_set_list_price,
--      admin_add_pack_game e admin_remove_pack_game. Toda ação vai para admin_events, com o motivo.

-- ===== 1. Preço riscado =============================================================================================
alter table public.products
  add column list_amount bigint,
  add column list_label text,
  add constraint products_list_price_check check (
    (list_amount is null) = (list_label is null)
    and (list_amount is null or list_amount > 0)
    and (list_label is null or char_length(btrim(list_label)) between 2 and 40));
comment on column public.products.list_amount is 'Preço de tabela riscado ao lado do cobrado (centavos, BRL), com o rótulo da promoção; o site só mostra se for maior que o preço da Stripe.';

-- A promoção de lançamento do P001 (R$ 39,90 riscado), até 2026-10-24 em src/content/offer.ts.
update public.products set list_amount = 3990, list_label = 'Preço de lançamento' where code = 'P001';

alter table private.admin_events drop constraint admin_events_action_check;
alter table private.admin_events add constraint admin_events_action_check check (action in (
  'blog_create', 'blog_update', 'blog_publish', 'blog_unpublish', 'blog_delete', 'blog_image', 'blog_image_delete',
  'user_gift', 'user_revoke', 'user_resend', 'user_newsletter_off', 'user_block', 'user_unblock', 'user_export', 'user_delete',
  'user_admin_grant', 'user_admin_revoke', 'order_refund', 'order_reconcile', 'alert_resolve',
  'product_status', 'product_price', 'product_list_price', 'pack_add_game', 'pack_remove_game'));

-- ===== 2. Pronto para vender ========================================================================================
-- Tudo o que vender exige, menos o status: nome, preço, a contagem de jogos certa e cada jogo publicado com o PDF.
create function private.product_ready(p_product_id bigint) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1
    from public.products p
    where p.id = p_product_id
      and p.name is not null
      and p.stripe_price_id is not null
      and p.games_expected is not null
      and (select count(*) from public.product_games pg where pg.product_id = p.id) = p.games_expected
      and not exists (
        select 1
        from public.product_games pg
        join public.games g on g.id = pg.game_id
        where pg.product_id = p.id
          and (g.status <> 'published'
               or not exists (select 1 from public.files f
                              where f.game_id = g.id and f.kind = 'pdf' and f.access = 'paid' and f.status = 'published')))
  )
$$;
revoke all on function private.product_ready(bigint) from public, anon, authenticated, service_role;

create or replace function private.product_is_sellable(p_product_id bigint) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.products p where p.id = p_product_id and p.status = 'active')
     and private.product_ready(p_product_id)
$$;

-- ===== 3. Catálogo público e a versão dele ==========================================================================
create or replace function public.get_catalog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'code', p.code,
             'kind', p.kind,
             'name', p.name,
             'stripe_price_id', p.stripe_price_id,
             'list_price', case when p.list_amount is not null
                                then jsonb_build_object('amount', p.list_amount, 'label', p.list_label) end,
             'games', coalesce((
               select jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name) order by pg.position)
               from public.product_games pg
               join public.games g on g.id = pg.game_id
               where pg.product_id = p.id), '[]'::jsonb))
           order by p.id), '[]'::jsonb)
  from public.products p
  where p.status = 'active' and private.product_is_sellable(p.id)
$$;

-- O vigia da VPS confere a cada minuto, pela API de dados, se a loja montada está com o catálogo de agora. O preço novo
-- é um Price novo, então o id muda e a versão também. Só o md5: nada além do que o /catalog já mostra.
create function public.get_catalog_version() returns text
language sql stable security definer set search_path = '' as $$
  select md5(public.get_catalog()::text)
$$;
revoke all on function public.get_catalog_version() from public, anon, authenticated, service_role;
grant execute on function public.get_catalog_version() to service_role;
grant execute on function public.get_catalog_version() to anon;

-- ===== 4. RPCs do admin =============================================================================================
create function private.log_product_action(p_user_id uuid, p_action text, p_code text, p_reason text, p_details jsonb)
returns void language sql set search_path = '' as $$
  insert into private.admin_events (user_id, action, details)
  values (p_user_id, p_action, p_details || jsonb_build_object('product', p_code, 'reason', p_reason))
$$;
revoke all on function private.log_product_action(uuid, text, text, text, jsonb) from public, anon, authenticated, service_role;

-- A versão do catálogo público (para o admin dizer se a loja está em dia), os produtos e os jogos. Cada produto com o
-- que a tela precisa: situação, se está pronto para vender, o preço da Stripe (a API completa o
-- valor), o riscado, os jogos com a versão do PDF, os pedidos pagos (no modo da chave da Stripe), quem tem o produto e
-- o histórico do admin. Os jogos trazem o avulso deles e os pacotes em que estão.
create function public.admin_list_catalog(p_user_id uuid, p_livemode boolean) returns table (outcome text, result jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_user_id is null or p_livemode is null then
    raise exception 'admin_list_catalog: argumentos inválidos' using errcode = 'KT001';
  end if;
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::jsonb;
    return;
  end if;
  return query select 'ok'::text, jsonb_build_object(
    'version', public.get_catalog_version(),
    'products', coalesce((select jsonb_agg(jsonb_build_object(
        'code', p.code, 'name', p.name, 'kind', p.kind, 'slug', p.slug, 'status', p.status,
        'ready', private.product_ready(p.id), 'sellable', private.product_is_sellable(p.id),
        'stripe_price_id', p.stripe_price_id, 'games_expected', p.games_expected,
        'list_price', case when p.list_amount is not null then jsonb_build_object('amount', p.list_amount, 'label', p.list_label) end,
        'games', coalesce((select jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name, 'position', pg.position) order by pg.position)
                             from public.product_games pg join public.games g on g.id = pg.game_id where pg.product_id = p.id), '[]'::jsonb),
        'paid_orders', (select count(distinct o.id) from public.orders o join public.order_items oi on oi.order_id = o.id
                         where oi.product_id = p.id and o.kind = 'purchase' and o.livemode = p_livemode and o.status in ('paid', 'disputed')),
        'owners', (select count(distinct e.user_id) from public.entitlements e where e.product_id = p.id and e.status = 'active'),
        'history', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'created_at', a.created_at, 'details', a.details,
                                                                 'by', (select u.email from auth.users u where u.id = a.user_id))
                                              order by a.created_at desc, a.id desc)
                               from (select * from private.admin_events a where a.details->>'product' = p.code
                                      order by a.created_at desc, a.id desc limit 20) a), '[]'::jsonb))
      order by p.kind, p.code) from public.products p), '[]'::jsonb),
    'games', coalesce((select jsonb_agg(jsonb_build_object(
        'code', g.code, 'name', g.name, 'access', g.access, 'status', g.status,
        'file', (select jsonb_build_object('version', f.version, 'filename', f.filename, 'size_bytes', f.size_bytes, 'published_at', f.published_at)
                   from public.files f where f.game_id = g.id and f.kind = 'pdf' and f.status = 'published'),
        'single', (select p.code from public.products p join public.product_games pg on pg.product_id = p.id
                    where p.kind = 'single' and pg.game_id = g.id order by p.id limit 1),
        'packs', coalesce((select jsonb_agg(p.code order by p.code) from public.products p join public.product_games pg on pg.product_id = p.id
                            where p.kind = 'bundle' and pg.game_id = g.id), '[]'::jsonb))
      order by g.access, g.code) from public.games g), '[]'::jsonb));
end $$;

-- Pausar (archived) e voltar a vender (active). Voltar a vender exige tudo pronto (product_ready). Quem já comprou
-- continua com o jogo; o pacote que contém um jogo pausado continua à venda.
create function public.admin_set_product_status(p_user_id uuid, p_code text, p_status text, p_reason text)
  returns table (outcome text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_reason  text;
  v_product public.products;
begin
  if p_user_id is null or p_code is null or p_status is null or p_status not in ('active', 'archived') then
    raise exception 'admin_set_product_status: argumentos inválidos' using errcode = 'KT001';
  end if;
  v_reason := private.admin_reason(p_reason);
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text;
    return;
  end if;
  select * into v_product from public.products p where p.code = p_code for update;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;
  if v_product.status = p_status then
    return query select 'unchanged'::text;
    return;
  end if;
  if p_status = 'active' and not private.product_ready(v_product.id) then
    return query select 'not_ready'::text;
    return;
  end if;
  update public.products p set status = p_status where p.id = v_product.id;
  perform private.log_product_action(p_user_id, 'product_status', p_code, v_reason,
    jsonb_build_object('from', v_product.status, 'to', p_status));
  return query select 'ok'::text;
end $$;

-- O produto passa para o Price novo que a API acabou de criar na Stripe (do mesmo produto da Stripe). O Price novo
-- entra na memória de preços; o antigo fica marcado como inativo (a API arquiva na Stripe em seguida).
create function public.admin_set_product_price(p_user_id uuid, p_code text, p_price_id text, p_unit_amount bigint,
                                               p_currency text, p_stripe_product text, p_reason text)
  returns table (outcome text, previous_price_id text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_reason  text;
  v_product public.products;
  v_old     bigint;
begin
  if p_user_id is null or p_code is null or p_price_id is null or p_price_id !~ '^price_[A-Za-z0-9_]+$'
     or p_unit_amount is null or p_unit_amount <= 0 or p_currency is null or p_currency !~ '^[a-z]{3}$'
     or p_stripe_product is null or p_stripe_product !~ '^prod_[A-Za-z0-9_]+$' then
    raise exception 'admin_set_product_price: argumentos inválidos' using errcode = 'KT001';
  end if;
  v_reason := private.admin_reason(p_reason);
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, null::text;
    return;
  end if;
  select * into v_product from public.products p where p.code = p_code for update;
  if not found then
    return query select 'not_found'::text, null::text;
    return;
  end if;
  if v_product.stripe_price_id = p_price_id then
    return query select 'unchanged'::text, v_product.stripe_price_id;
    return;
  end if;
  select s.unit_amount into v_old from private.stripe_prices s where s.price_id = v_product.stripe_price_id;
  update public.products p set stripe_price_id = p_price_id where p.id = v_product.id;
  insert into private.stripe_prices (price_id, unit_amount, currency, product, active, fetched_at)
  values (p_price_id, p_unit_amount, p_currency, p_stripe_product, true, now())
  on conflict (price_id) do update set unit_amount = excluded.unit_amount, currency = excluded.currency,
    product = excluded.product, active = true, fetched_at = excluded.fetched_at;
  update private.stripe_prices s set active = false, fetched_at = now() where s.price_id = v_product.stripe_price_id;
  perform private.log_product_action(p_user_id, 'product_price', p_code, v_reason, jsonb_strip_nulls(jsonb_build_object(
    'from_price', v_product.stripe_price_id, 'to_price', p_price_id, 'from_amount', v_old, 'to_amount', p_unit_amount)));
  return query select 'ok'::text, v_product.stripe_price_id;
end $$;

-- O preço riscado da promoção: o valor (centavos) e o rótulo, ou nada (p_amount nulo) para tirar.
create function public.admin_set_list_price(p_user_id uuid, p_code text, p_amount bigint, p_label text, p_reason text)
  returns table (outcome text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_reason  text;
  v_label   text := nullif(btrim(p_label), '');
  v_product public.products;
begin
  if p_user_id is null or p_code is null or (p_amount is not null and (p_amount <= 0 or v_label is null or char_length(v_label) not between 2 and 40)) then
    raise exception 'admin_set_list_price: argumentos inválidos' using errcode = 'KT001';
  end if;
  v_reason := private.admin_reason(p_reason);
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text;
    return;
  end if;
  select * into v_product from public.products p where p.code = p_code for update;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;
  if v_product.list_amount is not distinct from p_amount and (p_amount is null or v_product.list_label = v_label) then
    return query select 'unchanged'::text;
    return;
  end if;
  update public.products p
     set list_amount = p_amount, list_label = case when p_amount is null then null else v_label end
   where p.id = v_product.id;
  perform private.log_product_action(p_user_id, 'product_list_price', p_code, v_reason, jsonb_strip_nulls(jsonb_build_object(
    'from_amount', v_product.list_amount, 'to_amount', p_amount, 'label', case when p_amount is null then null else v_label end)));
  return query select 'ok'::text;
end $$;

-- Pôr um jogo no fim do pacote. Com p_gift, quem tem o pacote ativo (compra ou presente, conta viva) e ainda não tem o
-- jogo ganha o avulso dele como presente (admin_gift_products: pedido de R$ 0, e-mail se p_notify), como na Coleção
-- Fundadores em 2026-10-23. Sem avulso à venda para dar, o pedido com presente é recusado antes de mudar algo.
create function public.admin_add_pack_game(p_user_id uuid, p_code text, p_game_code text, p_gift boolean, p_notify boolean,
                                           p_reason text, p_livemode boolean)
  returns table (outcome text, gifted integer, outbox_ids uuid[])
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_reason  text;
  v_product public.products;
  v_game    public.games;
  v_single  text;
  v_gift    record;
  v_count   integer := 0;
  v_outbox  uuid[] := '{}';
  r         record;
begin
  if p_user_id is null or p_code is null or p_game_code is null or p_gift is null or p_notify is null or p_livemode is null then
    raise exception 'admin_add_pack_game: argumentos inválidos' using errcode = 'KT001';
  end if;
  v_reason := private.admin_reason(p_reason);
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text, 0, null::uuid[];
    return;
  end if;
  select * into v_product from public.products p where p.code = p_code for update;
  select * into v_game from public.games g where g.code = p_game_code;
  if v_product.id is null or v_game.id is null then
    return query select 'not_found'::text, 0, null::uuid[];
    return;
  end if;
  if v_product.kind <> 'bundle' or v_game.access <> 'paid' or v_game.status <> 'published' then
    return query select 'not_allowed'::text, 0, null::uuid[];
    return;
  end if;
  if exists (select 1 from public.product_games pg where pg.product_id = v_product.id and pg.game_id = v_game.id) then
    return query select 'unchanged'::text, 0, null::uuid[];
    return;
  end if;
  if p_gift then
    select p.code into v_single from public.products p join public.product_games pg on pg.product_id = p.id
     where p.kind = 'single' and p.status = 'active' and pg.game_id = v_game.id order by p.id limit 1;
    if v_single is null then
      return query select 'no_single'::text, 0, null::uuid[];
      return;
    end if;
  end if;

  insert into public.product_games (product_id, game_id, position)
  values (v_product.id, v_game.id, coalesce((select max(pg.position) from public.product_games pg where pg.product_id = v_product.id), 0) + 1);
  update public.products p set games_expected = coalesce(p.games_expected, 0) + 1 where p.id = v_product.id;

  if p_gift then
    for r in select distinct e.user_id from public.entitlements e
               join auth.users u on u.id = e.user_id and u.deleted_at is null and u.email_confirmed_at is not null
              where e.product_id = v_product.id and e.status = 'active'
                and not exists (select 1 from public.entitlements e2 join public.entitlement_games eg on eg.entitlement_id = e2.id
                                 where e2.user_id = e.user_id and e2.status = 'active' and eg.game_id = v_game.id)
    loop
      select * into v_gift from public.admin_gift_products(p_user_id, r.user_id, array[v_single],
        format('%s ganhou %s: jogo novo para quem já tem o pacote', coalesce(v_product.name, v_product.code), v_game.name),
        p_notify, p_livemode);
      if v_gift.outcome <> 'ok' then
        raise exception 'admin_add_pack_game: o presente para uma conta voltou %', v_gift.outcome using errcode = 'KT001';
      end if;
      v_count := v_count + 1;
      if v_gift.outbox_id is not null then v_outbox := v_outbox || v_gift.outbox_id; end if;
    end loop;
  end if;

  perform private.log_product_action(p_user_id, 'pack_add_game', p_code, v_reason,
    jsonb_build_object('game', p_game_code, 'gift', p_gift, 'notify', p_notify, 'gifted', v_count));
  return query select 'ok'::text, v_count, v_outbox;
end $$;

-- Tirar um jogo do pacote (fica com pelo menos dois). Quem já comprou continua com ele: a compra é uma fotografia.
create function public.admin_remove_pack_game(p_user_id uuid, p_code text, p_game_code text, p_reason text)
  returns table (outcome text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_reason   text;
  v_product  public.products;
  v_position smallint;
begin
  if p_user_id is null or p_code is null or p_game_code is null then
    raise exception 'admin_remove_pack_game: argumentos inválidos' using errcode = 'KT001';
  end if;
  v_reason := private.admin_reason(p_reason);
  if not private.confirmed_admin(p_user_id) then
    return query select 'forbidden'::text;
    return;
  end if;
  select * into v_product from public.products p where p.code = p_code for update;
  if not found then
    return query select 'not_found'::text;
    return;
  end if;
  select pg.position into v_position from public.product_games pg join public.games g on g.id = pg.game_id
   where pg.product_id = v_product.id and g.code = p_game_code;
  if v_position is null then
    return query select 'unchanged'::text;
    return;
  end if;
  if v_product.kind <> 'bundle' or (select count(*) from public.product_games pg where pg.product_id = v_product.id) <= 2 then
    return query select 'not_allowed'::text;
    return;
  end if;
  delete from public.product_games pg where pg.product_id = v_product.id and pg.position = v_position;
  -- as posições seguintes sobem uma (passando por mil a mais: a posição é única no pacote)
  update public.product_games pg set position = pg.position + 1000 where pg.product_id = v_product.id and pg.position > v_position;
  update public.product_games pg set position = pg.position - 1001 where pg.product_id = v_product.id and pg.position > 1000;
  update public.products p set games_expected = p.games_expected - 1 where p.id = v_product.id;
  perform private.log_product_action(p_user_id, 'pack_remove_game', p_code, v_reason, jsonb_build_object('game', p_game_code));
  return query select 'ok'::text;
end $$;

do $$
declare sig text;
begin
  foreach sig in array array[
    'admin_list_catalog(uuid, boolean)', 'admin_set_product_status(uuid, text, text, text)',
    'admin_set_product_price(uuid, text, text, bigint, text, text, text)', 'admin_set_list_price(uuid, text, bigint, text, text)',
    'admin_add_pack_game(uuid, text, text, boolean, boolean, text, boolean)', 'admin_remove_pack_game(uuid, text, text, text)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', sig);
    execute format('grant execute on function public.%s to service_role', sig);
  end loop;
end $$;
