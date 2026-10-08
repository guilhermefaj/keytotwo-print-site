# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY react-router.config.ts vite.config.ts tsconfig.json site.config.json ./
COPY scripts/seo-files.mjs scripts/check-release.mjs ./scripts/
COPY src/ ./src/
COPY public/ ./public/
# Public build-time settings only; omitted values use site.config.json.
ARG VITE_SITE_STAGE
ARG VITE_SITE_URL
RUN node scripts/check-release.mjs \
    && npm run build \
    && node scripts/check-release.mjs --built

FROM nginx:stable-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
# build/server is only used during prerendering; it is not a production runtime.
COPY --from=build /app/build/client/ /srv/keytotwo/

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
