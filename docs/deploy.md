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

**Limpeza (desde 2026-10-31):** no fim, cada `atualizar.sh` (teste, produção e admin) guarda só três imagens do seu site: a do ar e as duas mais novas, para voltar sem build. A do ar fica pelo nome, não pela data, porque um build igual a um antigo reaproveita a imagem e a data dela. Também apaga as imagens sem nome (o vigia refaz a mesma tag a cada post) e o cache de build com mais de uma semana. Para voltar a uma versão mais antiga, rode o `atualizar.sh` com o commit dela, que refaz a imagem. Se a limpeza falhar, o script só avisa: o site já está no ar.

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

Para voltar, ponha um `live-<commit>` anterior no `IMAGE_TAG` de `producao/.env` e rode `docker compose up -d` na pasta `producao`. Ficam três `live-`, a do ar e as duas mais novas (veja a limpeza no teste); uma mais antiga se refaz com `atualizar.sh <commit>`.

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
6. **Search Console:** enviar `https://keytotwo.com.br/sitemap.xml` e conferir se o site está incluído nos recursos de IA generativa da Pesquisa (o Google exige isso para aparecer nas Visões gerais criadas por IA e no Modo IA).

**Depois da virada:** o teste e o dev local continuam no mesmo Supabase, agora com a Stripe live. Dá para navegar, entrar e baixar por eles, mas o pagamento não funciona, porque o site em stage test recusa sessões live. Para voltar a testar compras fora da produção, o teste precisa de um projeto Supabase próprio, com a Stripe de teste.

## Admin (admin.keytotwo.com.br)

App à parte (`admin/`), com imagem e contêiner próprios: mudar o admin não republica a loja. Fala com o mesmo Supabase hospedado, então mexe sempre em dados reais.

- **Na VPS:** `/opt/keytotwo-site/admin/build.env` com `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` e `VITE_SITE_URL=https://keytotwo.com.br` (só chaves publicáveis). O `.env` ao lado guarda o `IMAGE_TAG`.
- **Publicar:** `ssh deploy@<vps> sh /opt/keytotwo-site/repo/deploy/admin/atualizar.sh [ref]`; de uma branch, `sh -s <branch> < deploy/admin/atualizar.sh`. Espera a vez dos outros deploys (o mesmo `flock`). O `ssh` passa o nome do branch para o shell da VPS: use só nomes com letras, números, `.`, `_`, `/` e `-` (os scripts recusam o resto, `refs/…` e opções).
- **DNS:** `admin` A para o IP da VPS, só DNS (nuvem cinza), como o teste. O Traefik tira o certificado sozinho.
- **Supabase:** `https://admin.keytotwo.com.br` em `ALLOWED_ORIGINS` das funções e `https://admin.keytotwo.com.br/**` na lista de retorno do Auth (login com Google). TOTP ligado em *Authentication > Multi-Factor*.
- **Segundo fator:** na primeira entrada o admin cadastra o app autenticador. Perdeu o app: apague o fator em *Authentication > Users > a conta > MFA factors*; na próxima entrada o admin pede um cadastro novo.
- **Local:** `npm run dev:admin` (porta 5179, com o `.env.local` da raiz). A 5179 precisa estar no `ALLOWED_ORIGINS` das funções locais.

## E-mail: Plunk e Amazon SES (email.keytotwo.com.br)

Desde 2026-10-31 o Plunk (código aberto, versão fixa no compose) roda na VPS e envia pelo Amazon SES. Ele substituiu a Brevo no mesmo dia: os e-mails do site e os do Auth (pelo SMTP do SES, `docs/auth-setup.md`) saem por ele e pelo SES.

- **Na VPS:** `/opt/keytotwo-site/plunk/compose.yaml` (cópia de `deploy/plunk/compose.yaml`) e o `.env` ao lado (600): `DB_PASSWORD`, `JWT_SECRET`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` (aleatórios, gerados na VPS), `AWS_SES_REGION`, `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY` (as mesmas do arquivo de segredos) e `DISABLE_SIGNUPS=true`. Subir ou aplicar mudança: `docker compose --project-directory /opt/keytotwo-site/plunk up -d --wait`. Atualizar o Plunk: trocar a versão da imagem no compose depois de ler as notas da versão. Depois de atualizar, conferir duas coisas que dependem dele: o link do rodapé (abaixo) e a checagem de fora do ar, que espera `404` com "Contact not found" em `curl -s https://api.email.keytotwo.com.br/contacts/public/00000000-0000-0000-0000-000000000000` (se mudar, a checagem acusa o Plunk fora do ar).
- **Endereços** (DNS A para a VPS, só DNS): `email.` é o painel e as páginas de descadastro; `api.email.` é a API (o site e a AWS chamam); `arquivos.email.` serve só GET/HEAD em `/uploads/` (imagens dos e-mails, no MinIO). Nenhuma porta publicada: tudo passa pelo Traefik. O `POST /auth/login` tem limite de 10 pedidos por minuto por IP.
- **Contas:** o cadastro fica fechado. Para mais alguém: `DISABLE_SIGNUPS=false` no `.env`, `up -d`, a pessoa se cadastra, volta para `true` e `up -d` de novo.
- **AWS (projeto da AWS em us-east-2):** identidade `keytotwo.com.br` com DKIM (3 CNAME `<token>._domainkey`) e MAIL FROM `plunk.keytotwo.com.br` (MX `feedback-smtp.us-east-2.amazonses.com` e TXT `v=spf1 include:amazonses.com ~all`); conta fora do sandbox. Configuration sets `plunk-tracking` e `plunk-no-tracking`, que publicam os eventos no tópico SNS `plunk-ses-events` (só o SES publica, assinatura v2), inscrito em `https://api.email.keytotwo.com.br/webhooks/sns`. O usuário IAM `plunk-ses` (política `plunk-ses-send`) só envia como `keytotwo.com.br` e só saindo do IP da VPS: se a VPS mudar de IP, atualize o `aws:SourceIp` da política antes.
- **Chave da AWS:** trocar a cada 90 dias (criar a nova no IAM, pôr no `.env` da VPS e no arquivo de segredos, `up -d`, conferir um envio e só então apagar a antiga).
- **Alertas pelo SES (desde 2026-11-01):** o e-mail dos alertas dos admins não passa pelo Plunk: a função `email-dispatch` chama a API do SES direto, para o aviso de fora do ar sair mesmo com a VPS parada (o Plunk e o admin estão nela). O usuário IAM `/service/supabase-ses-alertas` (política `supabase-ses-alertas-send`) só tem `ses:SendEmail`, só na identidade `keytotwo.com.br` e no configuration set padrão dela (`plunk-no-tracking`), só com o remetente dos e-mails do site, `contato@keytotwo.com.br` (`ses:FromAddress`, igual ao `EMAIL_FROM` das funções; `kito@` é do marketing e fica de fora), e só para os e-mails dos admins e `success@simulator.amazonses.com` (`ses:Recipients`; o simulador serve para testar a chave sem entregar nada). Não dá para travar por IP: a Supabase não tem IP fixo. Ao entrar ou sair um admin, atualizar a lista de `ses:Recipients` da política (nova versão). Até lá, o alerta do admin novo sai pelo Plunk. A chave fica nos segredos das funções (`SES_ALERTS_REGION=us-east-2`, `SES_ALERTS_ACCESS_KEY_ID`, `SES_ALERTS_SECRET_ACCESS_KEY`) e no arquivo de segredos. Se o SES recusar, o alerta vai pelo Plunk, como antes, e o log da `email-dispatch` mostra `alerta pelo SES falhou (ses_http_403 …)`. Trocar também a cada 90 dias (nova chave, um envio ao simulador, segredos das funções, apagar a antiga). Se o remetente do site (`EMAIL_FROM`) mudar, atualizar o `ses:FromAddress` da política antes.
- **Avisos para o site:** a função `ses-events` tem a sua própria inscrição HTTPS no tópico `plunk-ses-events`, com filtro no corpo (`{"eventType": ["Bounce", "Complaint"]}`): bounce definitivo e reclamação viram supressão no banco, com a origem `ses_events` (contrato da API, 8.3).
- **Limpeza diária** (política de privacidade: o registro de cada e-mail some em 90 dias): `deploy/plunk/limpar.sh`, em `/opt/keytotwo-site/plunk/limpar.sh`, no cron do `deploy` às 03:50 de Brasília (`50 6 * * * sh /opt/keytotwo-site/plunk/limpar.sh >> /opt/keytotwo-site/plunk/limpar.log 2>&1`). Apaga do banco do Plunk os e-mails com mais de 90 dias (com os eventos, em cascata; os que ainda vão sair ficam) e os contatos sem inscrição e sem e-mail recente. A exclusão de conta no site já apaga o contato na hora.

**Brevo desligada** (2026-10-31, fase 5):

- O código não tem mais o modo `brevo` nem a função `brevo-webhook`; o hospedado não tem a função nem os segredos `BREVO_API_KEY` e `BREVO_WEBHOOK_SECRET`. Voltar para a Brevo não é mais uma troca de segredo: pediria código novo.
- A conta da Brevo foi encerrada pelo responsável, com as chaves revogadas antes.
- DNS (Cloudflare): saíram o TXT `brevo-code` da raiz e os CNAME `brevo1._domainkey` e `brevo2._domainkey`. O DMARC (`_dmarc`) manda os relatórios para o DMARC Management do Cloudflare, em vez da Brevo.
- O banco mantém a origem `brevo_webhook` nas restrições: as linhas antigas continuam válidas.

**Marketing no Plunk** (desde 2026-10-31, fase 4; migração `20261031180000_marketing_plunk.sql`):

- **O site é a fonte do consentimento.** Quem já deu opt-in alguma vez tem uma linha em `private.marketing_contacts`; as triggers marcam quem muda (consentimento, bounce, compra, jogos, e-mail) e o `email-dispatch`, na rodada da agenda, manda o estado atual ao Plunk: inscrito ou não e, nos campos do contato, `comprou`, `jogos` (códigos) e `boas_vindas_no_lancamento`. A primeira inscrição vai como o evento `inscricao`, que começa as boas-vindas. Só no `EMAIL_MODE=plunk`.
- **Automações** (criadas por `deploy/plunk/automacoes.mjs`, que cria o que falta pelo nome; `--ligar` liga): "Boas-vindas" (Boas-vindas 1, 3 dias, 2, 4 dias, sai quem comprou, sai quem se inscreveu mais de 7 dias antes da abertura das vendas, 3) e "Descadastro no Plunk → site" (`contact.unsubscribed` → função `plunk-webhook`, com o segredo `PLUNK_WEBHOOK_SECRET` no header). Os modelos ficam no Plunk (Templates), editáveis lá.
- **Campanha do lançamento:** "Lançamento: boas-vindas 3", em rascunho, para quem tem `boas_vindas_no_lancamento` e não comprou. Agendar para 09/11 às 19h no painel do Plunk.
- **Publicar:** migração e funções (`api`, `email-dispatch`, `stripe-webhook`, a nova `plunk-webhook`), o segredo `PLUNK_WEBHOOK_SECRET` nas funções (o mesmo do arquivo de segredos) e só então `node --env-file=<segredos> deploy/plunk/automacoes.mjs --ligar`. Os contatos que já tinham opt-in vão ao Plunk na primeira rodada.
- **Descadastro pelo rodapé** (desde 2026-11-01): o Plunk põe o rodapé dele em todo e-mail de marketing, com o link `email.keytotwo.com.br/unsubscribe/<contato>?e=<e-mail>`. O roteador `plunk-descadastro` do compose leva esse endereço (302) para `keytotwo.com.br/email/preferencias?contato=…&e=…`, a mesma despedida do site; ao confirmar, a `api` chama o descadastro de 1 clique do Plunk e `record_plunk_unsubscribe` (seção 6.10 do contrato da API). O botão "Cancelar inscrição" do Gmail (List-Unsubscribe, 1 clique) continua indo direto ao Plunk. Publicar o site antes de aplicar o compose; ao atualizar o Plunk, conferir se o link continua igual (`curl -sI https://email.keytotwo.com.br/unsubscribe/<uuid>` deve dar 302 para o site).
- **Campanhas avulsas** (newsletter, jogo novo, data com cupom) saem do painel do Plunk com os modelos; para o jogo novo, tirar quem já tem o jogo pelo campo `jogos`. O reengajamento (90 dias sem clique) fica para quando houver quem se encaixe.

## Backup do banco

O plano grátis do Supabase não guarda backup. Desde 2026-10-24 (decisões do responsável) a VPS tira uma cópia por noite:

- **O que roda:** `deploy/backup/backup.sh`, no cron do `deploy` às 03:30 de Brasília (`30 6 * * * sh /opt/keytotwo-site/backup/backup.sh >> /opt/keytotwo-site/backup/backup.log 2>&1`). O deploy da produção copia o script para `/opt/keytotwo-site/backup/`. Num contêiner `postgres:17-alpine`, gera `roles.sql`, `schema.sql` e `data.sql` com os filtros do `supabase db dump`, confere que as tabelas da loja vieram, fecha num `.tar.gz.age` e envia para `diario/<data>.tar.gz.age` (no dia 1, também `mensal/`). No fim chama `private.record_backup`; sem cópia nova em 26 horas, o admin abre o alerta "Backup atrasado".
- **Quem entra no banco:** o papel `backup_ro` (só leitura, `BYPASSRLS`, até 3 conexões), pelo pooler de sessão (`backup_ro.<ref>@aws-1-sa-east-1.pooler.supabase.com:5432`). Desde 2026-10-25 (revisão de segurança, migração `20261025120000`) ele lê só as tabelas e sequências de `public` e `private` (as de agora e as próximas; a `public.test` do responsável fica de fora) e, do Auth, `auth.users` e `auth.identities` pelas funções `private.backup_auth_users()` e `private.backup_auth_identities()`. Antes tinha `pg_read_all_data`, que dava também os tokens de sessão (que viram sessão de admin) e o Vault. A fila do `pg_net` (`net.http_request_queue`) a própria extensão abre para todos os papéis, e o postgres não pode fechar; por isso o segredo que passa por ela é o `DISPATCH_SECRET`, sem poder no banco. Só executa essas funções e `private.record_backup`. A senha foi definida direto no banco hospedado e não está no repositório.
- **`/opt/keytotwo-site/backup/backup.env`** (600, só do `deploy`; formato do `docker --env-file`, sem aspas): `BACKUP_DB_URL` (sem a senha), `BACKUP_DB_PASSWORD` (vai como `PGPASSWORD`, fora da lista de processos; a URL com a senha ainda funciona), `BACKUP_AGE_RECIPIENT` (a chave pública `age1…`), `B2_BACKUP_ENDPOINT`, `B2_BACKUP_REGION`, `B2_BACKUP_BUCKET`, `B2_BACKUP_KEY_ID` e `B2_BACKUP_APPLICATION_KEY`.
- **Bucket:** privado, só para o backup, com a criptografia da B2 ligada e duas regras de validade: `diario/` some 30 dias depois do envio, `mensal/` em 365. A chave da VPS é restrita a esse bucket e só escreve: quem entrar na VPS não lê nem apaga as cópias.
- **A chave secreta do `age`** fica só com o responsável (no arquivo de segredos e no gerenciador de senhas). Sem ela, nenhuma cópia abre.
- **Plunk (desde 2026-10-31):** o mesmo `backup.sh`, numa etapa à parte depois da do Supabase (falhar uma não impede a outra), tira `pg_dump -Fc` do Postgres do Plunk, confere que a tabela `emails` veio, fecha com a mesma chave `age` e envia para `diario/plunk-<data>.dump.age` (no dia 1, também `mensal/`). Desde 2026-11-01 também chama `private.record_backup` com esse nome: o banco separa as duas cópias pelo `plunk-` e, sem cópia nova do Plunk em 26 horas, o admin abre "Backup do Plunk atrasado" (começa a contar na primeira cópia registrada). A falha também sai no `backup.log`.
- **Fica de fora** (já tem cópia em outro lugar): os PDFs dos jogos e as imagens do blog (B2, com os originais no Drive), o código (GitHub) e os segredos (arquivo de segredos). Desde 2026-10-25 também ficam de fora as sessões, os tokens e o app autenticador dos admins (`auth.mfa_factors`): depois de restaurar, cada pessoa entra de novo e cada admin cadastra o app outra vez na primeira entrada.

**Recuperar** (num projeto Supabase novo; o mesmo vale para o ensaio, num banco descartável):

1. Baixe a cópia no painel da B2 (ou com uma chave de leitura do bucket) e abra: `age -d -i <chave-secreta> <arquivo>.tar.gz.age | tar -xz`.
2. Restaure como manda a Supabase (*Restore a Platform Project*): `psql --single-transaction -v ON_ERROR_STOP=1 -f roles.sql -f schema.sql -c 'SET session_replication_role = replica' -f data.sql --dbname "<conexão do projeto novo>"`.
3. Refaça o que a cópia não leva: os gatilhos de evento (o `rls_auto_enable` do hospedado; a cópia não leva), as quatro agendas do `pg_cron` (o `pg_dump` não leva as tabelas das extensões; rode os `cron.schedule` de `email-dispatch-tick`, `email-outbox-purge`, `discounts-tick` e `uptime-tick`, nas migrações `20261008190749`, `20261019120000`, `20261024220000` e `20261026120000`), os segredos do Vault do despacho de e-mail (a URL e, em `email_dispatch_key`, o mesmo valor do `DISPATCH_SECRET` das funções; `supabase/local/aplicar-dispatch-vault.mjs` no local), a senha do `backup_ro`, os segredos e o deploy das funções, a configuração do Auth (Google, URLs de retorno, TOTP) e o `SUPABASE_URL`/chaves no site, no admin e na VPS.
4. Confira as contagens (`auth.users`, `public.orders`, `public.entitlements`) com as da última noite.

**Ensaio (2026-10-24):** a cópia restaurada num Supabase local zerado (`supabase init` numa pasta à parte, sem as migrações, como um projeto novo), com o comando do passo 2, sem nenhuma edição. Contagens iguais às do banco, o catálogo responde e o `02_privileges_rls` passa no banco restaurado (só a lista exata de RPCs difere: o hospedado tem a `rls_auto_enable`, um gatilho de evento do painel). O ensaio achou e o `backup.sh` já corrige:
- as RPCs voltavam abertas para `anon` (o projeto novo dá tudo em `public` por padrão e o `pg_dump` não tira): o `schema.sql` desliga esse padrão antes e o religa no fim;
- os gatilhos da loja em `auth.users` (perfil e confirmação do e-mail) não vinham: entram no fim do `schema.sql`;
- o Storage do Supabase (vazio; a loja usa a B2) e a permissão interna `ON PARAMETER` da plataforma travavam a restauração: saem da cópia.

**Recuperar o Plunk:** abra a cópia (`age -d -i <chave-secreta> plunk-<data>.dump.age > plunk.dump`), pare o serviço `plunk` do compose e, com o `postgres` no ar, `docker compose exec -T postgres pg_restore -U plunk -d plunk --clean --if-exists --no-owner < plunk.dump`; depois `up -d`. Numa VPS nova, suba o compose com um `.env` novo antes (a senha do banco pode ser outra; o `JWT_SECRET` novo só desloga quem estava no painel). Ensaio de 2026-10-31: restaurado num `postgres:16-alpine` descartável, contagens iguais às do banco.

Repetir o ensaio a cada 3 meses, ou depois de mudar o `backup.sh`. Precisa do Docker Desktop; no Windows, as portas 54275 a 54474 podem estar reservadas (`netsh int ipv4 show excludedportrange protocol=tcp`): troque as do `config.toml` da pasta do ensaio.

## Blog e catálogo (do banco, site reconstruído sozinho)

Desde 2026-10-23 os posts são escritos no admin e ficam no banco; desde 2026-10-24, o catálogo também (preço, riscado, situação e os jogos do pacote). O site continua pré-renderizado, então publicar um post ou mudar o catálogo pede um build novo:

- **Catálogo:** com `BLOG_SOURCE=api` (o nome é de antes do catálogo e fica, porque a VPS reconstrói commits antigos com scripts novos e o contrário), o `scripts/catalog-export.mjs` lê a versão (`POST /rest/v1/rpc/get_catalog_version`) e o `GET /catalog`, grava `src/content/catalog-snapshot.ts` (no repositório fica o retrato de 2026-10-24, usado no local e no CI) e `/catalogo/versao.json`. Daí saem o preço do dado do Google, a lista de jogos do pacote e o valor dos eventos; o preço, o riscado e "à venda" que a página mostra continuam vindo do `/catalog` na hora. Produto lançado fora do `/catalog` (pausado) aparece "Indisponível no momento".
- **Build:** os `atualizar.sh` do teste e da produção passam `BLOG_SOURCE=api`, `BLOG_VERSION` e `CATALOG_VERSION` ao Docker. O `scripts/blog-export.mjs` traz os publicados de `GET /blog/posts` para `content/blog` (os arquivos do repositório saem), baixa as imagens do bucket público para `public/images/blog`, gera a imagem de compartilhar de cada post com capa (JPEG 1200×630 em `public/images/blog/og/<endereço>.jpg`, a que o WhatsApp e as redes mostram) e grava a versão em `/blog/versao.json`. Falhou (API fora, post inválido, imagem ausente): o build para e o site no ar não muda. Fora da VPS (local e CI), o build usa os arquivos do repositório.
- **Vigia:** `deploy/blog/vigiar.sh`, no cron do usuário `deploy`, a cada minuto (o responsável preferiu assim a conferir mais vezes). Compara as versões do banco (`POST /rest/v1/rpc/get_blog_version` e `get_catalog_version`, a API de dados do Supabase com a chave publicável, mais leve que chamar a função) com o `/blog/versao.json` e o `/catalogo/versao.json` de cada contêiner e, se diferem, roda o `atualizar.sh` daquele site (produção primeiro) com o ref `registrado`: o commit que já está no ar (`/opt/keytotwo-site/<site>/commit`, gravado pelo `atualizar.sh`), lido só depois de ter a vez no `flock`. Só o blog muda. Uma versão que falhou num site fica em `/opt/keytotwo-site/blog/<site>.falhou` e não é tentada de novo até o banco mudar. O log fica em `/opt/keytotwo-site/blog/vigia.log`.
- **Instalar o vigia (uma vez):** depois do primeiro deploy da produção com o blog (ele copia o script para `/opt/keytotwo-site/blog/vigiar.sh`), `crontab -e` do `deploy` com `* * * * * sh /opt/keytotwo-site/blog/vigiar.sh >> /opt/keytotwo-site/blog/vigia.log 2>&1` (instalado em 2026-10-23). Do publicar ao site no ar: até 1 minuto para perceber e cerca de 1 minuto de build.
- **Um deploy por vez:** os três `atualizar.sh` (teste, produção e, desde 2026-10-25, o admin) esperam a vez num `flock` (`/opt/keytotwo-site/.deploy.lock`), porque eles e o vigia usam o mesmo checkout em `repo/`. O commit que o vigia reconstrói é gravado logo depois do checkout: outro deploy no meio não o troca. E o vigia só lê o commit depois de ter a vez (2026-10-29): antes, um post mudado durante um deploy fazia o vigia esperar com o commit antigo e desfazer o deploy logo depois.
- **Imagens:** bucket público `keytotwo-print-blog` na Backblaze, com uma chave de escrita só dele nos segredos da função `api` (`B2_BLOG_*`, `docs/api-contract.md` seção 10). O admin mostra as imagens direto do bucket; o site serve a cópia do próprio domínio.
- **No admin:** a lista do blog e o editor (depois de salvar algo que muda o site) comparam a versão do banco com o `/blog/versao.json` da produção (o nginx do site libera esse arquivo para `https://admin.keytotwo.com.br`), conferem de novo a cada 10 s e avisam quando o site fica em dia.
- **O `/admin` antigo** (Sveltia CMS) saiu; o nginx do site manda `/admin` para `https://admin.keytotwo.com.br/blog`.

## Referências técnicas

- [Nginx: try_files e error_page](https://nginx.org/en/docs/http/ngx_http_core_module.html).
- [Nginx: add_header](https://nginx.org/en/docs/http/ngx_http_headers_module.html).
- [Playwright: integração contínua](https://playwright.dev/docs/ci-intro).
- [Deno: check](https://docs.deno.com/runtime/reference/cli/check/).
