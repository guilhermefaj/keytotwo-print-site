#!/bin/sh
# Publica o admin.keytotwo.com.br na VPS: traz o commit, constrói a imagem do admin na própria VPS e recria o contêiner.
# Rodar como o usuário deploy: sh /opt/keytotwo-site/repo/deploy/admin/atualizar.sh [ref]   (sem ref, o main)
# Antes do merge, de uma branch: ssh deploy@<vps> sh -s <branch> < deploy/admin/atualizar.sh
# Tudo fica dentro de main(): o git checkout troca este arquivo no meio da execução, e o sh lê o script aos poucos.
set -eu

main() {
  base=/opt/keytotwo-site
  ref=${1:-main}
  # Só um nome de branch ou um commit (revisão de segurança, 2026-10-25): nada de refs/ (refs/pull/* traria código de um
  # PR de fork), de opção (-x) nem de caractere de shell.
  case $ref in
    ''|-*|refs/*|*..*|*[!A-Za-z0-9._/-]*) echo "ref inválida: use um branch ou um commit" >&2; exit 1 ;;
  esac
  # Um deploy por vez (2026-10-25: este também): o teste, a produção, o vigia e o admin usam o mesmo checkout em repo/. Sem
  # isso, um checkout do admin no meio do build da produção fazia o vigia reconstruir a produção num branch.
  exec 9>"$base/.deploy.lock"
  flock 9
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
  # Limpeza (2026-10-31): ficam três imagens do admin, a do ar e as duas mais novas para voltar sem build. A do ar sai da
  # lista pelo nome, não pela data: um build igual a um antigo reaproveita a imagem e a data dela.
  {
    docker images keytotwo-admin --format '{{.CreatedAt}}|{{.Tag}}' | sort -r | sed -n 's/^.*|//p' \
      | grep -vx "$sha" | tail -n +3 \
      | while read -r tag; do docker image rm "keytotwo-admin:$tag" >/dev/null 2>&1 || true; done
    docker image prune -f >/dev/null
    docker builder prune -f --filter until=168h >/dev/null
  } || echo "Aviso: a limpeza das imagens falhou; o admin já está no ar" >&2
  echo "admin.keytotwo.com.br no commit $sha"
}

main "$@"
exit
