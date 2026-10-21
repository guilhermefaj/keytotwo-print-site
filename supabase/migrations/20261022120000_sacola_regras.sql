-- Sacola sem login e jogo repetido (2026-10-22, pedido do responsável). Nenhuma tabela muda.
-- 1. As regras de cada item da sacola ficam num lugar só (private.cart_lines), usado pela sacola da conta, pela
--    cotação da sacola de quem ainda não entrou (quote_cart) e pela criação do pedido.
-- 2. Ninguém paga duas vezes pelo mesmo jogo: o produto que a pessoa já tem (already_owned) e o avulso que já
--    está num pacote da sacola (included) ficam na sacola, riscados, e não entram no pedido. O pacote com jogos
--    que a pessoa já tem é cobrado pelo que falta ("completar a coleção"); o valor é calculado na API, com os
--    Prices da Stripe, a partir dos jogos e do Price do avulso de cada um que esta migração devolve.
-- 3. cart_add aceita produto já possuído (aparece riscado); depois de liberar um pedido, a sacola perde o que
--    ficou da pessoa.

-- ===== 1. cart_lines: cada produto de um conjunto, com o estado na sacola ============================
-- p_product_ids na ordem em que os itens entraram; p_user_id NULL = quem ainda não entrou (não possui nada).
-- status: unavailable (não vendável) > already_owned (já tem todos os jogos) > included (avulso cujos jogos estão
-- todos num pacote vendável da mesma sacola que a pessoa ainda não tem por inteiro) > ok.
create function private.cart_lines(p_user_id uuid, p_product_ids bigint[])
  returns table (product_id bigint, code text, kind text, name text, stripe_price_id text, line integer,
                 status text, games jsonb, owned_games jsonb, included_in jsonb, shared_with jsonb)
language sql stable set search_path = '' as $$
  with ids as (
    select u.id, min(u.ord)::integer as line
      from unnest(p_product_ids) with ordinality as u(id, ord)
     group by u.id
  ), owned as (
    select o as game_id from private.owned_game_ids(p_user_id) o
  ), base as (
    select p.id, p.code, p.kind, p.name, p.stripe_price_id, i.line,
           private.product_is_sellable(p.id) as sellable,
           (exists (select 1 from public.product_games pg where pg.product_id = p.id)
            and not exists (select 1 from public.product_games pg
                             where pg.product_id = p.id and pg.game_id not in (select game_id from owned))) as owned_all
      from ids i
      join public.products p on p.id = i.id
  )
  select b.id, b.code, b.kind, b.name, b.stripe_price_id, b.line,
         case when not b.sellable then 'unavailable'
              when b.owned_all then 'already_owned'
              when inc.codes is not null then 'included'
              else 'ok' end,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'code', g.code, 'name', g.name,
                    -- Price do avulso vendável do jogo: base do desconto de "completar a coleção"
                    'single_price_id', (select s.stripe_price_id
                                          from public.product_games sg
                                          join public.products s on s.id = sg.product_id
                                         where sg.game_id = pg.game_id and s.kind = 'single'
                                           and private.product_is_sellable(s.id)
                                         order by s.id limit 1)) order by pg.position)
             from public.product_games pg
             join public.games g on g.id = pg.game_id
            where pg.product_id = b.id), '[]'::jsonb),
         coalesce((
           select jsonb_agg(g.code order by pg.position)
             from public.product_games pg
             join public.games g on g.id = pg.game_id
            where pg.product_id = b.id and pg.game_id in (select game_id from owned)), '[]'::jsonb),
         coalesce(inc.codes, '[]'::jsonb),
         coalesce((
           select jsonb_agg(distinct b2.code order by b2.code)
             from base b2
            where b2.id <> b.id
              and exists (select 1
                            from public.product_games pg2
                            join public.product_games pg3 on pg3.game_id = pg2.game_id
                           where pg2.product_id = b.id and pg3.product_id = b2.id)), '[]'::jsonb)
    from base b
    left join lateral (
      select jsonb_agg(b2.code order by b2.line) as codes
        from base b2
       where b.kind = 'single' and b2.kind = 'bundle' and b2.id <> b.id and b2.sellable and not b2.owned_all
         and exists (select 1 from public.product_games pg where pg.product_id = b.id)
         and not exists (select 1 from public.product_games pg
                          where pg.product_id = b.id
                            and pg.game_id not in (select pg2.game_id from public.product_games pg2 where pg2.product_id = b2.id))
    ) inc on true
   order by b.line
$$;
revoke all on function private.cart_lines(uuid, bigint[]) from public, anon, authenticated, service_role;

-- O mesmo, no formato que a API devolve. available = entra no pedido (status ok).
create function private.cart_lines_json(p_user_id uuid, p_product_ids bigint[]) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', l.code, 'kind', l.kind, 'name', l.name, 'stripe_price_id', l.stripe_price_id,
           'games', l.games, 'available', l.status = 'ok', 'status', l.status, 'owned_games', l.owned_games,
           'included_in', l.included_in, 'shared_with', l.shared_with) order by l.line), '[]'::jsonb)
    from private.cart_lines(p_user_id, p_product_ids) l
$$;
revoke all on function private.cart_lines_json(uuid, bigint[]) from public, anon, authenticated, service_role;

-- ===== 2. get_cart: a sacola da conta, mais os produtos vendáveis que a pessoa já tem por inteiro ======
-- owned_products deixa a página do jogo trocar o botão por "Já está no seu Portal".
create or replace function public.get_cart(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_confirmed_email(p_user_id);

  return jsonb_build_object(
    'version', coalesce((select c.version from public.carts c where c.user_id = p_user_id), 0),
    'items', private.cart_lines_json(p_user_id, array(
      select ci.product_id from public.cart_items ci where ci.user_id = p_user_id order by ci.added_at, ci.product_id)),
    'owned_products', coalesce((
      select jsonb_agg(p.code order by p.code)
        from public.products p
       where p.status = 'active' and private.product_is_sellable(p.id)
         and exists (select 1 from public.product_games pg where pg.product_id = p.id)
         and not exists (select 1 from public.product_games pg
                          where pg.product_id = p.id
                            and pg.game_id not in (select o from private.owned_game_ids(p_user_id) o))), '[]'::jsonb));
end $$;

-- ===== 3. quote_cart: a sacola de quem ainda não entrou (guardada no navegador) ======================
-- Mesmas regras, sem dono: ninguém possui nada. unknown = códigos que não existem (o site tira da sacola).
create function public.quote_cart(p_product_codes text[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_product_codes is null or cardinality(p_product_codes) > 20 then
    raise exception 'quote_cart: até 20 códigos' using errcode = 'KT001';
  end if;

  return jsonb_build_object(
    'items', private.cart_lines_json(null, array(
      select p.id
        from unnest(p_product_codes) with ordinality as u(code, ord)
        join public.products p on p.code = u.code
       order by u.ord)),
    'unknown', coalesce((
      select jsonb_agg(u.code order by u.ord)
        from unnest(p_product_codes) with ordinality as u(code, ord)
       where not exists (select 1 from public.products p where p.code = u.code)), '[]'::jsonb));
end $$;

-- ===== 4. cart_add: aceita produto já possuído ======================================================
-- Ele aparece riscado na sacola e não entra no pedido; assim a sacola de quem entra na hora de pagar chega inteira.
create or replace function public.cart_add(p_user_id uuid, p_product_code text)
  returns table (outcome text, cart_version integer, owned_games jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  v_product_id bigint;
  v_version    integer;
  v_codes      jsonb;
  v_inserted   integer;
begin
  perform private.require_confirmed_email(p_user_id);
  if p_product_code is null or btrim(p_product_code) = '' then
    raise exception 'cart_add: p_product_code é obrigatório' using errcode = 'KT001';
  end if;

  -- cria o carrinho se não existe e trava (serializa as mudanças do mesmo usuário)
  insert into public.carts (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select c.version into v_version from public.carts c where c.user_id = p_user_id for update;

  select p.id into v_product_id from public.products p where p.code = p_product_code;
  if v_product_id is null or not private.product_is_sellable(v_product_id) then
    return query select 'product_unavailable'::text, v_version, '[]'::jsonb;
    return;
  end if;

  select coalesce(jsonb_agg(g.code order by pg.position), '[]'::jsonb) into v_codes
    from public.product_games pg
    join public.games g on g.id = pg.game_id
   where pg.product_id = v_product_id
     and pg.game_id in (select o from private.owned_game_ids(p_user_id) o);

  insert into public.cart_items (user_id, product_id) values (p_user_id, v_product_id)
  on conflict (user_id, product_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return query select 'noop'::text, v_version, v_codes;
    return;
  end if;

  update public.carts c set version = c.version + 1 where c.user_id = p_user_id returning c.version into v_version;
  insert into public.funnel_events (user_id, type, product_id, cart_version)
  values (p_user_id, 'cart_item_added', v_product_id, v_version);

  return query select 'added'::text, v_version, v_codes;
end $$;

-- ===== 5. create_order_from_cart: o pedido leva só os itens com status ok ==========================
-- Mesma assinatura e mesmos outcomes. already_owned agora quer dizer "nada a pagar": todos os itens já são da pessoa
-- ou já estão num pacote da sacola. items traz, de cada item do pedido, o tipo, os jogos (com o Price do avulso)
-- e os jogos que a pessoa já tem, para a API calcular o valor do pacote.
create or replace function public.create_order_from_cart(
  p_user_id        uuid,
  p_livemode       boolean,
  p_cart_version   integer,
  p_terms_version  text,
  p_terms_accepted boolean
) returns table (
  outcome            text,
  order_id           uuid,
  email              text,
  stripe_customer_id text,
  items              jsonb,
  reused             boolean,
  detail             jsonb
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_email    text;
  v_terms    text;
  v_version  integer;
  v_ids      bigint[];
  v_n_items  integer;
  v_bad      jsonb;
  v_order_id uuid;
  v_reused   boolean;
  v_customer text;
  v_items    jsonb;
begin
  v_email := private.require_confirmed_email(p_user_id);
  if p_livemode is null or p_cart_version is null or p_cart_version < 0
     or p_terms_version is null or btrim(p_terms_version) = '' then
    raise exception 'create_order_from_cart: argumentos inválidos' using errcode = 'KT001';
  end if;
  if p_terms_accepted is distinct from true then
    raise exception 'create_order_from_cart: o aceite dos termos é obrigatório' using errcode = 'KT007';
  end if;
  v_terms := btrim(p_terms_version);

  -- trava o carrinho: serializa os checkouts do mesmo usuário (o 2º reaproveita o pedido do 1º)
  select c.version into v_version from public.carts c where c.user_id = p_user_id for update;
  v_ids := array(select ci.product_id from public.cart_items ci where ci.user_id = p_user_id order by ci.added_at, ci.product_id);
  if v_version is null or cardinality(v_ids) = 0 then
    return query select 'cart_empty'::text, null::uuid, null::text, null::text, null::jsonb, false, null::jsonb;
    return;
  end if;
  if v_version <> p_cart_version then
    return query select 'cart_changed'::text, null::uuid, null::text, null::text, null::jsonb, false,
                        jsonb_build_object('cart_version', v_version);
    return;
  end if;

  -- produto que deixou de ser vendável
  select jsonb_agg(l.code order by l.line) into v_bad from private.cart_lines(p_user_id, v_ids) l where l.status = 'unavailable';
  if v_bad is not null then
    return query select 'product_unavailable'::text, null::uuid, null::text, null::text, null::jsonb, false,
                        jsonb_build_object('product_codes', v_bad);
    return;
  end if;

  -- nada a pagar: tudo já é da pessoa (comprado em outra aba, por exemplo) ou já está num pacote da sacola
  select count(*) into v_n_items from private.cart_lines(p_user_id, v_ids) l where l.status = 'ok';
  if v_n_items = 0 then
    select jsonb_agg(l.code order by l.line) into v_bad from private.cart_lines(p_user_id, v_ids) l;
    return query select 'already_owned'::text, null::uuid, null::text, null::text, null::jsonb, false,
                        jsonb_build_object('product_codes', v_bad);
    return;
  end if;

  -- reaproveita o pedido open da mesma versão do carrinho, do mesmo ambiente e dos mesmos termos, com os mesmos
  -- itens e Prices de hoje, sessão ainda dentro do prazo e nenhum jogo ganho ou perdido desde a criação (o valor
  -- do pacote depende do que a pessoa já tem)
  select o.id into v_order_id
    from public.orders o
   where o.user_id = p_user_id
     and o.status = 'open'
     and o.cart_version = p_cart_version
     and o.livemode = p_livemode
     and o.terms_version = v_terms
     and (o.checkout_expires_at is null or o.checkout_expires_at > now())
     and (select count(*) from public.order_items oi where oi.order_id = o.id) = v_n_items
     and not exists (select 1
                       from public.order_items oi
                       left join private.cart_lines(p_user_id, v_ids) l on l.product_id = oi.product_id and l.status = 'ok'
                      where oi.order_id = o.id
                        and (l.product_id is null or oi.stripe_price_id is distinct from l.stripe_price_id))
     and not exists (select 1 from public.entitlements e
                      where e.user_id = p_user_id and (e.granted_at > o.created_at or e.revoked_at > o.created_at))
   order by o.created_at desc, o.id desc
   limit 1;
  v_reused := v_order_id is not null;

  if not v_reused then
    insert into public.orders (user_id, email, cart_version, terms_version, terms_accepted_at, livemode)
    values (p_user_id, v_email, p_cart_version, v_terms, now(), p_livemode)
    returning id into v_order_id;

    insert into public.order_items (order_id, product_id, position, stripe_price_id)
    select v_order_id, l.product_id, (row_number() over (order by l.line))::smallint, l.stripe_price_id
      from private.cart_lines(p_user_id, v_ids) l
     where l.status = 'ok';

    insert into public.order_events (order_id, from_status, to_status, source)
    values (v_order_id, null, 'open', 'checkout');
    insert into public.funnel_events (user_id, type, order_id, cart_version)
    values (p_user_id, 'checkout_started', v_order_id, p_cart_version);
  end if;

  select pf.stripe_customer_id into v_customer from public.profiles pf where pf.user_id = p_user_id;
  select jsonb_agg(jsonb_build_object('product_code', l.code, 'stripe_price_id', oi.stripe_price_id, 'kind', l.kind,
                                      'games', l.games, 'owned_games', l.owned_games) order by oi.position)
    into v_items
    from public.order_items oi
    join private.cart_lines(p_user_id, v_ids) l on l.product_id = oi.product_id
   where oi.order_id = v_order_id;

  return query select 'ok'::text, v_order_id, v_email, v_customer, v_items, v_reused, null::jsonb;
end $$;

-- ===== 6. Depois de liberar um pedido, a sacola perde o que ficou da pessoa ==========================
-- fulfill_order já tira da sacola os produtos pagos e sobe a version; este gatilho tira também o que ficou possuído
-- por inteiro com os jogos novos (o avulso que veio no pacote). Roda a cada jogo liberado, antes daquele passo.
-- Trava o carrinho antes de mexer nos itens, como cart_add e cart_remove: a ordem pedido → carrinho → itens evita
-- deadlock com quem mexe na sacola ao mesmo tempo (T127).
create function private.prune_owned_cart_items() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  select e.user_id into v_user from public.entitlements e where e.id = new.entitlement_id;
  perform 1 from public.carts c where c.user_id = v_user for update;
  delete from public.cart_items ci
   where ci.user_id = v_user
     and exists (select 1 from public.product_games pg where pg.product_id = ci.product_id)
     and not exists (select 1 from public.product_games pg
                      where pg.product_id = ci.product_id
                        and pg.game_id not in (select o from private.owned_game_ids(v_user) o));
  return null;
end $$;
revoke all on function private.prune_owned_cart_items() from public, anon, authenticated, service_role;

create trigger entitlement_games_prune_cart
  after insert on public.entitlement_games
  for each row execute function private.prune_owned_cart_items();

-- ===== EXECUTE só para service_role ================================================================
revoke all on function public.quote_cart(text[]) from public, anon, authenticated, service_role;
grant execute on function public.quote_cart(text[]) to service_role;
