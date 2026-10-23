#!/bin/sh
# Blog (2026-10-23): publicar no admin muda a versão do blog no banco. Este vigia roda no cron do usuário deploy a cada
# minuto e, dentro do minuto, confere a cada 10 s. Quando a versão no ar de um site (produção, depois teste) difere da
# do banco, reconstrói esse site no MESMO commit que já está no ar: só o conteúdo do blog muda. O atualizar.sh espera a
# vez (flock), sem brigar com um deploy.
# A versão vem da API de dados do Supabase (get_blog_version, liberada para a chave publicável): conferir a cada 10 s
# pelas funções gastaria as invocações do plano.
# Fica em /opt/keytotwo-site/blog/vigiar.sh (o deploy da produção copia a versão do repositório) e só escreve no log
# quando reconstrói ou falha. Uma versão que já falhou num site não é tentada de novo até o banco mudar.
# Cron: * * * * * sh /opt/keytotwo-site/blog/vigiar.sh >> /opt/keytotwo-site/blog/vigia.log 2>&1
set -eu

base=/opt/keytotwo-site

# Uma conferência: a versão do banco contra a de cada site; reconstrói o que estiver atrás. Sem resposta da API, 1.
conferir() {
  want=$(curl -fsS --max-time 8 -X POST -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY" -H 'Content-Type: application/json' \
    -d '{}' "$VITE_SUPABASE_URL/rest/v1/rpc/get_blog_version" 2>/dev/null \
    | sed -n 's/^"\([0-9a-f]\{32\}\)"$/\1/p' || true)
  [ -n "$want" ] || return 1

  for site in producao teste; do
    live=$(docker exec "keytotwo-$site-site-1" cat /srv/keytotwo/blog/versao.json 2>/dev/null \
      | sed -n 's/.*"version":"\([0-9a-f]\{32\}\)".*/\1/p' || true)
    [ "$live" = "$want" ] && continue
    [ "$(cat "$base/blog/$site.falhou" 2>/dev/null || true)" = "$want" ] && continue
    commit=$(cat "$base/$site/commit" 2>/dev/null || true)
    if [ -z "$commit" ]; then
      echo "$want" > "$base/blog/$site.falhou"
      echo "$(date -Is) $site: sem commit registrado; rode o atualizar.sh dele uma vez" >&2
      continue
    fi
    echo "$(date -Is) $site: blog ${live:-sem versão} → $want; reconstruindo o commit $commit"
    if sh "$base/repo/deploy/$site/atualizar.sh" "$commit"; then
      rm -f "$base/blog/$site.falhou"
      echo "$(date -Is) $site: blog no ar"
    else
      echo "$want" > "$base/blog/$site.falhou"
      echo "$(date -Is) $site: a reconstrução falhou; o site continua com o blog anterior" >&2
    fi
  done
}

main() {
  mkdir -p "$base/blog"
  exec 8>"$base/blog/.vigia.lock"
  flock -n 8 || return 0 # a rodada anterior ainda está conferindo ou reconstruindo

  set -a
  . "$base/producao/build.env"
  set +a
  # Uns 50 s de conferências; depois de uma reconstrução longa, o próximo minuto do cron continua.
  fim=$(( $(date +%s) + 50 ))
  falhas=0
  while :; do
    conferir || falhas=$((falhas + 1))
    [ "$(date +%s)" -lt "$fim" ] || break
    sleep 10
  done
  if [ "$falhas" -gt 0 ]; then echo "$(date -Is) a API não respondeu a versão do blog ($falhas vez(es) neste minuto)" >&2; fi
  return 0
}

main "$@"
exit
