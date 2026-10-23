#!/bin/sh
# Publica o admin.keytotwo.com.br na VPS: traz o commit, constrói a imagem do admin na própria VPS e recria o contêiner.
# Rodar como o usuário deploy: sh /opt/keytotwo-site/repo/deploy/admin/atualizar.sh [ref]   (sem ref, o main)
# Antes do merge, de uma branch: ssh deploy@<vps> sh -s <branch> < deploy/admin/atualizar.sh
# Tudo fica dentro de main(): o git checkout troca este arquivo no meio da execução, e o sh lê o script aos poucos.
set -eu

main() {
  base=/opt/keytotwo-site
  ref=${1:-main}
  git -C "$base/repo" fetch --quiet --depth 1 origin "$ref"
  git -C "$base/repo" checkout --quiet --detach FETCH_HEAD
  sha=$(git -C "$base/repo" rev-parse --short HEAD)

  # Variáveis públicas do build (VITE_*): o Supabase hospedado e o endereço da loja. Só chaves publicáveis.
  set -a
  . "$base/admin/build.env"
  set +a
  docker build --pull --quiet -f "$base/repo/admin/Dockerfile" -t "keytotwo-admin:$sha" \
    --build-arg VITE_SUPABASE_URL --build-arg VITE_SUPABASE_PUBLISHABLE_KEY --build-arg VITE_SITE_URL \
    "$base/repo" >/dev/null

  # Para voltar, basta pôr um commit anterior no IMAGE_TAG e rodar o compose de novo.
  cp "$base/repo/deploy/admin/compose.yaml" "$base/admin/compose.yaml"
  if [ -f "$base/admin/.env" ]; then sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$sha/" "$base/admin/.env"; else echo "IMAGE_TAG=$sha" > "$base/admin/.env"; fi
  docker compose --project-directory "$base/admin" up -d --wait
  echo "admin.keytotwo.com.br no commit $sha"
}

main "$@"
exit
