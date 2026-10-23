#!/bin/sh
# Blog (2026-10-23): publicar no admin muda a versão do blog no banco. Este vigia roda no cron do usuário deploy a cada
# minuto e, quando a versão no ar de um site (produção, depois teste) difere da do banco, reconstrói esse site no MESMO
# commit que já está no ar: só o conteúdo do blog muda. O atualizar.sh espera a vez (flock), sem brigar com um deploy.
# A versão vem da API de dados do Supabase (get_blog_version, liberada para a chave publicável), mais leve que chamar a
# função a cada minuto. Uma conferência por minuto basta (responsável, 2026-10-23: sem pressa à custa de processamento).
# Fica em /opt/keytotwo-site/blog/vigiar.sh (o deploy da produção copia a versão do repositório) e só escreve no log
# quando reconstrói ou falha. Uma versão que já falhou num site não é tentada de novo até o banco mudar.
# Cron: * * * * * sh /opt/keytotwo-site/blog/vigiar.sh >> /opt/keytotwo-site/blog/vigia.log 2>&1
set -eu

main() {
  base=/opt/keytotwo-site
  mkdir -p "$base/blog"
  exec 8>"$base/blog/.vigia.lock"
  flock -n 8 || return 0 # a rodada anterior ainda está reconstruindo

  set -a
  . "$base/producao/build.env"
  set +a
  want=$(curl -fsS --max-time 20 -X POST -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY" -H 'Content-Type: application/json' \
    -d '{}' "$VITE_SUPABASE_URL/rest/v1/rpc/get_blog_version" | sed -n 's/^"\([0-9a-f]\{32\}\)"$/\1/p')
  if [ -z "$want" ]; then echo "$(date -Is) a API não respondeu a versão do blog" >&2; return 1; fi

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

main "$@"
exit
