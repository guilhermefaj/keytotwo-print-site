-- Seed de TESTE (docs/data-contract.md v0.3.2, seção 8). Roda só no ambiente LOCAL (supabase start / db reset).
-- Nunca aplicar em remoto sem autorização do orquestrador. Tudo é fictício e rotulado TESTE:
-- o nome comercial, o preço e a composição de avulsos NÃO são decisões comerciais. Valores monetários são 0 (não são preço).
-- Avulsos: J001 (Rabisque e Adivinhe; código do produto = código comercial do jogo, decisão do responsável) e TESTE-AV2 existem só aqui;
-- o P001 segue com nome PENDENTE. Os jogos mantêm os códigos TESTE-J0n (chaves do B2 e PDFs de teste dependem deles).
-- Sem senhas: os usuários entram por código de e-mail (Mailpit, porta 54324) ou criam outra conta de teste.
-- Os pedidos não passam pelas RPCs de checkout: o seed grava direto, como dono, e as invariantes (CHECKs e triggers)
-- validam a coerência. Cada pedido nasce open e chega ao estado final por arestas legais.
-- Um único bloco (uma transação): o trigger de consistência pedido-direito é checado no commit.

do $seed$
declare
  v_a constant uuid := '00000000-0000-4000-8000-00000000000a';   -- dona do P001
  v_b constant uuid := '00000000-0000-4000-8000-00000000000b';   -- dono do avulso 1; carrinho com o P001
  v_c constant uuid := '00000000-0000-4000-8000-00000000000c';   -- NÃO confirmado
  v_d constant uuid := '00000000-0000-4000-8000-00000000000d';   -- pendente, reembolsado e contestado
  v_e constant uuid := '00000000-0000-4000-8000-00000000000e';   -- contestação perdida, checkout expirado e abandonado
  v_p001 bigint;
  v_j001 bigint;
  v_av2  bigint;
  v_game bigint;
  v_file uuid;
  v_ent  uuid;
  v_i    int;
  v_code text;
  v_name text;
  r      record;
  e      record;
  v_path text[];
  v_step text;
begin
  -- ===== Usuários. As triggers de auth.users criam o perfil e o account_confirmed dos confirmados. =====
  -- O GoTrue lê estas 4 colunas como texto e quebra com NULL (admin/users responde 500, o login por código falha):
  -- uma inserção direta precisa gravar '' nelas, como o próprio GoTrue faz.
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '',
         case when u.confirmed then now() end,
         '', '', '', '',
         '{"provider":"email","providers":["email"]}', '{}', now(), now()
  from (values
    (v_a, 'teste-a@keytotwo.test', true),
    (v_b, 'teste-b@keytotwo.test', true),
    (v_c, 'teste-c@keytotwo.test', false),
    (v_d, 'teste-d@keytotwo.test', true),
    (v_e, 'teste-e@keytotwo.test', true)) as u(id, email, confirmed);

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select u.id::text, u.id,
         jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', (u.email_confirmed_at is not null), 'phone_verified', false),
         'email', now(), now(), now()
  from auth.users u
  where u.id in (v_a, v_b, v_c, v_d, v_e);

  -- ===== Catálogo =====
  insert into public.products (code, slug, kind, name, status, stripe_price_id, games_expected) values
    ('P001',      'p001',      'bundle', '[PENDENTE] Nome comercial do P001 [TESTE]', 'active', 'price_TESTE_P001', 5),
    ('J001',      'j001',      'single', '[TESTE] Rabisque e Adivinhe (avulso)',     'active', 'price_TESTE_J001', 1),
    ('TESTE-AV2', 'teste-av2', 'single', '[TESTE] Avulso Hora dos Artistas',          'active', 'price_TESTE_AV2',  1);
  select id into v_p001 from public.products where code = 'P001';
  select id into v_j001 from public.products where code = 'J001';
  select id into v_av2  from public.products where code = 'TESTE-AV2';

  -- Códigos de jogo são de teste: a base ainda não atribuiu J002 em diante. Vagas 4 e 5 não recebem título real.
  for v_i in 1..5 loop
    v_code := 'TESTE-J0' || v_i;
    v_name := case v_i
                when 1 then 'Rabisque e Adivinhe'
                when 2 then 'Hora dos Artistas'
                when 3 then 'Tabuleiro da Sorte'
                when 4 then 'Jogo 4'
                else        'Jogo 5'
              end;
    insert into public.games (code, slug, name, access, status)
    values (v_code, lower(v_code), v_name, 'paid', 'published')
    returning id into v_game;

    insert into public.product_games (product_id, game_id, position) values (v_p001, v_game, v_i);
    if v_i = 1 then
      insert into public.product_games (product_id, game_id, position) values (v_j001, v_game, 1);
    elsif v_i = 2 then
      insert into public.product_games (product_id, game_id, position) values (v_av2, v_game, 1);
    end if;

    -- Tamanho e sha256 dos 5 PDFs fictícios de TESTE enviados ao bucket de teste do B2 (lidos de volta e conferidos pelo Ferrolho no I4).
    -- Conteúdo fictício, sem dado pessoal e sem segredo; a chave, o nome e a versão são os de sempre. O bucket continua o nome fictício:
    -- a API assina sempre no bucket configurado no ambiente.
    insert into public.files (game_id, kind, access, version, filename, size_bytes, sha256, status, published_at)
    values (v_game, 'pdf', 'paid', '1.0', v_code || '-v1.0.pdf', 699,
            (jsonb_build_object(
               'TESTE-J01', '35454cce258badc63d530a5744c9a2d46d1d6fd5a718f2adedbcf310194fd7da',
               'TESTE-J02', '1f3251b5a26fd0efaae5f159e450f731923a7c4e862391571e5efc29d2b5a95f',
               'TESTE-J03', 'd8165f721e1fd0acdc545dc4624785f04842d1ae0c1c3d46d0d95173de76dc0d',
               'TESTE-J04', '98dd7189dd01904bcc4479a104aa4feb86466f0ff0dc42a6ea0f934c3673ed64',
               'TESTE-J05', '40207c1576721c3e2fbdf4fc4c6822b4238033733dbd7d0914a4ed5a72bcf372') ->> v_code),
            'published', now())
    returning id into v_file;
    insert into public.file_objects (file_id, access, bucket, object_key)
    values (v_file, 'paid', 'bucket-teste-pendente', 'paid/' || v_code || '/1.0/' || v_code || '-v1.0.pdf');
  end loop;

  -- Jogo gratuito fictício: draft (estado padrão = sem jogo gratuito). Para testar, publique jogo e arquivo.
  insert into public.games (code, slug, name, access, status)
  values ('TESTE-GRATIS', 'teste-gratis', 'Jogo gratuito fictício [TESTE]', 'free', 'draft')
  returning id into v_game;
  insert into public.files (game_id, kind, access, version, filename, size_bytes, sha256)
  values (v_game, 'pdf', 'free', '0.1', 'TESTE-GRATIS-v0.1.pdf', 1024, repeat('0', 64))
  returning id into v_file;
  insert into public.file_objects (file_id, access, bucket, object_key)
  values (v_file, 'free', 'bucket-teste-pendente', 'free/TESTE-GRATIS/0.1/TESTE-GRATIS-v0.1.pdf');

  -- ===== Clientes da Stripe de teste (fictícios) =====
  update public.profiles set stripe_customer_id = 'cus_TESTE_A' where user_id = v_a;
  update public.profiles set stripe_customer_id = 'cus_TESTE_B' where user_id = v_b;

  -- ===== Pedidos (ids fixos). Cada um nasce open (itens entram nesse estado) e chega ao estado final por arestas legais. =====
  for r in select * from (values
    (1, 'a1000001-0000-4000-8000-000000000001'::uuid, v_a, 'paid',         array['P001'],      72),
    (2, 'a1000002-0000-4000-8000-000000000002'::uuid, v_b, 'paid',         array['J001'], 60),
    (3, 'a1000003-0000-4000-8000-000000000003'::uuid, v_d, 'pending_payment', array['P001'],   48),
    (4, 'a1000004-0000-4000-8000-000000000004'::uuid, v_d, 'refunded',     array['TESTE-AV2'], 36),
    (5, 'a1000005-0000-4000-8000-000000000005'::uuid, v_d, 'disputed',     array['J001'], 24),
    (6, 'a1000006-0000-4000-8000-000000000006'::uuid, v_e, 'dispute_lost', array['TESTE-AV2'], 18),
    (7, 'a1000007-0000-4000-8000-000000000007'::uuid, v_e, 'expired',      array['J001'], 12),
    (8, 'a1000008-0000-4000-8000-000000000008'::uuid, v_e, 'open',         array['P001'],       6)
  ) as t(n, id, uid, final, prods, hours_ago)
  loop
    insert into public.orders (id, user_id, email, status, cart_version, terms_version, terms_accepted_at,
                               stripe_checkout_session_id, livemode, created_at)
    values (r.id, r.uid, (select lower(u.email) from auth.users u where u.id = r.uid), 'open', 0, 'v1-TESTE',
            now() - make_interval(hours => r.hours_ago),
            case when r.final <> 'open' then 'cs_test_TESTE_O' || r.n end, false,
            now() - make_interval(hours => r.hours_ago));

    insert into public.order_items (order_id, product_id, position, stripe_price_id)
    select r.id, p.id, u.ord, p.stripe_price_id
    from unnest(r.prods) with ordinality as u(code, ord)
    join public.products p on p.code = u.code;

    v_path := case r.final
      when 'open' then '{}' when 'pending_payment' then '{pending_payment}' when 'paid' then '{paid}'
      when 'failed' then '{failed}' when 'expired' then '{expired}'
      when 'disputed' then '{paid,disputed}' when 'dispute_lost' then '{paid,disputed,dispute_lost}'
      when 'refunded' then '{paid,refunded}' end::text[];
    foreach v_step in array v_path loop
      if v_step in ('pending_payment', 'paid') then
        update public.order_items set unit_amount = 0, currency = 'brl' where order_id = r.id and unit_amount is null;
      end if;
      update public.orders o set
        status = v_step,
        amount_total = case when v_step in ('pending_payment','paid','disputed','dispute_lost','refunded') then 0 else o.amount_total end,
        amount_subtotal = case when v_step in ('pending_payment','paid','disputed','dispute_lost','refunded') then 0 else o.amount_subtotal end,
        amount_discount = case when v_step in ('pending_payment','paid','disputed','dispute_lost','refunded') then 0 else o.amount_discount end,
        currency     = case when v_step in ('pending_payment','paid','disputed','dispute_lost','refunded') then 'brl' else o.currency end,
        paid_at      = case when v_step in ('paid','disputed','dispute_lost','refunded') then coalesce(o.paid_at, o.created_at + interval '5 minutes') else o.paid_at end,
        stripe_payment_intent_id = case when v_step in ('paid','disputed','dispute_lost','refunded') then coalesce(o.stripe_payment_intent_id, 'pi_TESTE_O' || r.n) else o.stripe_payment_intent_id end,
        refunded_at  = case when v_step = 'refunded' then o.created_at + interval '1 day' else o.refunded_at end
      where o.id = r.id;
    end loop;

    -- direitos (um por item) e fotografia da composição
    if r.final in ('paid', 'refunded', 'disputed', 'dispute_lost') then
      for e in select i.product_id from public.order_items i where i.order_id = r.id order by i.position loop
        insert into public.entitlements (order_id, product_id, user_id, status, granted_at, revoked_at, revoke_reason)
        values (r.id, e.product_id, r.uid,
                case when r.final = 'paid' then 'active' else 'revoked' end,
                now() - make_interval(hours => r.hours_ago) + interval '5 minutes',
                case when r.final <> 'paid' then now() end,
                case r.final when 'refunded' then 'refund' when 'disputed' then 'dispute' when 'dispute_lost' then 'dispute' end)
        returning id into v_ent;
        insert into public.entitlement_games (entitlement_id, game_id, position)
        select v_ent, pg.game_id, pg.position from public.product_games pg where pg.product_id = e.product_id;
      end loop;
    end if;
  end loop;

  -- ===== Carrinhos: B tem o P001 (sobreposição parcial: já possui o jogo 1); A vazio =====
  insert into public.carts (user_id, version) values (v_b, 1), (v_a, 0);
  insert into public.cart_items (user_id, product_id) values (v_b, v_p001);

  -- ===== Consentimento: só A (os demais sem consentimento) =====
  insert into public.marketing_consents (user_id, email, action, source, text_version)
  values (v_a, 'teste-a@keytotwo.test', 'granted', 'signup_prompt', 'v1-TESTE');
  update public.profiles set marketing_prompted_at = now() - interval '2 days' where user_id = v_a;   -- A já viu o convite; os demais não

  -- ===== Trilha, funil e fila (nenhum envio real) =====
  insert into public.order_events (order_id, from_status, to_status, source)
  select o.id, null, 'open', 'checkout' from public.orders o where o.id::text like 'a100000%';
  insert into public.order_events (order_id, from_status, to_status, source, stripe_event_id) values
    ('a1000001-0000-4000-8000-000000000001', 'open', 'paid', 'webhook', 'evt_TESTE_O1'),
    ('a1000002-0000-4000-8000-000000000002', 'open', 'paid', 'webhook', 'evt_TESTE_O2'),
    ('a1000003-0000-4000-8000-000000000003', 'open', 'pending_payment', 'webhook', 'evt_TESTE_O3');
  insert into public.stripe_events (id, type, livemode, stripe_object_id, order_id, outcome) values
    ('evt_TESTE_O1', 'checkout.session.completed', false, 'cs_test_TESTE_O1', 'a1000001-0000-4000-8000-000000000001', 'applied'),
    ('evt_TESTE_O2', 'checkout.session.completed', false, 'cs_test_TESTE_O2', 'a1000002-0000-4000-8000-000000000002', 'applied');
  insert into public.funnel_events (user_id, type, order_id, cart_version) values
    (v_a, 'checkout_started', 'a1000001-0000-4000-8000-000000000001', 0),
    (v_a, 'order_paid',       'a1000001-0000-4000-8000-000000000001', null),
    (v_b, 'checkout_started', 'a1000002-0000-4000-8000-000000000002', 0),
    (v_b, 'order_paid',       'a1000002-0000-4000-8000-000000000002', null);

  -- Entrega (delivery) na fila para os dois pedidos pagos: o mesmo payload de fulfill_order, por jogo, sem token.
  insert into public.email_outbox (user_id, order_id, kind, category, to_email, dedupe_key, payload)
  select o.user_id, o.id, 'delivery', 'transactional', o.email, 'delivery:' || o.id, private.delivery_payload(o.id)
  from public.orders o
  where o.id in ('a1000001-0000-4000-8000-000000000001', 'a1000002-0000-4000-8000-000000000002');
end
$seed$;
