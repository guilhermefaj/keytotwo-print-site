#!/bin/sh
# Atualiza o teste.keytotwo.com.br na VPS: traz o commit, constrói a imagem na própria VPS e recria o contêiner.
# Rodar como o usuário deploy: sh /opt/keytotwo-site/repo/deploy/teste/atualizar.sh [ref]   (sem ref, o main)
# Tudo fica dentro de main(): o git checkout troca este arquivo no meio da execução, e o sh lê o script aos poucos.
set -eu

main() {
  base=/opt/keytotwo-site
  ref=${1:-main}
  # Um deploy por vez (este, o da produção ou o vigia do blog): todos usam o mesmo checkout em repo/.
  exec 9>"$base/.deploy.lock"
  flock 9
  git -C "$base/repo" fetch --quiet --depth 1 origin "$ref"
  git -C "$base/repo" checkout --quiet --detach FETCH_HEAD
  sha=$(git -C "$base/repo" rev-parse --short HEAD)

  # Variáveis públicas do build (VITE_*): vão para o JavaScript do navegador.
  set -a
  . "$base/build.env"
  set +a
  # Blog: os posts publicados vêm do banco no build; a versão muda a cada publicação e refaz só essa parte.
  blog=$(curl -fsS --max-time 20 -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY" "$VITE_SUPABASE_URL/functions/v1/api/blog/version" \
    | sed -n 's/.*"version":"\([0-9a-f]\{32\}\)".*/\1/p')
  if [ -z "$blog" ]; then echo "A API não respondeu a versão do blog" >&2; exit 1; fi
  # Catálogo (2026-10-24): o preço, o riscado e os pacotes vêm do banco no build; a versão muda a cada mudança no admin.
  catalog=$(curl -fsS --max-time 20 -X POST -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY" -H 'Content-Type: application/json' \
    -d '{}' "$VITE_SUPABASE_URL/rest/v1/rpc/get_catalog_version" | sed -n 's/^"\([0-9a-f]\{32\}\)"$/\1/p')
  if [ -z "$catalog" ]; then echo "A API não respondeu a versão do catálogo" >&2; exit 1; fi
  docker build --pull --quiet -t "keytotwo-site:$sha" \
    --build-arg VITE_SITE_STAGE --build-arg VITE_SITE_URL --build-arg VITE_SUPABASE_URL \
    --build-arg VITE_SUPABASE_PUBLISHABLE_KEY --build-arg VITE_STRIPE_PUBLISHABLE_KEY --build-arg VITE_CHECKOUT_MODE \
    --build-arg CONTENT_SOURCE=api --build-arg BLOG_VERSION="$blog" --build-arg CATALOG_VERSION="$catalog" \
    "$base/repo" >/dev/null

  # O commit vira a tag em uso; para voltar, basta pôr um commit anterior no IMAGE_TAG e rodar o compose de novo.
  cp "$base/repo/deploy/teste/compose.yaml" "$base/teste/compose.yaml"
  sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$sha/" "$base/teste/.env"
  docker compose --project-directory "$base/teste" up -d --wait
  # O vigia do blog reconstrói este mesmo commit quando um post é publicado.
  git -C "$base/repo" rev-parse HEAD > "$base/teste/commit"
  echo "teste.keytotwo.com.br no commit $sha"
}

main "$@"
exit
