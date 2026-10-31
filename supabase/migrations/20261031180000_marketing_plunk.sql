-- Marketing no Plunk (2026-10-31, fase 4 da troca da Brevo pelo Plunk):
--   1. 2º toque da sacola (cart_reminder_2): 24 h depois do 1º lembrete enviado da mesma versão do carrinho, com o
--      carrinho igual, só para quem nunca comprou (o cupom PRIMEIRA10 do e-mail é da primeira compra). Os dois lembretes
--      só são enfileirados com as vendas abertas (private.sales_opening): antes disso a compra está fechada.
--   2. Contatos de marketing no Plunk: quem já deu opt-in alguma vez tem uma linha em private.marketing_contacts. As
--      triggers marcam a linha quando muda o que o Plunk precisa saber (consentimento, supressão, compra, jogos, e-mail),
--      e o email-dispatch manda o estado atual (claim_marketing_contacts, mark_marketing_contact). A primeira inscrição
--      manda o evento "inscricao", que começa as boas-vindas no Plunk (uma vez por pessoa).
--   3. O descadastro feito no Plunk (rodapé dos e-mails dele) volta para o site: record_plunk_unsubscribe, origem
--      plunk_webhook, pelo mesmo caminho do SES e da Brevo (supressão, consentimento revogado, marketing da fila cancelado).

-- ===== 1. 2º toque da sacola =========================================================================================
alter table public.email_outbox
  drop constraint email_outbox_kind_check,
  drop constraint email_outbox_kind_category_check;
alter table public.email_outbox
  add constraint email_outbox_kind_check check (kind in
    ('delivery', 'gift', 'refund', 'admin_alert', 'cart_reminder', 'cart_reminder_2', 'post_purchase')),
  add constraint email_outbox_kind_category_check check ((kind in ('delivery', 'gift', 'refund', 'admin_alert')) = (category = 'transactional'));

-- Já comprou alguma vez (pedido de compra que chegou a ser pago, mesmo que depois contestado ou reembolsado)? É o mesmo
-- critério do "só na primeira compra" do cupom na Stripe.
create function private.has_purchased(p_user_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.orders o
                  where o.user_id = p_user_id and o.kind = 'purchase'
                    and o.status in ('paid', 'disputed', 'dispute_lost', 'refunded'))
$$;

-- Os itens que o lembrete mostra: vendáveis e ainda não possuídos inteiros, na ordem em que entraram. NULL sem nenhum.
create function private.cart_reminder_items(p_user_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name) order by ci.added_at, p.id)
    from public.cart_items ci
    join public.products p on p.id = ci.product_id
   where ci.user_id = p_user_id
     and private.product_is_sellable(p.id)
     and not (exists (select 1 from public.product_games pg where pg.product_id = p.id)
              and not exists (select 1 from public.product_games pg
                               where pg.product_id = p.id
                                 and pg.game_id not in (select o from private.owned_game_ids(p_user_id) o)))
$$;

create or replace function private.enqueue_followups(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  c_reminder_after constant interval := interval '3 hours';   -- lembrete de carrinho: sem mudança há 3 h (D3)
  c_second_after   constant interval := interval '24 hours';  -- 2º toque: 24 h depois do 1º lembrete enviado
  c_second_until   constant interval := interval '72 hours';  -- janela do 2º toque: não dispara lembrete velho
  c_post_after     constant interval := interval '3 days';    -- pós-compra em D+3 (D3)
  c_post_until     constant interval := interval '14 days';   -- janela do pós-compra: não dispara pedido velho quando a agenda liga
  v_sched timestamptz := least(coalesce(p_now, now()), now());   -- igual a p_now em produção; deixa o teste adiantar o relógio
  v_now   timestamptz := coalesce(p_now, now());
  v_open  boolean;
  v_n     integer := 0;
  v_rows  integer;
begin
  -- com a compra fechada (antes da abertura das vendas) a sacola não tem lembrete
  v_open := not exists (select 1 from private.sales_opening s where s.opens_at > v_now);

  -- lembrete de carrinho: itens vendáveis e ainda não possuídos, carrinho parado, uma vez por version
  insert into public.email_outbox (user_id, kind, category, to_email, payload, scheduled_at, dedupe_key)
  select c.user_id, 'cart_reminder', 'marketing', private.normalize_email(u.email),
         jsonb_build_object('cart_version', c.version, 'items', it.items),
         v_sched, 'cart_reminder:' || c.user_id::text || ':' || c.version::text
    from public.carts c
    join auth.users u on u.id = c.user_id
   cross join lateral (select private.cart_reminder_items(c.user_id) as items) it
   where v_open
     and c.updated_at <= v_now - c_reminder_after
     and it.items is not null
     and not exists (select 1 from public.orders o where o.user_id = c.user_id and o.status = 'pending_payment')
     and private.marketing_allowed(c.user_id)
  on conflict (dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  v_n := v_n + v_rows;

  -- 2º toque: o 1º lembrete desta version saiu há 24 h (e não há mais de 72 h), o carrinho não mudou e a pessoa nunca
  -- comprou; uma vez por version
  insert into public.email_outbox (user_id, kind, category, to_email, payload, scheduled_at, dedupe_key)
  select c.user_id, 'cart_reminder_2', 'marketing', private.normalize_email(u.email),
         jsonb_build_object('cart_version', c.version, 'items', it.items),
         v_sched, 'cart_reminder_2:' || c.user_id::text || ':' || c.version::text
    from public.carts c
    join auth.users u on u.id = c.user_id
    join public.email_outbox r1 on r1.dedupe_key = 'cart_reminder:' || c.user_id::text || ':' || c.version::text
   cross join lateral (select private.cart_reminder_items(c.user_id) as items) it
   where v_open
     and r1.status = 'sent'
     and r1.sent_at <= v_now - c_second_after
     and r1.sent_at >  v_now - c_second_until
     and it.items is not null
     and not exists (select 1 from public.orders o where o.user_id = c.user_id and o.status = 'pending_payment')
     and not private.has_purchased(c.user_id)
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

-- A mesma de 20261024180000, com o 2º toque: confere o carrinho como o 1º lembrete e cancela se a pessoa já comprou.
create or replace function public.claim_email_batch(
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
      elsif r.kind in ('cart_reminder', 'cart_reminder_2') then
        select c.version into v_cart_version from public.carts c where c.user_id = r.user_id;
        select count(*) into v_cart_items from public.cart_items ci where ci.user_id = r.user_id;
        if v_cart_items = 0 then
          v_reason := 'cart_empty';
        elsif v_cart_version is distinct from (r.payload->>'cart_version')::integer then
          v_reason := 'cart_changed';
        elsif r.kind = 'cart_reminder_2' and private.has_purchased(r.user_id) then
          v_reason := 'already_purchased';
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
    elsif r.kind in ('delivery', 'gift') then
      -- entrega e presente: só saem se o pedido segue pago e nenhum direito foi revogado. O aviso de reembolso sai
      -- justamente com o pedido reembolsado, e o alerta dos admins não é de um pedido.
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

-- A retenção da fila guarda o lembrete da version atual do carrinho (a dedupe_key impede repetir); o 2º toque também.
create or replace function private.purge_email_outbox(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  c_keep constant interval := interval '90 days';
  v_rows integer;
begin
  delete from public.email_outbox x
   where x.status in ('sent', 'failed', 'skipped', 'canceled')
     and coalesce(x.sent_at, x.updated_at) < coalesce(p_now, now()) - c_keep
     and not (x.kind in ('cart_reminder', 'cart_reminder_2')
              and exists (select 1 from public.carts c
                           where c.user_id = x.user_id and c.version = (x.payload ->> 'cart_version')::integer));
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

-- ===== 2. Contatos de marketing no Plunk ==============================================================================
-- Uma linha por pessoa que já deu opt-in alguma vez. dirty_at: mudou algo desde o último envio ao Plunk (NULL = em dia).
-- synced_*: o que o Plunk tem (o e-mail, para tirar o antigo quando a pessoa troca; a inscrição, para não desfazer a pausa
-- que a pessoa pediu no Plunk). welcomed_at: quando o evento "inscricao" foi mandado (as boas-vindas saem uma vez).
create table private.marketing_contacts (
  user_id           uuid        primary key references auth.users (id) on delete cascade,
  dirty_at          timestamptz,
  locked_at         timestamptz,
  attempts          integer     not null default 0,
  next_try_at       timestamptz,
  last_error        text,
  synced_email      text,
  synced_subscribed boolean,
  synced_at         timestamptz,
  welcomed_at       timestamptz,
  constraint marketing_contacts_attempts_check check (attempts >= 0),
  constraint marketing_contacts_error_check check (last_error is null or char_length(last_error) <= 200)
);
create index marketing_contacts_dirty_idx on private.marketing_contacts (dirty_at) where dirty_at is not null;
revoke all on table private.marketing_contacts from public, anon, authenticated, service_role;

-- Marca a pessoa para o próximo envio ao Plunk. Só quem tem histórico de consentimento; na exclusão da conta, sai.
create function private.mark_marketing_contact(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null then
    return;
  end if;
  if coalesce(current_setting('keytotwo.account_erasure', true), 'off') = 'on' then
    delete from private.marketing_contacts m where m.user_id = p_user_id;
    return;
  end if;
  insert into private.marketing_contacts (user_id, dirty_at)
  select p_user_id, now()
   where exists (select 1 from public.marketing_consents c where c.user_id = p_user_id)
  on conflict (user_id) do update
    set dirty_at = excluded.dirty_at, attempts = 0, next_try_at = null, last_error = null;
end $$;

create function private.mark_marketing_contact_by_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.mark_marketing_contact(new.user_id);
  return null;
end $$;

create function private.mark_marketing_contact_by_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.mark_marketing_contact(u.id) from auth.users u where lower(u.email) = new.email;
  return null;
end $$;

create function private.mark_marketing_contact_by_auth() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.mark_marketing_contact(new.id);
  return null;
end $$;

create trigger marketing_consents_mark_contact after insert on public.marketing_consents
  for each row execute function private.mark_marketing_contact_by_user();
create trigger email_suppressions_mark_contact after insert on public.email_suppressions
  for each row execute function private.mark_marketing_contact_by_email();
create trigger orders_mark_contact after update of status on public.orders
  for each row when (old.status is distinct from new.status) execute function private.mark_marketing_contact_by_user();
create trigger entitlements_mark_contact after insert or update of status on public.entitlements
  for each row execute function private.mark_marketing_contact_by_user();
create trigger auth_users_mark_contact after update of email, email_confirmed_at on auth.users
  for each row when (old.email is distinct from new.email or old.email_confirmed_at is distinct from new.email_confirmed_at)
  execute function private.mark_marketing_contact_by_auth();

-- O email-dispatch pega um lote: o estado atual de cada pessoa marcada.
--   subscribed: pode receber marketing agora (private.marketing_allowed).
--   push_subscribed: mandar a inscrição ao Plunk. Sempre que o site diz "não"; "sim" só quando muda para sim (ou o e-mail
--     é novo), para não desfazer a pausa que a pessoa pediu no próprio Plunk.
--   welcome: mandar o evento "inscricao" (começa as boas-vindas), uma vez por pessoa.
--   previous_email: o e-mail antigo que o Plunk tem, quando a pessoa trocou (sai de lá).
--   data: campos do contato no Plunk: comprou, jogos (códigos dos jogos que tem), boas_vindas_no_lancamento (inscrição mais
--     de 7 dias antes da abertura das vendas: o 3º e-mail das boas-vindas sairia antes dela; vai na campanha do lançamento).
create function public.claim_marketing_contacts(p_limit integer default 20)
returns table (
  user_id         uuid,
  email           text,
  previous_email  text,
  subscribed      boolean,
  push_subscribed boolean,
  welcome         boolean,
  data            jsonb
)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  r       record;
  v_email text;
  v_ok    boolean;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'claim_marketing_contacts: p_limit deve estar entre 1 e 100' using errcode = 'KT001';
  end if;

  -- sem histórico de consentimento ou com a conta excluída: sai daqui sem ir ao Plunk (a exclusão já apagou o contato lá)
  delete from private.marketing_contacts m
   where not exists (select 1 from public.marketing_consents c where c.user_id = m.user_id)
      or not exists (select 1 from auth.users u where u.id = m.user_id and u.deleted_at is null);

  for r in
    select m.* from private.marketing_contacts m
     where m.dirty_at is not null
       and (m.next_try_at is null or m.next_try_at <= now())
       and (m.locked_at is null or m.locked_at < now() - interval '10 minutes')
     order by m.dirty_at, m.user_id
     limit p_limit
     for update skip locked
  loop
    update private.marketing_contacts m set locked_at = now() where m.user_id = r.user_id;
    select private.normalize_email(u.email) into v_email from auth.users u where u.id = r.user_id;
    v_ok := private.marketing_allowed(r.user_id);

    user_id := r.user_id;
    email := v_email;
    previous_email := case when r.synced_email is distinct from v_email then r.synced_email end;
    subscribed := v_ok;
    push_subscribed := not v_ok or r.synced_subscribed is distinct from true or r.synced_email is distinct from v_email;
    welcome := v_ok and r.welcomed_at is null;
    data := jsonb_build_object(
      'comprou', private.has_purchased(r.user_id),
      'jogos', coalesce((select jsonb_agg(g.code order by g.code) from public.games g
                          where g.id in (select o from private.owned_game_ids(r.user_id) o)), '[]'::jsonb),
      'boas_vindas_no_lancamento', coalesce((
        select p.marketing_opt_in_at < s.opens_at - interval '7 days'
          from public.profiles p cross join private.sales_opening s
         where p.user_id = r.user_id and p.marketing_opt_in), false));
    return next;
  end loop;
end $$;

-- O resultado do envio. Deu certo: guarda o que o Plunk tem e limpa a marca, se nada mudou depois do lote (senão, vai de
-- novo no próximo). Deu errado: tenta de novo com espera crescente (2, 4, 8... minutos, até 6 h).
-- p_subscribed: a inscrição mandada (NULL quando não foi mandada). Devolve 'applied' ou 'missing'.
create function public.mark_marketing_contact(
  p_user_id    uuid,
  p_email      text default null,
  p_subscribed boolean default null,
  p_welcomed   boolean default false,
  p_error      text default null
) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null or (p_error is null and nullif(btrim(coalesce(p_email, '')), '') is null) then
    raise exception 'mark_marketing_contact: usuário e e-mail (ou erro) são obrigatórios' using errcode = 'KT001';
  end if;
  if p_error is null then
    update private.marketing_contacts m
       set synced_email      = private.normalize_email(p_email),
           synced_subscribed = coalesce(p_subscribed, m.synced_subscribed),
           synced_at         = now(),
           welcomed_at       = case when p_welcomed then coalesce(m.welcomed_at, now()) else m.welcomed_at end,
           dirty_at          = case when m.dirty_at > m.locked_at then m.dirty_at end,
           locked_at         = null, attempts = 0, next_try_at = null, last_error = null
     where m.user_id = p_user_id;
  else
    update private.marketing_contacts m
       set attempts    = m.attempts + 1,
           next_try_at = now() + least(interval '6 hours', interval '1 minute' * power(2, least(m.attempts + 1, 10))),
           last_error  = left(p_error, 200),
           locked_at   = null
     where m.user_id = p_user_id;
  end if;
  return case when found then 'applied' else 'missing' end;
end $$;

-- Quem já deu opt-in alguma vez entra marcado: o primeiro envio leva todos ao Plunk.
insert into private.marketing_contacts (user_id, dirty_at)
select distinct c.user_id, now() from public.marketing_consents c
  join auth.users u on u.id = c.user_id and u.deleted_at is null
on conflict (user_id) do nothing;

-- ===== 3. Descadastro feito no Plunk ==================================================================================
alter table public.email_suppressions drop constraint email_suppressions_source_check;
alter table public.email_suppressions add constraint email_suppressions_source_check
  check (source in ('brevo_webhook', 'ses_events', 'plunk_webhook'));

alter table public.marketing_consents
  drop constraint marketing_consents_source_check,
  drop constraint marketing_consents_source_action_check;
alter table public.marketing_consents
  add constraint marketing_consents_source_check check (source in
    ('signup_prompt', 'account', 'free_games', 'unsubscribe_link', 'brevo_webhook', 'ses_events', 'plunk_webhook', 'support')),
  add constraint marketing_consents_source_action_check check (
    (source in ('signup_prompt', 'free_games') and action = 'granted')
    or (source in ('unsubscribe_link', 'brevo_webhook', 'ses_events', 'plunk_webhook') and action = 'revoked')
    or source in ('account', 'support'));

-- A mesma de 20261031120000, aceitando a origem plunk_webhook.
create or replace function public.record_email_event(
  p_email               text,
  p_event               text,
  p_provider_message_id text default null,
  p_occurred_at         timestamptz default now(),
  p_source              text default 'brevo_webhook'
) returns table (outcome text, user_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_email    text := private.normalize_email(p_email);
  v_reason   text;
  v_user     uuid;
  v_when     timestamptz;
  v_rows     integer;
  v_opted    boolean;
  v_opted_at timestamptz;
  v_revoked  boolean := false;
begin
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or p_event is null or p_event not in ('hard_bounce', 'complaint', 'unsubscribe')
     or p_source is null or p_source not in ('brevo_webhook', 'ses_events', 'plunk_webhook') then
    raise exception 'record_email_event: e-mail, evento ou origem inválidos' using errcode = 'KT001';
  end if;
  v_reason := case p_event when 'unsubscribe' then 'unsubscribe_all' else p_event end;
  -- o horário que vale é o do EVENTO (não o da chegada do aviso); evento "do futuro" vira agora
  v_when := least(coalesce(p_occurred_at, now()), now());

  -- a conta do e-mail, se existir (a supressão vale mesmo sem conta)
  select u.id into v_user from auth.users u
   where lower(u.email) = v_email and u.deleted_at is null
   order by u.created_at limit 1;

  -- a supressão é por e-mail e motivo e é idempotente; o horário do evento entra nas duas datas
  insert into public.email_suppressions (email, reason, source, provider_message_id, occurred_at, created_at)
  values (v_email, v_reason, p_source, left(nullif(btrim(coalesce(p_provider_message_id, '')), ''), 200), v_when, v_when)
  on conflict (email, reason) do nothing;
  get diagnostics v_rows = row_count;

  -- queixa e descadastro também revogam o consentimento da conta, se ele está vigente e o evento é posterior ao opt-in
  -- (assim um segundo descadastro, depois de a pessoa dar opt-in de novo, ainda vale; e um evento velho reenviado não revoga o opt-in novo)
  if v_user is not null and p_event in ('complaint', 'unsubscribe') then
    select p.marketing_opt_in, p.marketing_opt_in_at into v_opted, v_opted_at from public.profiles p where p.user_id = v_user for update;
    if coalesce(v_opted, false) and v_when >= v_opted_at then
      insert into public.marketing_consents (user_id, email, action, source) values (v_user, v_email, 'revoked', p_source);
      v_revoked := true;
    end if;
    if v_rows > 0 or v_revoked then
      perform private.cancel_queued_marketing(v_user);   -- a trigger já deixou profiles em dia
    end if;
  end if;

  return query select (case when v_rows > 0 or v_revoked then 'applied' else 'noop' end)::text, v_user;
end $$;

-- O Plunk avisa toda saída da lista, inclusive a que o próprio site mandou para lá (o eco de um descadastro feito no
-- site). Só vale quando o site ainda tem a pessoa inscrita; aí é um descadastro de verdade, pelo caminho de sempre.
create function public.record_plunk_unsubscribe(p_email text, p_occurred_at timestamptz default now())
returns table (outcome text, user_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_email text := private.normalize_email(p_email);
begin
  if v_email is null or not exists (
       select 1 from auth.users u join public.profiles p on p.user_id = u.id
        where lower(u.email) = v_email and u.deleted_at is null and p.marketing_opt_in) then
    return query select 'noop'::text, null::uuid;
    return;
  end if;
  return query select * from public.record_email_event(v_email, 'unsubscribe', null, p_occurred_at, 'plunk_webhook');
end $$;

-- ===== EXECUTE: as RPCs só para service_role; as internas para ninguém ================================================
do $$
declare sig text;
begin
  foreach sig in array array['private.has_purchased(uuid)', 'private.cart_reminder_items(uuid)',
                             'private.mark_marketing_contact(uuid)', 'private.mark_marketing_contact_by_user()',
                             'private.mark_marketing_contact_by_email()', 'private.mark_marketing_contact_by_auth()']
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', sig);
  end loop;
  foreach sig in array array['public.claim_marketing_contacts(integer)',
                             'public.mark_marketing_contact(uuid, text, boolean, boolean, text)',
                             'public.record_plunk_unsubscribe(text, timestamptz)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', sig);
    execute format('grant execute on function %s to service_role', sig);
  end loop;
end $$;
