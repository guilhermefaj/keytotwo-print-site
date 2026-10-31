#!/bin/sh
# Limpeza diária do Plunk (2026-10-31, política de privacidade): o Plunk guarda para sempre o registro de cada e-mail e
# o contato de cada destinatário (só apaga o corpo da mensagem depois de 90 dias). Aqui, como promete a política:
# - e-mails com mais de 90 dias saem, com os eventos deles (aberturas, cliques, entregas), em cascata no banco;
#   os que ainda vão sair (PENDING, SENDING) ficam;
# - contatos sem inscrição no marketing e sem nenhum e-mail recente saem (com o que for deles, em cascata), desde
#   que tenham mais de 90 dias. Quem está inscrito fica até sair da lista.
# A exclusão da conta no site já apaga o contato na hora (forgetEmailContact); isto cobre o que falhar lá.
# Fica em /opt/keytotwo-site/plunk/limpar.sh, ao lado do compose. Cron do deploy, depois do backup das 03:30:
#   50 6 * * * sh /opt/keytotwo-site/plunk/limpar.sh >> /opt/keytotwo-site/plunk/limpar.log 2>&1
set -eu

dir=/opt/keytotwo-site/plunk
result=$(docker compose --project-directory "$dir" exec -T postgres psql -U plunk -d plunk -At -v ON_ERROR_STOP=1 <<'SQL'
begin;
with apagados as (
  delete from emails
   where "createdAt" < now() - interval '90 days' and status not in ('PENDING', 'SENDING')
  returning 1
)
select 'e-mails: ' || count(*) from apagados;
with apagados as (
  delete from contacts c
   where not c.subscribed and c."createdAt" < now() - interval '90 days'
     and not exists (select 1 from emails e where e."contactId" = c.id)
  returning 1
)
select 'contatos: ' || count(*) from apagados;
commit;
SQL
) || { echo "$(date -Is) limpeza do Plunk falhou" >&2; exit 1; }
echo "$(date -Is) limpeza do Plunk: $(echo "$result" | grep -E '^(e-mails|contatos):' | tr '\n' ' ')"
