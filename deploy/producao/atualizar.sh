#!/bin/sh
# Publica o keytotwo.com.br na VPS: traz o commit, constrói a imagem live na própria VPS e recria o contêiner.
# Rodar como o usuário deploy: sh /opt/keytotwo-site/repo/deploy/producao/atualizar.sh [ref]   (sem ref, o main)
# O build live passa pela trava check-release: com pendência, a imagem não é criada e o site no ar não muda.
# Tudo fica dentro de main(): o git checkout troca este arquivo no meio da execução, e o sh lê o script aos poucos.
set -eu

main() {
  base=/opt/keytotwo-site
  ref=${1:-main}
  # Um deploy por vez (este, o do teste ou o vigia do blog): todos usam o mesmo checkout em repo/.
  exec 9>"$base/.deploy.lock"
  flock 9
  git -C "$base/repo" fetch --quiet --depth 1 origin "$ref"
  git -C "$base/repo" checkout --quiet --detach FETCH_HEAD
  sha=$(git -C "$base/repo" rev-parse --short HEAD)

  # Variáveis públicas do build live (VITE_*): vão para o JavaScript do navegador. Só chaves publicáveis.
  set -a
  . "$base/producao/build.env"
  set +a
  if [ "${VITE_SITE_STAGE:-}" != live ]; then echo "producao/build.env precisa de VITE_SITE_STAGE=live" >&2; exit 1; fi
  # Blog: os posts publicados vêm do banco no build; a versão muda a cada publicação e refaz só essa parte.
  blog=$(curl -fsS --max-time 20 -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY" "$VITE_SUPABASE_URL/functions/v1/api/blog/version" \
    | sed -n 's/.*"version":"\([0-9a-f]\{32\}\)".*/\1/p')
  if [ -z "$blog" ]; then echo "A API não respondeu a versão do blog" >&2; exit 1; fi
  # O prefixo separa a imagem live da do teste, feita do mesmo commit com outras variáveis.
  docker build --pull --quiet -t "keytotwo-site:live-$sha" \
    --build-arg VITE_SITE_STAGE --build-arg VITE_SITE_URL --build-arg VITE_SUPABASE_URL \
    --build-arg VITE_SUPABASE_PUBLISHABLE_KEY --build-arg VITE_STRIPE_PUBLISHABLE_KEY --build-arg VITE_CHECKOUT_MODE \
    --build-arg VITE_TERMS_VERSION --build-arg BLOG_SOURCE=api --build-arg BLOG_VERSION="$blog" \
    "$base/repo" >/dev/null

  # Para voltar, basta pôr um live-<commit> anterior no IMAGE_TAG e rodar o compose de novo.
  cp "$base/repo/deploy/producao/compose.yaml" "$base/producao/compose.yaml"
  sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=live-$sha/" "$base/producao/.env"
  docker compose --project-directory "$base/producao" up -d --wait
  # O vigia do blog reconstrói este mesmo commit quando um post é publicado. A cópia dele troca por rename: o cron
  # pode estar lendo o arquivo antigo agora (é ele que chama este script).
  git -C "$base/repo" rev-parse HEAD > "$base/producao/commit"
  mkdir -p "$base/blog"
  cp "$base/repo/deploy/blog/vigiar.sh" "$base/blog/vigiar.sh.novo"
  mv -f "$base/blog/vigiar.sh.novo" "$base/blog/vigiar.sh"
  # O backup noturno do banco (deploy/backup/backup.sh) também roda de uma cópia, pelo mesmo motivo.
  mkdir -p "$base/backup"
  cp "$base/repo/deploy/backup/backup.sh" "$base/backup/backup.sh.novo"
  mv -f "$base/backup/backup.sh.novo" "$base/backup/backup.sh"
  echo "keytotwo.com.br no commit $sha"
}

main "$@"
exit
