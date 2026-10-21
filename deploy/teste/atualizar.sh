#!/bin/sh
# Atualiza o teste.keytotwo.com.br na VPS: traz o commit, constrói a imagem na própria VPS e recria o contêiner.
# Rodar como o usuário deploy: sh /opt/keytotwo-site/repo/deploy/teste/atualizar.sh [ref]   (sem ref, o main)
# Tudo fica dentro de main(): o git checkout troca este arquivo no meio da execução, e o sh lê o script aos poucos.
set -eu

main() {
  base=/opt/keytotwo-site
  ref=${1:-main}
  git -C "$base/repo" fetch --quiet --depth 1 origin "$ref"
  git -C "$base/repo" checkout --quiet --detach FETCH_HEAD
  sha=$(git -C "$base/repo" rev-parse --short HEAD)

  # Variáveis públicas do build (VITE_*): vão para o JavaScript do navegador.
  set -a
  . "$base/build.env"
  set +a
  docker build --pull --quiet -t "keytotwo-site:$sha" \
    --build-arg VITE_SITE_STAGE --build-arg VITE_SITE_URL --build-arg VITE_SUPABASE_URL \
    --build-arg VITE_SUPABASE_PUBLISHABLE_KEY --build-arg VITE_STRIPE_PUBLISHABLE_KEY --build-arg VITE_CHECKOUT_MODE \
    "$base/repo" >/dev/null

  # O commit vira a tag em uso; para voltar, basta pôr um commit anterior no IMAGE_TAG e rodar o compose de novo.
  cp "$base/repo/deploy/teste/compose.yaml" "$base/teste/compose.yaml"
  sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$sha/" "$base/teste/.env"
  docker compose --project-directory "$base/teste" up -d --wait
  echo "teste.keytotwo.com.br no commit $sha"
}

main "$@"
exit
