# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY react-router.config.ts vite.config.ts tsconfig.json site.config.json ./
# Scripts that `npm run build` calls, the release gate and the blog and catalog exports; tests/unit/docker-build.test.mjs checks this list.
COPY scripts/seo-files.mjs scripts/html-priorities.mjs scripts/check-release.mjs scripts/blog-export.mjs scripts/catalog-export.mjs ./scripts/
COPY src/ ./src/
# As regras do post do blog, as mesmas da API e do admin (src/lib/blog.server.ts importa).
COPY supabase/functions/_shared/blog-rules.ts ./supabase/functions/_shared/
COPY content/ ./content/
COPY public/ ./public/
# Public build-time settings only; omitted values use site.config.json.
ARG VITE_SITE_STAGE
ARG VITE_SITE_URL
# Public keys of the hosted Supabase project and Stripe (they end up in the browser bundle; never secret keys).
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_STRIPE_PUBLISHABLE_KEY
ARG VITE_CHECKOUT_MODE
ARG VITE_TERMS_VERSION
# Content from the database (blog 2026-10-23, catalog 2026-10-24): on the VPS (BLOG_SOURCE=api; the name predates the
# catalog and stays, since the VPS rebuilds older commits with newer deploy scripts and vice versa) the published posts and
# the catalog on sale come from the API and replace content/blog and src/content/catalog-snapshot.ts. The versions change
# with every publish or catalog change, so only the steps below run again (deploy/blog/vigiar.sh).
ARG BLOG_SOURCE
ARG BLOG_VERSION
ARG CATALOG_VERSION
RUN if [ "$BLOG_SOURCE" = api ]; then node scripts/blog-export.mjs && node scripts/catalog-export.mjs; fi \
    && node scripts/check-release.mjs \
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
