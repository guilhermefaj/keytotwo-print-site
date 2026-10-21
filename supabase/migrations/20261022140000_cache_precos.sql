-- Preços da Stripe guardados no banco (2026-10-22, pedido do responsável: a sacola demorava a carregar).
-- Ler o Price na Stripe a cada chamada custava ~0,6 s no catálogo e na sacola, e o cache em memória da função
-- não se mantém entre chamadas. O valor e a moeda de um Price nunca mudam na Stripe; só o "ativo" muda (arquivar).
-- A API lê daqui e só consulta a Stripe quando falta o Price ou ele foi conferido há mais de uma hora.
-- Fica em private: nenhum papel da API enxerga a tabela; só as duas RPCs abaixo, com EXECUTE só para service_role.

create table private.stripe_prices (
  price_id    text primary key,
  unit_amount bigint      not null,
  currency    text        not null,
  product     text,
  active      boolean     not null,
  fetched_at  timestamptz not null default now(),
  constraint stripe_prices_id_check       check (price_id ~ '^price_[A-Za-z0-9_]+$'),
  constraint stripe_prices_amount_check   check (unit_amount >= 0),
  constraint stripe_prices_currency_check check (currency ~ '^[a-z]{3}$'),
  constraint stripe_prices_product_check  check (product is null or product ~ '^prod_[A-Za-z0-9_]+$')
);
revoke all on table private.stripe_prices from public, anon, authenticated, service_role;

-- Os Prices pedidos que estão guardados, com a idade (a API decide se confere de novo na Stripe).
create function public.get_stripe_prices(p_price_ids text[])
  returns table (price_id text, unit_amount bigint, currency text, product text, active boolean, fetched_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_price_ids is null or cardinality(p_price_ids) > 100 then
    raise exception 'get_stripe_prices: até 100 ids' using errcode = 'KT001';
  end if;
  return query
    select s.price_id, s.unit_amount, s.currency, s.product, s.active, s.fetched_at
      from private.stripe_prices s
     where s.price_id = any (p_price_ids);
end $$;

-- Guarda (ou atualiza) os Prices lidos na Stripe: [ { "price_id", "unit_amount", "currency", "product", "active" } ].
create function public.remember_stripe_prices(p_prices jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  if p_prices is null or jsonb_typeof(p_prices) <> 'array' or jsonb_array_length(p_prices) > 100
     or exists (select 1 from jsonb_array_elements(p_prices) e
                 where jsonb_typeof(e) <> 'object'
                    or coalesce(e->>'price_id', '') !~ '^price_[A-Za-z0-9_]+$'
                    or coalesce(e->>'unit_amount', '') !~ '^[0-9]{1,15}$'
                    or coalesce(e->>'currency', '') !~ '^[a-z]{3}$'
                    or (e->>'product' is not null and e->>'product' !~ '^prod_[A-Za-z0-9_]+$')
                    or jsonb_typeof(e->'active') is distinct from 'boolean') then
    raise exception 'remember_stripe_prices: lista de Prices inválida' using errcode = 'KT001';
  end if;

  -- repetido na lista: vale o último (o upsert não aceita a mesma linha duas vezes)
  insert into private.stripe_prices (price_id, unit_amount, currency, product, active, fetched_at)
  select distinct on (e->>'price_id') e->>'price_id', (e->>'unit_amount')::bigint, e->>'currency', e->>'product', (e->>'active')::boolean, now()
    from jsonb_array_elements(p_prices) with ordinality as x(e, ord)
   order by e->>'price_id', ord desc
  on conflict (price_id) do update
     set unit_amount = excluded.unit_amount, currency = excluded.currency, product = excluded.product,
         active = excluded.active, fetched_at = excluded.fetched_at;
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

-- ===== EXECUTE só para service_role ================================================================
revoke all on function public.get_stripe_prices(text[]) from public, anon, authenticated, service_role;
grant execute on function public.get_stripe_prices(text[]) to service_role;
revoke all on function public.remember_stripe_prices(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.remember_stripe_prices(jsonb) to service_role;
