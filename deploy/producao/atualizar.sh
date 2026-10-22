#!/bin/sh
# Publica o keytotwo.com.br na VPS: traz o commit, constrói a imagem live na própria VPS e recria o contêiner.
# Rodar como o usuário deploy: sh /opt/keytotwo-site/repo/deploy/producao/atualizar.sh [ref]   (sem ref, o main)
# O build live passa pela trava check-release: com pendência, a imagem não é criada e o site no ar não muda.
# Tudo fica dentro de main(): o git checkout troca este arquivo no meio da execução, e o sh lê o script aos poucos.
set -eu

main() {
  base=/opt/keytotwo-site
  ref=${1:-main}
  git -C "$base/repo" fetch --quiet --depth 1 origin "$ref"
  git -C "$base/repo" checkout --quiet --detach FETCH_HEAD
  sha=$(git -C "$base/repo" rev-parse --short HEAD)

  # Variáveis públicas do build live (VITE_*): vão para o JavaScript do navegador. Só chaves publicáveis.
  set -a
  . "$base/producao/build.env"
  set +a
  if [ "${VITE_SITE_STAGE:-}" != live ]; then echo "producao/build.env precisa de VITE_SITE_STAGE=live" >&2; exit 1; fi
  # O prefixo separa a imagem live da do teste, feita do mesmo commit com outras variáveis.
  docker build --pull --quiet -t "keytotwo-site:live-$sha" \
    --build-arg VITE_SITE_STAGE --build-arg VITE_SITE_URL --build-arg VITE_SUPABASE_URL \
    --build-arg VITE_SUPABASE_PUBLISHABLE_KEY --build-arg VITE_STRIPE_PUBLISHABLE_KEY --build-arg VITE_CHECKOUT_MODE \
    --build-arg VITE_TERMS_VERSION \
    "$base/repo" >/dev/null

  # Para voltar, basta pôr um live-<commit> anterior no IMAGE_TAG e rodar o compose de novo.
  cp "$base/repo/deploy/producao/compose.yaml" "$base/producao/compose.yaml"
  sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=live-$sha/" "$base/producao/.env"
  docker compose --project-directory "$base/producao" up -d --wait
  echo "keytotwo.com.br no commit $sha"
}

main "$@"
exit
