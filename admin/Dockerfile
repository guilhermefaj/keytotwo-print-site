# syntax=docker/dockerfile:1
# Admin (admin.keytotwo.com.br): o SPA de admin/, construído do mesmo repositório. Contexto do build: a raiz.
# Uso: docker build -f admin/Dockerfile -t keytotwo-admin:<commit> .   (deploy/admin/atualizar.sh faz isso na VPS)
FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY admin/ ./admin/
# O que o admin usa da loja: os tokens da marca, o logo, o G do Google e os ícones do Kito.
COPY src/tokens.css ./src/
COPY public/media/icons/ ./public/media/icons/
COPY public/media/hero/keytotwo-logo.webp ./public/media/hero/
COPY public/media/auth/google-g.png ./public/media/auth/
# Só chaves publicáveis: vão para o JavaScript do navegador.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SITE_URL
RUN test -n "$VITE_SUPABASE_URL" && test -n "$VITE_SUPABASE_PUBLISHABLE_KEY" && npm run build:admin

FROM nginx:stable-alpine AS runtime
COPY admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/admin/dist/ /srv/admin/

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
