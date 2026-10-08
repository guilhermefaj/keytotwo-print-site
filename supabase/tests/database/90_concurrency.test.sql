-- 90_concurrency: webhook e retorno ao mesmo tempo, checkouts simultâneos e ordem de travas (docs/data-contract.md v0.3.3, T120 a T125 e T127).
-- Roda com `supabase test db` (pgTAP). SEM begin/rollback: os dados são gravados de verdade (dblink precisa enxergá-los) e removidos no fim.
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp) ============================================
-- expect: executa o SQL e compara o SQLSTATE obtido ('OK' = sem erro) com o esperado.
create function pg_temp.expect(p_label text, p_sql text, p_state text) returns text language plpgsql as $$
declare st text := 'OK';
begin
  begin execute p_sql; exception when others then get stacked diagnostics st = returned_sqlstate; end;
  return extensions.is(st, p_state, p_label);
end $$;

-- expect_as: o mesmo, mas com o papel trocado (o pgTAP roda de volta como dono).
create function pg_temp.expect_as(p_label text, p_role text, p_sql text, p_state text) returns text language plpgsql as $$
declare st text := 'OK';
begin
  execute format('set local role %I', p_role);
  begin execute p_sql; exception when others then get stacked diagnostics st = returned_sqlstate; end;
  reset role;
  return extensions.is(st, p_state, p_label);
end $$;

create function pg_temp.assert(p_label text, p_cond boolean) returns text language sql as $$
  select extensions.ok(coalesce(p_cond, false), p_label)
$$;

create temp table ids (name text primary key, id uuid);
create function pg_temp.uid(p_name text) returns uuid language sql as $$ select id from pg_temp.ids where name = p_name $$;

-- usuário do Auth (as triggers criam o perfil e o account_confirmed)
create function pg_temp.mk_user(p_name text, p_confirmed boolean default true, p_password text default null) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_name || '@pgtap.test', p_password,
          case when p_confirmed then now() end, '', '', '', '', now(), now());
  insert into pg_temp.ids values (p_name, v_id);
  return v_id;
end $$;

-- produto ativo com N jogos publicados (PDF pago publicado + objeto no B2)
create function pg_temp.mk_product(p_code text, p_kind text, p_games int) returns bigint
language plpgsql as $$
declare v_pid bigint; v_gid bigint; v_fid uuid; i int; v_gcode text;
begin
  insert into public.products (code, slug, kind, name, status, stripe_price_id, games_expected)
  values (p_code, lower(p_code), p_kind, 'Produto ' || p_code || ' [TESTE]', 'active', 'price_PGTAP_' || p_code, p_games)
  returning id into v_pid;
  for i in 1..p_games loop
    v_gcode := 'GM-' || p_code || '-' || i;
    insert into public.games (code, slug, name, status) values (v_gcode, lower(v_gcode), 'Jogo ' || v_gcode || ' [TESTE]', 'published')
    returning id into v_gid;
    insert into public.product_games (product_id, game_id, position) values (v_pid, v_gid, i);
    insert into public.files (game_id, kind, access, version, filename, size_bytes, sha256, status, published_at)
    values (v_gid, 'pdf', 'paid', '1.0', v_gcode || '-v1.0.pdf', 1000 + i, repeat('0', 64), 'published', now())
    returning id into v_fid;
    insert into public.file_objects (file_id, access, bucket, object_key)
    values (v_fid, 'paid', 'bucket-pgtap-teste', 'paid/' || v_gcode || '/1.0/' || v_gcode || '-v1.0.pdf');
  end loop;
  return v_pid;
end $$;

-- um passo da máquina de estados do pedido, com os campos que o estado exige
create function pg_temp.mv(p_order uuid, p_to text) returns void language plpgsql as $$
declare v_paid boolean := p_to in ('paid','disputed','dispute_lost','refunded');
        v_money boolean := p_to in ('pending_payment','paid','disputed','dispute_lost','refunded');
begin
  if p_to in ('pending_payment', 'paid') then
    update public.order_items set unit_amount = 0, currency = 'brl' where order_id = p_order and unit_amount is null;
  end if;
  update public.orders o set
     status = p_to,
     amount_total = case when v_money then 0 else o.amount_total end,
     amount_subtotal = case when v_money then 0 else o.amount_subtotal end,
     amount_discount = case when v_money then 0 else o.amount_discount end,
     currency = case when v_money then 'brl' else o.currency end,
     paid_at = case when v_paid then coalesce(o.paid_at, now()) else o.paid_at end,
     stripe_payment_intent_id = case when v_paid then coalesce(o.stripe_payment_intent_id, 'pi_PGTAP_' || replace(o.id::text, '-', '')) else o.stripe_payment_intent_id end,
     refunded_at = case when p_to = 'refunded' then now() else o.refunded_at end
   where o.id = p_order;
end $$;

-- pedido no estado alvo, chegando por arestas legais
create function pg_temp.mk_order(p_user uuid, p_status text, p_products bigint[], p_tag text, p_created timestamptz default now()) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid(); i int; v_path text[];
begin
  insert into public.orders (id, user_id, email, status, cart_version, terms_version, terms_accepted_at,
                             stripe_checkout_session_id, livemode, created_at)
  values (v_id, p_user, (select lower(email) from auth.users where id = p_user), 'open', 0, 'v-pgtap', now(),
          'cs_test_PGTAP_' || p_tag, false, p_created);
  for i in 1..cardinality(p_products) loop
    insert into public.order_items (order_id, product_id, position, stripe_price_id)
    select v_id, p.id, i, p.stripe_price_id from public.products p where p.id = p_products[i];
  end loop;
  v_path := case p_status
    when 'open' then '{}' when 'pending_payment' then '{pending_payment}' when 'paid' then '{paid}'
    when 'failed' then '{failed}' when 'expired' then '{expired}'
    when 'disputed' then '{paid,disputed}' when 'dispute_lost' then '{paid,disputed,dispute_lost}'
    when 'refunded' then '{paid,refunded}' end::text[];
  for i in 1..coalesce(cardinality(v_path), 0) loop
    perform pg_temp.mv(v_id, v_path[i]);
  end loop;
  return v_id;
end $$;

-- direitos (um por item) com a fotografia da composição
create function pg_temp.mk_ents(p_order uuid, p_status text default 'active', p_reason text default null) returns void
language plpgsql as $$
declare r record; v_ent uuid;
begin
  for r in select i.product_id, o.user_id from public.order_items i join public.orders o on o.id = i.order_id
           where i.order_id = p_order order by i.position loop
    insert into public.entitlements (order_id, product_id, user_id, status, revoked_at, revoke_reason)
    values (p_order, r.product_id, r.user_id, p_status, case when p_status = 'revoked' then now() end, p_reason)
    returning id into v_ent;
    insert into public.entitlement_games (entitlement_id, game_id, position)
    select v_ent, pg.game_id, pg.position from public.product_games pg where pg.product_id = r.product_id;
  end loop;
end $$;

-- ===== ajudantes do checkout (05_checkout_fulfill e 90_concurrency) =================================
create temp table oids (name text primary key, id uuid);
create function pg_temp.oid(p_name text) returns uuid language sql as $$ select id from pg_temp.oids where name = p_name $$;

-- preenche o carrinho pelas RPCs e devolve a version
create function pg_temp.fill_cart(p_user uuid, p_codes text[]) returns integer language plpgsql as $$
declare c text;
begin
  foreach c in array p_codes loop perform public.cart_add(p_user, c); end loop;
  return coalesce((select ca.version from public.carts ca where ca.user_id = p_user), 0);
end $$;

-- pedido open pelas RPCs (carrinho -> create_order_from_cart -> attach_checkout_session)
create function pg_temp.open_order(p_user uuid, p_codes text[], p_attach boolean default true) returns uuid language plpgsql as $$
declare v_ver integer; v_order uuid;
begin
  v_ver := pg_temp.fill_cart(p_user, p_codes);
  select c.order_id into v_order from public.create_order_from_cart(p_user, false, v_ver, 'v-pgtap', true) c;
  if p_attach then
    perform public.attach_checkout_session(v_order, 'cs_test_PGTAP_' || replace(v_order::text, '-', ''));
  end if;
  return v_order;
end $$;

-- line_items da sessão para os itens do pedido (preço cheio por position)
create function pg_temp.sess_items(p_order uuid, p_amounts bigint[]) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('stripe_price_id', oi.stripe_price_id, 'quantity', 1,
                                      'unit_amount', p_amounts[oi.position], 'currency', 'brl') order by oi.position)
  from public.order_items oi where oi.order_id = p_order
$$;

-- fulfill_order com valores coerentes por padrão; p_over troca campos: discount, subtotal, total, code, intent, customer,
-- event, event_type, status, session, source, livemode, currency, items
create function pg_temp.fulfill(p_order uuid, p_amounts bigint[], p_over jsonb default '{}'::jsonb)
returns table (outcome text, order_id uuid, order_status text, entitlement_count integer, outbox_id uuid, send_delivery boolean)
language plpgsql as $$
declare
  v_sub  bigint := coalesce((select sum(a) from unnest(p_amounts) a), 0);
  v_disc bigint := coalesce((p_over->>'discount')::bigint, 0);
begin
  return query select * from public.fulfill_order(
    p_order_id => p_order,
    p_checkout_session_id => coalesce(p_over->>'session', 'cs_test_PGTAP_' || replace(p_order::text, '-', '')),
    p_payment_status => coalesce(p_over->>'status', 'paid'),
    p_amount_subtotal => coalesce((p_over->>'subtotal')::bigint, v_sub),
    p_amount_discount => v_disc,
    p_amount_total => coalesce((p_over->>'total')::bigint, v_sub - v_disc),
    p_currency => coalesce(p_over->>'currency', 'brl'),
    p_promotion_code => p_over->>'code',
    p_payment_intent_id => case when p_over ? 'intent' then p_over->>'intent' else 'pi_PGTAP_' || replace(p_order::text, '-', '') end,
    p_customer_id => p_over->>'customer',
    p_livemode => coalesce((p_over->>'livemode')::boolean, false),
    p_items => coalesce(p_over->'items', pg_temp.sess_items(p_order, p_amounts)),
    p_source => coalesce(p_over->>'source', 'webhook'),
    p_stripe_event_id => p_over->>'event',
    p_event_type => p_over->>'event_type');
end $$;

-- set_order_status: p_over troca: event, event_type, reason, source, subtotal, discount, total, currency, code, intent
create function pg_temp.setst(p_order uuid, p_new text, p_over jsonb default '{}'::jsonb)
returns table (outcome text, order_id uuid, previous_status text, order_status text, entitlement_status text)
language plpgsql as $$
begin
  return query select * from public.set_order_status(
    p_order_id => p_order, p_new_status => p_new,
    p_source => coalesce(p_over->>'source', 'webhook'),
    p_stripe_event_id => p_over->>'event',
    p_reason => p_over->>'reason',
    p_amount_total => (p_over->>'total')::bigint,
    p_currency => p_over->>'currency',
    p_payment_intent_id => p_over->>'intent',
    p_amount_subtotal => (p_over->>'subtotal')::bigint,
    p_amount_discount => (p_over->>'discount')::bigint,
    p_promotion_code => p_over->>'code',
    p_event_type => p_over->>'event_type');
end $$;

-- compra completa pelas RPCs; devolve o pedido
create function pg_temp.buy(p_user uuid, p_codes text[], p_amounts bigint[], p_over jsonb default '{}'::jsonb) returns uuid language plpgsql as $$
declare v_order uuid;
begin
  v_order := pg_temp.open_order(p_user, p_codes);
  perform * from pg_temp.fulfill(v_order, p_amounts, p_over);
  return v_order;
end $$;

-- I-5 no estado atual: dispara os gatilhos diferidos agora e volta ao modo diferido
create function pg_temp.i5(p_label text) returns text language plpgsql as $$
declare st text := 'OK';
begin
  begin set constraints all immediate; exception when others then get stacked diagnostics st = returned_sqlstate; end;
  set constraints all deferred;
  return extensions.is(st, 'OK', p_label);
end $$;

-- contagens de um pedido, para provar que nada mudou
create function pg_temp.footprint(p_order uuid) returns text language sql as $$
  select concat_ws('|',
    (select count(*) from public.entitlements where order_id = p_order),
    (select count(*) from public.entitlement_games eg join public.entitlements e on e.id = eg.entitlement_id where e.order_id = p_order),
    (select count(*) from public.email_outbox where order_id = p_order),
    (select count(*) from public.order_events where order_id = p_order),
    (select count(*) from public.funnel_events where order_id = p_order),
    (select count(*) from public.stripe_events where order_id = p_order),
    (select status from public.orders where id = p_order))
$$;

-- Cada corrida abre N conexões com dblink (todas com SET ROLE service_role, como a API), segura a trava da linha (pedido ou carrinho) numa conexão à parte, dispara as N chamadas,
-- espera todas ficarem bloqueadas e só então solta a trava: a disputa é real, não depende de sorte de tempo.
select exists (select 1 from pg_extension where extname = 'dblink') as had_dblink \gset
create extension if not exists dblink with schema extensions;

-- ===== ajudantes da corrida =========================================================================
-- Endereço do próprio servidor: o pg_hba do contêiner confia no 127.0.0.1 (e o dblink de quem não é superusuário exige senha de verdade),
-- então a corrida conecta pelo IP do servidor, com a senha padrão do banco local.
create function pg_temp.conn_str(p_app text default 'kt_race') returns text language sql as $$
  select format('host=%s port=%s dbname=%s user=postgres password=postgres application_name=%s',
                host(inet_server_addr()), current_setting('port'), current_database(), p_app)
$$;

create function pg_temp.race_disconnect(p_n integer) returns void language plpgsql as $$
declare i integer;
begin
  for i in 1..p_n loop
    begin perform extensions.dblink_disconnect('race' || i); exception when others then null; end;
  end loop;
  begin perform extensions.dblink_exec('racelock', 'rollback'); exception when others then null; end;
  begin perform extensions.dblink_disconnect('racelock'); exception when others then null; end;
end $$;

create function pg_temp.can_race() returns boolean language plpgsql as $$
begin
  if inet_server_addr() is null then return false; end if;
  perform extensions.dblink_connect('kt_probe', pg_temp.conn_str('kt_probe'));
  perform extensions.dblink_disconnect('kt_probe');
  return true;
exception when others then
  begin perform extensions.dblink_disconnect('kt_probe'); exception when others then null; end;
  return false;
end $$;

-- p_calls: SQL de cada conexão, cada um devolvendo UMA coluna jsonb (select to_jsonb(r) from ... r).
-- p_hold_sql: comando que trava a linha numa conexão à parte (select 1 from ... for update); todas as chamadas ficam esperando
-- por ela e a corrida só começa depois que as N estão bloqueadas.
create function pg_temp.race(p_calls text[], p_hold_sql text default null) returns setof jsonb language plpgsql as $$
declare
  n         integer := cardinality(p_calls);
  i         integer;
  v_waiting integer;
  t0        timestamptz := clock_timestamp();
  v_conn    text := pg_temp.conn_str();
  r         jsonb;
begin
  perform pg_temp.race_disconnect(n + 5);
  begin
    for i in 1..n loop
      perform extensions.dblink_connect('race' || i, v_conn);
      -- como a API: o COMMIT (e os gatilhos diferidos da I-5) roda com o papel service_role, que não tem SELECT em tabela alguma (D-12)
      perform extensions.dblink_exec('race' || i, 'set role service_role');
      -- uma trava que não solta quebra o teste em 20 s (erro 55P03) em vez de pendurar a suíte
      perform extensions.dblink_exec('race' || i, 'set lock_timeout = ''20s''');
    end loop;
    if p_hold_sql is not null then
      perform extensions.dblink_connect('racelock', pg_temp.conn_str('kt_racelock'));
      perform extensions.dblink_exec('racelock', 'begin');
      perform * from extensions.dblink('racelock', p_hold_sql) as t(x integer);
    end if;
    for i in 1..n loop
      perform extensions.dblink_send_query('race' || i, p_calls[i]);
    end loop;
    if p_hold_sql is not null then
      loop
        perform pg_stat_clear_snapshot();
        select count(*) into v_waiting from pg_stat_activity a
         where a.application_name = 'kt_race' and a.state = 'active' and a.wait_event_type = 'Lock';
        exit when v_waiting >= n or clock_timestamp() > t0 + interval '20 seconds';
        perform pg_sleep(0.05);
      end loop;
      if v_waiting < n then
        raise exception 'corrida: só % de % chamadas ficaram bloqueadas na trava', v_waiting, n;
      end if;
      perform extensions.dblink_exec('racelock', 'commit');
    end if;
    for i in 1..n loop
      for r in select t.j from extensions.dblink_get_result('race' || i) as t(j jsonb) loop
        return next r;
      end loop;
    end loop;
  exception when others then
    perform pg_temp.race_disconnect(n + 5);
    raise;
  end;
  perform pg_temp.race_disconnect(n + 5);
  return;
end $$;

-- remove tudo o que a corrida gravou (os logs são só inserção: os gatilhos de proteção são desligados dentro desta transação
-- e voltam sozinhos; se algo falhar, nada fica desligado). Padrões próprios: usuários conc*@pgtap.test, produtos CONC*, jogos GM-CONC*.
create function pg_temp.conc_cleanup() returns void language plpgsql as $$
declare
  v_users  uuid[] := coalesce((select array_agg(id) from auth.users where email like 'conc%@pgtap.test'), '{}');
  v_orders uuid[] := coalesce((select array_agg(id) from public.orders where user_id = any (v_users)), '{}');
begin
  alter table public.order_events        disable trigger order_events_forbid_modification;
  alter table public.stripe_events       disable trigger stripe_events_forbid_modification;
  alter table public.entitlement_games   disable trigger entitlement_games_forbid_modification;
  alter table public.funnel_events       disable trigger funnel_events_guard;
  alter table public.order_items         disable trigger order_items_guard_changes;
  alter table public.files               disable trigger files_guard_changes;
  alter table public.file_objects        disable trigger file_objects_guard_changes;

  delete from public.stripe_events where id like 'evt\_CONC%' or order_id = any (v_orders);
  delete from public.order_events where order_id = any (v_orders);
  delete from public.funnel_events where user_id = any (v_users) or order_id = any (v_orders);
  delete from public.email_outbox where user_id = any (v_users);
  delete from public.entitlement_games where entitlement_id in (select id from public.entitlements where user_id = any (v_users));
  delete from public.entitlements where user_id = any (v_users);
  delete from public.order_items where order_id = any (v_orders);
  delete from public.orders where id = any (v_orders);
  delete from public.cart_items where user_id = any (v_users);
  delete from public.carts where user_id = any (v_users);
  delete from public.download_events where file_id in (select f.id from public.files f join public.games g on g.id = f.game_id where g.code like 'GM-CONC%');
  delete from public.file_objects where file_id in (select f.id from public.files f join public.games g on g.id = f.game_id where g.code like 'GM-CONC%');
  delete from public.files where game_id in (select id from public.games where code like 'GM-CONC%');
  delete from public.product_games where product_id in (select id from public.products where code like 'CONC%');
  delete from public.products where code like 'CONC%';
  delete from public.games where code like 'GM-CONC%';
  delete from auth.users where id = any (v_users);   -- o perfil cai em cascata

  alter table public.order_events        enable trigger order_events_forbid_modification;
  alter table public.stripe_events       enable trigger stripe_events_forbid_modification;
  alter table public.entitlement_games   enable trigger entitlement_games_forbid_modification;
  alter table public.funnel_events       enable trigger funnel_events_guard;
  alter table public.order_items         enable trigger order_items_guard_changes;
  alter table public.files               enable trigger files_guard_changes;
  alter table public.file_objects        enable trigger file_objects_guard_changes;
end $$;

-- ===== corrida ======================================================================================
select pg_temp.conc_cleanup();   -- sobras de uma execução interrompida
select pg_temp.can_race() as can_race \gset

\if :can_race

create temp table rr (test text, n serial, j jsonb);

-- fixtures gravadas de verdade (o DO termina e confirma antes de qualquer corrida: as outras conexões só enxergam o que foi confirmado)
do $fx$
declare i integer;
begin
  perform pg_temp.mk_product('CONCA1', 'single', 1);
  perform pg_temp.mk_product('CONCB1', 'bundle', 2);
  perform pg_temp.mk_product('CONCC1', 'single', 1);
  for i in 1..9 loop perform pg_temp.mk_user('conc' || i); end loop;        -- T120 a T127
  for i in 1..6 loop perform pg_temp.mk_user('concr' || i); end loop;       -- T122 (uma por rodada)
  for i in 1..4 loop perform pg_temp.mk_user('conct' || i); end loop;       -- T124 (uma por rodada)
end $fx$;

-- SQL de cada RPC como texto, para as outras conexões (cada uma devolve UMA coluna jsonb)
create function pg_temp.sql_fulfill(p_order uuid, p_amounts bigint[], p_event text, p_source text default 'webhook') returns text language sql as $$
  select format($f$select to_jsonb(r) from public.fulfill_order(%L, %L, 'paid', %s, 0, %s, 'brl', null, %L, null, false, %L::jsonb, %L, %L, 'checkout.session.completed') r$f$,
    p_order, 'cs_test_PGTAP_' || replace(p_order::text, '-', ''), (select sum(a) from unnest(p_amounts) a), (select sum(a) from unnest(p_amounts) a),
    'pi_PGTAP_' || replace(p_order::text, '-', ''), pg_temp.sess_items(p_order, p_amounts)::text, p_source, p_event)
$$;
create function pg_temp.sql_status(p_order uuid, p_new text, p_event text) returns text language sql as $$
  select format($f$select to_jsonb(r) from public.set_order_status(%L, %L, 'webhook', %L) r$f$, p_order, p_new, p_event)
$$;
create function pg_temp.sql_checkout(p_user uuid, p_version integer) returns text language sql as $$
  select format($f$select to_jsonb(r) from public.create_order_from_cart(%L, false, %s, 'v-conc', true) r$f$, p_user, p_version)
$$;
create function pg_temp.sql_cart_add(p_user uuid, p_code text) returns text language sql as $$
  select format($f$select to_jsonb(r) from public.cart_add(%L, %L) r$f$, p_user, p_code)
$$;
create function pg_temp.hold_order(p_order uuid) returns text language sql as $$ select format('select 1 from public.orders where id = %L for update', p_order) $$;
create function pg_temp.hold_cart(p_user uuid) returns text language sql as $$ select format('select 1 from public.carts where user_id = %L for update', p_user) $$;

-- ----- T120: 10 fulfill_order simultâneos, mesmo pedido e mesmo evento --------------------------------
do $c$ begin insert into pg_temp.oids values ('t120', pg_temp.open_order(pg_temp.uid('conc1'), array['CONCA1'])); end $c$;
insert into rr (test, j) select 't120', j from pg_temp.race(
  array_fill(pg_temp.sql_fulfill(pg_temp.oid('t120'), array[1000], 'evt_CONC_T120'), array[10]), pg_temp.hold_order(pg_temp.oid('t120'))) j;
select pg_temp.assert('T120: 10 chamadas simultâneas do mesmo evento: exatamente 1 applied e 9 duplicate_event',
  (select count(*) = 10 and count(*) filter (where j->>'outcome' = 'applied') = 1 and count(*) filter (where j->>'outcome' = 'duplicate_event') = 9 from rr where test = 't120'));
select pg_temp.assert('T120: um único send_delivery = true', (select count(*) filter (where (j->>'send_delivery')::boolean) = 1 from rr where test = 't120'));
select pg_temp.assert('T120: 1 direito, 1 fotografia, 1 entrega, 2 trilhas, 2 funis, 1 evento e pedido paid', pg_temp.footprint(pg_temp.oid('t120')) = '1|1|1|2|2|1|paid');

-- ----- T121: webhook e página de retorno ao mesmo tempo (eventos distintos e sem evento) ---------------
do $c$ begin insert into pg_temp.oids values ('t121', pg_temp.open_order(pg_temp.uid('conc2'), array['CONCB1'])); end $c$;
insert into rr (test, j) select 't121', j from pg_temp.race(array[
  pg_temp.sql_fulfill(pg_temp.oid('t121'), array[2500], 'evt_CONC_T121A'), pg_temp.sql_fulfill(pg_temp.oid('t121'), array[2500], 'evt_CONC_T121B'),
  pg_temp.sql_fulfill(pg_temp.oid('t121'), array[2500], 'evt_CONC_T121A'),
  replace(pg_temp.sql_fulfill(pg_temp.oid('t121'), array[2500], 'evt_CONC_X', 'return_page'), ', ''evt_CONC_X'', ', ', null, '),
  replace(pg_temp.sql_fulfill(pg_temp.oid('t121'), array[2500], 'evt_CONC_X', 'return_page'), ', ''evt_CONC_X'', ', ', null, ')],
  pg_temp.hold_order(pg_temp.oid('t121'))) j;
select pg_temp.assert('T121: webhook ∥ retorno: exatamente 1 applied; as outras são noop ou duplicate_event',
  (select count(*) = 5 and count(*) filter (where j->>'outcome' = 'applied') = 1
          and count(*) filter (where j->>'outcome' in ('noop', 'duplicate_event')) = 4 from rr where test = 't121'));
select pg_temp.assert('T121: 1 entrega nova, 1 direito com 2 jogos, pedido paid, sem duplicata',
  (select count(*) filter (where (j->>'send_delivery')::boolean) = 1 from rr where test = 't121')
  and (select count(*) = 1 from public.entitlements where order_id = pg_temp.oid('t121'))
  and (select count(*) = 2 from public.entitlement_games eg join public.entitlements e on e.id = eg.entitlement_id where e.order_id = pg_temp.oid('t121'))
  and (select count(*) = 1 from public.email_outbox where order_id = pg_temp.oid('t121'))
  and (select status = 'paid' from public.orders where id = pg_temp.oid('t121'))
  and (select count(*) = 1 from public.funnel_events where order_id = pg_temp.oid('t121') and type = 'order_paid'));

-- ----- T122: liberação ∥ contestação, 6 rodadas (a ordem das chamadas alterna) -------------------------
create function pg_temp.t122_setup(i integer) returns void language plpgsql as $$
begin
  insert into pg_temp.oids values ('t122_' || i, pg_temp.open_order(pg_temp.uid('concr' || i), array['CONCC1']));
end $$;
create function pg_temp.t122_calls(i integer) returns text[] language sql as $$
  select case when i % 2 = 1
              then array[pg_temp.sql_fulfill(pg_temp.oid('t122_' || i), array[900], 'evt_CONC_T122F' || i), pg_temp.sql_status(pg_temp.oid('t122_' || i), 'disputed', 'evt_CONC_T122D' || i)]
              else array[pg_temp.sql_status(pg_temp.oid('t122_' || i), 'disputed', 'evt_CONC_T122D' || i), pg_temp.sql_fulfill(pg_temp.oid('t122_' || i), array[900], 'evt_CONC_T122F' || i)] end
$$;
-- a contestação que ganhou a trava antes da liberação voltou deferred: a Stripe reenvia o mesmo evento
create function pg_temp.t122_resend(i integer) returns void language plpgsql as $$
begin
  if (select status from public.orders where id = pg_temp.oid('t122_' || i)) = 'paid' then
    insert into rr (test, j) select 't122r_' || i, to_jsonb(s) from public.set_order_status(pg_temp.oid('t122_' || i), 'disputed', 'webhook', 'evt_CONC_T122D' || i) s;
  end if;
end $$;
-- cada passo da rodada é um comando próprio (\gexec), para o setup ser confirmado antes da corrida
select s from generate_series(1, 6) i,
  lateral (values (1, format('select pg_temp.t122_setup(%s)', i)),
                  (2, format($q$insert into rr (test, j) select 't122_%1$s', j from pg_temp.race(pg_temp.t122_calls(%1$s), pg_temp.hold_order(pg_temp.oid('t122_%1$s'))) j$q$, i)),
                  (3, format('select pg_temp.t122_resend(%s)', i))) v(ord, s)
 order by i, ord \gexec

select pg_temp.assert('T122: em cada rodada, 1 liberação applied e a contestação applied ou deferred (nunca erro nem perda)',
  (select count(*) = 0 from generate_series(1, 6) i
    where (select count(*) from rr where test = 't122_' || i and j ? 'send_delivery' and j->>'outcome' = 'applied') <> 1
       or (select count(*) from rr where test = 't122_' || i and j ? 'previous_status' and j->>'outcome' in ('applied', 'deferred')) <> 1));
select pg_temp.assert('T122: depois do reenvio dos deferred, os 6 pedidos terminam disputed',
  (select count(*) = 6 and bool_and(o.status = 'disputed') from public.orders o where o.id in (select id from pg_temp.oids where name like 't122\_%')));
select pg_temp.assert('T122: I-5 no estado final: 1 direito por pedido, nenhum ativo, 1 entrega, sem duplicata',
  (select count(*) = 0 from pg_temp.oids x where x.name like 't122\_%' and
     ((select count(*) from public.entitlements e where e.order_id = x.id) <> 1
      or (select count(*) from public.entitlements e where e.order_id = x.id and e.status = 'active') <> 0
      or (select count(*) from public.email_outbox m where m.order_id = x.id) <> 1)));
select diag(format('T122: contestação antes da liberação (deferred e reenviada) em %s das 6 rodadas', (select count(*) from rr where test like 't122r\_%')));

-- ----- T123: checkouts simultâneos do mesmo usuário e da mesma versão ----------------------------------
do $c$ begin perform pg_temp.fill_cart(pg_temp.uid('conc7'), array['CONCA1', 'CONCB1']); end $c$;
insert into rr (test, j) select 't123', j from pg_temp.race(
  array_fill(pg_temp.sql_checkout(pg_temp.uid('conc7'), 2), array[8]), pg_temp.hold_cart(pg_temp.uid('conc7'))) j;
select pg_temp.assert('T123: 8 checkouts simultâneos: todos ok, 1 criou e 7 reaproveitaram, todos com o mesmo pedido',
  (select count(*) = 8 and count(*) filter (where j->>'outcome' = 'ok') = 8 and count(*) filter (where not (j->>'reused')::boolean) = 1
          and count(distinct j->>'order_id') = 1 from rr where test = 't123'));
select pg_temp.assert('T123: um único pedido open, 2 itens, 1 funil checkout_started e 1 linha de trilha',
  (select count(*) = 1 from public.orders where user_id = pg_temp.uid('conc7') and status = 'open')
  and (select count(*) = 2 from public.order_items oi join public.orders o on o.id = oi.order_id where o.user_id = pg_temp.uid('conc7'))
  and (select count(*) = 1 from public.funnel_events where user_id = pg_temp.uid('conc7') and type = 'checkout_started')
  and (select count(*) = 1 from public.order_events oe join public.orders o on o.id = oe.order_id where o.user_id = pg_temp.uid('conc7')));

-- ----- T124: cart_add ∥ create_order_from_cart, 4 rodadas --------------------------------------------------
create function pg_temp.t124_setup(i integer) returns void language plpgsql as $$
begin
  perform pg_temp.fill_cart(pg_temp.uid('conct' || i), array['CONCA1']);   -- version 1
end $$;
create function pg_temp.t124_calls(i integer) returns text[] language sql as $$
  select case when i % 2 = 1
              then array[pg_temp.sql_checkout(pg_temp.uid('conct' || i), 1), pg_temp.sql_cart_add(pg_temp.uid('conct' || i), 'CONCB1')]
              else array[pg_temp.sql_cart_add(pg_temp.uid('conct' || i), 'CONCB1'), pg_temp.sql_checkout(pg_temp.uid('conct' || i), 1)] end
$$;
select s from generate_series(1, 4) i,
  lateral (values (1, format('select pg_temp.t124_setup(%s)', i)),
                  (2, format($q$insert into rr (test, j) select 't124_%1$s', j from pg_temp.race(pg_temp.t124_calls(%1$s), pg_temp.hold_cart(pg_temp.uid('conct%1$s'))) j$q$, i))) v(ord, s)
 order by i, ord \gexec

select pg_temp.assert('T124: nunca sai pedido com um carrinho que o usuário não viu (ok só com o item visto, ou cart_changed sem pedido)',
  (select count(*) = 0 from generate_series(1, 4) i
    where not (
      ((select count(*) from rr where test = 't124_' || i and j->>'outcome' = 'ok') = 1
        and (select count(*) = 1 from public.order_items oi join public.orders o on o.id = oi.order_id where o.user_id = pg_temp.uid('conct' || i) and o.status = 'open'))
      or
      ((select count(*) from rr where test = 't124_' || i and j->>'outcome' = 'cart_changed') = 1
        and (select count(*) = 0 from public.orders o where o.user_id = pg_temp.uid('conct' || i) and o.status = 'open')))));
select pg_temp.assert('T124: o cart_add nunca se perde: cada carrinho termina com os 2 itens e version 2',
  (select count(*) = 4 and bool_and(version = 2) from public.carts where user_id in (select pg_temp.uid('conct' || i) from generate_series(1, 4) i))
  and (select count(*) = 8 from public.cart_items where user_id in (select pg_temp.uid('conct' || i) from generate_series(1, 4) i)));

-- ----- T127: sem deadlock entre liberação (pedido, depois carrinho), checkout e carrinho ---------------------
do $c$
declare o uuid; u uuid := pg_temp.uid('conc8');
begin
  perform pg_temp.fill_cart(u, array['CONCA1', 'CONCB1']);
  o := pg_temp.open_order(u, array['CONCA1', 'CONCB1']);
  insert into pg_temp.oids values ('t127', o);
end $c$;
insert into rr (test, j) select 't127', j from pg_temp.race(array[
  pg_temp.sql_fulfill(pg_temp.oid('t127'), array[1000, 2500], 'evt_CONC_T127'),
  pg_temp.sql_checkout(pg_temp.uid('conc8'), 2), pg_temp.sql_cart_add(pg_temp.uid('conc8'), 'CONCC1'),
  format($f$select to_jsonb(r) from public.cart_remove(%L, 'CONCA1') r$f$, pg_temp.uid('conc8')),
  pg_temp.sql_checkout(pg_temp.uid('conc8'), 2)],
  pg_temp.hold_cart(pg_temp.uid('conc8'))) j;
select pg_temp.assert('T127: as 5 chamadas terminaram sem deadlock (40P01) nem erro', (select count(*) = 5 from rr where test = 't127'));
select pg_temp.assert('T127: o pedido foi liberado uma vez, com 2 direitos e uma entrega', (select status = 'paid' from public.orders where id = pg_temp.oid('t127'))
  and (select count(*) = 2 from public.entitlements where order_id = pg_temp.oid('t127'))
  and (select count(*) = 1 from public.email_outbox where order_id = pg_temp.oid('t127')));

-- ----- T125: a fila não entrega a mesma linha a dois despachantes ---------------------------------------
-- 24 entregas vencidas, as mais antigas do banco (os claims desta corrida nunca chegam às linhas de outros dados, como as do seed).
do $fx$
declare i integer; o uuid; v_prod bigint := (select id from public.products where code = 'CONCA1');
begin
  for i in 1..24 loop
    perform pg_temp.mk_user('concq' || i);
    o := pg_temp.mk_order(pg_temp.uid('concq' || i), 'paid', array[v_prod], 'CONCQ' || i);
    perform pg_temp.mk_ents(o);
    insert into public.email_outbox (user_id, order_id, kind, category, to_email, payload, scheduled_at, dedupe_key)
    values (pg_temp.uid('concq' || i), o, 'delivery', 'transactional', 'concq' || i || '@pgtap.test', '{}'::jsonb,
            now() - interval '2 days' - (i * interval '1 minute'), 'conc:q' || i);
  end loop;
end $fx$;

-- (a) um despachante PEGA 8 e não confirma ainda (linhas travadas); outros dois pegam ao mesmo tempo: nenhum recebe linha do primeiro
do $c$
begin
  perform extensions.dblink_connect('claimhold', pg_temp.conn_str('kt_claimhold'));
  perform extensions.dblink_exec('claimhold', 'set role service_role');
  perform extensions.dblink_exec('claimhold', 'begin');
  insert into rr (test, j) select 't125_hold', j from extensions.dblink('claimhold', 'select to_jsonb(r) from public.claim_email_batch(8) r') as t(j jsonb);
end $c$;
insert into rr (test, j) select 't125_c', j from pg_temp.race(array[
  'select to_jsonb(r) from public.claim_email_batch(8) r', 'select to_jsonb(r) from public.claim_email_batch(8) r']) j;
do $c$
begin
  perform extensions.dblink_exec('claimhold', 'commit');
  perform extensions.dblink_disconnect('claimhold');
exception when others then
  begin perform extensions.dblink_disconnect('claimhold'); exception when others then null; end;
  raise;
end $c$;
select pg_temp.assert('T125: o despachante que segurava 8 linhas recebeu 8 e os outros dois, 16 (nenhum a mais, nenhum a menos)',
  (select count(*) filter (where test = 't125_hold') = 8 and count(*) filter (where test = 't125_c') = 16 from rr where test like 't125%'));
select pg_temp.assert('T125: nenhuma linha foi entregue duas vezes (24 ids distintos)', (select count(distinct j->>'id') = 24 from rr where test like 't125%'));
select pg_temp.assert('T125: só linhas desta corrida (a fila de outros dados, como a do seed, não foi tocada)',
  (select count(*) = 0 from rr where test like 't125%' and j->>'to_email' not like 'concq%@pgtap.test'));
select pg_temp.assert('T125: as 24 linhas ficaram em envio, com locked_at',
  (select count(*) = 24 and bool_and(status = 'sending' and locked_at is not null) from public.email_outbox where dedupe_key like 'conc:q%'));

-- (b) o mesmo resultado informado ao mesmo tempo: uma aplica, as outras viram noop, e o funil registra uma vez
do $c$
begin
  insert into pg_temp.oids select 't125_mark', id from public.email_outbox where dedupe_key = 'conc:q1';
end $c$;
insert into rr (test, j) select 't125_m', j from pg_temp.race(
  array_fill(format($f$select to_jsonb(r) from public.mark_email_result(%L, 'sent', 'msg-conc') r$f$, pg_temp.oid('t125_mark')), array[6]),
  format('select 1 from public.email_outbox where id = %L for update', pg_temp.oid('t125_mark'))) j;
select pg_temp.assert('T125: 6 marcações simultâneas do mesmo envio: 1 applied e 5 noop',
  (select count(*) = 6 and count(*) filter (where j->>'outcome' = 'applied') = 1 and count(*) filter (where j->>'outcome' = 'noop' and j->>'status' = 'sent') = 5 from rr where test = 't125_m'));
select pg_temp.assert('T125: a linha ficou sent, com 1 funil delivery_sent no pedido',
  (select status = 'sent' and provider_message_id = 'msg-conc' and sent_at is not null from public.email_outbox where dedupe_key = 'conc:q1')
  and (select count(*) = 1 from public.funnel_events f join public.email_outbox x on x.order_id = f.order_id where x.dedupe_key = 'conc:q1' and f.type = 'delivery_sent'));

-- ----- I-5 nos pedidos de todas as corridas, no estado gravado --------------------------------------------
select pg_temp.assert('I-5 no estado gravado: todo pedido paid tem um direito por item e nenhum outro estado tem direito ativo',
  (select count(*) = 0 from public.orders o where o.user_id in (select id from auth.users where email like 'conc%@pgtap.test')
     and ((o.status = 'paid' and (select count(*) from public.entitlements e where e.order_id = o.id) <> (select count(*) from public.order_items i where i.order_id = o.id))
       or (o.status <> 'paid' and exists (select 1 from public.entitlements e where e.order_id = o.id and e.status = 'active')))));

\else
select skip('concorrência: o dblink não conectou (IP do servidor ou senha local diferentes do padrão); rode com a stack local padrão do supabase start', 1);
\endif

select pg_temp.conc_cleanup();
\if :had_dblink
\else
drop extension dblink;
\endif
select pg_temp.assert('limpeza: nenhum dado de concorrência sobrou',
  (select count(*) = 0 from auth.users where email like 'conc%@pgtap.test') and (select count(*) = 0 from public.products where code like 'CONC%')
  and (select count(*) = 0 from public.stripe_events where id like 'evt\_CONC%') and (select count(*) = 0 from public.games where code like 'GM-CONC%'));

select * from finish();
