#!/bin/sh
# O que vem do banco na loja (blog, 2026-10-23; catálogo, 2026-10-24): publicar um post ou mudar o catálogo no admin
# muda a versão no banco. Este vigia roda no cron do usuário deploy a cada minuto e, quando a versão no ar de um site
# (produção, depois teste) difere da do banco, reconstrói esse site no MESMO commit que já está no ar: só o conteúdo do
# banco muda. O atualizar.sh espera a vez (flock), sem brigar com um deploy.
# As versões vêm da API de dados do Supabase (get_blog_version e get_catalog_version, liberadas para a chave
# publicável), mais leve que chamar a função a cada minuto. Uma conferência por minuto basta (responsável, 2026-10-23:
# sem pressa à custa de processamento).
# Fica em /opt/keytotwo-site/blog/vigiar.sh (o deploy da produção copia a versão do repositório) e só escreve no log
# quando reconstrói ou falha. Uma versão que já falhou num site não é tentada de novo até o banco mudar.
# Cron: * * * * * sh /opt/keytotwo-site/blog/vigiar.sh >> /opt/keytotwo-site/blog/vigia.log 2>&1
set -eu

# A versão de uma RPC (o md5 entre aspas que a API de dados devolve).
version() {
  curl -fsS --max-time 20 -X POST -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY" -H 'Content-Type: application/json' \
    -d '{}' "$VITE_SUPABASE_URL/rest/v1/rpc/$1" | sed -n 's/^"\([0-9a-f]\{32\}\)"$/\1/p'
}

# A versão gravada no site no ar (/blog/versao.json, /catalogo/versao.json).
live() {
  docker exec "keytotwo-$1-site-1" cat "/srv/keytotwo/$2/versao.json" 2>/dev/null \
    | sed -n 's/.*"version":"\([0-9a-f]\{32\}\)".*/\1/p' || true
}

main() {
  base=/opt/keytotwo-site
  mkdir -p "$base/blog"
  exec 8>"$base/blog/.vigia.lock"
  flock -n 8 || return 0 # a rodada anterior ainda está reconstruindo

  set -a
  . "$base/producao/build.env"
  set +a
  blog=$(version get_blog_version)
  catalog=$(version get_catalog_version)
  if [ -z "$blog" ] || [ -z "$catalog" ]; then echo "$(date -Is) a API não respondeu as versões do blog e do catálogo" >&2; return 1; fi
  want="blog $blog, catálogo $catalog"

  for site in producao teste; do
    now="blog $(live "$site" blog), catálogo $(live "$site" catalogo)"
    [ "$now" = "$want" ] && continue
    [ "$(cat "$base/blog/$site.falhou" 2>/dev/null || true)" = "$want" ] && continue
    commit=$(cat "$base/$site/commit" 2>/dev/null || true)
    if [ -z "$commit" ]; then
      echo "$want" > "$base/blog/$site.falhou"
      echo "$(date -Is) $site: sem commit registrado; rode o atualizar.sh dele uma vez" >&2
      continue
    fi
    echo "$(date -Is) $site: $now → $want; reconstruindo o commit $commit"
    if sh "$base/repo/deploy/$site/atualizar.sh" "$commit"; then
      rm -f "$base/blog/$site.falhou"
      echo "$(date -Is) $site: no ar com o banco de agora"
    else
      echo "$want" > "$base/blog/$site.falhou"
      echo "$(date -Is) $site: a reconstrução falhou; o site continua como estava" >&2
    fi
  done
}

main "$@"
exit
