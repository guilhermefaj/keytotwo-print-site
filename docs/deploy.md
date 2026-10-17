# I0 — CI e contêiner para a VPS Hostinger própria

O ajuste 7 da nota **Plano do site P1** define uma VPS Hostinger própria com Docker. Publicar somente `build/client`, com um `index.html` por rota. `build/server` é intermediário de pré-render e não roda na VPS; backend, Auth e banco permanecem no Supabase. O site ainda é um protótipo com `noindex` e dados comerciais pendentes.

## Imagem e execução local

Na raiz do repositório, com Docker em modo Linux:

```powershell
docker build --pull -t keytotwo-site:i0 .
docker run -d --name keytotwo-site-i0 -p 127.0.0.1:18080:8080 keytotwo-site:i0
docker exec keytotwo-site-i0 nginx -t
curl.exe -I http://127.0.0.1:18080/
curl.exe -I http://127.0.0.1:18080/meus-jogos
curl.exe -I http://127.0.0.1:18080/pedido/confirmacao
curl.exe -I http://127.0.0.1:18080/rota-inexistente
```

Resultados esperados: 200 nas três rotas existentes, 404 na inexistente, com o HTML de `build/client/404/index.html`. Depois do teste, `docker stop keytotwo-site-i0` e `docker rm keytotwo-site-i0` removem somente este contêiner. Os servidores de desenvolvimento em 5173/5174 são independentes.

Para um build que fala com o backend, passe as chaves públicas do projeto Supabase hospedado (`keytotwo-print-db`) e da Stripe como argumentos de build: `--build-arg VITE_SUPABASE_URL=https://<ref>.supabase.co --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_… --build-arg VITE_STRIPE_PUBLISHABLE_KEY=pk_… --build-arg VITE_CHECKOUT_MODE=stripe`, além de `VITE_SITE_STAGE`, `VITE_SITE_URL` e, se mudar, `VITE_TERMS_VERSION` (igual ao segredo `TERMS_VERSION` das funções). Só chaves publicáveis: nunca `sb_secret_` nem `sk_`.

O Dockerfile faz `npm ci` e `npm run build` com Node 24; a etapa final usa Nginx e copia somente a saída pública. O contexto exclui `.env*`, chaves, arte original, dependências e saídas locais. Não passar segredos em argumentos de build: variáveis incorporadas no JavaScript público são visíveis ao navegador. O I0 não exige credenciais de backend.

`nginx.conf` atende em HTTP na porta interna **8080**. `try_files` procura primeiro o HTML da rota; rotas privadas recebem sua própria casca pré-renderizada. URLs desconhecidas retornam HTTP 404, sem fallback 200 para a home. `/404` também responde 404. O arquivo interno de fallback SPA não é publicado como uma página navegável.

Headers: `nosniff`, bloqueio de frames, política de referrer e restrição de câmera/microfone/geolocalização, inclusive em erros. HTML e erros usam `Cache-Control: no-store`. Assets com hash em `/assets/` usam um ano e `immutable`; mídia sem hash usa uma hora com revalidação. TLS e HSTS ficam no proxy da VPS.

## CI

`.github/workflows/ci.yml` roda em pull request, em push no `main` e por execução manual (`gh workflow run CI --ref <branch>`), com permissão somente de leitura. Desde 2026-10-17, para caber na cota de minutos do plano Free: um commit de PR roda uma vez só, um commit novo cancela a execução anterior do mesmo PR, e em PR os jobs de funções, banco e integração só rodam quando o diff toca `supabase/`, `src/lib/`, os specs `i*`/`smoke`, `playwright.config.ts`, `package*.json` ou `.github/`. No `main` e na execução manual roda tudo. Executa `npm ci`, lint, typecheck, build, instalação dos navegadores/dependências Playwright e `npm run test:e2e`. O build precede os testes que servem `build/client`. Os navegadores exercitados são os declarados pela configuração da Lupa; instalar os executáveis não amplia automaticamente a matriz de testes.

Um job independente detecta `supabase/functions` e, quando existir, instala **Deno 2.9.x** e executa `deno check .` nesse diretório, usando a configuração Deno versionada pelo outro floor. Não conecta ao Supabase remoto nem aplica migrações. A execução real no GitHub fica para o próximo commit/PR; nenhum workflow de deploy existe nesta entrega.

## Deploy na VPS — dados PENDENTES

| Dado do responsável | Estado |
| --- | --- |
| Proxy reverso existente e rede Docker usada por ele | PENDENTE |
| Emissão/renovação de TLS e onde configurar HSTS | PENDENTE |
| Orquestração existente: Compose, Swarm, Portainer ou outra | PENDENTE |
| Domínio de produção e DNS | PENDENTE |
| Subdomínio de teste e DNS | PENDENTE |
| Host/IP, porta e usuário SSH da VPS | PENDENTE |
| Chave SSH exclusiva do CI e fingerprint SSH verificado | PENDENTE |
| Registro de imagens, nome e credenciais de pull, se privado | PENDENTE |

Quando esses dados estiverem definidos, o pipeline futuro construirá e publicará a imagem (GHCR é uma proposta), com tag pelo SHA do commit; a VPS atualizará por SSH conforme o stack existente. A referência efetiva deve ser imutável (tag por commit ou digest), mantendo a anterior para rollback. As tags Node 24 e Nginx stable do Dockerfile recebem atualizações; o digest da imagem publicada identifica a versão efetivamente implantada.

Roteiro a adaptar ao stack, sem escolher uma orquestração nova:

1. Registrar a imagem aprovada e autenticar o pull da VPS quando necessário.
2. Conectar o serviço HTTP interno `8080` à rede do proxy existente, com limite de exposição ao proxy. Não publicar uma porta HTTP aberta na internet como substituto do TLS.
3. Atualizar o serviço pelo mecanismo existente; conferir saúde, `/`, `/meus-jogos`, `/pedido/confirmacao` e 404 via subdomínio de teste, com TLS no proxy.
4. Conservar imagem/configuração anteriores para rollback e validar o retorno se a atualização falhar.

Não executar comandos de deploy nem criar chave, domínio ou workflow antes de resolver os dados PENDENTES. A falta desses dados não impede o build e a verificação local do I0.

## Referências técnicas

- [Nginx: try_files e error_page](https://nginx.org/en/docs/http/ngx_http_core_module.html).
- [Nginx: add_header](https://nginx.org/en/docs/http/ngx_http_headers_module.html).
- [Playwright: integração contínua](https://playwright.dev/docs/ci-intro).
- [Deno: check](https://docs.deno.com/runtime/reference/cli/check/).
