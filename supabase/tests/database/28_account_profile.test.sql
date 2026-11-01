-- 28_account_profile: a migração 20261101120000 (perfil da conta em Minha conta): o nome do Google como sugestão até a
-- pessoa salvar, set_account_profile (regras do nome, da data de nascimento e do WhatsApp), a cópia dos dados, a
-- exclusão e a ficha do admin. Roda com `supabase test db` (pgTAP). Dados de teste só existem dentro da transação.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ===== helpers (só existem nesta transação; pg_temp): supabase/tests/database/helpers ===========
\ir helpers/base.psql

create temp table ids (name text primary key, id uuid);
create function pg_temp.uid(p_name text) returns uuid language sql as $$ select id from pg_temp.ids where name = p_name $$;

create function pg_temp.mk_user(p_name text, p_meta jsonb, p_admin boolean default false, p_confirmed boolean default true) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_name || '@pgtap.test', null,
          case when p_confirmed then now() end, '', '', '', '', now(), now(),
          jsonb_build_object('provider', 'google', 'providers', jsonb_build_array('google'), 'admin', p_admin), p_meta);
  insert into pg_temp.ids values (p_name, v_id);
  return v_id;
end $$;

-- a maior data de nascimento aceita: 18 anos antes de hoje, no dia de Brasília
create function pg_temp.adult_limit() returns date language sql as $$
  select ((now() at time zone 'America/Sao_Paulo')::date - interval '18 years')::date
$$;

select pg_temp.mk_user('google', '{"full_name": "  Ana Souza  ", "avatar_url": "https://example.test/a.png"}');
select pg_temp.mk_user('nome', '{"name": "Bia Lima"}');
select pg_temp.mk_user('email', '{}');
select pg_temp.mk_user('pendente', '{"full_name": "Sem Confirmar"}', false, false);
select pg_temp.mk_user('adm', '{}', true);

-- ===== o nome do Google é a sugestão até a pessoa salvar ===========================================================
select pg_temp.assert('get_account: o nome do Google (full_name, sem espaços nas pontas), sem nada salvo',
  (select public.get_account(pg_temp.uid('google')) -> 'profile'
          = '{"name": "Ana Souza", "birth_date": null, "whatsapp": null, "saved": false}'::jsonb));
select pg_temp.assert('get_account: sem full_name, vale o name do Google',
  (select public.get_account(pg_temp.uid('nome')) #>> '{profile,name}' = 'Bia Lima'));
select pg_temp.assert('get_account: conta por e-mail começa sem nome',
  (select public.get_account(pg_temp.uid('email')) -> 'profile' = '{"name": null, "birth_date": null, "whatsapp": null, "saved": false}'::jsonb));

-- ===== set_account_profile ====================================================================================
select pg_temp.assert('salva o nome com os espaços arrumados, a data e o WhatsApp, e devolve o perfil',
  (select public.set_account_profile(pg_temp.uid('google'), '  Ana   Maria  Souza ', date '1990-05-10', '+5511987654321')
          = '{"name": "Ana Maria Souza", "birth_date": "1990-05-10", "whatsapp": "+5511987654321", "saved": true}'::jsonb));
select pg_temp.assert('get_account devolve o perfil salvo',
  (select public.get_account(pg_temp.uid('google')) #>> '{profile,name}' = 'Ana Maria Souza'));
select pg_temp.assert('a linha guarda quando a pessoa salvou',
  (select profile_updated_at is not null from public.profiles where user_id = pg_temp.uid('google')));
select pg_temp.assert('nome vazio depois de salvo fica vazio: o do Google não volta',
  (select public.set_account_profile(pg_temp.uid('google'), '   ', null, null)
          = '{"name": null, "birth_date": null, "whatsapp": null, "saved": true}'::jsonb));
select pg_temp.assert('quem faz 18 anos hoje pode salvar a data',
  (select public.set_account_profile(pg_temp.uid('email'), null, pg_temp.adult_limit(), null) ->> 'birth_date' = pg_temp.adult_limit()::text));
select pg_temp.expect('menor de 18 anos: KT001',
  format($q$select public.set_account_profile(%L, null, %L, null)$q$, pg_temp.uid('email'), pg_temp.adult_limit() + 1), 'KT001');
select pg_temp.expect('data antes de 1900: KT001',
  format($q$select public.set_account_profile(%L, null, date '1899-12-31', null)$q$, pg_temp.uid('email')), 'KT001');
select pg_temp.expect('nome com mais de 80 letras: KT001',
  format($q$select public.set_account_profile(%L, %L, null, null)$q$, pg_temp.uid('email'), repeat('a', 81)), 'KT001');
select pg_temp.expect('nome com caractere de controle: KT001',
  format($q$select public.set_account_profile(%L, %L, null, null)$q$, pg_temp.uid('email'), 'Ana' || chr(7)), 'KT001');
select pg_temp.expect('WhatsApp sem o + do E.164: KT001',
  format($q$select public.set_account_profile(%L, null, null, '11987654321')$q$, pg_temp.uid('email')), 'KT001');
select pg_temp.expect('WhatsApp curto demais: KT001',
  format($q$select public.set_account_profile(%L, null, null, '+5511')$q$, pg_temp.uid('email')), 'KT001');
select pg_temp.expect('e-mail não confirmado: KT009',
  format($q$select public.set_account_profile(%L, 'Nome', null, null)$q$, pg_temp.uid('pendente')), 'KT009');
select pg_temp.expect('a constraint segura o WhatsApp fora do formato mesmo sem a RPC',
  format($q$update public.profiles set whatsapp = '(11) 98765-4321' where user_id = %L$q$, pg_temp.uid('email')), '23514');

-- ===== cópia dos dados, ficha do admin e exclusão ==============================================================
select public.set_account_profile(pg_temp.uid('google'), 'Ana Souza', date '1990-05-10', '+5511987654321');
select pg_temp.assert('export_account_data: o perfil salvo, com a data em que foi salvo',
  (select d -> 'profile' ->> 'name' = 'Ana Souza' and d -> 'profile' ->> 'birth_date' = '1990-05-10'
          and d -> 'profile' ->> 'whatsapp' = '+5511987654321' and d -> 'profile' ->> 'updated_at' is not null
          and d -> 'account' ->> 'name' = '  Ana Souza  '
     from public.export_account_data(pg_temp.uid('google')) d));
select pg_temp.assert('admin_get_user: o nome do perfil, a data de nascimento e o WhatsApp',
  (select outcome = 'ok' and result -> 'account' ->> 'name' = 'Ana Souza' and result -> 'account' ->> 'birth_date' = '1990-05-10'
          and result -> 'account' ->> 'whatsapp' = '+5511987654321'
     from public.admin_get_user(pg_temp.uid('adm'), pg_temp.uid('google'))));
select pg_temp.assert('admin_get_user: sem nada salvo, o nome do Google',
  (select result -> 'account' ->> 'name' = 'Bia Lima' and result -> 'account' -> 'whatsapp' = 'null'::jsonb
     from public.admin_get_user(pg_temp.uid('adm'), pg_temp.uid('nome'))));
select pg_temp.assert('delete_account_data apaga o perfil na hora',
  (select outcome = 'deleted' from public.delete_account_data(pg_temp.uid('google'))));
select pg_temp.assert('depois da exclusão: sem nome, data, WhatsApp nem a data do perfil salvo',
  (select full_name is null and birth_date is null and whatsapp is null and profile_updated_at is null
     from public.profiles where user_id = pg_temp.uid('google')));

-- ===== permissões ===========================================================================================
select pg_temp.assert('set_account_profile: EXECUTE só para service_role',
  (select p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}' and p.prosecdef
     from pg_proc p where p.oid = 'public.set_account_profile(uuid, text, date, text)'::regprocedure));
select pg_temp.expect_as('authenticated executa set_account_profile', 'authenticated',
  format($q$select public.set_account_profile(%L, 'X', null, null)$q$, pg_temp.uid('email')), '42501');

select * from finish();
rollback;
