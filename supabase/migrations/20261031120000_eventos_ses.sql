-- E-mail pelo Amazon SES (2026-10-31): na troca da Brevo pelo Plunk (que envia pelo SES), os avisos de bounce e de
-- reclamação chegam direto da AWS, pela função ses-events. A supressão e a revogação do consentimento passam a guardar
-- de onde veio o aviso: brevo_webhook (enquanto a Brevo enviar) ou ses_events. Nenhuma tabela nova.

alter table public.email_suppressions drop constraint email_suppressions_source_check;
alter table public.email_suppressions add constraint email_suppressions_source_check
  check (source in ('brevo_webhook', 'ses_events'));

alter table public.marketing_consents
  drop constraint marketing_consents_source_check,
  drop constraint marketing_consents_source_action_check;
alter table public.marketing_consents
  add constraint marketing_consents_source_check check (source in
    ('signup_prompt', 'account', 'free_games', 'unsubscribe_link', 'brevo_webhook', 'ses_events', 'support')),
  add constraint marketing_consents_source_action_check check (
    (source in ('signup_prompt', 'free_games') and action = 'granted')
    or (source in ('unsubscribe_link', 'brevo_webhook', 'ses_events') and action = 'revoked')
    or source in ('account', 'support'));

-- A mesma função, com a origem no fim (padrão brevo_webhook: o webhook da Brevo chama sem ela).
drop function public.record_email_event(text, text, text, timestamptz);
create function public.record_email_event(
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
     or p_source is null or p_source not in ('brevo_webhook', 'ses_events') then
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

revoke all on function public.record_email_event(text, text, text, timestamptz, text) from public, anon, authenticated, service_role;
grant execute on function public.record_email_event(text, text, text, timestamptz, text) to service_role;
