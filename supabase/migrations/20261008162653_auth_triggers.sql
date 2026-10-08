-- Triggers em auth.users (docs/data-contract.md v0.3.2, D-18, I-17):
--  (a) zera a senha na PRIMEIRA confirmação do e-mail (a senha definida antes da confirmação não vale);
--  (b) cria o perfil; (c) registra account_confirmed (uma vez por usuário).
-- Única migração que toca fora de public/private; não altera dados do Auth além da senha na primeira confirmação.

-- AFTER INSERT: cria o perfil; se o usuário já nasce confirmado (Google, criação administrativa), registra account_confirmed.
create function private.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  if new.email_confirmed_at is not null then
    insert into public.funnel_events (user_id, type) values (new.id, 'account_confirmed')
    on conflict (user_id) where type = 'account_confirmed' and user_id is not null do nothing;
  end if;
  return null;
end $$;

-- BEFORE UPDATE da PRIMEIRA confirmação (email_confirmed_at: NULL -> valor):
--  (a) zera a senha, a menos que o mesmo UPDATE já troque a senha (a nova veio com prova de posse do e-mail);
--  (b) garante o perfil; (c) registra account_confirmed (uma vez por usuário).
create function private.handle_auth_user_confirmed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.encrypted_password is not distinct from old.encrypted_password then
    new.encrypted_password := '';
  end if;
  insert into public.profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  insert into public.funnel_events (user_id, type) values (new.id, 'account_confirmed')
  on conflict (user_id) where type = 'account_confirmed' and user_id is not null do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_auth_user();
create trigger on_auth_user_confirmed before update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function private.handle_auth_user_confirmed();

-- Perfil dos usuários que já existiam antes das triggers (idempotente).
insert into public.profiles (user_id)
select u.id from auth.users u
on conflict (user_id) do nothing;
