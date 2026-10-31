# KeyToTwo

Loja de jogos de papel para casais imprimirem em casa (keytotwo.com.br). Site em React Router 8 pré-renderizado (SSG) com Vite e Tailwind só na base, admin à parte em `admin/`, e backend no Supabase hospedado (Auth, Postgres e Edge Functions em `supabase/`), com Stripe, Plunk (e-mail, pelo Amazon SES) e Backblaze B2. Direção visual em [DESIGN.md](DESIGN.md).

## Rodar

Requer Node.js 22.22 ou mais novo (o CI e a imagem usam Node 24) e npm.

```powershell
npm ci
npm run dev        # site em http://127.0.0.1:5178 (porta estrita)
npm run dev:admin  # admin em http://127.0.0.1:5179
```

O dev fala com o Supabase hospedado (o mesmo da produção), então a origem precisa estar no `ALLOWED_ORIGINS` das funções. O `.env.local` (não versionado) traz as chaves publicáveis e o stage.

| Porta | Para quê |
| --- | --- |
| 5178 | `npm run dev` |
| 5179 | `npm run dev:admin` |
| 4174 | `npm run preview` e o Playwright (`E2E_PORT` muda) |
| 4181 | a suíte do `npm run verificar` |

## Stages

`site.config.json` define a origem e o stage padrão (`preview`); `VITE_SITE_URL` e `VITE_SITE_STAGE` sobrescrevem (a variável do shell vence o `.env.local`).

- **preview:** vitrine sem preço nem compra; downloads e preferências de e-mail simulados.
- **test:** o teste.keytotwo.com.br e o build local: faixa "Ambiente de teste", conteúdo de exemplo (relatos, rascunhos do blog), sacola e pagamento contra a API de verdade. Como a Stripe é live, o pagamento não fecha.
- **live:** o domínio. O build passa pela trava `scripts/check-release.mjs` (sem `PENDENTE`, com preços aprovados); com pendência, a imagem não é criada.

Fora de live, toda página tem `noindex`, o `robots.txt` bloqueia tudo e o sitemap sai vazio. Em live, entram no sitemap as páginas públicas, os produtos e os posts publicados; sacola, entrar, área privada e 404 continuam `noindex`. Cada página tem `og:image` 1200 × 630 (`public/media/og`, de `scripts/prepare-og-images.mjs`), e há JSON-LD da loja (OnlineStore, com razão social, CNPJ e o link da política de reembolso), site, produto (com o preço em BRL) e post. Em live sai também o `llms.txt`, o resumo da loja em texto simples para assistentes de IA, gerado do conteúdo e do catálogo do build. As URLs antigas de produto (`/loja/p001`…) voltam com 301 pelo `nginx.conf`.

## Variáveis do build (`VITE_*`, públicas)

| Variável | O que faz |
| --- | --- |
| `VITE_SITE_STAGE`, `VITE_SITE_URL` | stage e origem (live exige HTTPS) |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | o projeto Supabase (só a chave publicável, nunca `sb_secret_`) |
| `VITE_STRIPE_PUBLISHABLE_KEY` | a chave publicável da Stripe |
| `VITE_CHECKOUT_MODE=stripe` | pagamento de verdade fora de live; sem ela, o `/pagamento` é demonstração |
| `VITE_DELIVERY_MODE=mock`, `VITE_EMAIL_PREFERENCES_MODE=mock` | downloads e preferências de e-mail simulados (dev sem API) |
| `VITE_TERMS_VERSION` | versão dos termos gravada no aceite; padrão em `src/content/legal.ts`, igual ao segredo `TERMS_VERSION` das funções |
| `VITE_ADMIN_URL` | link "Painel" do menu da conta (padrão: admin.keytotwo.com.br) |

Live nunca aceita simulação: em stage `live` os modos `mock` e a demonstração de pagamento ficam desligados, seja qual for a variável.

## Verificar

```powershell
npm run verificar
```

Roda lint, as fixtures da trava de release, os testes unitários, o build do admin, os dois builds do site (um igual ao do CI, sem API, e outro com o `.env.local`), o smoke de console e a suíte E2E na porta 4181. Rode antes de abrir PR: o CI roda uma vez por PR. As funções (Deno) e o banco (pgTAP) rodam no CI; veja [supabase/functions/tests/README.md](supabase/functions/tests/README.md).

**Capturas opcionais dos E2E** (vão para `.maestri/design-review/`, ignorada pelo git): `D1_CAPTURE=1`, `D2_CAPTURE=1`, `D3_CAPTURE=1`, `I5_CAPTURE=1` (sacola), `MENU_CAPTURE=1` e `SHOP_CAPTURE=1` (Loja e produtos, em WebP); `REDESIGN_QA_DIR=<pasta>` salva as capturas da matriz do Início. Ex.: `npm run build` e depois `E2E_PORT=4174 SHOP_CAPTURE=1 npx playwright test tests/e2e/shop.spec.ts --workers=1` (no PowerShell, `$env:SHOP_CAPTURE='1'` antes).

**Armadilhas conhecidas:**

- O `.env.local` builda em `test`, e o CI em `preview`: rode `VITE_SITE_STAGE=preview npm run build` para ver o que o CI vê. No build local, os smokes "carrega direto" falham por CORS de propósito.
- Deixe o `playwright.config.ts` subir o `sirv` na 4174: um `sirv` aberto à mão cacheia a lista de arquivos e devolve 404 depois de um rebuild.
- A máquina sofre com vários Chromium: com a suíte cheia, prefira poucos workers e feche sessões ociosas.
- No Git Bash, argumentos que começam com `/` viram caminhos do Windows; use `MSYS_NO_PATHCONV=1`.
- Todo o CSS entra por `src/app.css`, numa folha só; a ordem dos `@import` é a cascata. Classe usada em mais de um lugar precisa de escopo.

## Imagens e scripts de assets

Rodados à mão quando a arte muda; a saída vai para `public/media/` e entra no git.

| Script | Origem | Saída |
| --- | --- | --- |
| `prepare-kito-pixel.mjs` | `art-source/kito-pixel/` (o Kito.zip de 2026-10-18) | atlas e pose de frente da hero, `src/kito-sprites.ts` (gerado) |
| `prepare-kito-tonto.mjs`, `prepare-kito-cookie.mjs` | animações do Kito.zip e do Kito-eating_a_cookie.zip (Drive) | Kito tonto e Kito do cookie em `public/media/experience/` |
| `prepare-kito-empty.mjs` | Kito na caixa (Drive) | `public/media/experience/` |
| `prepare-kito-hi.mjs` | `kito_hi.png` (Drive) | `public/media/experience/kito-hi-{128,256}.webp` |
| `prepare-game-covers.mjs` | capas oficiais "[CAPA - <código>]" (Drive) | `public/media/games/*-capa-{640,800}.webp` (no máximo 800 px) |
| `prepare-og-images.mjs` | as capas de 800 px | `public/media/og/*.jpg` |
| `prepare-free-pages.mjs` | PDFs dos gratuitos (Drive; precisa do Poppler) | `public/media/experience/gratuitos-paginas-*.webp` |
| `prepare-favicon.mjs` | `kito_favicon.png` (Drive) | favicons e ícones em `public/media/icons/` |

Os scripts do build (`seo-files`, `html-priorities`, `blog-export`, `check-release`, `verificar`) rodam sozinhos. Fontes auto-hospedadas: Bricolage Grotesque 700 e DM Sans 400/600, subset latin, via `@fontsource`. Nenhuma página do PDF de um jogo pago vai para o site (DESIGN.md › Capa de jogo).

## Documentos

- [docs/deploy.md](docs/deploy.md): CI, contêiner, VPS, teste, produção, admin e blog.
- [docs/api-contract.md](docs/api-contract.md) e [docs/data-contract.md](docs/data-contract.md): rotas da API e o banco.
- [docs/auth-setup.md](docs/auth-setup.md): SMTP do Auth (Amazon SES), login com Google e templates do Auth.
- [docs/stripe.md](docs/stripe.md): pagamento.
- [docs/desempenho.md](docs/desempenho.md): Lighthouse e como medir.
- [docs/third-party-notices.md](docs/third-party-notices.md): avisos de licença de terceiros.

Limites: axe e Chromium automatizados não substituem revisão independente, leitor de tela ou testes em Safari/Firefox.
