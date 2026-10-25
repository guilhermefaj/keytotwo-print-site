-- Segurança (2026-10-25, revisão de segurança com o responsável): o que a revisão achou na camada do banco.
--   1. "Completar a coleção": o pacote guarda os jogos descontados e não os inclui no direito. Antes, reembolsar ou
--      contestar o avulso deixava o jogo dele valendo pelo pacote, de graça;
--   2. a cotação pública da sacola não mostra produto em rascunho;
--   3. o backup_ro lê só o que a cópia leva: as tabelas da loja e, por funções, auth.users e auth.identities. Antes, o
--      pg_read_all_data dava também os tokens de sessão (que viram sessão de admin), o Vault e a fila do pg_net;
--   4. o que nasce em public fora das migrações (editor SQL) não abre mais para quem não entrou;
--   5. o alerta "pago sem o aceite dos termos".

-- ===== 1. Jogos descontados no pacote =============================================================================
-- O jogo descontado continua valendo pelo pedido do avulso, e some com ele se esse pedido for reembolsado.
alter table public.order_items add column credited_game_ids bigint[] not null default '{}';

create or replace function private.guard_order_item_changes() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_status text;
begin
  select o.status into v_status from public.orders o where o.id = coalesce(new.order_id, old.order_id);

  if tg_op = 'INSERT' then
    if v_status is distinct from 'open' then
      raise exception 'order_items: só se inserem itens em pedido open' using errcode = 'KT010';
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if v_status is not null and v_status <> 'open' then
      raise exception 'order_items: só se apagam itens de pedido open' using errcode = 'KT010';
    end if;
    return old;
  end if;

  if new.order_id is distinct from old.order_id
     or new.product_id is distinct from old.product_id
     or new.position is distinct from old.position
     or new.stripe_price_id is distinct from old.stripe_price_id
     or new.credited_game_ids is distinct from old.credited_game_ids then
    raise exception 'order_items: pedido, produto, posição, Price e jogos descontados são imutáveis' using errcode = 'KT010';
  end if;
  if new.unit_amount is distinct from old.unit_amount or new.currency is distinct from old.currency then
    if old.unit_amount is not null or v_status not in ('open', 'pending_payment') then
      raise exception 'order_items: o valor cobrado entra uma vez, com o pedido open ou pending_payment' using errcode = 'KT010';
    end if;
  end if;
  return new;
end $$;

create or replace function private.grant_order_entitlements(p_order_id uuid, p_user_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_ent  uuid;
  v_rows integer;
  r      record;
begin
  for r in select oi.product_id, oi.credited_game_ids, p.code from public.order_items oi join public.products p on p.id = oi.product_id
            where oi.order_id = p_order_id order by oi.position loop
    v_ent := null;
    insert into public.entitlements (order_id, product_id, user_id)
    values (p_order_id, r.product_id, p_user_id)
    on conflict (order_id, product_id) do nothing
    returning id into v_ent;
    if v_ent is not null then
      insert into public.entitlement_games (entitlement_id, game_id, position)
      select v_ent, pg.game_id, pg.position from public.product_games pg
       where pg.product_id = r.product_id and pg.game_id <> all(r.credited_game_ids);
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        raise exception 'o produto % não tem jogos na composição', r.code using errcode = 'KT003';
      end if;
    end if;
  end loop;
end $$;

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
    values (p_user_id, v_email, p_cart_version, v_terms, case when p_terms_accepted then now() end, p_livemode)
    returning id into v_order_id;

    -- o pacote de "completar a coleção" guarda os jogos que a pessoa já tinha e que saíram do preço (2026-10-25)
    insert into public.order_items (order_id, product_id, position, stripe_price_id, credited_game_ids)
    select v_order_id, l.product_id, (row_number() over (order by l.line))::smallint, l.stripe_price_id,
           case when l.kind = 'bundle' then array(select g.id from jsonb_array_elements_text(l.owned_games) c(code)
                                                    join public.games g on g.code = c.code order by g.id)
                else '{}' end
      from private.cart_lines(p_user_id, v_ids) l
     where l.status = 'ok';

    insert into public.order_events (order_id, from_status, to_status, source)
    values (v_order_id, null, 'open', 'checkout');
    insert into public.funnel_events (user_id, type, order_id, cart_version)
    values (p_user_id, 'checkout_started', v_order_id, p_cart_version);
  end if;

  -- o site anterior manda o aceite junto (terms_accepted = true): vale também para o pedido reaproveitado
  if v_reused and p_terms_accepted then
    update public.orders o set terms_accepted_at = now() where o.id = v_order_id and o.terms_accepted_at is null;
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

-- ===== 2. A cotação pública sem rascunho ==========================================================================
create or replace function public.quote_cart(p_product_codes text[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_product_codes is null or cardinality(p_product_codes) > 20 then
    raise exception 'quote_cart: até 20 códigos' using errcode = 'KT001';
  end if;

  return jsonb_build_object(
    'items', private.cart_lines_json(null, array(
      select p.id
        from unnest(p_product_codes) with ordinality as u(code, ord)
        join public.products p on p.code = u.code and p.status <> 'draft'
       order by u.ord)),
    'unknown', coalesce((
      select jsonb_agg(u.code order by u.ord)
        from unnest(p_product_codes) with ordinality as u(code, ord)
       where not exists (select 1 from public.products p where p.code = u.code and p.status <> 'draft')), '[]'::jsonb));
end $$;

-- ===== 3. O papel do backup ========================================================================================
-- Leitura das tabelas da loja (public e private), as de agora e as próximas, e auth.users e auth.identities pelas
-- funções abaixo (o postgres não pode dar acesso ao schema auth). Sessões, tokens, MFA, Vault e pg_net ficam de fora:
-- depois de restaurar, cada pessoa entra de novo e cada admin cadastra o app autenticador outra vez (docs/deploy.md).
-- A public.test do hospedado (do responsável, fora da loja) não é tocada: nem permissão, nem cópia.
revoke pg_read_all_data from backup_ro;
alter role backup_ro connection limit 3;
grant usage on schema private to backup_ro;
do $$
declare
  r record;
begin
  for r in select c.oid::regclass as rel
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'S')
              and not (n.nspname = 'public' and (c.relname = 'test' or exists (
                    select 1 from pg_depend d join pg_class t on t.oid = d.refobjid
                     where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype in ('a', 'i')
                       and t.relnamespace = n.oid and t.relname = 'test')))
  loop
    execute format('grant select on %s to backup_ro', r.rel);
  end loop;
end $$;
alter default privileges for role postgres in schema public, private grant select on tables to backup_ro;
alter default privileges for role postgres in schema public, private grant select on sequences to backup_ro;

create function private.backup_auth_users() returns setof auth.users
language sql stable security definer set search_path = '' as $$ select * from auth.users $$;
create function private.backup_auth_identities() returns setof auth.identities
language sql stable security definer set search_path = '' as $$ select * from auth.identities $$;
revoke all on function private.backup_auth_users() from public, anon, authenticated, service_role;
revoke all on function private.backup_auth_identities() from public, anon, authenticated, service_role;
grant execute on function private.backup_auth_users() to backup_ro;
grant execute on function private.backup_auth_identities() to backup_ro;

-- ===== 4. O que nasce em public fica fechado ======================================================================
-- O projeto da Supabase dá tudo a anon e authenticated no que o postgres cria em public, e o Postgres dá EXECUTE a
-- PUBLIC em toda função nova. Toda migração já revoga e concede o que precisa; isto vale para o que for criado fora
-- delas. A função do gatilho de evento do painel (rls_auto_enable, só no hospedado) também fecha: o gatilho segue.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- ===== 5. Alerta: pago sem o aceite dos termos =====================================================================
alter table private.admin_alerts drop constraint admin_alerts_kind_check;
alter table private.admin_alerts add constraint admin_alerts_kind_check
  check (kind in ('dispute', 'delivery_failed', 'order_stuck', 'stripe_unmatched', 'email_queue_stuck', 'backup_late', 'terms_missing'));

create or replace function private.scan_admin_alerts(p_now timestamptz default now()) returns integer
language plpgsql set search_path = '' as $$
declare
  v_new bigint[];
begin
  update private.admin_alerts a
     set resolved_at = p_now, resolution = 'auto'
   where a.resolved_at is null
     and case a.kind
       when 'dispute' then (select o.status from public.orders o where o.id = a.order_id) <> 'disputed'
       when 'order_stuck' then (select o.status from public.orders o where o.id = a.order_id) not in ('open', 'pending_payment')
       -- um reenvio do mesmo e-mail saiu, ou a entrega deixou de valer (o pedido não está mais pago)
       when 'delivery_failed' then exists (
              select 1 from public.email_outbox x
               where x.order_id = a.order_id and x.kind = a.details->>'email_kind' and x.status = 'sent'
                 and x.created_at > (a.details->>'created_at')::timestamptz)
            or (a.details->>'email_kind' <> 'refund' and (select o.status from public.orders o where o.id = a.order_id) <> 'paid')
       when 'email_queue_stuck' then private.stuck_email(p_now) is null
       when 'backup_late' then (select max(r.finished_at) from private.backup_runs r) >= p_now - interval '26 hours'
       else false end;

  with candidates (kind, alert_key, order_id, user_id, details) as (
    -- contestação: a chave é a passagem para disputed, a mesma que o webhook usa ao abrir com o prazo
    select 'dispute', 'dispute:' || ev.id, o.id, o.user_id, '{}'::jsonb
      from public.orders o
      cross join lateral (select max(e.id) as id from public.order_events e where e.order_id = o.id and e.to_status = 'disputed') ev
     where o.status = 'disputed' and ev.id is not null
    union all
    -- acesso, presente ou aviso de reembolso que falhou de vez, ou que saiu e voltou (endereço que não recebe)
    select 'delivery_failed', 'email:' || x.id, x.order_id, x.user_id,
           jsonb_build_object('outbox_id', x.id, 'email_kind', x.kind, 'created_at', x.created_at,
                              'cause', case x.status when 'failed' then 'failed' else 'bounced' end, 'error', left(x.last_error, 200))
      from public.email_outbox x
     where x.kind in ('delivery', 'gift', 'refund') and x.created_at > p_now - interval '7 days'
       and (x.status = 'failed'
            or (x.status = 'sent' and exists (
                  select 1 from public.email_suppressions s
                   where s.reason = 'hard_bounce' and btrim(s.provider_message_id, '<>') = btrim(x.provider_message_id, '<>'))))
    union all
    -- pedido aberto há mais de 26 horas: a sessão da Stripe vence em 24, então o aviso dela não chegou
    select 'order_stuck', 'order:' || o.id, o.id, o.user_id, jsonb_build_object('status', o.status)
      from public.orders o
     where o.kind = 'purchase' and o.status in ('open', 'pending_payment') and o.stripe_checkout_session_id is not null
       and o.created_at > p_now - interval '7 days' and o.created_at < p_now - interval '26 hours'
    union all
    -- pago sem o "Li e aceito" gravado (2026-10-25): só quem destrava o formulário à mão chega aqui. Fecha à mão.
    select 'terms_missing', 'terms:' || o.id, o.id, o.user_id, '{}'::jsonb
      from public.orders o
     where o.kind = 'purchase' and o.status = 'paid' and o.terms_accepted_at is null
       and o.paid_at > p_now - interval '7 days'
    union all
    -- a Stripe confirmou o pagamento de um pedido que não existe aqui
    select 'stripe_unmatched', 'stripe:' || e.id, null, null,
           jsonb_build_object('event_id', e.id, 'type', e.type, 'object_id', e.stripe_object_id, 'livemode', e.livemode)
      from public.stripe_events e
     where e.outcome = 'not_found' and e.received_at > p_now - interval '7 days'
    union all
    -- fila de e-mail parada: um alerta por vez (a chave é o e-mail parado há mais tempo), que fecha quando a fila anda
    select 'email_queue_stuck', 'email_queue:' || s.id, null, null, '{}'::jsonb
      from (select private.stuck_email(p_now) as id) s
     where s.id is not null
       and not exists (select 1 from private.admin_alerts a where a.kind = 'email_queue_stuck' and a.resolved_at is null)
    union all
    -- backup atrasado: a chave é a última cópia, então só abre de novo se atrasar depois de outra cópia
    select 'backup_late', 'backup:' || b.id, null, null, jsonb_build_object('last_finished_at', b.finished_at)
      from (select r.id, r.finished_at from private.backup_runs r order by r.id desc limit 1) b
     where b.finished_at < p_now - interval '26 hours'
  ), opened as (
    insert into private.admin_alerts (kind, alert_key, order_id, user_id, details, opened_at)
    select c.kind, c.alert_key, c.order_id, c.user_id, c.details, p_now from candidates c
     where not exists (select 1 from private.admin_alerts a where a.alert_key = c.alert_key)
    on conflict (alert_key) do nothing
    returning id
  )
  select array_agg(id order by id) into v_new from opened;

  perform private.notify_admins(v_new);
  delete from private.admin_alerts a where a.resolved_at < p_now - interval '180 days';
  return coalesce(cardinality(v_new), 0);
end $$;
