# CI, contêiner e deploy na VPS

O site é publicado numa VPS Hostinger própria, com Docker atrás do Traefik. Vai para o ar somente `build/client`, com um `index.html` por rota; `build/server` é intermediário de pré-render e não roda na VPS. Backend, Auth e banco ficam no Supabase hospedado.

## Imagem e execução local

Na raiz do repositório, com Docker em modo Linux:

```powershell
docker build --pull -t keytotwo-site:local .
docker run -d --name keytotwo-site-local -p 127.0.0.1:18080:8080 keytotwo-site:local
docker exec keytotwo-site-local nginx -t
curl.exe -I http://127.0.0.1:18080/
curl.exe -I http://127.0.0.1:18080/meus-jogos
curl.exe -I http://127.0.0.1:18080/pedido/confirmacao
curl.exe -I http://127.0.0.1:18080/rota-inexistente
```

Resultados esperados: 200 nas três rotas existentes, 404 na inexistente, com o HTML de `build/client/404/index.html`. Depois do teste, `docker stop keytotwo-site-local` e `docker rm keytotwo-site-local` removem somente este contêiner. O dev (5178) e o admin (5179) são independentes.

Para um build que fala com o backend, passe as chaves públicas do projeto Supabase hospedado (`keytotwo-print-db`) e da Stripe como argumentos de build: `--build-arg VITE_SUPABASE_URL=https://<ref>.supabase.co --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_… --build-arg VITE_STRIPE_PUBLISHABLE_KEY=pk_… --build-arg VITE_CHECKOUT_MODE=stripe`, além de `VITE_SITE_STAGE`, `VITE_SITE_URL` e, se mudar, `VITE_TERMS_VERSION` (igual ao segredo `TERMS_VERSION` das funções). Só chaves publicáveis: nunca `sb_secret_` nem `sk_`.

O Dockerfile faz `npm ci` e `npm run build` com Node 24; a etapa final usa Nginx e copia somente a saída pública. O contexto exclui `.env*`, chaves, arte original, dependências e saídas locais. Não passar segredos em argumentos de build: variáveis incorporadas no JavaScript público são visíveis ao navegador.

`nginx.conf` atende em HTTP na porta interna **8080**. `try_files` procura primeiro o HTML da rota; rotas privadas recebem sua própria casca pré-renderizada. URLs desconhecidas retornam HTTP 404, sem fallback 200 para a home. `/404` também responde 404. O arquivo interno de fallback SPA não é publicado como uma página navegável.

Headers: `nosniff`, bloqueio de frames, política de referrer e restrição de câmera/microfone/geolocalização, inclusive em erros. HTML e erros usam `Cache-Control: no-store`. Assets com hash em `/assets/` usam um ano e `immutable`; mídia sem hash usa uma hora com revalidação. TLS e HSTS ficam no proxy da VPS.

## CI

`.github/workflows/ci.yml` roda em pull request, em push no `main` e por execução manual (`gh workflow run CI --ref <branch>`), com permissão somente de leitura. Em PR, um commit roda uma vez só e um commit novo cancela a execução anterior do mesmo PR. Os jobs de funções, banco e integração só rodam quando o diff toca `supabase/`, `src/lib/`, os specs `i*`/`smoke`, `playwright.config.ts`, `package*.json` ou `.github/`. No `main` e na execução manual roda tudo. O repositório é público desde 2026-10-17 (minutos grátis), e o foco é a espera: o Site roda o e2e com 4 workers, só o Chromium é instalado, a stack efêmera sobe sem Studio, Storage, Realtime, imgproxy, postgres-meta, logs e pooler, e a integração são dois jobs em paralelo (funções e e2e), cada um com a sua stack (`.github/actions/stack-efemera`).

Antes de abrir PR, `npm run verificar` roda na máquina o que o job Site roda e também os specs do stage test (sacola, conta) com a API simulada, que o CI só exercita quando a integração roda: lint, testes unitários, o build do admin, os dois builds do site (um igual ao do CI, para o smoke de console, e outro com o `.env.local`) e a suíte E2E numa porta própria (4181). Não roda `npm ci` nem instala navegadores; isso fica para quem prepara a máquina.

O job Funções instala **Deno 2.9.x** e roda `deno check .` e os testes de contrato em `supabase/functions`; o job Banco roda os testes pgTAP com o Supabase CLI. Nenhum dos dois conecta ao Supabase remoto nem aplica migrações; não existe workflow de deploy.

## Deploy na VPS

A VPS é a da Chalk Labs na Hostinger. O acesso é pelo usuário `deploy`, que está no grupo `docker`; host, porta e caminho da chave estão no arquivo de segredos (`VPS_*`). Os outros serviços dela são projetos do Docker Manager da Hostinger em `/docker/*`. O site fica fora disso, em `/opt/keytotwo-site`, e não mexe neles nem na configuração do Traefik.

**Traefik que já roda lá** (`traefik-au8p`):

- rede `host` e provider docker com `exposedbydefault=false`: cada site entra só pelas etiquetas do próprio contêiner;
- entrada `websecure` (443); a `web` (80) redireciona para HTTPS;
- certificados do Let's Encrypt pelo resolver `letsencrypt`, com desafio HTTP-01. Por isso o DNS do domínio, que fica no Cloudflare, precisa estar em "Somente DNS" (nuvem cinza);
- o Traefik alcança o nginx na 8080 pela rede do Docker; o contêiner não publica porta.

**Na VPS:**

| Caminho | O que é |
| --- | --- |
| `/opt/keytotwo-site/repo` | Clone raso do repositório; o script de atualização troca o commit |
| `/opt/keytotwo-site/build.env` | Variáveis públicas do build (`VITE_*`): stage `test`, `VITE_SITE_URL` do teste e as chaves publicáveis |
| `/opt/keytotwo-site/teste/compose.yaml` | Cópia de `deploy/teste/compose.yaml` |
| `/opt/keytotwo-site/teste/.env` | `IMAGE_TAG` (o commit em uso) e `SITE_BASIC_AUTH_USERS` (hash apr1 do usuário de teste, entre aspas simples). Usuário e senha em texto ficam no arquivo de segredos (`TEST_BASIC_AUTH_*`) |
| `/opt/keytotwo-site/producao/build.env` | Variáveis públicas do build live: stage `live`, `VITE_SITE_URL=https://keytotwo.com.br`, as mesmas chaves do Supabase e a `pk_live_` da Stripe |
| `/opt/keytotwo-site/producao/compose.yaml` e `.env` | Cópia de `deploy/producao/compose.yaml`; o `.env` tem só o `IMAGE_TAG` (`live-<commit>`) |

**Atualizar o teste** (`teste.keytotwo.com.br`, com senha):

```sh
ssh deploy@<VPS_HOST> sh /opt/keytotwo-site/repo/deploy/teste/atualizar.sh   # ou com um ref: ... atualizar.sh minha-branch
```

O script traz o commit, constrói a imagem na própria VPS (cerca de 70 s), marca a imagem com o commit, grava o commit no `IMAGE_TAG` e recria o contêiner. Para voltar a uma versão anterior, troque o `IMAGE_TAG` do `.env` por um commit cuja imagem ainda exista (`docker images keytotwo-site`) e rode `docker compose up -d` na pasta `teste`.

**Primeira instalação** (feita em 2026-10-21): `git clone --depth 1` do repositório em `/opt/keytotwo-site/repo`, o `build.env` com as variáveis públicas e o `teste/.env` com `chmod 600`. Se o repositório voltar a ser privado, a VPS precisa de uma chave de deploy só de leitura para o `git fetch`.

**Backend do teste:** o Supabase hospedado. Desde 2026-10-21, `https://teste.keytotwo.com.br` está em `ALLOWED_ORIGINS` e na lista de retorno do Auth, e o `SITE_URL` das funções e o `site_url` do Auth apontam para ele. Por isso o retorno do pagamento e os links dos e-mails vão para o teste, inclusive nas compras feitas pelo 5178.

## Produção (keytotwo.com.br)

Mesmo padrão do teste, na mesma VPS e no mesmo Traefik, com `deploy/producao/compose.yaml` e `deploy/producao/atualizar.sh`. As diferenças:

- não tem senha;
- o build é `live`, então passa pela trava `check-release`. Com qualquer pendência, a imagem não é criada e o que está no ar não muda;
- a imagem leva o prefixo `live-` (`keytotwo-site:live-<commit>`), porque o teste faz outra imagem do mesmo commit;
- `www.keytotwo.com.br` responde 301 para `keytotwo.com.br`. Cada nome tem o seu certificado, então um não espera o DNS do outro;
- HSTS de um ano só para `keytotwo.com.br` e `www`, sem `includeSubDomains`.

**Publicar uma versão nova** (depois do lançamento):

```sh
ssh deploy@<VPS_HOST> sh /opt/keytotwo-site/repo/deploy/producao/atualizar.sh   # ou com um ref
```

Para voltar, ponha um `live-<commit>` anterior no `IMAGE_TAG` de `producao/.env` e rode `docker compose up -d` na pasta `producao`.

### Antes do lançamento

1. **Trava sem pendências:** `VITE_SITE_STAGE=live node scripts/check-release.mjs` passa. A validação jurídica foi aprovada em 2026-10-22, na versão `termos-2026-10-22`. Os relatos de exemplo não travam: no live, a seção de relatos só aparece com o primeiro relato real (`placeholder: false` em `src/content/experience.ts`, com texto, autor e a nota que o casal deu). Se os Termos mudarem, a versão nova vai também para o segredo `TERMS_VERSION` das funções.
2. **VPS:** criar `/opt/keytotwo-site/producao/` com o `build.env` (as linhas abaixo) e um `.env` com `IMAGE_TAG=`. Os dois ficam com `chmod 600`.

   ```sh
   VITE_SITE_STAGE=live
   VITE_SITE_URL=https://keytotwo.com.br
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
   VITE_STRIPE_PUBLISHABLE_KEY=pk_live_…
   VITE_CHECKOUT_MODE=stripe
   ```

3. **Stripe live:** cadastrar `keytotwo.com.br` em *Payment method domains*, para Apple Pay e Google Pay no formulário.
4. **Google Cloud** (login com Google): a tela de consentimento OAuth publicada ("Em produção"), com `keytotwo.com.br` nos domínios autorizados e os links da página inicial, de `/privacidade` e de `/termos`. O retorno continua sendo o do Supabase, então não muda.

### No dia, nessa ordem

1. **Supabase hospedado** (pelo Lastro, com o OK do responsável):
   - segredos das funções: `STRIPE_SECRET_KEY` (a `rk_live_`), `STRIPE_WEBHOOK_SECRET` (o do webhook live), `SITE_URL=https://keytotwo.com.br` e `https://keytotwo.com.br` em `ALLOWED_ORIGINS` (o teste continua). Valem nas chamadas seguintes, sem redeploy;
   - Auth: `site_url` em `https://keytotwo.com.br` e `https://keytotwo.com.br/**` na lista de retorno;
   - banco:
     - `products.stripe_price_id` com os preços live (os `STRIPE_PRICE_ID_*` do arquivo de segredos);
     - `private.stripe_prices` vazia;
     - `profiles.stripe_customer_id` nulo, porque os clientes de teste não existem na conta live;
     - pedidos e eventos das compras de teste apagados. O Lastro lista antes; a conta do admin fica.
2. **DNS no Cloudflare, em "Somente DNS":** `keytotwo.com.br` A para o IP da VPS e `www` CNAME para `keytotwo.com.br`. Os MX do e-mail não mudam. Espere `nslookup keytotwo.com.br 1.1.1.1` responder o IP da VPS: o certificado sai pelo desafio HTTP-01, que precisa do DNS já apontado.
3. **VPS:** na primeira vez, o script ainda não está no clone da VPS. Rode a partir do repositório local: `ssh deploy@<VPS_HOST> sh -s main < deploy/producao/atualizar.sh`.
4. **Conferir:**
   - `https://keytotwo.com.br` com certificado; `http://` e `www` levam a ele;
   - `robots.txt` e `sitemap.xml` com o domínio;
   - o aviso de cookies;
   - depois de "Aceitar", a visita aparece em *Tempo real* no GA4.
5. **Compra real pequena** (um jogo avulso, cartão ou Pix):
   - pedido pago, jogo em Meus jogos e e-mail de confirmação;
   - em seguida, o reembolso total pelo Dashboard. O webhook `charge.refunded` marca o pedido como reembolsado.
6. **Search Console:** enviar `https://keytotwo.com.br/sitemap.xml`.

**Depois da virada:** o teste e o dev local continuam no mesmo Supabase, agora com a Stripe live. Dá para navegar, entrar e baixar por eles, mas o pagamento não funciona, porque o site em stage test recusa sessões live. Para voltar a testar compras fora da produção, o teste precisa de um projeto Supabase próprio, com a Stripe de teste.

## Admin (admin.keytotwo.com.br)

App à parte (`admin/`), com imagem e contêiner próprios: mudar o admin não republica a loja. Fala com o mesmo Supabase hospedado, então mexe sempre em dados reais.

- **Na VPS:** `/opt/keytotwo-site/admin/build.env` com `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` e `VITE_SITE_URL=https://keytotwo.com.br` (só chaves publicáveis). O `.env` ao lado guarda o `IMAGE_TAG`.
- **Publicar:** `ssh deploy@<vps> sh /opt/keytotwo-site/repo/deploy/admin/atualizar.sh [ref]`; de uma branch, `sh -s <branch> < deploy/admin/atualizar.sh`.
- **DNS:** `admin` A para o IP da VPS, só DNS (nuvem cinza), como o teste. O Traefik tira o certificado sozinho.
- **Supabase:** `https://admin.keytotwo.com.br` em `ALLOWED_ORIGINS` das funções e `https://admin.keytotwo.com.br/**` na lista de retorno do Auth (login com Google). TOTP ligado em *Authentication > Multi-Factor*.
- **Segundo fator:** na primeira entrada o admin cadastra o app autenticador. Perdeu o app: apague o fator em *Authentication > Users > a conta > MFA factors*; na próxima entrada o admin pede um cadastro novo.
- **Local:** `npm run dev:admin` (porta 5179, com o `.env.local` da raiz). A 5179 precisa estar no `ALLOWED_ORIGINS` das funções locais.

## Blog (posts no banco, site reconstruído sozinho)

Desde 2026-10-23 os posts são escritos no admin e ficam no banco. O site continua pré-renderizado, então publicar um post pede um build novo:

- **Build:** os `atualizar.sh` do teste e da produção passam `BLOG_SOURCE=api` e `BLOG_VERSION` ao Docker. O `scripts/blog-export.mjs` traz os publicados de `GET /blog/posts` para `content/blog` (os arquivos do repositório saem), baixa as imagens do bucket público para `public/images/blog`, gera a imagem de compartilhar de cada post com capa (JPEG 1200×630 em `public/images/blog/og/<endereço>.jpg`, a que o WhatsApp e as redes mostram) e grava a versão em `/blog/versao.json`. Falhou (API fora, post inválido, imagem ausente): o build para e o site no ar não muda. Fora da VPS (local e CI), o build usa os arquivos do repositório.
- **Vigia:** `deploy/blog/vigiar.sh`, no cron do usuário `deploy`, a cada minuto (o responsável preferiu assim a conferir mais vezes). Compara a versão do banco (`POST /rest/v1/rpc/get_blog_version`, a API de dados do Supabase com a chave publicável, mais leve que chamar a função) com o `/blog/versao.json` de cada contêiner e, se diferem, roda o `atualizar.sh` daquele site (produção primeiro) no commit que já está no ar (`/opt/keytotwo-site/<site>/commit`, gravado pelo `atualizar.sh`). Só o blog muda. Uma versão que falhou num site fica em `/opt/keytotwo-site/blog/<site>.falhou` e não é tentada de novo até o banco mudar. O log fica em `/opt/keytotwo-site/blog/vigia.log`.
- **Instalar o vigia (uma vez):** depois do primeiro deploy da produção com o blog (ele copia o script para `/opt/keytotwo-site/blog/vigiar.sh`), `crontab -e` do `deploy` com `* * * * * sh /opt/keytotwo-site/blog/vigiar.sh >> /opt/keytotwo-site/blog/vigia.log 2>&1` (instalado em 2026-10-23). Do publicar ao site no ar: até 1 minuto para perceber e cerca de 1 minuto de build.
- **Um deploy por vez:** os dois `atualizar.sh` esperam a vez num `flock` (`/opt/keytotwo-site/.deploy.lock`), porque o teste, a produção e o vigia usam o mesmo checkout em `repo/`.
- **Imagens:** bucket público `keytotwo-print-blog` na Backblaze, com uma chave de escrita só dele nos segredos da função `api` (`B2_BLOG_*`, `docs/api-contract.md` seção 10). O admin mostra as imagens direto do bucket; o site serve a cópia do próprio domínio.
- **No admin:** a lista do blog e o editor (depois de salvar algo que muda o site) comparam a versão do banco com o `/blog/versao.json` da produção (o nginx do site libera esse arquivo para `https://admin.keytotwo.com.br`), conferem de novo a cada 10 s e avisam quando o site fica em dia.
- **O `/admin` antigo** (Sveltia CMS) saiu; o nginx do site manda `/admin` para `https://admin.keytotwo.com.br/blog`.

## Referências técnicas

- [Nginx: try_files e error_page](https://nginx.org/en/docs/http/ngx_http_core_module.html).
- [Nginx: add_header](https://nginx.org/en/docs/http/ngx_http_headers_module.html).
- [Playwright: integração contínua](https://playwright.dev/docs/ci-intro).
- [Deno: check](https://docs.deno.com/runtime/reference/cli/check/).
