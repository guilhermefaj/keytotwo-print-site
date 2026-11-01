#!/bin/sh
# Backup do banco (2026-10-24, decisões do responsável): uma cópia por noite do Supabase hospedado, que no plano grátis
# não guarda backup. Entra com o papel backup_ro (só leitura), gera roles.sql, schema.sql e data.sql como o
# `supabase db dump`, fecha com age (a chave secreta fica só com o responsável) e envia para o bucket PRIVADO da B2 com
# uma chave que só escreve. Quem apaga as antigas é a regra de validade do bucket (diario/ 30 dias, mensal/ 12 meses).
# Desde 2026-10-25 (revisão de segurança) a cópia leva só os dados da loja (public e private) e, do Auth, as contas e os
# logins (auth.users e auth.identities); sessões, tokens e o app autenticador dos admins ficam de fora, como o backup_ro.
# A senha vai em BACKUP_DB_PASSWORD (PGPASSWORD), fora da URL: assim não aparece na lista de processos.
# No fim, registra a cópia no banco: o alerta "backup atrasado" do admin confere esse registro.
# Desde 2026-10-31 copia também o banco do Plunk (e-mail, num contêiner desta VPS), numa etapa à parte: falhar uma
# não impede a outra, e as duas falhas saem no log. A do Plunk não entra no alerta do admin.
# Fica em /opt/keytotwo-site/backup/backup.sh (o deploy da produção copia a versão do repositório), com o backup.env
# (600, só do deploy) ao lado. Cron do deploy, 03:30 em Brasília:
#   30 6 * * * sh /opt/keytotwo-site/backup/backup.sh >> /opt/keytotwo-site/backup/backup.log 2>&1
# Recuperar: docs/deploy.md, "Backup do banco".
set -eu

main() {
  base=/opt/keytotwo-site/backup
  exec 9>"$base/.backup.lock"
  flock -n 9 || { echo "$(date -Is) a cópia anterior ainda está rodando" >&2; return 1; }
  # Tudo roda num contêiner do Postgres 17 (o pg_dump da mesma versão do banco); os segredos entram pelo --env-file.
  docker run --rm -i --env-file "$base/backup.env" postgres:17-alpine sh -s <<'CONTEINER'
set -eu
if [ -n "${BACKUP_DB_PASSWORD:-}" ]; then export PGPASSWORD="$BACKUP_DB_PASSWORD"; fi
apk add --quiet --no-cache age curl >/dev/null
cd "$(mktemp -d)"
stamp=$(date -u +%Y-%m-%dT%H%MZ)

# Os mesmos filtros do `supabase db dump` (CLI 2.118.0: pkg/migration/dump.go e scripts/dump_*.sh), sem o
# `--role postgres`: o papel do backup não vira postgres. As listas e os sed são os da CLI.
internal='information_schema|pg_*|_analytics|_realtime|_supavisor|auth|etl|extensions|pgbouncer|realtime|storage|supabase_functions|supabase_migrations|cron|dbdev|graphql|graphql_public|net|pgmq|pgsodium|pgsodium_masks|pgtle|repack|tiger|tiger_data|timescaledb_*|_timescaledb_*|topology|vault'
reserved='anon|authenticated|authenticator|cli_login_.*|dashboard_user|pgbouncer|postgres|service_role|supabase_.*|pgsodium_keyholder|pgsodium_keyiduser|pgsodium_keymaker|pgtle_admin'
configs='pgaudit.*|pgrst.*|session_replication_role|statement_timeout|track_io_timing'

pg_dumpall --dbname="$BACKUP_DB_URL" --roles-only --quote-all-identifier --no-role-passwords --no-comments \
| sed -E 's/^\\(un)?restrict .*$/-- &/' \
| sed -E "s/^CREATE ROLE \"($reserved)\"/-- &/" \
| sed -E "s/^ALTER ROLE \"($reserved)\"/-- &/" \
| sed -E "s/ (NOSUPERUSER|NOREPLICATION)//g" \
| sed -E "s/^-- (.* SET \"($configs)\" .*)/\1/" \
| sed -E "s/GRANT \".*\" TO \"($reserved)\"/-- &/" \
| sed -E "s/^GRANT .* ON PARAMETER .* TO \"($reserved)\"/-- &/" \
| sed -E '/^--/d' \
| uniq > roles.sql

# O pg_dump grava as permissões como diferença do padrão do Postgres, e um projeto novo da Supabase dá tudo a anon,
# authenticated e service_role no que nasce em public: sem desligar isso antes, as RPCs voltariam abertas para
# qualquer um (visto no ensaio de 2026-10-24). O padrão de origem volta no fim do próprio dump.
{
  echo 'ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "anon", "authenticated", "service_role";'
  echo 'ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "anon", "authenticated", "service_role";'
  echo 'ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "anon", "authenticated", "service_role";'
  # A public.test do hospedado (do responsável, fora da loja) não entra: o backup_ro não tem permissão nela.
  pg_dump "$BACKUP_DB_URL" --schema-only --quote-all-identifier --exclude-schema="$internal" \
    --exclude-table='"public"."test"' --exclude-table='"public"."test_id_seq"' \
| sed -E 's/^\\(un)?restrict .*$/-- &/' \
| sed -E 's/^CREATE SCHEMA "/CREATE SCHEMA IF NOT EXISTS "/' \
| sed -E 's/^CREATE TABLE "/CREATE TABLE IF NOT EXISTS "/' \
| sed -E 's/^CREATE SEQUENCE "/CREATE SEQUENCE IF NOT EXISTS "/' \
| sed -E 's/^CREATE VIEW "/CREATE OR REPLACE VIEW "/' \
| sed -E 's/^CREATE FUNCTION "/CREATE OR REPLACE FUNCTION "/' \
| sed -E 's/^CREATE TRIGGER "/CREATE OR REPLACE TRIGGER "/' \
| sed -E 's/^CREATE PUBLICATION "supabase_realtime/-- &/' \
| sed -E 's/^CREATE EVENT TRIGGER /-- &/' \
| sed -E 's/^         WHEN TAG IN /-- &/' \
| sed -E 's/^   EXECUTE FUNCTION /-- &/' \
| sed -E 's/^ALTER EVENT TRIGGER /-- &/' \
| sed -E 's/^ALTER PUBLICATION "supabase_realtime_/-- &/' \
| sed -E 's/^ALTER FOREIGN DATA WRAPPER (.+) OWNER TO /-- &/' \
| sed -E 's/^ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin"/-- &/' \
| sed -E 's/^GRANT ALL ON FOREIGN DATA WRAPPER (.+) TO "postgres" WITH GRANT OPTION/-- &/' \
| sed -E "s/^GRANT (.+) ON (.+) \"($internal)\"/-- &/" \
| sed -E "s/^REVOKE (.+) ON (.+) \"($internal)\"/-- &/" \
| sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pg_tle").+/\1;/' \
| sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pgsodium").+/\1;/' \
| sed -E 's/^(CREATE EXTENSION IF NOT EXISTS "pgmq").+/\1;/' \
| sed -E 's/^COMMENT ON EXTENSION (.+)/-- &/' \
| sed -E 's/^CREATE POLICY "cron_job_/-- &/' \
| sed -E 's/^ALTER TABLE "cron"/-- &/' \
| sed -E 's/^SET transaction_timeout = 0;/-- &/' \
| sed -E '/^--/d'
  # Os gatilhos da loja nas tabelas do Auth (o perfil de quem se cadastra, a confirmação do e-mail) ficam fora do dump,
  # que não leva o schema auth: entram no fim, depois das funções que eles chamam (visto no ensaio de 2026-10-24).
  psql "$BACKUP_DB_URL" --no-psqlrc -At -v ON_ERROR_STOP=1 -c "select pg_get_triggerdef(t.oid) || ';' from pg_trigger t
    join pg_class c on c.oid = t.tgrelid join pg_namespace cn on cn.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
    where cn.nspname = 'auth' and not t.tgisinternal and pn.nspname in ('public', 'private') order by t.tgname"
} > schema.sql

# Do Auth, só auth.users e auth.identities, pelas funções da cópia (o backup_ro não lê o schema auth; migração
# 20261025120000) ou, antes dela, direto da tabela. As colunas geradas ficam de fora, como no pg_dump.
auth_copy() {
  cols=$(psql "$BACKUP_DB_URL" --no-psqlrc -At -v ON_ERROR_STOP=1 -c "select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth' and c.relname = '$1' and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''")
  [ -n "$cols" ] || { echo "auth.$1 sem colunas" >&2; exit 1; }
  source=$(psql "$BACKUP_DB_URL" --no-psqlrc -At -v ON_ERROR_STOP=1 -c "select case when exists (select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'backup_auth_$1')
    then 'private.backup_auth_$1()' else 'auth.$1' end")
  echo "COPY \"auth\".\"$1\" ($cols) FROM stdin;"
  psql "$BACKUP_DB_URL" --no-psqlrc -v ON_ERROR_STOP=1 -c "copy (select $cols from $source) to stdout"
  printf '%s\n' '\.'
}

{
  echo 'SET session_replication_role = replica;'
  pg_dump "$BACKUP_DB_URL" --data-only --quote-all-identifier --schema=public --schema=private \
    --exclude-table='"public"."test"' --exclude-table='"public"."test_id_seq"' \
  | sed -E 's/^\\(un)?restrict .*$/-- &/'
  auth_copy users
  auth_copy identities
  echo 'RESET ALL;'
} > data.sql

# Uma cópia sem as tabelas da loja não vale: confere antes de enviar (o sed no fim de cada pipe esconde a falha do
# pg_dump; a conferência não).
grep -q '^CREATE ROLE "backup_ro"' roles.sql
grep -q '^CREATE TABLE IF NOT EXISTS "public"."orders"' schema.sql
grep -q '^ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"' schema.sql
grep -q '^CREATE TRIGGER on_auth_user_created ' schema.sql
grep -q '^COPY "public"."orders"' data.sql
grep -q '^COPY "auth"."users"' data.sql
grep -q '^COPY "auth"."identities"' data.sql
tar -czf - roles.sql schema.sql data.sql | age -r "$BACKUP_AGE_RECIPIENT" > copia.tar.gz.age
bytes=$(wc -c < copia.tar.gz.age)

# PUT na API S3 da B2, assinado (SigV4). A chave vai pela configuração do curl na entrada, fora da lista de processos.
put() {
  printf 'user = "%s:%s"\n' "$B2_BACKUP_KEY_ID" "$B2_BACKUP_APPLICATION_KEY" | curl -fsS --retry 3 --config - \
    --aws-sigv4 "aws:amz:$B2_BACKUP_REGION:s3" -H "x-amz-content-sha256: $(sha256sum copia.tar.gz.age | cut -d' ' -f1)" \
    -T copia.tar.gz.age "https://$B2_BACKUP_ENDPOINT/$B2_BACKUP_BUCKET/$1"
}
put "diario/$stamp.tar.gz.age"
if [ "$(date -u +%d)" = 01 ]; then put "mensal/$stamp.tar.gz.age"; fi
echo "select private.record_backup(:'chave', :bytes);" \
| psql "$BACKUP_DB_URL" --quiet --no-psqlrc -v ON_ERROR_STOP=1 -v chave="diario/$stamp.tar.gz.age" -v bytes="$bytes" >/dev/null
echo "diario/$stamp.tar.gz.age ($bytes bytes)"
CONTEINER
}

# O banco do Plunk (Postgres 16 em /opt/keytotwo-site/plunk) sai no formato do pg_restore, fechado com a mesma chave
# age e enviado ao mesmo bucket, nas mesmas pastas (a validade da B2 é por prefixo), com o nome começando por plunk-.
# O arquivo aberto fica no disco só até o envio, com permissão só do deploy. Aqui o set -e não vale (a função roda
# dentro do if, como a main), por isso cada passo confere o próprio resultado.
plunk() {
  base=/opt/keytotwo-site/backup
  dir=/opt/keytotwo-site/plunk
  [ -f "$dir/compose.yaml" ] || return 0
  exec 9>"$base/.backup.lock"
  flock -n 9 || { echo "$(date -Is) a cópia anterior ainda está rodando" >&2; return 1; }
  dump=$(umask 077 && mktemp "$base/plunk.XXXXXX") || return 1
  stamp=$(date -u +%Y-%m-%dT%H%MZ)
  ok=0
  if docker compose --project-directory "$dir" exec -T postgres pg_dump -U plunk -d plunk -Fc --no-owner --no-privileges > "$dump" \
    && docker compose --project-directory "$dir" exec -T postgres pg_restore -l < "$dump" | grep -qE 'TABLE DATA public emails( |$)' \
    && docker run --rm -i --env-file "$base/backup.env" -e STAMP="$stamp" postgres:17-alpine sh -c '
set -eu
apk add --quiet --no-cache age curl >/dev/null
cd "$(mktemp -d)"
age -r "$BACKUP_AGE_RECIPIENT" > copia.dump.age
put() {
  printf "user = \"%s:%s\"\n" "$B2_BACKUP_KEY_ID" "$B2_BACKUP_APPLICATION_KEY" | curl -fsS --retry 3 --config - \
    --aws-sigv4 "aws:amz:$B2_BACKUP_REGION:s3" -H "x-amz-content-sha256: $(sha256sum copia.dump.age | cut -d" " -f1)" \
    -T copia.dump.age "https://$B2_BACKUP_ENDPOINT/$B2_BACKUP_BUCKET/$1"
}
put "diario/plunk-$STAMP.dump.age"
if [ "$(date -u +%d)" = 01 ]; then put "mensal/plunk-$STAMP.dump.age"; fi
# Registra no banco da loja, como a cópia do Supabase: sem cópia nova do Plunk em 26 horas, o admin abre "Backup do
# Plunk atrasado" (2026-11-01). O nome começando por plunk- separa as duas. \047 é a aspa simples (estamos dentro de uma).
bytes=$(wc -c < copia.dump.age)
if [ -n "${BACKUP_DB_PASSWORD:-}" ]; then export PGPASSWORD="$BACKUP_DB_PASSWORD"; fi
printf "select private.record_backup(\047%s\047, %s);\n" "diario/plunk-$STAMP.dump.age" "$bytes" \
| psql "$BACKUP_DB_URL" --quiet --no-psqlrc -v ON_ERROR_STOP=1 >/dev/null
echo "diario/plunk-$STAMP.dump.age ($bytes bytes)"
' < "$dump"; then ok=1; fi
  rm -f "$dump"
  [ "$ok" = 1 ]
}

status=0
if result=$(main); then echo "$(date -Is) backup: $result"; else echo "$(date -Is) backup falhou" >&2; status=1; fi
if result=$(plunk); then
  [ -z "$result" ] || echo "$(date -Is) backup do Plunk: $result"
else
  echo "$(date -Is) backup do Plunk falhou" >&2; status=1
fi
exit "$status"
