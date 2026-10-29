# Contrato da API — KeyToTwo (v0.3.14)

| | |
| --- | --- |
| Versão | 0.3.19, 2026-10-29 (blog: o post leva `author_instagram`, o Instagram de quem escreveu, opcional, seção 6.13). 0.3.18, 2026-10-27 (prévia do lançamento: o `GET /catalog` leva `sales_open_at`, seção 6.1, e o `POST /checkout` recusa com `409 SALES_NOT_OPEN` antes da abertura das vendas, seção 6.5). 0.3.17, 2026-10-26 (aviso de site fora do ar: `POST /internal/uptime` e o alerta `site_down` com o e-mail de volta, seção 6.16; o CSP do site passa a valer, seção 6.19). 0.3.16, 2026-10-25 (uso da infraestrutura: `GET /admin/metrics` leva `usage`, e toda chamada das funções soma no contador do mês, seção 6.12). 0.3.15, 2026-10-25 (revisão de segurança: o admin exige o código do app autenticador confirmado nas últimas 12 horas, seção 6.12; `POST /referral/visit` devolve o comprovante assinado da visita e o `POST /checkout` só atribui a venda ao parceiro com ele, seção 6.18; a agenda do banco usa o segredo próprio `DISPATCH_SECRET`, seção 8.2; nova `POST /csp-report`, seção 6.19). 0.3.14, 2026-10-24 (o formulário de pagamento abre com a página, travado até o aceite: `POST /checkout` sem `terms_accepted` devolve também o `order_id`, e `POST /checkout/terms` grava o aceite, seção 6.5; sai o `TERMS_NOT_ACCEPTED`). 0.3.13, 2026-10-24 (cupons, parceiros e indicações em `/admin/discounts/*`, `/admin/partners/*` e `POST /referral/visit`; a faixa do topo no `/catalog`, a indicação no `POST /checkout` e o marketing nas métricas, seção 6.18). 0.3.12, 2026-10-24 (catálogo no admin em `/admin/catalog` e `/admin/products/*`, seção 6.17; o `/catalog` leva o preço riscado, seção 6.1). 0.3.11, 2026-10-24 (alertas do admin em `/admin/alerts/*`, seção 6.16; o e-mail dos admins e a contestação que abre o alerta, seções 8.2 e 9). 0.3.10, 2026-10-24 (Fase 3 do admin: pedidos e reembolsos em `/admin/orders/*`, seção 6.15; o aviso de reembolso por e-mail, seção 8). 0.3.9, 2026-10-24 (limpeza: saem `GET /health`, `POST /account/marketing/prompt`, a origem `cart` e o `Content-Disposition` das exportações; Customer apagado na Stripe é trocado: seção 11.7). 0.3.8, 2026-10-23 (usuários no admin). 0.3.7, 2026-10-23 (blog no admin). 0.3.6, 2026-10-22 (preços da Stripe guardados no banco: seção 6.1). 0.3.5, 2026-10-22 (sacola sem login e jogo repetido: seções 6.2, 6.2.1 e 6.5). 0.3.4, 2026-10-21 (painel do administrador: seção 6.12). 0.3.3, 2026-10-19 (direitos do titular, LGPD: seção 6.11). 0.3.2, 2026-10-08. Modelo de vendas do Plano do site P2: carrinho, login obrigatório, entrega por e-mail, consentimento e contestações. Inclui o formulário de pagamento embutido configurado no Checkout Studio (nota "Stripe Checkout Studio"). Substitui a v0.2. O que mudou está na seção 11; a v0.3.1 registra o I4 (seção 11.1) e a v0.3.2, o I5 (seção 11.2). |
| Dono | Ferrolho (Backend sênior). Banco, permissões e RPCs: `docs/data-contract.md` v0.3 (Lastro). |
| Estado | I4: além do I3 (`POST /checkout`, `GET /order-status`, `stripe-webhook`), implementadas `POST /download-url`, `GET /d/{token}`, `GET /free-games`, `POST /free-download` e a função `email-dispatch` (entrega; modo log no local). I5: e-mails de marketing (`cart_reminder`, `post_purchase`) no `email-dispatch`, `GET`/`POST /email/unsubscribe`, a função `brevo-webhook` e a agenda (`pg_cron` + `pg_net`, migração do Lastro). Testes em `supabase/functions/tests`. Passos restantes da Stripe: `docs/stripe.md`. |
| Fontes | Nota "Plano do site P2" (ajustes do orquestrador, seções 4 e 5) e decisões do responsável registradas nas notas P1 e P2. |

**Alinhamento:** conferido com `docs/data-contract.md` v0.3.1 (21 RPCs), em revisão cruzada com o Lastro. **Marcador:** **[D#]** indica decisão pendente do responsável (nota P2, seção 7).

## 1. Funções

| Função | Quem chama | Autenticação | `verify_jwt` | CORS | Incremento |
| --- | --- | --- | --- | --- | --- |
| `api` | Site (navegador) e e-mails (links) | Sessão, token HMAC ou pública, por rota | `false` | Lista de origens | I0 em diante |
| `stripe-webhook` | Stripe | Assinatura `Stripe-Signature` | `false` | Não | I3 |
| `brevo-webhook` | Brevo | Segredo compartilhado (seção 8.1) | `false` | Não | I5 |
| `email-dispatch` | `pg_cron` via `pg_net`, `api` e `stripe-webhook` | Chave secreta do projeto | `false` | Não | I4 |

Base: `<SUPABASE_URL>/functions/v1/<função>`. Local: `http://127.0.0.1:54321/functions/v1/<função>`. Teste: projeto `keytotwo-print-db`. Deploy só com autorização da tarefa.

## 2. Autenticação

O projeto assina as sessões com chave assimétrica (ES256) e o site usa a chave publishable, que não é JWT. Por isso o gateway não valida nada (`verify_jwt = false`) e cada rota decide no código.

| Tipo de rota | Regra | Falha |
| --- | --- | --- |
| **Pública** | Ignora o `Authorization` | — |
| **Sessão** | JWT válido (`auth.getClaims()`), `role = authenticated`, usuário não anônimo e **e-mail confirmado** | `401 UNAUTHENTICATED`; e-mail não confirmado: `403 EMAIL_NOT_CONFIRMED` |
| **Token HMAC** | Token do e-mail, assinado pelo servidor (seção 7) | Redireciona ou responde `400 INVALID_TOKEN`, conforme a rota |

- **E-mail confirmado.** Com a configuração do Auth (confirmação obrigatória, código que confirma, Google com e-mail verificado), uma sessão já implica e-mail confirmado. Como defesa em profundidade, toda RPC que recebe `p_user_id` confere `auth.users.email_confirmed_at` e levanta `KT009 email_not_confirmed` (data-contract 6; a exceção é `unsubscribe`, que funciona pelo token). A rota converte em `403 EMAIL_NOT_CONFIRMED`.
- **Falha de rede ao validar** a sessão gera `500 INTERNAL_ERROR`, e não `401`, para o site não encerrar a sessão por instabilidade.
- **Login:** o site usa o supabase-js direto no Auth; não há rota própria. Todo pedido pertence a um `user_id`. Não existe compra anônima nem vínculo por e-mail.

| Forma | Chamadas | E-mail (template) |
| --- | --- | --- |
| Código por e-mail | `signInWithOtp({ email, options: { shouldCreateUser: true } })` → `verifyOtp({ email, token, type: 'email' })` | E-mail novo: *Confirme seu e-mail*; conta existente: *Seu código de acesso* |
| Criar conta com senha | Código por e-mail primeiro; já com sessão, `updateUser({ password })` | Os do código |
| Entrar com senha | `signInWithPassword({ email, password })` | — |
| Google | `signInWithOAuth({ provider: 'google', options: { redirectTo } })` | Nenhum. O Supabase liga o Google à conta que já tem o mesmo e-mail confirmado |
| Nova senha | `resetPasswordForEmail(email, { redirectTo })` → `verifyOtp({ email, token, type: 'recovery' })` → `updateUser({ password })` | *Redefina sua senha* |

- **Proteção contra tomada de conta (aprovada).** O site não usa `signUp` com senha. No banco, um trigger em `auth.users` zera a senha na primeira confirmação do e-mail. Assim, uma senha cadastrada por terceiro antes da confirmação nunca passa a valer.
- **Códigos:** 6 dígitos, válidos por 10 minutos, de uso único. Um novo código ou pedido de nova senha só sai 60 s depois do anterior; antes disso, `429 over_email_send_rate_limit`. Senha: mínimo de 8 caracteres, com letras e números (`weak_password`).
- **Mensagens neutras:** depois de pedir código ou nova senha, o site mostra a mesma mensagem para qualquer e-mail.

Headers enviados pelo site:

| Header | Quando | Valor |
| --- | --- | --- |
| `apikey` | Sempre | Chave publishable do ambiente |
| `Authorization` | Rotas de sessão | `Bearer <access_token>` |
| `Content-Type` | `POST` e `PUT` com corpo | `application/json` |

## 3. CORS e origem (função `api`)

- `ALLOWED_ORIGINS` lista as origens do site, separadas por vírgula. Sem valor, nenhuma origem de navegador é aceita.
- `OPTIONS` responde `204`. Com origem permitida, inclui:
  - `Access-Control-Allow-Origin`: a própria origem, nunca `*`;
  - `Allow-Headers`: `authorization, apikey, content-type, x-client-info`;
  - `Allow-Methods`: `GET, POST, PUT, DELETE, OPTIONS`;
  - `Max-Age`: `600`.
- `Origin` fora da lista: `403 ORIGIN_NOT_ALLOWED`, sem executar a rota. Sem `Origin` (curl, servidor, cliente de e-mail), a rota segue com a autenticação dela.
- Sucesso e erro levam `Access-Control-Allow-Origin` quando a origem é permitida.
- Local: o Kong da CLI responde o `OPTIONS` e troca a origem por `*`. O CORS da função só é conferido no projeto de teste ou chamando o edge runtime direto.

## 4. Formato e erros

- JSON em UTF-8. As respostas levam `Cache-Control: no-store` e `X-Content-Type-Options: nosniff`, exceto `GET /catalog` (seção 6.1).
- `POST` e `PUT` com corpo exigem `application/json` e até 16 KB. A exceção é `POST /email/unsubscribe`, que também aceita o formulário do descadastro em 1 clique.
- Datas em ISO 8601 (UTC). Dinheiro em centavos, com `currency` minúscula, como na Stripe (`brl`). Preço exibido vem sempre da Stripe; o valor cobrado é o da sessão do Checkout.
- Campos novos podem ser acrescentados; o site ignora os desconhecidos.
- Erro: `{ "error": { "code": "<CÓDIGO>", "message": "<texto em pt-BR>", "details": { ... } } }`. O site decide pelo `code`. `details` é opcional e nunca traz dado pessoal: por exemplo, `{ "product_codes": ["P001"] }` ou `{ "cart_version": 4 }`.

| HTTP | `code` | Quando |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | Corpo, JSON ou parâmetro inválido |
| 400 | `INVALID_TOKEN` | Token HMAC inválido em `POST /email/unsubscribe` |
| 401 | `UNAUTHENTICATED` | Rota de sessão sem sessão válida; função interna sem chave válida |
| 403 | `EMAIL_NOT_CONFIRMED` | Sessão de conta sem e-mail confirmado |
| 403 | `NOT_ENTITLED` | Sem direito ao arquivo |
| 403 | `FREE_GAMES_LOCKED` | Gratuito pedido por conta que nunca aceitou os e-mails (6.9) |
| 403 | `MFA_REQUIRED` | Rota de admin com sessão sem o segundo fator (aal1) ou com o código do app confirmado há mais de 12 horas (6.12) |
| 403 | `NOT_ADMIN` | Painel pedido por conta sem o admin (6.12) |
| 403 | `ORIGIN_NOT_ALLOWED` | `Origin` fora da lista |
| 404 | `NOT_FOUND` | Rota inexistente |
| 404 | `FILE_NOT_FOUND` | Arquivo inexistente, não publicado, trocado por versão nova ou fora do escopo |
| 405 | `METHOD_NOT_ALLOWED` | Método não aceito (header `Allow`) |
| 409 | `PRODUCT_UNAVAILABLE` | Produto inexistente, inativo ou sem preço no ambiente |
| 409 | `EDIT_CONFLICT` | Post do blog salvo em outro lugar depois que o editor abriu; `details.post` traz o atual (6.13) |
| 409 | `SLUG_TAKEN` | Outro post já usa o endereço (6.13) |
| 409 | `SLUG_LOCKED` | Mudança de endereço num post que já foi publicado (6.13) |
| 409 | `IMAGE_IN_USE` | Apagar do bucket uma imagem que algum post usa; `details.used_by` traz os posts (6.13) |
| 409 | `PROTECTED_ACCOUNT` | Bloquear, excluir ou retirar jogo da própria conta ou da de outro admin (6.14) |
| 409 | `ALREADY_REVOKED` · `ORDER_NOT_DELIVERABLE` · `EMAIL_ALREADY_QUEUED` | Jogo já retirado; pedido sem acesso para reenviar; e-mail de acesso ainda na fila (6.14) |
| 409 | `NOT_SUBSCRIBED` · `ALREADY_BLOCKED` · `NOT_BLOCKED` · `TARGET_NOT_CONFIRMED` | Conta fora das novidades; já bloqueada; não bloqueada; conta sem e-mail confirmado para exportar, excluir ou virar admin (6.14) |
| 409 | `GIFT_OVERLAP` · `ADMIN_UNCHANGED` · `LAST_ADMIN` · `ACCOUNT_BLOCKED` | Presente com produtos de jogo em comum; a conta já está no estado pedido; a equipe ficaria sem admin; conta bloqueada não vira admin (6.14) |
| 409 | `ALREADY_OWNED` | No checkout: nada a pagar (tudo na sacola já é do usuário ou já está num pacote dela) |
| 409 | `CART_EMPTY` | Checkout com carrinho vazio |
| 409 | `CART_CHANGED` | `cart_version` diferente da atual: o site recarrega o carrinho |
| 409 | `TERMS_CHANGED` | `terms_version` diferente da vigente: o site mostra o texto atual e pede o aceite de novo |
| 409 | `SALES_NOT_OPEN` | Checkout antes da abertura das vendas, na prévia do lançamento (`details.sales_open_at`) |
| 409 | `ACCOUNT_DELETION_BLOCKED` | Exclusão de conta com pagamento em andamento, checkout aberto ou contestação aberta (`details.reason`) |
| 413 | `PAYLOAD_TOO_LARGE` | Corpo acima de 16 KB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Corpo com tipo não aceito |
| 500 | `INTERNAL_ERROR` | Falha inesperada ou de configuração |
| 502 | `PAYMENT_PROVIDER_ERROR` | Falha ao falar com a Stripe |
| 503 | `FILE_UNAVAILABLE` | Direito confirmado, arquivo temporariamente indisponível |

Logs registram só o tipo do erro e o código. Nunca registram e-mail, token, corpo, URL assinada nem mensagem do Postgres.

## 5. Banco de dados

- `anon` e `authenticated` não têm GRANT em nada. O site nunca lê o banco direto.
- As funções chamam só RPCs `SECURITY DEFINER` com `EXECUTE` para `service_role`, por `rpc()` em `_shared/admin.ts`: chave secreta só no header `apikey`, timeout de 10 s. Na v0.3, nenhuma função lê tabela, nem `email_outbox`: a fila também é operada por RPC (D-12 sem exceção).
- A rota passa ao banco só o `user_id` validado. Dados do navegador são validados antes (formato de código, UUID e versão).
- Cada RPC é uma transação. Stripe, Brevo e B2 ficam fora dela: lê a Stripe, chama a RPC, e só depois assina a URL do B2 ou envia o e-mail.
- `livemode` vem da chave da Stripe do ambiente, nunca do navegador.
- **Resultados de negócio** voltam em `outcome` e viram códigos HTTP (seção 6); recusas de carrinho e checkout nunca chegam como erro. **Erros `KT`** (data-contract 6.1): `KT009` vira `403 EMAIL_NOT_CONFIRMED`. Nas rotas da `api`, os demais e `23505` indicam defeito e viram `500` com log só do código. No webhook, a regra está na seção 9.

### 5.1 Rota → RPC (v0.3)

| Rota ou evento | RPCs, em ordem | Incremento |
| --- | --- | --- |
| `GET /catalog` | `get_catalog()` + preços da Stripe | I2b |
| `GET /cart` | `get_cart(uid)` | I2b |
| `POST /cart/items` | `cart_add(uid, product_code)` → `get_cart(uid)` (só com `added` ou `noop`) | I2b |
| `DELETE /cart/items/{code}` | `cart_remove(uid, product_code)` → `get_cart(uid)` | I2b |
| `POST /cart/quote` | `quote_cart(product_codes)` | Sacola sem login (2026-10-22) |
| `POST /cart/merge` | `cart_add(uid, code)` para cada código, na ordem → `get_cart(uid)` | Sacola sem login (2026-10-22) |
| `GET /account` | `get_account(uid)` | I2b |
| `PUT /account/marketing` | `set_marketing_consent(uid, granted, source, text_version)` → `get_account(uid)` | I2b |
| `GET /library` | `get_library(uid)` | I2b |
| `GET /account/export` | `export_account_data(uid)` | LGPD |
| `POST /account/delete` | `delete_account_data(uid)` → Auth admin `DELETE /auth/v1/admin/users/{uid}` (só com `deleted`) | LGPD |
| `POST /checkout` | `create_order_from_cart(uid, livemode, cart_version, terms_version, terms_accepted)` → Stripe Customer, se faltar ou se a Stripe disser que foi apagado → `set_stripe_customer(uid, customer_id[, replaces])` → Checkout Session do formulário embutido → `attach_checkout_session(order_id, session_id, expires_at)` | I3 |
| `GET /order-status` | Stripe lê a sessão → `fulfill_order` ou `set_order_status`, se preciso → `get_order_status(order_id, uid)` | I3 |
| `POST /download-url` | `resolve_download(uid, file_id)` → assina no B2 | I4 |
| `GET /d/{token}` | `resolve_delivery(entitlement_id, game_id)` → assina no B2 | I4 |
| `GET /free-games` | `list_free_games()` | Gratuitos (2026-10-20) |
| `POST /free-download` | `resolve_free_download(user_id, file_id)` → assina no B2 | Gratuitos (2026-10-20) |
| `GET /admin/metrics` | `get_admin_metrics(uid, days, livemode)`, `admin_marketing_metrics` e `admin_usage_metrics(uid, days)` | Painel (2026-10-21) |
| `GET /admin/blog/posts` | `admin_list_blog_posts(uid)` | Blog (2026-10-23) |
| `POST /admin/blog/posts` · `PUT /admin/blog/posts/{id}` | `admin_save_blog_post(uid, id, post, expected_updated_at)` | Blog (2026-10-23) |
| `GET /admin/blog/posts/{id}` · `DELETE /admin/blog/posts/{id}` | `admin_get_blog_post(uid, id)` · `admin_delete_blog_post(uid, id)` | Blog (2026-10-23) |
| `POST /admin/blog/images` | `admin_register_blog_image(uid, path)` → grava no bucket público do blog | Blog (2026-10-23) |
| `GET /admin/blog/images` | `admin_blog_image_usage(uid)` → lista o bucket público do blog | Blog, galeria (2026-10-23) |
| `DELETE /admin/blog/images` | `admin_delete_blog_image(uid, path)` → apaga do bucket público do blog | Blog, galeria (2026-10-23) |
| `GET /admin/users` · `GET /admin/users/{id}` | `admin_list_users(uid, q, filter, offset)` · `admin_get_user(uid, target)` | Usuários (2026-10-23) |
| `POST /admin/users/{id}/gifts` | `admin_gift_products(uid, target, product_codes, reason, notify, livemode)` → e-mail do presente | Usuários (2026-10-23) |
| `POST /admin/users/{id}/admin` · `GET /admin/follow-up` | `admin_set_admin(uid, target, admin, reason)` · `admin_follow_up(uid)` | Usuários, equipe e acompanhamento (2026-10-23) |
| `POST …/entitlements/{entitlement}/revoke` · `POST …/orders/{order}/resend` · `POST …/newsletter/off` | `admin_revoke_entitlement` · `admin_resend_delivery` → e-mail · `admin_newsletter_off` | Usuários (2026-10-23) |
| `POST /admin/users/{id}/block` · `POST …/unblock` | `admin_check_user_block` → Auth admin `PUT /auth/v1/admin/users/{id}` (`ban_duration`) → `admin_log_user_block` | Usuários (2026-10-23) |
| `GET /admin/users/{id}/export` · `POST /admin/users/{id}/delete` | `admin_export_user` · `admin_delete_user` → Auth admin `DELETE /auth/v1/admin/users/{id}` | Usuários (2026-10-23) |
| `GET /blog/posts` · `GET /blog/version` | `list_published_blog_posts()` · `get_blog_version()` | Blog (2026-10-23) |
| `POST /email/unsubscribe` | `unsubscribe(user_id, 'unsubscribe_link')` | I5 |
| `stripe-webhook` | `fulfill_order` ou `set_order_status` (seção 9) | I3 |
| `brevo-webhook` | `record_email_event(...)` | I5 |
| `email-dispatch` | `claim_email_batch(limit, outbox_id)` → Brevo → `mark_email_result(id, sent \| failed \| rejected, ...)` | I4 |
| Agenda (`pg_cron`, só SQL) | `private.enqueue_followups()` e chamada ao `email-dispatch` | I5 |
| Agenda diária (`pg_cron`, só SQL) | `private.purge_email_outbox()`: apaga da fila o que saiu há mais de 90 dias | LGPD |

Saem da v0.2: `claim_orders`, `create_order` e o vínculo por e-mail.

## 6. Rotas da função `api`

| Método e rota | Acesso | Incremento | Estado |
| --- | --- | --- | --- |
| `GET /catalog` | Pública | I2b | Implementada |
| `GET /cart` · `POST /cart/items` · `DELETE /cart/items/{code}` | Sessão | I2b | Implementada |
| `POST /cart/quote` | Pública | Sacola sem login | Implementada |
| `POST /cart/merge` | Sessão | Sacola sem login | Implementada |
| `GET /account` · `PUT /account/marketing` | Sessão | I2b | Implementada |
| `GET /library` | Sessão | I2b | Implementada |
| `GET /account/export` · `POST /account/delete` | Sessão | LGPD | Implementada |
| `POST /checkout` · `GET /order-status` | Sessão | I3 | Implementada |
| `POST /download-url` | Sessão | I4 | Planejada |
| `GET /d/{token}` | Token HMAC | I4 | Planejada |
| `GET /free-games` | Pública | Gratuitos | Implementada |
| `POST /free-download` | Sessão + aceite de e-mails registrado alguma vez | Gratuitos | Implementada |
| `GET /admin/metrics` | Sessão de admin (`app_metadata.admin`) com segundo fator (`aal2`) | Admin | Implementada |
| `GET /admin/users` · `GET /admin/users/{id}` e as ações em `/admin/users/{id}/…` (6.14) | Sessão de admin com segundo fator (`aal2`) | Usuários | Implementada |
| `GET` e `POST /admin/blog/posts` · `GET`, `PUT` e `DELETE /admin/blog/posts/{id}` · `GET`, `POST` e `DELETE /admin/blog/images` | Sessão de admin com segundo fator (`aal2`) | Blog | Implementada |
| `GET /blog/posts` · `GET /blog/version` | Pública (só o que está publicado) | Blog | Implementada |
| `GET` e `POST /email/unsubscribe` | Token HMAC | I5 | Planejada |
| `POST /csp-report` | Pública (o navegador, pelo CSP do site) | Segurança | Implementada |

Rota ainda não implementada responde `404 NOT_FOUND`.

### 6.1 `GET /catalog`

Produtos à venda (`get_catalog()`: produtos ativos e vendáveis, com jogos). O preço é o do Price da Stripe de cada produto (`stripe_price_id`). Desde 2026-10-22 ele fica guardado no banco (`get_stripe_prices` e `remember_stripe_prices`, data-contract 6.13): a rota lê do banco numa chamada só e consulta a Stripe (`GET /v1/prices/{id}`, `Stripe-Version: 2026-03-25.dahlia`) só para o Price que falta, que passa a ficar guardado. O guardado há mais de uma hora é conferido de novo em segundo plano, porque só o "ativo" muda (o valor de um Price nunca muda). A instância ainda guarda em memória por 5 minutos. Vale para o catálogo, as rotas da sacola e o "completar a coleção" do checkout. Antes, cada chamada ia à Stripe e custava ~0,6 s. O `stripe_price_id` não é exposto. Sem `STRIPE_SECRET_KEY` (local sem Stripe), com Price inativo ou inexistente, o preço sai `null`; em falha transitória, vale o último valor em cache.

`200`, com `Cache-Control: public, max-age=60`:

```json
{
  "products": [
    {
      "code": "P001",
      "kind": "bundle",
      "name": "<nome>",
      "games": [{ "code": "J001", "name": "<jogo>" }],
      "price": { "unit_amount": 0, "currency": "brl" },
      "list_price": { "amount": 3990, "label": "Preço de lançamento" }
    }
  ]
}
```

- `list_price` (2026-10-24): o preço de tabela riscado da promoção, definido no admin (6.17), ou `null`. A loja mostra riscado só em real e só quando é maior que `price`.
- `sales_open_at` (2026-10-27, prévia do lançamento): a hora da abertura das vendas em ISO 8601 (UTC) enquanto ela não chega (`get_sales_opening`), depois `null`. Até lá o site mostra o cronômetro na barrinha e a data no lugar da compra, e abre sozinho na hora. O build a guarda no retrato (`salesOpenAt`), e ela entra em `get_catalog_version`: na hora marcada o vigia reconstrói os sites.
- `games` vem na ordem do pacote no banco. No build da VPS, o `scripts/catalog-export.mjs` grava esta resposta em `src/content/catalog-snapshot.ts` (o preço do dado do Google, a lista de jogos do pacote e o valor dos eventos) e a versão em `/catalogo/versao.json`.

- `kind` é `bundle` ou `single`. Hoje só existe o P001 **[D1]**; o site não inventa produto nem preço.
- `price: null` quando não há preço lido da Stripe: sem chave (local), Price inexistente ou placeholder (seed), ou Stripe fora do ar sem cache. O site mostra "preço indisponível". **Adicionar ao carrinho continua permitido**: quem decide se o produto é vendável é o banco (`cart_add`), não o preço. **Finalizar compra fica desativado** enquanto o carrinho não tiver item a pagar, tiver `subtotal: null` ou aviso `PRICE_UNAVAILABLE` ou `PRODUCT_UNAVAILABLE`. Item riscado (`already_owned`, `included`) não impede: fica fora do pedido.

### 6.2 Carrinho: `GET /cart`, `POST /cart/items`, `DELETE /cart/items/{code}`

Um carrinho por usuário, guardado no banco (vale entre aparelhos). Desde 2026-10-22 o login só é pedido no pagamento: quem ainda não entrou guarda a sacola no navegador e a cota em `POST /cart/quote`; ao entrar, `POST /cart/merge` junta essa sacola à da conta (6.2.1).

- `POST /cart/items`, corpo `{ "product_code": "P001" }` → `cart_add`. Produto que o usuário já tem entra e aparece riscado (`status: already_owned`):

  | `outcome` | HTTP |
  | --- | --- |
  | `added` ou `noop` (já estava no carrinho) | `200` com o carrinho |
  | `product_unavailable` (inexistente ou não vendável) | `409 PRODUCT_UNAVAILABLE` |

- `DELETE /cart/items/{code}` → `cart_remove` (`removed` ou `noop`): sempre `200` com o carrinho.
- As três rotas respondem o carrinho atualizado (`get_cart`, sem os ids de Price da Stripe):

```json
{
  "version": 3,
  "items": [
    {
      "code": "P001",
      "kind": "bundle",
      "name": "<nome>",
      "games": [{ "code": "J001", "name": "<jogo>" }, { "code": "J002", "name": "<jogo>" }],
      "price": { "unit_amount": 2990, "currency": "brl" },
      "charge": { "unit_amount": 1692, "currency": "brl" },
      "status": "ok",
      "available": true,
      "owned_games": ["J001"],
      "included_in": [],
      "shared_with": ["J002"]
    },
    {
      "code": "J002",
      "kind": "single",
      "price": { "unit_amount": 1290, "currency": "brl" },
      "charge": null,
      "status": "included",
      "available": false,
      "included_in": ["P001"]
    }
  ],
  "subtotal": { "amount": 1692, "currency": "brl" },
  "warnings": [{ "code": "COMPLETE_THE_SET", "product_code": "P001" }, { "code": "INCLUDED_IN_BUNDLE", "product_code": "J002" }],
  "owned_products": ["J001"]
}
```

| Campo ou aviso | Significado |
| --- | --- |
| `version` | Sobe a cada mudança e na compra. O checkout envia a versão que o usuário viu. Sem carrinho: `0` e `items: []` |
| `status` | `ok` (vai para o pedido), `unavailable` (deixou de ser vendável), `already_owned` (o usuário já tem todos os jogos) ou `included` (avulso cujos jogos estão num pacote `ok` do mesmo carrinho). `available` é `status = ok` |
| `price` | Preço de tabela, lido do Price da Stripe |
| `charge` | O que será cobrado; só nos itens `ok`. Menor que `price` no pacote de "completar a coleção" |
| `owned_games` | Jogos do produto que o usuário já tem. Num pacote `ok`, ativam o "completar a coleção" |
| `included_in` | Pacotes do carrinho que já trazem os jogos deste avulso |
| `shared_with` | Outros produtos do carrinho com jogos em comum |
| `subtotal` | Soma dos `charge`; `null` sem item a pagar ou se faltar preço de algum item `ok` |
| `owned_products` | Produtos vendáveis que o usuário já tem por inteiro (a página do produto troca o botão por "Já está no seu Portal") |
| Aviso `COMPLETE_THE_SET` | Pacote `ok` com jogos já possuídos |
| Aviso `INCLUDED_IN_BUNDLE` / `ALREADY_OWNED` / `PRODUCT_UNAVAILABLE` | Item com esse `status` (os dois primeiros só informam; o último impede o checkout) |
| Aviso `PARTIAL_OVERLAP` | Item `ok` que divide jogos com outro item `ok` (dois pacotes) |
| Aviso `PRICE_UNAVAILABLE` | Preço de item `ok` não lido da Stripe |

**Completar a coleção (2026-10-22, decisão do responsável; referência: Steam).** O pacote com jogos que o usuário já tem cobra só os que faltam, com o mesmo desconto do pacote sobre os avulsos: `charge = round(preço do pacote × soma dos avulsos que faltam ÷ soma dos avulsos de todos os jogos)`. Sem o preço avulso de algum jogo, o desconto é proporcional ao número de jogos. Exemplo: pacote de R$ 29,90 com avulsos de R$ 9,90, R$ 9,90 e R$ 12,90; quem já tem um de R$ 9,90 paga R$ 20,85.

`POST /cart/items` também responde `400 INVALID_REQUEST` para código fora do formato.

### 6.2.1 Sacola sem login: `POST /cart/quote` e `POST /cart/merge`

- `POST /cart/quote` (pública), corpo `{ "product_codes": ["P001", "J002"] }`, até 20 códigos no formato de `products.code` (senão `400 INVALID_REQUEST`; repetidos contam uma vez). Responde o mesmo formato de `GET /cart`, com `version: 0`, sem `owned_products` e com `unknown`: os códigos que não existem, que o site tira da sacola guardada. Ninguém possui nada, então `already_owned` não aparece.
- `POST /cart/merge` (sessão), mesmo corpo: chama `cart_add` para cada código, na ordem, e responde a sacola da conta. Produto que deixou de ser vendável fica de fora sem erro. O site chama ao detectar a sessão com sacola guardada e apaga a guardada quando dá certo.

### 6.3 `GET /account` e `PUT /account/marketing`

`GET /account` → `get_account(uid)`:

```json
{
  "email": "<e-mail da conta>",
  "marketing": { "opted_in": false, "updated_at": null, "text_version": null, "prompted_at": null },
  "orders": [
    {
      "ref": "A1B2C3D4",
      "created_at": "2026-10-08T12:00:00Z",
      "paid_at": "2026-10-08T12:01:00Z",
      "status": "paid",
      "amount_subtotal": 0,
      "amount_discount": 0,
      "amount_total": 0,
      "promotion_code": null,
      "currency": "brl",
      "items": [{ "code": "P001", "name": "<nome>", "unit_amount": 0, "currency": "brl" }]
    }
  ]
}
```

- `status` pode ser `pending_payment`, `paid`, `failed`, `disputed`, `dispute_lost` ou `refunded`; `open` e `expired` não aparecem.
- Sem comprovante no P2: o banco não guarda URL.

`PUT /account/marketing`, corpo `{ "granted": true, "source": "account", "text_version": "mkt-2026-10" }` → `set_marketing_consent(uid, granted, source, text_version)`. Responde `200 { "marketing": { ... } }`.

- `source` aceito do site: `account`, `signup_prompt` ou `free_games` (página Gratuitos). `signup_prompt` e `free_games` só concedem; para retirar, `source` é `account`. As demais origens (`unsubscribe_link`, `brevo_webhook`, `support`) são só do servidor. Fora dessas regras, `400 INVALID_REQUEST`.
- `text_version` é obrigatório para conceder e opcional para revogar. Segue `^[A-Za-z0-9._-]{1,40}$`, o mesmo formato do banco, e é a versão do texto que a pessoa viu **[D6]**.
- Consentimento é sempre opcional: comprar não depende dele. Cada mudança vira uma linha no histórico; repetir o mesmo estado não cria linha (`noop`).

**`marketing.prompted_at`:** a primeira vez que a pessoa concedeu pelo convite (`source: "signup_prompt"`); `null` antes disso. O convite pós-login do site saiu em 2026-10-10 e a rota de dispensa (`POST /account/marketing/prompt`) saiu em 2026-10-24; o campo continua na conta e na exportação. Ver o convite nunca foi consentimento: o histórico registra só as ações explícitas de conceder ou retirar.

### 6.4 `GET /library`

Meus jogos, organizado **por jogo** → `get_library(uid)`:

```json
{
  "games": [
    {
      "code": "J001",
      "name": "<jogo>",
      "acquired_at": "2026-10-08T12:01:00Z",
      "products": [{ "code": "P001", "name": "<nome>" }],
      "files": [{ "id": "<uuid>", "kind": "pdf", "version": "1.0", "size_bytes": 0 }]
    }
  ],
  "pending": [{ "ref": "A1B2C3D4", "created_at": "2026-10-08T12:00:00Z", "products": [{ "code": "P001", "name": "<nome>" }] }]
}
```

- Só direitos ativos; o acesso não expira. `products` são os produtos de origem; um jogo aparece uma vez, mesmo vindo de mais de um produto.
- `files: []` significa jogo temporariamente indisponível.
- `pending` lista pedidos `pending_payment`. `{ "games": [], "pending": [] }` é o estado sem compras.
- Nunca traz chave do B2 nem URL. O ZIP completo fica para depois.

### 6.5 `POST /checkout`

O pagamento usa o **formulário embutido** configurado pelo responsável no Checkout Studio da Stripe (nota "Stripe Checkout Studio", fonte autorizada dos parâmetros). A rota cria a Checkout Session e devolve o `client_secret`; o site monta o formulário na própria página de checkout.

Corpo: `{ "cart_version": 3, "terms_version": "termos-2026-10", "terms_accepted"?: true, "referral"?: {…} }`.

O aceite dos termos é colhido **na nossa página**, na caixa "Li e aceito" logo acima do formulário (o formulário embutido não aceita `consent_collection`). Desde 2026-10-24 (responsável) o formulário abre com a página, apagado e travado (`inert`) até a pessoa marcar a caixa: o pedido nasce aqui sem o momento do aceite e `POST /checkout/terms` o grava antes de o site destravar o formulário. `terms_accepted: true` (o site anterior, que só chamava depois do aceite) ainda grava o aceite aqui.

0. **Validação:**
   - antes da abertura das vendas (`get_sales_opening` não é `null`) → `409 SALES_NOT_OPEN` com `details.sales_open_at`, sem pedido;
   - `terms_version` diferente de `TERMS_VERSION` → `409 TERMS_CHANGED`;
   - `cart_version` inteiro ≥ 0, senão `400 INVALID_REQUEST`.
1. `create_order_from_cart(uid, livemode, cart_version, terms_version, terms_accepted)` confere a versão e os itens. Cria o pedido `open` com `order_items` só dos itens `ok` (o riscado fica de fora) e grava `terms_version` (e `terms_accepted_at` só com `terms_accepted: true`). Reaproveita o pedido `open` da mesma versão do carrinho e dos termos, se nenhum jogo foi ganho ou perdido desde então (`reused`). Devolve `outcome`, `order_id`, itens (`product_code`, `stripe_price_id`, `kind`, `games` com o `single_price_id` de cada jogo e `owned_games`), e-mail da conta, `stripe_customer_id` e `detail`.

   | `outcome` | HTTP |
   | --- | --- |
   | `ok` | segue |
   | `cart_empty` | `409 CART_EMPTY` |
   | `cart_changed` | `409 CART_CHANGED`, com `details.cart_version` |
   | `product_unavailable` | `409 PRODUCT_UNAVAILABLE`, com `details.product_codes` |
   | `already_owned` | `409 ALREADY_OWNED`, com `details.product_codes`: nada a pagar (tudo já é do usuário, comprado em outra aba por exemplo, ou já está num pacote da sacola) |

2. **Customer.** Sem `stripe_customer_id`, cria o Customer com o e-mail da conta, `metadata.user_id` e idempotency key `customer:<user_id>`, e grava com `set_stripe_customer(uid, customer_id)`. A RPC devolve o id vigente; se outra requisição gravou antes, vale o dela. Com o Customer guardado, atualiza o e-mail nele; se a Stripe responder `resource_missing` (Customer apagado no painel), cria outro com a chave `customer:<user_id>:<id apagado>` e troca com `set_stripe_customer(uid, customer_id, replaces)`, que só troca se o guardado ainda for o apagado.
3. **Checkout Session** (`checkout.sessions.create`, idempotency key `checkout:<order_id>`):

   | Parâmetro | Valor | Origem |
   | --- | --- | --- |
   | `ui_mode` | `'form'` (SDK `stripe` ≥ 21.0.0) ou `'custom'` (SDK menor) | Studio (seção 6.5.1) |
   | `billing_address_collection` | `'auto'` | Studio, fixo |
   | `phone_number_collection` | `{ enabled: false }` | Studio, fixo |
   | `automatic_tax` | `{ enabled: false }` | Studio, fixo |
   | `submit_type` | `'auto'` | Studio, fixo |
   | `integration_identifier` | `'custom_embedded_web_0001'` | Studio, fixo |
   | `mode` | `'payment'` (compra única) | Studio (exemplo) |
   | `line_items` | Uma por item do pedido, na ordem de `position`: `{ price: stripe_price_id, quantity: 1 }`; o pacote de "completar a coleção" vai com `{ price_data: { currency, unit_amount: charge, product }, quantity: 1 }`, no mesmo produto da Stripe do Price de tabela | Pedido |
   | `client_reference_id` | `order_id` | Nossa arquitetura |
   | `customer` | `stripe_customer_id` | Nossa arquitetura |
   | `metadata` | `{ order_id, terms_version }` e, por pacote cobrado com `price_data`, `base_price_<produto da Stripe>` = o Price de tabela (a liberação manda esse Price ao banco, que confere os itens pelo `stripe_price_id`) | Nossa arquitetura |
   | `allow_promotion_codes` | `true`: o cliente digita o cupom no formulário | Nossa decisão (cupons) |
   | `payment_intent_data.metadata` | `{ order_id }`, para achar o pedido nas contestações; se faltar, a rota busca a sessão pelo `payment_intent` | Nossa arquitetura |
   | `locale` | `'pt-BR'` | Nossa arquitetura |
   | `return_url` | `SITE_URL/pedido/confirmacao?session_id={CHECKOUT_SESSION_ID}` | Nossa arquitetura |

   - `payment_method_collection` **não entra**: o Studio só o usa em `mode: subscription`.
   - Não há `consent_collection`, `custom_text`, `success_url` nem `cancel_url`: no formulário embutido não existem; quem desiste fica na nossa página.
   - Os métodos de pagamento seguem a conta Stripe **[D9]**.
4. `attach_checkout_session(order_id, session_id, expires_at)`. Se falhar, só vai para o log: webhook e confirmação acham o pedido pelo `client_reference_id`.

`200 { "client_secret": "<client_secret da sessão>", "order_id": "<uuid>" }`.

- O `client_secret` permite concluir aquele pagamento: nunca vai para log nem URL, e a resposta é `no-store`.
- Pedido reaproveitado devolve a mesma sessão (mesma chave de idempotência), dentro da janela de 24 h da Stripe.
- A sessão expira no prazo padrão da Stripe **[D9]**. Ao expirar, o webhook marca o pedido `expired` e o funil registra `checkout_expired`.

Erros: `400 INVALID_REQUEST`, `409 SALES_NOT_OPEN`, `409 TERMS_CHANGED`, os da tabela do passo 1, `401`, `403 EMAIL_NOT_CONFIRMED` e `502 PAYMENT_PROVIDER_ERROR`.

**`POST /checkout/terms { order_id, terms_version }`** (sessão) → `200 { "accepted": true }`: a pessoa marcou o "Li e aceito". `accept_order_terms` grava `terms_accepted_at` no pedido de compra `open` dela, uma vez (marcar de novo não muda o momento). `order_id` que não é uuid → `400`; versão diferente de `TERMS_VERSION` ou do pedido → `409 TERMS_CHANGED`; pedido de outra pessoa ou que não está aberto → `404 NOT_FOUND`. Uma compra sem o aceite gravado só acontece se alguém destravar o formulário à mão; o pagamento é liberado mesmo assim.

**Verificado na API de teste (2026-10-08):** `ui_mode: 'form'` com os parâmetros do Studio, `allow_promotion_codes: true` e `payment_intent_data.metadata` criam a sessão juntos, com `client_secret` e validade de 24 h.

**Cupons:**

- O cliente aplica o código no formulário embutido (`checkout.applyPromotionCode` e `checkout.removePromotionCode`), e o total se atualiza antes de confirmar. Os cupons são criados pelo responsável na Stripe (Coupon e Promotion Code).
- O valor que vale é sempre o cobrado pela Stripe. Na liberação, o pedido grava `amount_subtotal` (preço cheio), `amount_discount` (`total_details.amount_discount`), `amount_total` e o texto do código promocional. Os itens guardam o preço unitário cheio.
- `/account` mostra esses campos por pedido. O site não exibe preço riscado fictício: o riscado da sacola é real (preço de tabela do item que não é cobrado, ou do pacote que cobra só o que falta).
- No pacote de "completar a coleção", o item do pedido guarda o valor cobrado (`charge`), não o de tabela.
- Price de tabela do pacote ou dos avulsos não lido na Stripe: `502 PAYMENT_PROVIDER_ERROR`, antes de criar a sessão.
- `payment_status = no_payment_required` (cupom de 100%) só é aceito pelo banco com total 0 e desconto maior que zero.

### 6.5.1 Stripe: versão da API, SDK e risco do preview

- **Cliente no servidor:** `new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2026-03-25.dahlia; custom_checkout_payment_form_preview=v1' })`.
- **SDK fixo:** `npm:stripe@22.0.2` no `supabase/functions/deno.json`, cuja API padrão é a `2026-03-25.dahlia` (registrado em `docs/stripe.md`). Nunca faixa de versão. Cliente HTTP por `fetch`; criptografia do webhook pelo Web Crypto.
- **Regra do `ui_mode`:** `'form'` se o SDK `stripe` for ≥ 21.0.0; `'custom'` se for menor. A regra fica numa constante ao lado da versão fixada.
- **Webhook:** o endpoint de teste é criado com a versão base `2026-03-25.dahlia`, para o formato dos eventos bater com o SDK. Se o sufixo de preview vale para endpoint, fica a confirmar no I3. A assinatura é verificada com `constructEventAsync` e o provedor de criptografia do Web Crypto (Deno).
- **Risco:** `custom_checkout_payment_form_preview=v1` é API em **preview (beta)**. Pode mudar ou sair sem a garantia de compatibilidade das versões estáveis, e pode depender de a conta estar no programa. Mitigações:
  - versão e SDK fixos, e teste do fluxo a cada troca;
  - o banco e o webhook não dependem do modo do formulário;
  - **plano B:** voltar ao Checkout hospedado (`checkout_url` e redirecionamento), mudando só esta rota e a página de checkout. Pedido, aceite, webhook e entrega ficam iguais.

### 6.5.2 Impacto no site: formulário e CSP (Aquarela e Costura)

**Frontend (Aquarela):**

- Stripe.js carregado direto de `https://js.stripe.com/dahlia/stripe.js`, nunca empacotado nem hospedado por nós.
- `Stripe(VITE_STRIPE_PUBLISHABLE_KEY, { betas: ['custom_checkout_payment_form_1'] })` → `initCheckoutFormSdk({ clientSecret, appearance })` com a aparência da nota → `createForm({ layout: 'expanded' })` montado em `#checkout-form`. O evento `confirm` chama `actions.confirm({ formConfirmEvent })` depois de `loadActions()`.
- Ordem na página: itens e total do carrinho, aviso de sem reembolso, caixa obrigatória dos termos e, só depois do aceite, o `POST /checkout` e a montagem do formulário.

**CSP (Costura, no nginx da imagem do site),** conforme o guia de segurança da Stripe para Stripe.js:

| Diretiva | Origens a liberar |
| --- | --- |
| `script-src` | `https://js.stripe.com` `https://*.js.stripe.com` |
| `frame-src` | `https://js.stripe.com` `https://*.js.stripe.com` `https://hooks.stripe.com` (3D Secure e redirecionamentos) |
| `connect-src` | `https://api.stripe.com`, além da URL do Supabase do ambiente (Auth e funções) |
| `img-src` | `https://*.stripe.com` |
| Se a conta tiver Link | `frame-src` e `connect-src`: `https://link.com` `https://*.link.com`; `img-src`: `https://*.link.com` **[D9]** |

- **O que vale hoje** (2026-10-26, seção 6.19): o `nginx.conf` restringe só `script-src` (o nonce de cada resposta com `'strict-dynamic'`: o Stripe.js e o GA entram pelos scripts do site), `object-src`, `base-uri`, `frame-ancestors` e `form-action`. `frame-src`, `connect-src` e `img-src` ficam livres; a tabela acima é o que liberar se um dia forem restringidas.
- `https://maps.googleapis.com` só é necessário com o Address Element e chave própria do Google Maps. Não usamos.
- Não ativar isolamento de origem cruzada (`Cross-Origin-Embedder-Policy: require-corp` com `Cross-Origin-Opener-Policy: same-origin`). A Stripe não oferece suporte.
- Com Trusted Types, permitir scripts dinâmicos de `js.stripe.com` e `*.js.stripe.com`.
- A página de checkout é servida só por HTTPS (subdomínio de teste com TLS).

### 6.6 `GET /order-status?session_id=<cs_...>`

Sessão obrigatória. Depois do `confirm` no formulário embutido, a Stripe leva ao `return_url` no mesmo navegador. Sem sessão, o site leva a `/entrar` e volta.

1. Lê a sessão na Stripe, com `line_items`, e pega o `order_id` do `client_reference_id`.
2. Se a Stripe pede mudança e o pedido não chegou lá, roda a liberação idempotente do webhook com `p_source = 'return_page'`.
3. `get_order_status(order_id, uid)` devolve `outcome`, `status`, itens e `relation` (`owner` ou `other`).

`200 { "state": "paid", "next": "open_library", "items": [{ "code": "P001", "name": "<nome>" }] }`

| Pedido / sessão | `state` |
| --- | --- |
| `paid` | `paid` |
| Sessão paga e liberação com erro transitório | `processing` |
| `pending_payment` | `pending_payment` |
| `failed`, ou sessão ainda `open` | `failed` |
| `expired` | `expired` |
| Sessão ou pedido inexistente; `disputed`, `dispute_lost` ou `refunded` | `not_found` (orienta Ajuda) |

- `next` (só com `paid`): `open_library` para o dono; `other_account` para outra conta. Com `other`, a resposta não traz `items`.
- Com `paid`, o site informa que os jogos estão em Meus jogos e foram enviados ao e-mail da conta.

Erros: `400 INVALID_REQUEST`, `401`, `403 EMAIL_NOT_CONFIRMED` e `502 PAYMENT_PROVIDER_ERROR`.

### 6.7 `POST /download-url`

Corpo `{ "file_id": "<uuid>" }` → `resolve_download(uid, file_id)`. Com `ok`, assina a URL do B2, válida por 300 s; a RPC registra `download_event`, sem IP, na emissão da URL. Sem sessão → `401`; e-mail não confirmado → `403 EMAIL_NOT_CONFIRMED`; `file_id` inválido → `400`.

**URL do B2:** SigV4 por consulta, estilo virtual-hosted (`https://<bucket>.<endpoint>/<object_key>`), só o header `host` assinado, chave **só leitura**, bucket da configuração (`B2_BUCKET`; o banco fornece o `object_key`). A URL leva `response-content-disposition=attachment` (nome do banco, RFC 6266) e `response-content-type`: o B2 responde sempre como anexo PDF, independente do metadado do upload. O site gera uma URL nova a cada clique e não a guarda.

`200 { "url": "<url assinada>", "expires_at": "...", "filename": "<arquivo>" }`

| `outcome` | HTTP |
| --- | --- |
| `ok` | `200` |
| `not_found` (inexistente, grátis, ou retirado com versão nova publicada) | `404 FILE_NOT_FOUND`; o site recarrega Meus jogos |
| `not_entitled` (sem direito ou direito revogado) | `403 NOT_ENTITLED` |
| `unavailable` (direito válido, sem arquivo publicado) | `503 FILE_UNAVAILABLE` |

### 6.8 `GET /d/{token}`: link do e-mail de entrega

Pública, autenticada pelo token (seção 7). Um botão por jogo no e-mail de entrega.

1. Confere a assinatura, o propósito `d` e a validade. Token adulterado ou malformado → `401 INVALID_TOKEN` (JSON da seção 4), sem consultar o banco. Token vencido → `302` para `SITE_URL/meus-jogos?link=expirado`.
2. `resolve_delivery(entitlement_id, game_id)` confere o direito `active` **na hora** e escolhe a versão publicada vigente do jogo. Também registra `download_event`.
3. `ok` → `302` para a URL assinada do B2 (300 s). Revogado, inexistente ou sem arquivo → `302` para `SITE_URL/meus-jogos?link=indisponivel`.

- Respostas com `Cache-Control: no-store` e `Referrer-Policy: no-referrer`. Só `GET`; fora o `401`, não há resposta JSON. O redirecionamento leva só `link=`, sem o jogo.
- Quem tem o link baixa sem login enquanto o direito estiver ativo e o link valer, como um anexo encaminhado. A validade padrão é de 30 dias **[D4]**.

### 6.9 `GET /free-games` e `POST /free-download`

Gratuitos (responsável, 2026-10-20): mais de um jogo grátis publicado; para baixar, conta confirmada e o aceite de e-mails registrado **alguma vez**. Quem retira o aceite depois continua baixando.

- `GET /free-games` (pública) → `list_free_games()`: `200 { "games": [] }` enquanto não houver gratuito publicado, ou `200 { "games": [{ "code": "F001", "name": "…", "file": { "id": "<uuid>", "version": "1.0", "size_bytes": 123 } }] }`, em ordem de código. Sem bucket, chave nem nome do arquivo.
- `POST /free-download` (sessão) com `{ "file_id": "<uuid>" }` → `resolve_free_download(user_id, file_id)`: `ok` → `200 { "url", "expires_at" }` (300 s, anexo como em 6.7); `locked` (nunca aceitou os e-mails) → `403 FREE_GAMES_LOCKED`; `not_found`, inclusive id de arquivo pago, → `404 FILE_NOT_FOUND`. Sem sessão → `401`; e-mail não confirmado → como nas outras rotas de conta; corpo inválido → `400`.
- O site libera pelo `PUT /account/marketing` com `source: "free_games"` (6.6) e lê `free_games_unlocked` em `GET /account`.

 As condições do jogo gratuito e a eventual exigência de login estão pendentes **[D12]**. Rota pública que grava no banco: limite de abuso pendente (seção 12).

### 6.10 Descadastro: `GET` e `POST /email/unsubscribe`

Autenticado pelo token de propósito `u` (seção 7), presente em todo e-mail de marketing. Segue o descadastro em 1 clique (RFC 8058):

- Headers do e-mail: `List-Unsubscribe: <API/email/unsubscribe?token=...>` e `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- `POST`, com o token na query (é como o provedor de e-mail chama, com o corpo `List-Unsubscribe=One-Click`), em JSON `{ "token": "..." }` ou em formulário `token=...`. Chama `unsubscribe(user_id, 'unsubscribe_link')`, com efeito imediato e idempotente: revoga o opt-in e cancela o marketing na fila. Responde `200 { "status": "unsubscribed" }` também na repetição; token ausente, adulterado ou de outro propósito → `400 INVALID_TOKEN`. Pública e sem sessão; o `POST` do provedor chega sem `Origin` e passa pelo CORS.
- `GET` não muda nada (scanners de e-mail abrem links): faz `302` para `SITE_URL/email/preferencias?token=...`. Essa página pública confirma e chama o `POST`.
- O link no rodapé dos e-mails de marketing aponta para `/email/preferencias?token=...` (página do site, a construir pela Aquarela: mostra o pedido de descadastro, chama o `POST` com `{ "token" }` e confirma). O rodapé também leva a Minha conta (`/conta`).
- Transacionais (entrega, códigos do Auth) não dependem de consentimento e não levam descadastro.

### 6.11 Direitos do titular: `GET /account/export` e `POST /account/delete`

LGPD, art. 18 (Política de privacidade › Seus direitos). Sessão obrigatória; a pessoa resolve sozinha em Minha conta, sem e-mail ao atendimento. Decisão de retenção e anonimização: `docs/data-contract.md` D-28.

`GET /account/export` → `export_account_data(uid)`. Responde `200` com o JSON da cópia; o site salva o arquivo com o nome dele (a rota não manda `Content-Disposition`: o site chama por CORS e não leria o header). Sem ids internos (pedidos pelo `ref` de 8 caracteres):

```json
{
  "generated_at": "2026-10-19T12:00:00Z",
  "account": { "email": "…", "created_at": "…", "email_confirmed_at": "…", "last_sign_in_at": "…", "sign_in_methods": ["email"], "name": null, "avatar_url": null, "has_password": false, "stripe_customer_id": null },
  "marketing": { "opted_in": false, "opted_in_at": null, "prompted_at": null },
  "consents": [{ "action": "granted", "source": "account", "text_version": "mkt-2026-10-19", "email": "…", "occurred_at": "…" }],
  "cart": [{ "code": "J001", "name": "…", "added_at": "…" }],
  "orders": [{ "ref": "A1B2C3D4", "status": "paid", "email": "…", "created_at": "…", "paid_at": "…", "refunded_at": null, "amount_subtotal": 990, "amount_discount": 0, "amount_total": 990, "currency": "brl", "promotion_code": null, "terms_version": "termos-2026-10-19", "terms_accepted_at": "…", "items": [{ "code": "J001", "name": "…", "unit_amount": 990, "currency": "brl" }] }],
  "library": [{ "order_ref": "A1B2C3D4", "product": { "code": "J001", "name": "…" }, "status": "active", "granted_at": "…", "revoked_at": null, "revoke_reason": null, "games": [{ "code": "J001", "name": "…" }] }],
  "downloads": [{ "game": "J001", "file": "….pdf", "version": "1.0", "at": "…" }],
  "emails": [{ "kind": "delivery", "category": "transactional", "to": "…", "status": "sent", "created_at": "…", "sent_at": "…" }],
  "email_suppressions": [],
  "activity": [{ "type": "order_paid", "at": "…", "product": null, "order_ref": "A1B2C3D4" }]
}
```

`POST /account/delete`, corpo `{ "confirmation": "EXCLUIR" }` (sem diferença de maiúsculas; o site pede que a pessoa digite a palavra) → `delete_account_data(uid)`:

- `deleted` → a rota apaga o usuário no Auth (`DELETE /auth/v1/admin/users/{uid}`, chave secreta no `apikey`; `404` conta como feito) e responde `200 { "deleted": true }`. O site encerra a sessão local e volta ao início.
- `blocked` → `409 ACCOUNT_DELETION_BLOCKED`, `details: { "reason": "payment_pending" | "checkout_open" | "dispute_open" }`. Nada muda.
- Confirmação ausente ou diferente → `400 INVALID_REQUEST`, sem tocar no banco. `KT009` → `403 EMAIL_NOT_CONFIRMED`.
- Falha do Auth depois da RPC → `500 INTERNAL_ERROR` (log só com o status HTTP). Repetir é seguro: a RPC é idempotente e o Auth recebe a exclusão de novo.
- Depois da exclusão, um link de entrega antigo responde como direito revogado e um link de descadastro antigo responde `200` (a conta já não recebe nada).

### 6.12 Painel do administrador: `GET /admin/metrics`

Responsável, 2026-10-21: métricas da loja para quem é admin. Desde 2026-10-23 ficam no admin (admin.keytotwo.com.br, `admin/`); o `/painel` do site redireciona para lá. Toda rota `/admin/*` exige o segundo fator (TOTP) na sessão: sem `aal2` no JWT, ou com o `totp` do claim `amr` confirmado há mais de 12 horas (desde 2026-10-25: renovar a sessão mantinha o `aal2` para sempre), `403 MFA_REQUIRED` antes do banco. O admin pede o código de novo, sem perder o que estava na tela. Admin é quem tem `app_metadata.admin = true` no Auth; só o servidor grava esse campo (Auth admin ou SQL no painel do Supabase). O site lê o JWT só para mostrar o link "Painel"; quem decide é o banco, a cada chamada, então tirar o admin vale na hora.

`GET /admin/metrics?days=7|30` (sessão; sem `days`, 7) → `get_admin_metrics(uid, days, livemode)`, com `livemode` da chave da Stripe do ambiente:

```json
{
  "days": 7, "since": "2026-10-15", "until": "2026-10-21", "livemode": false,
  "sales": { "orders": 4, "revenue": 9960, "currency": "brl" },
  "accounts": 4,
  "funnel": { "cart": 10, "checkout": 6, "paid": 3 },
  "downloads": { "paid": 9, "free": 21 },
  "free_unlocks": 5,
  "newsletter": { "subscribed": 42 },
  "daily": [{ "date": "2026-10-15", "orders": 1, "revenue": 2990, "accounts": 1 }]
}
```

- O período são os últimos `days` dias do calendário de Brasília, contando hoje (`since` e `until` em `AAAA-MM-DD`); `daily` traz um dia por entrada, em ordem.
- `ok` → `200` com o JSON acima, sem e-mail nem id de pessoa. `forbidden` → `403 NOT_ADMIN`. `days` fora de 7 e 30 → `400 INVALID_REQUEST`, sem tocar no banco. Sem sessão → `401`; `KT009` → `403 EMAIL_NOT_CONFIRMED`.
- O que cada número conta está no `docs/data-contract.md`, seção 6.12.
- **Uso da infraestrutura** (2026-10-25, `usage`, de `admin_usage_metrics`): o que a loja usa do plano grátis do Supabase no mês do calendário de Brasília, para acompanhar no lugar de um limite de requisições (o Supabase não tem um simples). `{ month_start, calls_month, by_area: { public, account, admin, webhooks, schedule }, daily: [{ date, calls }] (os dias do período), peak_hour: { hour, calls } | null (a hora mais movimentada das últimas 24 horas), database_bytes, active_accounts_month }`. As chamadas são contadas pelas próprias funções: a `api` no começo de toda requisição (inclusive as recusadas), pelo caminho (`/admin/*` admin; `/internal/*` schedule; as públicas e o que não existe, public; o resto, account); `stripe-webhook` e `brevo-webhook` como webhooks; `email-dispatch` como schedule. Cada chamada soma 1 em `record_api_usage(area)`, em segundo plano, depois da resposta (`private.api_usage`, por hora e tipo). Os números oficiais da Supabase pediriam um token da conta inteira na API. O admin compara com o plano grátis: 500 mil chamadas, 500 MB de banco e 50 mil contas ativas.

### 6.13 Blog: `/admin/blog/*`, `GET /blog/posts` e `GET /blog/version`

Responsável, 2026-10-23: listar, criar e editar os posts do blog pelo admin. Os posts saem de `content/blog` e ficam no banco (`private.blog_posts`, migração `20261023120000_blog_admin.sql`); cada mudança fica em `private.admin_events` (quem, o quê, quando). O build do site na VPS lê os publicados por `GET /blog/posts` (`scripts/blog-export.mjs`) e o vigia da VPS confere `GET /blog/version` a cada 2 minutos para reconstruir o site (`docs/deploy.md`).

Post (`post` nos corpos e nas respostas; `snake_case`):

```json
{
  "id": "uuid", "slug": "jogos-para-casais", "title": "Jogos para casais", "description": "Resumo", "author": "Equipe KeyToTwo", "author_instagram": "keytotwo",
  "date": "2026-10-23", "cover": "/images/blog/2026/10/ab12cd34-capa.webp", "cover_alt": "Mesa com o jogo", "tags": ["Jogos"],
  "body": "Markdown", "status": "draft | published", "published_at": null, "created_at": "…", "updated_at": "2026-10-23T12:00:00.123456+00:00"
}
```

- **Regras** (`supabase/functions/_shared/blog-rules.ts`, as mesmas do build e do editor): título até 120; endereço `a-z0-9` com hífens, até 80; data `AAAA-MM-DD` válida; capa só em `/images/blog/...` e com descrição; até 10 temas sem repetir; texto até 100 mil caracteres. Rascunho guarda o que estiver pronto. Publicar exige resumo, autor e texto, imagens do texto em `/images/blog/...` com descrição e nenhuma marcação `PENDENTE` (a trava do build live). Falhou: `400 INVALID_REQUEST` com `details.problems` (`[{ field, message }]`, na ordem do editor) e a primeira mensagem em `message`, sem tocar no banco.
- Campos do Google (2026-10-23, migração `20261023230000_blog_seo.sql`): `seo_title` (até 80) e `seo_description` (até 200), opcionais. Em branco, o site usa o título e o resumo no `<title>`, na descrição e no compartilhamento; o admin recomenda até 60 e 155 caracteres. Admin antigo, que não manda os campos, grava vazio. A trava `PENDENTE` vale para eles também.
- Instagram de quem escreveu (2026-10-29, migração `20261029120000_blog_instagram_autor.sql`): `author_instagram`, opcional, o nome de usuário sem o @ (até 30 letras minúsculas, números, pontos ou sublinhados). A API aceita `@Fulana` e o link do perfil (`instagram.com/fulana/…`) e grava `fulana`; outra coisa vira um problema do campo `author_instagram`. Sem o campo (admin antigo), grava vazio. No site, aparece ao lado do nome ("Por Fulana · @fulana", com link para o perfil) e vai para o `sameAs` do autor no JSON-LD.
- `GET /admin/blog/posts` → `{ version, posts, media_base }`: todos os posts sem o `body`, do editado mais recente ao mais antigo. `media_base` é a base pública do bucket das imagens (`null` sem o bucket configurado).
- `POST /admin/blog/posts { post }` → `201 { post, version }`. `PUT /admin/blog/posts/{id} { post, expected_updated_at }` → `200 { post, version }`, só se `expected_updated_at` ainda for o do banco; senão `409 EDIT_CONFLICT` com o post atual em `details.post`. O endereço não muda depois da primeira publicação (`409 SLUG_LOCKED`), nem repete o de outro post (`409 SLUG_TAKEN`).
- `GET /admin/blog/posts/{id}` → `{ post, media_base }`; `DELETE` → `{ "deleted": true, version }`. Id que não é uuid ou não existe → `404 NOT_FOUND`.
- `version` nas respostas de salvar e excluir: a versão do blog publicado depois da mudança (a de `GET /blog/version`). O admin compara com o `/blog/versao.json` do site e avisa até o site ficar com ela.
- `POST /admin/blog/images?name=<arquivo>`: a imagem crua no corpo (até 5 MB; WebP, PNG, JPG, GIF ou AVIF, conferidos pelo começo do arquivo). O admin já reduz para 1600 px e converte para WebP. Grava em `<ano>/<mês>/<sorteio>-<nome>.<ext>` no bucket público e responde `201 { path: "/images/blog/<chave>", url: "<media_base>/<chave>" }`. O `path` é o que vai no texto e na capa; no build, a imagem é copiada para `public/images/blog`.
- `GET /admin/blog/images` (galeria, 2026-10-23) → `{ images: [{ path, url, size, uploaded_at, used_by }], truncated, media_base }`: o que está no bucket público do blog (ListObjectsV2 assinado com a chave do blog), da imagem mais nova à mais antiga. Só entra o que pode ir num post (`/images/blog/...` com nome no padrão e extensão de imagem). Até 5 páginas de 1000 arquivos; passou disso, `truncated: true`. `used_by`: os posts que usam a imagem na capa ou no texto (`[{ id, title, status }]`, rascunhos incluídos), vindos do banco junto da conferência do admin (`admin_blog_image_usage`, migração `20261023180000_blog_apagar_imagem.sql`).
- `DELETE /admin/blog/images?path=/images/blog/<chave>` (2026-10-23) → `{ "deleted": true }`: apaga do bucket uma imagem que nenhum post usa, versão por versão (o B2 guarda versões; sem isso o arquivo só ficaria escondido). Caminho fora do padrão → `400 INVALID_REQUEST`, sem banco. Em uso → `409 IMAGE_IN_USE` com `details.used_by`, sem tocar no bucket: o build do site baixa as imagens de todos os publicados e pararia sem ela. Cada imagem apagada fica em `private.admin_events` (`blog_image_delete`).
- `GET /blog/posts` (pública) → `{ version, posts, media_base }` só com os publicados, com o `body`. `GET /blog/version` (pública) → `{ version }`: md5 de id e `updated_at` dos publicados; rascunho não muda a versão.
- A mesma versão sai pela API de dados do Supabase, `POST /rest/v1/rpc/get_blog_version` com a chave publicável: é a única RPC com EXECUTE para `anon` (migração `20261023160000_blog_galeria.sql`). O vigia da VPS confere a cada minuto por ela, sem gastar invocações das funções.
- Admin: o mesmo de 6.12 (`aal2`, `forbidden` → `403 NOT_ADMIN`, `KT009` → `403 EMAIL_NOT_CONFIRMED`).

### 6.14 Usuários: `/admin/users/*`

Responsável, 2026-10-23 (Fase 4 do admin): buscar contas, ver a ficha de cada pessoa e agir. Migração `20261023200000_admin_usuarios.sql`. O banco confere o admin em toda chamada (como em 6.12) e grava cada ação em `private.admin_events`, com o motivo (3 a 300 caracteres, obrigatório em toda ação que muda algo; `400 INVALID_REQUEST` sem ele, antes do banco). Bloquear, excluir e retirar jogo não valem para a própria conta nem para a de outro admin (`409 PROTECTED_ACCOUNT`). Tornar alguém admin continua fora da API.

- `GET /admin/users?q=&filter=all|buyers|newsletter|blocked|admins&page=1` → `{ total, offset, limit: 50, page, users: [{ id, email, created_at, last_sign_in_at, confirmed, blocked, admin, providers, newsletter, purchases, games }] }`, da conta mais nova à mais antiga. `q` procura no e-mail; `buyers` = alguma compra paga (presente não conta); `blocked` = login bloqueado agora; `admins` = a equipe (a aba Equipe do admin).
- `GET /admin/users/{id}` → a ficha: `account` (com `self`, `admin`, `blocked` e o cliente da Stripe), `newsletter` (estado e histórico), `library` (cada direito, com o pedido de origem e o tipo dele), `orders` (com `deliverable`: pago e sem jogo retirado), `emails` (os últimos 20), `suppressions`, `downloads`, `history` (o que a equipe fez, com o e-mail de quem fez) e `giftable` (produtos à venda, com `owned`). Conta apagada ou inexistente → `404 NOT_FOUND`.
- `POST /admin/users/{id}/gifts { product_codes, reason, notify }` → `201 { order_id, email_queued, products }`: de 1 a 10 produtos (sem repetir) num pedido e num e-mail só. Presente = **pedido de cortesia** (`orders.kind = 'courtesy'`), de R$ 0, sem Stripe nem aceite de termos, pago na hora, com um direito e os jogos do produto; o produto sai da sacola da pessoa. Com `notify`, o e-mail do presente (`kind = 'gift'`, transacional, os mesmos links de baixar da entrega) sai na hora. Fica fora das vendas, da receita e do funil das métricas (6.12) e aparece em Minha conta como "Presente da KeyToTwo". Produto fora da venda → `409 PRODUCT_UNAVAILABLE`; a pessoa já tem todos os jogos de um deles → `409 ALREADY_OWNED`; dois produtos com jogo em comum (um pacote e um jogo que já vem nele) → `409 GIFT_OVERLAP`. Nas três, `details.products` diz quais.
- `POST /admin/users/{id}/entitlements/{entitlement}/revoke { reason }` → `{ "revoked": true }`: o direito fica revogado com motivo `manual`; o pedido não muda (dinheiro de volta é reembolso). Já retirado → `409 ALREADY_REVOKED`.
- `POST /admin/users/{id}/orders/{order}/resend` → `202 { "queued": true }`: o e-mail de acesso de novo (o do presente, num pedido de cortesia), para o e-mail atual da conta. Pedido não pago ou com jogo retirado → `409 ORDER_NOT_DELIVERABLE`; envio do mesmo pedido ainda na fila → `409 EMAIL_ALREADY_QUEUED`.
- `POST /admin/users/{id}/newsletter/off { reason }` → `{ "newsletter": false }`: o descadastro, com origem `support`; os e-mails de marketing na fila são cancelados. Fora das novidades → `409 NOT_SUBSCRIBED`.
- `POST /admin/users/{id}/block { reason }` e `POST /admin/users/{id}/unblock { reason }` → `{ blocked }`: o banco confere a conta, o Auth troca o bloqueio (`ban_duration` de 100 anos ou `none`, chave secreta) e só então o histórico registra. Entrar e renovar a sessão falham na hora; o token já emitido vale até vencer (até 1 hora). Já no estado pedido → `409 ALREADY_BLOCKED` / `NOT_BLOCKED`.
- `POST /admin/users/{id}/admin { admin, reason }` → `{ admin }` (equipe, 2026-10-23): promove a admin ou tira o admin, gravando `app_metadata.admin` no Auth (`raw_app_meta_data`) na mesma transação do histórico (`user_admin_grant` / `user_admin_revoke`). Vale no banco na hora (`private.is_admin`); no token da pessoa, quando ela entrar de novo ou a sessão renovar (até 1 hora). Quem vira admin cadastra o segundo fator no primeiro acesso. Já no estado pedido → `409 ADMIN_UNCHANGED`; tirar o próprio admin → `409 PROTECTED_ACCOUNT`; equipe ficaria vazia → `409 LAST_ADMIN`; conta sem e-mail confirmado → `409 TARGET_NOT_CONFIRMED`; bloqueada → `409 ACCOUNT_BLOCKED`.
- `GET /admin/follow-up` → `{ cart, no_download, delivery, unconfirmed }` (acompanhamento, 2026-10-23), cada um `{ total, items }` com até 100 pessoas, sem contas apagadas ou bloqueadas. `cart`: a última coisa posta na sacola tem mais de 1 dia (`items` com os nomes, `reminded` se o lembrete já saiu). `no_download`: pedido pago (compra ou presente) há 2 dias ou mais, nos últimos 90, sem download depois do pagamento. `delivery`: e-mail de acesso que falhou e nunca saiu (`problem: failed`, com o pedido) ou endereço bloqueado na Brevo por devolução ou spam numa conta com jogos (`problem: suppressed`). `unconfirmed`: conta criada há mais de 1 hora sem confirmar o e-mail.
- `GET /admin/users/{id}/export` → a mesma cópia de `GET /account/export` (6.11), para baixar (`keytotwo-dados-<id>.json`). Conta sem e-mail confirmado → `409 TARGET_NOT_CONFIRMED`.
- `POST /admin/users/{id}/delete { reason, confirm_email }` → `{ deleted: true, orders_anonymized }`: a mesma exclusão de `POST /account/delete` (`delete_account_data` e depois o Auth). `confirm_email` tem de ser o e-mail da conta (o banco confere; senão `400`). Bloqueada por pagamento em andamento ou contestação → `409 ACCOUNT_DELETION_BLOCKED`. O histórico guarda o motivo e quantos pedidos ficaram anonimizados, sem o e-mail.

### 6.15 Pedidos e reembolsos: `/admin/orders/*`

Responsável, 2026-10-24 (Fase 3 do admin): buscar pedidos, ver a ficha de cada um, reembolsar o pedido inteiro e conferir com a Stripe o pedido que ficou aberto aqui. Migração `20261024150000_admin_pedidos.sql`. O banco confere o admin em toda chamada (como em 6.12); toda ação que muda algo pede o motivo (3 a 300 caracteres, `400 INVALID_REQUEST` sem ele, antes do banco) e vai para `private.admin_events` (`order_refund`, `order_reconcile`) depois que a Stripe aceitou, com o dono do pedido como alvo (aparece também na ficha da conta, 6.14). Só os pedidos do modo da chave da Stripe deste ambiente (teste ou produção); pedido do outro modo → `409 ORDER_NOT_REFUNDABLE`. O reembolso é sempre do pedido inteiro (decisão do responsável): reembolso parcial feito no painel da Stripe continua sem mudar o pedido (seção 9).

- `GET /admin/orders?q=&filter=all|paid|pending|abandoned|refunded|disputed|courtesy&page=1` → `{ total, offset, limit: 50, page, orders: [{ id, ref, kind, status, email, user_id, created_at, paid_at, amount_total, currency, promotion_code, items }] }`, do mais novo ao mais antigo. `q` acha pelo código do pedido (os 8 caracteres, com ou sem `#`) ou por parte do e-mail (o atual da conta; o do pedido se a conta saiu). `paid` = compra paga; `pending` = aberto ou com Pix gerado; `abandoned` = expirado ou falhou; `disputed` = em contestação ou perdida; `courtesy` = presentes.
- `GET /admin/orders/{id}` → a ficha: `order` (valores, cupom, datas, termos aceitos, ids da Stripe e o que dá para fazer: `deliverable`, `refundable`, `reconcilable`), `person` (dono, e-mail atual, se a conta existe e o cliente da Stripe), `items`, `events` (a linha do tempo de `order_events`), `entitlements` (com os jogos), `downloads` (quantos e o último, depois do pagamento), `emails` e `history`. Pedido que não existe → `404 NOT_FOUND`.
- `POST /admin/orders/{id}/refund { reason, confirm_ref }` → `{ refunded: true, refund_status, email_queued }`. `confirm_ref` é o código do pedido (com ou sem `#`, sem diferença de caixa; senão `400`). Só pedido de compra, pago e com cobrança (`refundable`); senão `409 ORDER_NOT_REFUNDABLE` (presente, já reembolsado, sem pagamento), antes da Stripe. A API cria o reembolso na Stripe pelo PaymentIntent (`reason: requested_by_customer`, metadata `order_id` e `source: admin`, chave de idempotência `refund:<order_id>`: repetir não reembolsa de novo). Aceito (`succeeded` ou `pending`), o pedido vira `refunded` na hora por `set_order_status` com origem `admin` (motivo `admin_refund`): os jogos saem e o aviso de reembolso vai para a fila e sai em seguida. O `charge.refunded` que chega depois vira `noop`. A chave restrita precisa da escrita em Reembolsos (sem ela, `502 PAYMENT_PROVIDER_ERROR` com essa explicação); recusa da Stripe ou reembolso `failed`/`canceled` → `502`, sem mudar o pedido; pagamento que a Stripe diz já reembolsado → `409 ORDER_NOT_REFUNDABLE` (o pedido atualiza pelo webhook).
- `POST /admin/orders/{id}/reconcile { reason }` → `{ outcome, status }`: busca a sessão na Stripe e aplica o que ela diz, com a mesma regra do webhook e da confirmação (`applySession`, origem `reconcile`): paga libera e manda o acesso; completa sem pagamento fica `pending_payment`; expirada expira. Só pedido de compra aberto, em andamento ou expirado, com sessão (`reconcilable`); senão `409 ORDER_NOT_RECONCILABLE`. Sessão ainda aberta → `409 ORDER_NOT_RECONCILABLE` (a pessoa não terminou de pagar). Stripe fora do ar → `502 PAYMENT_PROVIDER_ERROR`.
- Reenviar o acesso de um pedido usa a rota da conta dona (6.14, `POST /admin/users/{id}/orders/{order}/resend`).

### 6.16 Alertas: `/admin/alerts/*`

Responsável, 2026-10-24: o que precisa de atenção num lugar só, com e-mail para os admins. Migração `20261024180000_backup_alertas.sql`. A varredura `private.scan_admin_alerts` roda no `dispatch_tick` (a cada 5 minutos, antes do despacho) e abre um alerta por coisa (a chave é única para sempre: resolver à mão não faz reabrir), olhando os últimos 7 dias:

| `kind` | Abre quando | Fecha sozinho quando |
| --- | --- | --- |
| `dispute` | o pedido está `disputed`. O webhook abre na hora (`record_dispute_alert`, com o id `dp_…`, o prazo das provas `due_by`, o valor e o motivo); se essa chamada falhar, a varredura abre sem eles | o pedido sai de `disputed` |
| `delivery_failed` | e-mail de acesso, presente ou aviso de reembolso `failed`, ou `sent` com devolução permanente (`email_suppressions.hard_bounce` com o mesmo Message-ID, sem os `< >`) | um reenvio do mesmo e-mail sai (`sent`), ou o pedido não está mais pago (acesso e presente) |
| `order_stuck` | pedido de compra `open` ou `pending_payment`, com sessão, criado há mais de 26 horas (a sessão vence em 24: o aviso da Stripe não chegou) | o pedido muda de status |
| `stripe_unmatched` | `stripe_events` com `not_found` (a Stripe confirmou o pagamento de um pedido que não existe aqui) | não fecha sozinho |
| `email_queue_stuck` | e-mail na fila há mais de 30 minutos (a chave é o mais antigo; um por vez) | a fila anda. Do sistema: não se resolve à mão |
| `backup_late` | a última cópia do backup (`private.backup_runs`) tem mais de 26 horas; sem cópia nenhuma, não abre | chega uma cópia nova. Do sistema: não se resolve à mão |
| `terms_missing` | (2026-10-25) pedido de compra pago nos últimos 7 dias sem o "Li e aceito" gravado (`terms_accepted_at` vazio): alguém destravou o formulário à mão | não fecha sozinho |
| `site_down` | (2026-10-26) as duas últimas checagens de um alvo falharam (`details.target`: `site` ou `store`, com `since`, a primeira falha, e `error`, o último erro); ou a checagem não chega há mais de 15 minutos (`target` `monitor`, `since` = a última que chegou). A chave é a primeira falha da sequência (ou a última checagem): uma queda abre um alerta só | a última checagem do alvo passa (ou volta a chegar). Do sistema: não se resolve à mão |

Cada alerta novo vai num e-mail `admin_alert` (seção 8.2) para cada admin com o e-mail confirmado, uma vez só. Quando um `site_down` fecha sozinho, vai outro, o de volta (`payload.back`, chave `admin_alert_back:…`), com a hora em que fechou. Os resolvidos há mais de 180 dias saem.

- `POST /internal/uptime` (2026-10-26; só com o segredo da agenda em `apikey`, como o `/internal/discounts/tick`) → `{ checks: [{ target, ok, error? }] }`. A agenda do banco chama a cada 5 minutos (`private.uptime_tick`, cron `uptime-tick`, com 30 s de espera). Confere o que quem compra usa: `site`, a página inicial do `SITE_URL` responde 200 com "KeyToTwo" (10 s); `store`, o catálogo (o banco e os preços da Stripe, como o `GET /catalog`) lista produtos, todos com preço. Grava em `record_uptime_checks` (`private.uptime_checks`, 30 dias). Erros: `HTTP <status>`, `a página veio sem o nome da loja`, `sem conexão`, `não respondeu em 10 segundos`, `nenhum produto à venda`, `sem preço: <códigos>`. Não vê o que derruba a própria Supabase (a checagem e o e-mail dependem dela): aí, o status.supabase.com.

- `GET /admin/alerts` → `{ open: [alerta], resolved: [alerta] }`: os abertos (todos, do mais novo) e os resolvidos nos últimos 30 dias (até 100). Alerta: `{ id, kind, details, opened_at, order_id, order_ref, order_status, livemode, user_id, resolved_at, resolution, resolved_by, manual }`; `resolution` é `auto` quando fechou sozinho (`resolved_by` nulo) ou o motivo de quem resolveu (`resolved_by` = e-mail); `manual` diz se dá para resolver à mão.
- `POST /admin/alerts/{id}/resolve { reason }` → `{ resolved: true }`. Motivo de 3 a 300 caracteres (`400` antes do banco); id que não é número → `404`. Alerta que não existe → `404 NOT_FOUND`; já resolvido ou do sistema → `409 ALERT_NOT_RESOLVABLE`. Vai para `private.admin_events` (`alert_resolve`), com o dono do pedido como alvo.

### 6.17 Catálogo: `/admin/catalog` e `/admin/products/*`

Responsável, 2026-10-24: ver o que está à venda, por quanto e o que vem em cada pacote; pausar e voltar a vender, trocar o preço, o preço riscado da promoção e montar o pacote. Migração `20261024200000_admin_catalogo.sql`. O banco confere o admin em toda chamada; toda ação pede o motivo (3 a 300 caracteres, `400` antes do banco) e vai para `private.admin_events` (`product_status`, `product_price`, `product_list_price`, `pack_add_game`, `pack_remove_game`, com o código do produto). Resultado que não muda nada (o mesmo preço, a mesma situação) ou que a regra não deixa → `409 CATALOG_CONFLICT`, com o motivo na mensagem. A troca do PDF de um jogo continua por script (decisão do responsável): o catálogo só mostra a versão em uso.

- `GET /admin/catalog` → `{ version, livemode, products, games }`. `version` é a do catálogo público (`get_catalog_version`, o md5 do `get_catalog`), a que o admin compara com o `/catalogo/versao.json` da loja para dizer se ela já atualizou. Produto: `{ code, name, kind, slug, status (draft | active | archived), ready (tem tudo para vender), sellable (ativo e pronto: está no /catalog), stripe_price_id, price, list_price, games_expected, games [{ code, name, position }], paid_orders (no modo da chave), owners (pessoas com acesso ativo), history (as 20 últimas ações) }`. Jogo: `{ code, name, access, status, file { version, filename, size_bytes, published_at }, single (o avulso), packs }`.
- `POST /admin/products/{code}/status { status: active | archived, reason }` → `{ status }`. Pausar tira do /catalog (ninguém põe na sacola nem paga); quem já comprou continua com o jogo, e o pacote que traz um jogo pausado continua à venda. Voltar a vender exige o produto pronto (nome, preço, a contagem de jogos e cada jogo publicado com o PDF); senão `409`.
- `POST /admin/products/{code}/price { amount, reason }` → `{ price }`. `amount` em centavos, de 100 a 100000. A API cria o Price novo na Stripe no mesmo produto da Stripe do Price atual (metadata `code` e `source: admin`, chave de idempotência `price:<código>:<Price atual>:<valor>`: repetir não cria outro), passa o produto para ele (`admin_set_product_price`, que guarda o novo em `private.stripe_prices` e marca o antigo inativo) e arquiva o antigo na Stripe (se falhar, só fica no log). A sacola já mostra o novo; quem está no meio do pagamento paga o antigo. O mesmo valor de agora → `409`, sem ir à Stripe. Sem a escrita em Preços na chave restrita → `502 PAYMENT_PROVIDER_ERROR`, sem mudar nada.
- `POST /admin/products/{code}/list-price { amount | null, label, reason }` → `{ list_price }`: o preço riscado da promoção (centavos e um rótulo de 2 a 40 caracteres), ou `null` para tirar. Vai no `/catalog` (6.1) e a loja mostra riscado só quando for maior que o preço.
- `POST /admin/products/{code}/games { game, gift, notify, reason }` → `{ added, gifted, emails_queued }`: põe um jogo pago e publicado no fim do pacote (só pacote). Com `gift`, quem tem o pacote ativo (conta viva e confirmada) e ainda não tem o jogo ganha o avulso dele como presente (`admin_gift_products`, pedido de cortesia de R$ 0), com o e-mail de presente se `notify`; os e-mails saem em seguida. Para dar de presente, o avulso precisa estar à venda (senão `409`, antes de mudar algo).
- `POST /admin/products/{code}/games/{game}/remove { reason }` → `{ removed }`: tira o jogo do pacote; as posições seguintes sobem. O pacote fica com pelo menos dois jogos (`409`). Quem já comprou continua com o jogo (a compra é uma fotografia, `entitlement_games`).

### 6.18 Cupons, parceiros e indicações: `/admin/discounts/*`, `/admin/partners/*`, `POST /referral/visit`

Responsável, 2026-10-24: os cupons com prazo, percentual e o que eles cobrem; os cupons de temporada (Black Friday, Dia dos Namorados) com a faixa do topo da loja; os links de indicação dos parceiros, com o desconto e a comissão; de onde veio cada cliente. Migração `20261024220000_descontos_parceiros.sql`. As cinco decisões: vale o **último link** aberto nos 30 dias antes da compra, e um **cupom digitado** de outro parceiro leva a venda para ele; a comissão é calculada (0%: amigo ou pago por fora; as vendas contam, sem valor a pagar); o link **aplica o código sozinho** no pagamento; a faixa do topo sai do admin; a política de privacidade explica a indicação (versão 2026-10-24).

Cada cupom é um cupom e um código promocional da Stripe (o `allow_promotion_codes` do checkout continua; a Stripe confere o código, o prazo, o limite, a primeira compra e o mínimo). O banco guarda o cupom em `private.discounts` (o código é único para sempre). A Stripe não agenda o início: o código de um cupom que começa depois nasce inativo e a agenda `discounts-tick` (a cada 5 minutos) chama `POST /internal/discounts/tick` quando há um cujo início chegou. Toda ação do admin pede o motivo (3 a 300 caracteres) e vai para `private.admin_events` (`discount_create`, `discount_state`, `partner_save`, `partner_payout`).

- `GET /admin/discounts` → `{ discounts, partners, products }`. Cupom: `{ id, code, percent_off, product_codes (null: tudo), starts_at, ends_at, max_redemptions, first_time_only, minimum_amount, campaign, banner, partner { id, slug, name }, state (scheduled | active | paused | ended), effective_state (+ starting, expired), stripe_coupon_id, stripe_promotion_code_id, created_at, ended_at, stats { orders, revenue, discount } }` (as compras pagas do modo da chave que usaram o código). `products`: os ativos com o produto da Stripe (do Price guardado).
- `POST /admin/discounts { code, percent_off, product_codes, starts_at, ends_at, max_redemptions, first_time_only, minimum_amount, campaign, banner, partner, reason }` → `201 { id, state }`. O código vira maiúsculo (`^[A-Z0-9]{3,30}$`); `percent_off` de 0,01 a 100; o fim depois de agora e do início; a faixa (5 a 140 caracteres) precisa de `{cupom}`, onde o código aparece, e não vale com parceiro. Código já usado, produto sem Price na Stripe → `409 CATALOG_CONFLICT`; parceiro que não existe → `404`; tudo antes da Stripe. Depois a API cria o cupom (`duration: once`, `applies_to.products` quando há produtos; chave `coupon:<código>:<regras>`, um resumo das regras: repetir a mesma tentativa não cria outro) e o código (`promotion.coupon`, `restrictions.first_time_transaction` e `minimum_amount` em BRL, `expires_at`, `max_redemptions`; chave `promotion:<código>:<regras>`) e guarda (`admin_create_discount`). Se o banco recusar depois da Stripe, o código é desligado lá. Sem a escrita em Cupons e Códigos promocionais na chave restrita → `502 PAYMENT_PROVIDER_ERROR`.
- `POST /admin/discounts/{id}/state { state: active | paused | ended, reason }` → `{ state }`: liga ou desliga o código na Stripe antes do banco. Voltar a valer antes do início fica `scheduled` (desligado até a agenda). Encerrado não volta (`409`); a mesma situação → `409`.
- `POST /internal/discounts/tick` (só com o segredo da agenda em `apikey`, o mesmo do `email-dispatch`, seção 8.2) → `{ due, started }`: liga na Stripe os agendados cujo início chegou e marca (`mark_discount_started`). Um que falha fica para a próxima rodada.
- `GET /catalog` leva `banner: { code, text } | null` (`get_promo_banner`): o cupom ativo, sem parceiro, com faixa e dentro do prazo, o que começou por último. Entra em `get_catalog_version`, então o vigia reconstrói a loja quando a faixa muda; o build guarda a faixa em `src/content/catalog-snapshot.ts` (`promoBanner`).
- `POST /referral/visit { partner }` (pública) → `{ partner, name, code, percent_off, token }`: quem abriu `?p=<apelido>`. O `token` (desde 2026-10-25) é o comprovante da visita, assinado com o `EMAIL_LINK_SECRET` (propósito `r`, o apelido e a chegada; vale 30 dias). Conta a visita do dia (`private.partner_visits`, só o número) e devolve o código ativo do parceiro (o mais novo, ou `null`). Parceiro pausado ou que não existe → `404`. O site guarda a indicação no navegador por 30 dias (`keytotwo:indicacao`, com as marcas `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` e a página de entrada) e conta uma visita por dia.
- `POST /checkout` aceita `referral { partner, landed_at, path, utm_*, token }`: `set_order_referral` guarda no pedido aberto da pessoa o parceiro ativo (chegada nos últimos 30 dias) e as marcas; o resto é descartado. Desde 2026-10-25 o parceiro e a chegada vêm só do `token` válido; sem ele (ou vencido, ou adulterado), o `partner` do corpo é ignorado e ficam só a página, a chegada e as marcas, que não mexem em comissão. Uma falha aqui fica no log e não impede o pagamento. O site aplica o código do parceiro quando o formulário abre (`applyPromotionCode`); um código digitado toma o lugar.
- `GET /admin/partners` → `{ partners: [{ id, slug, name, handle, contact, commission_percent, status, notes, created_at, visits_30d, orders, revenue, codes }] }`. A venda é do parceiro do código usado (se o cupom é de um parceiro) ou do link guardado no pedido.
- `GET /admin/partners/{id}` → `{ partner, months [{ month, orders, revenue, commission, closed, payout }], visits { last_30_days, total }, discounts, orders [{ id, ref, paid_at, amount_total, promotion_code, source (code | link) }] }` (as 50 últimas). O mês é o de Brasília; a comissão é sobre o valor cobrado.
- `POST /admin/partners { slug, name, handle, contact, commission_percent, status, notes, reason }` → `201 { id }`; `POST /admin/partners/{id}` (o mesmo, sem mudar o `slug`) → `{ id }`. Apelido de link em uso → `409`.
- `POST /admin/partners/{id}/payouts { month: AAAA-MM, note, reason }` → `{ amount }`: registra que a comissão de um mês fechado foi paga (por fora). Mês aberto, já pago ou sem comissão → `409`.
- `GET /admin/partners/{id}/export?month=AAAA-MM` → CSV (ponto e vírgula, UTF-8 com BOM, para o Excel em português): pedido, data, total, desconto, cupom e comissão de cada venda do mês, com o total. Sem e-mail nem nome de cliente.
- `GET /admin/metrics` leva `marketing { codes, partners, campaigns }` (`admin_marketing_metrics`): as vendas pagas do período por cupom, por parceiro e por `utm_source`/`utm_campaign`. `GET /admin/orders/{id}` leva `origin` (o parceiro, se veio pelo cupom ou pelo link, e as marcas).

## 7. Tokens HMAC (entrega e descadastro)

Formato: `<payload>.<assinatura>`, ambos em base64url sem preenchimento.

- **Payload:** JSON compacto.
  - Entrega: `{"t":"d","e":"<entitlement_id>","g":<game_id>,"x":<expira em, epoch s>}`.
  - Descadastro: `{"t":"u","u":"<user_id>","i":<emitido em, epoch s>}`.
- **Assinatura:** HMAC-SHA256 com `EMAIL_LINK_SECRET` sobre o payload codificado. A comparação é em tempo constante. O propósito `t` faz parte do que é assinado: um token de descadastro não serve como token de entrega, nem o contrário.
- **Validade:** entrega, 30 dias a partir do envio **[D4]**; descadastro não expira, como recomenda a RFC 8058.
- **Sem estado:** o token não é guardado no banco nem na fila. O despachante gera os tokens na hora do envio, e o payload da fila não leva token.
- **Segredos (propostos para o modelo de segredos):**
  - `EMAIL_LINK_SECRET`: 32 bytes aleatórios ou mais (ex.: `openssl rand -base64 48`). Só nas Edge Functions.
  - `EMAIL_LINK_SECRET_PREVIOUS`, opcional: aceito só na verificação, durante uma rotação. Trocar o segredo sem manter o anterior invalida todos os links já enviados: entrega cai em Meus jogos e descadastro passa a pedir login.
- **Privacidade:** o token não leva e-mail nem nome, só ids opacos.

## 8. Funções de e-mail

Todo e-mail do app sai pela API v3 da Brevo (as Edge Functions não podem usar SMTP). No I4 o template da entrega está **no código** (`_shared/email.ts`, HTML e texto em pt-BR); mudar o texto exige deploy. Templates da Brevo continuam possíveis depois, sem mudar banco nem rotas. O remetente é `EMAIL_FROM` / `EMAIL_FROM_NAME` **[D7]**.

**Modo de envio (`EMAIL_MODE`):**

- `log` (padrão, e o único usado no local): nada sai para fora. O console registra só o tipo e o id da linha, sem e-mail nem token. Com `EMAIL_LOG_MAILPIT_URL`, uma cópia vai para o Mailpit local, para conferir o e-mail.
- `brevo`: envio real. Exige chave v3 (`xkeysib-`); outra chave → `rejected` com `brevo_chave_nao_v3`. Com `EMAIL_ALLOWED_RECIPIENTS` preenchida (ambientes de teste), destinatário fora da lista → `rejected` com `fora_da_lista_de_teste`. Na produção a lista fica vazia.

### 8.1 `brevo-webhook`

- **Autenticação:** `Authorization: Bearer <BREVO_WEBHOOK_SECRET>`, comparado em tempo constante. A Brevo oferece isso no cadastro do webhook (`POST /v3/webhooks` com `"auth": { "type": "bearer", "token": "<segredo>" }`, tipo `transactional`). Segredo na URL não é aceito. Sem o header ou com outro valor → `401`.
- **Corpo:** `application/json` (senão `415`), um evento ou, com `batched: true`, uma lista (até 1 MB). JSON inválido ou lista vazia → `400`. O horário do evento vem de `ts_event` (ou `ts`), em segundos; sem ele, o banco usa `now()`.
- **Eventos** (nomes conferidos na documentação de webhooks transacionais da Brevo):

  | Evento da Brevo | Chamada |
  | --- | --- |
  | `hard_bounce`, `invalid_email`, `blocked` | `record_email_event(email, 'hard_bounce', message_id, occurred_at)` |
  | `spam` (reclamação) | `record_email_event(..., 'complaint', ...)` |
  | `unsubscribed` | `record_email_event(..., 'unsubscribe', ...)` |
  | Os demais (`delivered`, `opened`, `click`, `soft_bounce`...) | `200` sem chamada |

- `record_email_event` é idempotente por e-mail e motivo e grava a supressão. Reclamação e descadastro também revogam o consentimento e cancelam o marketing na fila; bounce só suprime.
- Resposta `200 { "received", "recorded", "ignored" }`. Evento sem e-mail, de outro tipo ou recusado pelo banco com `KT001` (e-mail fora do padrão) conta como `ignored`. Outra falha do banco → `500`, para a Brevo reenviar (a RPC é idempotente). O e-mail do payload nunca vai para o log.

### 8.2 `email-dispatch`

- **Autenticação:** header `apikey` igual ao segredo da agenda, comparado em tempo constante. Na nuvem, desde 2026-10-25, é o `DISPATCH_SECRET` (segredo da função, aleatório, sem poder nenhum no banco), o mesmo valor guardado no Vault como `email_dispatch_key` para o `pg_net`. Antes era a chave secreta nomeada `dispatch`, com o poder do `service_role`: quem lesse o Vault ou a fila do `pg_net` levava o banco. Sem o `DISPATCH_SECRET` (local), vale a chave nomeada `dispatch` e, por fim, a `default`. Sem segredo válido → `401`.
- **Corpo:** `{ "limit": 20 }` (de 1 a 100), ou `{ "outbox_id": "<uuid>" }` para um e-mail específico. Corpo inválido → `400`; método diferente de `POST` → `405`.
- **Passos:**
  1. `claim_email_batch(limit, outbox_id)` (o terceiro parâmetro, `p_now`, só serve aos testes). A RPC troca as linhas para `sending` com `SKIP LOCKED` e retoma as presas em `sending` há mais de 10 minutos.
     - Marketing: pula (`skipped`, com motivo) quem não tem opt-in, quem está suprimido, o lembrete de carrinho que mudou ou foi pago e o pós-compra de pedido fora de `paid`. O limite de 1 e-mail de marketing por dia adia para o dia seguinte.
     - Entrega e presente: cancela se o pedido não está `paid` ou se algum direito foi revogado. O aviso de reembolso e o alerta dos admins não passam por essa conferência.
  2. Para cada linha, monta o e-mail a partir do `payload`. Entrega: assunto "Seus jogos chegaram (pedido <ref>)", um botão por jogo com link `GET /d/{token}` (30 dias, base `API_PUBLIC_URL`), o botão Meus jogos (`SITE_URL/meus-jogos`) e o link de ajuda. Lembrete de carrinho: assunto "Ficou um jogo no carrinho", os itens e o botão Voltar ao carrinho (`/carrinho`). Pós-compra: "Já rolou a primeira partida?", os jogos, Meus jogos e as dicas de impressão (`/ajuda#impressao`). Aviso de reembolso (`refund`, transacional, 2026-10-24): assunto "Reembolso do pedido <ref>", o valor devolvido pelo mesmo meio de pagamento, que o prazo é do banco ou do cartão, que os jogos saíram de Meus jogos e o link de ajuda; sem botão de baixar. Sem valor na fotografia → `rejected`. Alerta dos admins (`admin_alert`, transacional, sem pedido, 2026-10-24): assunto "Admin KeyToTwo: <n> alerta(s) novo(s)", uma linha por alerta com o que fazer, os links do pedido no admin (`ADMIN_URL/pedidos/<id>`) e da contestação ou do evento na Stripe, e o botão para `ADMIN_URL/atencao`; sem e-mail nem nome de cliente. Com `site_down` (2026-10-26), o assunto é "Admin KeyToTwo: o site está fora do ar", com o que parou, desde quando, o erro e onde conferir (o painel da Hostinger; o status da Supabase e da Stripe); o de volta (`payload.back`) tem o assunto "Admin KeyToTwo: voltou a funcionar", com a hora em que voltou e mais ou menos quanto durou. Sem alertas na fotografia → `rejected`. Todo marketing leva o rodapé de descadastro (seção 6.10) e os headers `List-Unsubscribe: <API_PUBLIC_URL/email/unsubscribe?token=...>` e `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Marketing sem `user_id` ou sem itens e `kind` desconhecido → `rejected`.
  3. Envia pelo modo configurado. Brevo: `POST https://api.brevo.com/v3/smtp/email` com `sender`, `to`, `subject`, `htmlContent`, `textContent`, `tags: [kind]` e, no marketing, `headers`. No modo log, a cópia no Mailpit leva os mesmos headers.
  4. `mark_email_result(id, status, message_id, erro)`:
     - `sent`;
     - `failed`, para erro transitório: timeout, `429`, `5xx`, e também `401`/`403` da Brevo (chave ou IP não autorizado: configuração que se corrige, então a fila tenta de novo);
     - `rejected`, para recusa definitiva: outros `4xx` da Brevo e as recusas do modo `brevo` acima.

     O banco decide a nova tentativa: no máximo 5, com atraso de 5 min × tentativas². `rejected` encerra a linha. O erro informado é só o código HTTP ou o código da Brevo, nunca a mensagem nem o e-mail.
- **Resposta:** `200 { "claimed": 0, "sent": 0, "failed": 0, "rejected": 0 }`. Linhas puladas ou canceladas pela RPC não voltam no `claim` e não entram na contagem.
- **Entrega única:** `dedupe_key` `delivery:{order_id}` cria no máximo uma linha por pedido; o `claim` passa a linha para `sending` com `SKIP LOCKED`, e `mark_email_result` numa linha que já saiu de `sending` responde `noop`. Só quem recebeu `send_delivery = true` de `fulfill_order` despacha.
- **Agenda (migração do Lastro, I5):** o job `email-dispatch-tick` do `pg_cron` roda `private.dispatch_tick()` a cada 5 minutos: primeiro `private.enqueue_followups()` (prazos D3), depois, se o Vault tiver `email_dispatch_url` e `email_dispatch_key`, `net.http_post` para esta função com `{ "limit": 20 }` e o header `apikey`. Sem os segredos no Vault, só enfileira e registra um aviso no log do banco. Nenhum valor vai na migração: no local, o passo `supabase/local/aplicar-dispatch-vault.mjs` grava a URL interna do gateway e a chave `default` (rodar depois de cada `db reset`); na nuvem, a chave nomeada `dispatch` é gravada à mão no Vault (I6) **[D3]**.
- **Recheque no envio:** o `claim_email_batch` confere de novo opt-in, e-mail confirmado e supressão, pula o lembrete de carrinho que mudou ou foi pago e o pós-compra de pedido fora de `paid`, e aplica o limite de 1 marketing a cada 24 h (adiando, sem pular).
- **Entrega imediata:** depois do commit de `fulfill_order`, o `stripe-webhook` ou o `/order-status` despacham o `outbox_id` devolvido, em segundo plano (`EdgeRuntime.waitUntil`). Se falhar, a agenda reenvia.
- **Templates da Brevo** (opção futura): `BREVO_TEMPLATE_DELIVERY`, `BREVO_TEMPLATE_CART_REMINDER` e `BREVO_TEMPLATE_POST_PURCHASE` ficam reservadas e não são lidas no I4.
- **Anexo [D4]:** opção futura do despachante, sem mudar banco nem rotas. Ligado por configuração, anexa os PDFs que couberem nos limites da Brevo (cerca de 4 MB por anexo e 20 MB por mensagem, a confirmar), além dos links. Arquivo acima do limite segue só por link. Hoje: só links.
- **Risco [D8]:** se a Brevo não aceitar conteúdo promocional pela API transacional, só o envio dos tipos de marketing muda (evento `trackEvent` para uma automação mínima). O banco continua decidindo e registrando.

## 9. `stripe-webhook`

1. Confere a assinatura no corpo bruto. Se for inválida, responde `400 INVALID_SIGNATURE` sem tocar no banco. Método diferente de `POST` responde `405`.
2. Acha o pedido:
   - eventos `checkout.session.*`: pelo `client_reference_id`;
   - `charge.*` e `charge.dispute.*`: pelo `metadata.order_id` do PaymentIntent, com recurso para a sessão do `payment_intent`.
   - Sem pedido nosso: `200` com log, sem RPC.
3. Faz uma única RPC. O evento é gravado na mesma transação do efeito.
4. Responde. Se `fulfill_order` devolver `send_delivery`, despacha o `outbox_id` em segundo plano (`EdgeRuntime.waitUntil`, mesmo código do `email-dispatch`); se falhar, a linha fica na fila para a agenda.

| Evento | RPC |
| --- | --- |
| `checkout.session.completed`, `payment_status = paid` | `fulfill_order` com a sessão relida na Stripe (código promocional expandido): subtotal, desconto, total, moeda, código promocional, itens (preço, quantidade, valor unitário cheio e moeda), Customer, intent, `p_stripe_event_id` e `p_event_type`. O aceite dos termos já está no pedido desde o checkout |
| `checkout.session.completed`, `unpaid` | `set_order_status('pending_payment')` |
| `checkout.session.async_payment_succeeded` | `fulfill_order` |
| `checkout.session.async_payment_failed` | `set_order_status('failed')` |
| `checkout.session.expired` | `set_order_status('expired')`; o funil registra `checkout_expired` |
| `charge.dispute.created` | `set_order_status('disputed')`: revoga todos os itens; depois `record_dispute_alert` abre o alerta do admin com o prazo das provas (seção 6.16; se falhar, o webhook responde 200 mesmo assim e a varredura abre o alerta sem o prazo) |
| `charge.dispute.closed`, `won` ou `warning_closed` | `set_order_status('paid')`: reativa |
| `charge.dispute.closed`, `lost` | `set_order_status('dispute_lost')`: o acesso fica revogado |
| `charge.refunded`, reembolso total (só por ação manual, excepcional) | `set_order_status('refunded')`: revoga |
| `charge.refunded`, parcial | `200` sem RPC; só pelo suporte **[D5]** |

Contestação e reembolso valem para o pedido inteiro.

| Resultado | Resposta |
| --- | --- |
| `applied`, `noop`, `duplicate_event`, `ignored`, `not_found` | `200` |
| `deferred` (contestação ou reembolso antes da liberação, ou `dispute_lost` com o pedido ainda `paid`; não gravado) | `500`, para a Stripe reenviar |
| `KT001`, `KT002`, `KT004`, `KT005`, `KT007`, `KT012` ou `23505` | `200` com log de erro e alerta; reenviar não resolve. `KT012` (itens da sessão diferentes do pedido) exige conferência manual |
| `KT003` (produto sem jogos), `KT010` ou `KT011` | `500`: defeito que se corrige no banco; a Stripe reenvia por até 3 dias, e o reenvio libera o pedido pago depois da correção |
| Falha de rede ou de banco | `500` |

## 10. Variáveis das funções

| Variável | Funções | Situação |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS` | todas | Injetadas pela plataforma e pela CLI |
| `ALLOWED_ORIGINS` | `api` | Já no modelo de segredos |
| `SITE_URL` | `api`, `stripe-webhook`, `email-dispatch` | Já no modelo; usada em retornos, redirecionamentos e links |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `api`, `stripe-webhook` | Já no modelo |
| **`VITE_STRIPE_PUBLISHABLE_KEY`** | site (build), não as funções | **Nova**, pública (`pk_test_...` no teste). Usada pelo formulário embutido |
| `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME` | `email-dispatch`, `api` e `stripe-webhook` (despacho em segundo plano) | Já no modelo. Chave v3 (`xkeysib-`) e, na Brevo, sem restrição de IP: as funções não têm IP fixo |
| **`EMAIL_MODE`** | as mesmas | **Nova**, não secreta: `log` (padrão) ou `brevo` |
| **`EMAIL_LOG_MAILPIT_URL`** | as mesmas | **Nova**, só local: Mailpit que recebe a cópia no modo `log` |
| **`EMAIL_ALLOWED_RECIPIENTS`** | as mesmas | **Nova**, só teste: destinatários permitidos no modo `brevo` (vírgula); vazia na produção |
| **`API_PUBLIC_URL`** | as mesmas | **Nova**, não secreta: base pública da `api` nos links dos e-mails. Padrão `SUPABASE_URL/functions/v1/api`; no local é obrigatória (lá `SUPABASE_URL` é o endereço interno do gateway) |
| `B2_ENDPOINT`, `B2_REGION`, `B2_BUCKET`, `B2_READ_KEY_ID`, `B2_READ_APPLICATION_KEY` | `api` | Já no modelo. Só a chave de leitura vai para as funções; a de escrita fica fora delas |
| **`B2_BLOG_BUCKET`**, **`B2_BLOG_KEY_ID`**, **`B2_BLOG_APPLICATION_KEY`** | `api` | **Novas** (blog, 2026-10-23). O bucket PÚBLICO das imagens do blog (`keytotwo-print-blog`, mesma região do `B2_ENDPOINT`) e uma chave de escrita restrita a ele. Nada dos jogos passa por ela |
| **`EMAIL_LINK_SECRET`** (+ `EMAIL_LINK_SECRET_PREVIOUS` opcional) | `api`, `email-dispatch` | **Nova, secreta** |
| **`BREVO_WEBHOOK_SECRET`** | `brevo-webhook` | **Nova, secreta**, já no modelo. É o token Bearer cadastrado no webhook da Brevo |
| **`BREVO_TEMPLATE_DELIVERY`**, **`BREVO_TEMPLATE_CART_REMINDER`**, **`BREVO_TEMPLATE_POST_PURCHASE`** | `email-dispatch` | **Novas**, ids (não secretos) |
| **`TERMS_VERSION`** | `api` | **Nova**, não secreta. Versão vigente dos termos mostrada na página de checkout; o aceite precisa vir com ela. Desde 2026-10-22: `termos-2026-10-22` (`src/content/legal.ts`, `termsVersion`); o site manda a mesma, salvo `VITE_TERMS_VERSION` **[D11]** |

O Price de cada produto fica em `products.stripe_price_id`, no banco de cada ambiente; nenhuma variável de ambiente guarda Price.

## 11. O que mudou da v0.2

| Tema | v0.2 | v0.3 |
| --- | --- | --- |
| Compra | Um produto, sessão opcional, vínculo por e-mail (`claim_orders`) | Carrinho multi-item, login obrigatório, dono sempre o `user_id` |
| Rotas privadas | Sessão válida | Sessão com e-mail confirmado (`403 EMAIL_NOT_CONFIRMED`) |
| Novas rotas | — | `/catalog`, `/cart`, `/cart/items`, `PUT /account/marketing`, `/d/{token}`, `/email/unsubscribe` |
| Checkout | `create_order`, Checkout hospedado (`checkout_url`) | `create_order_from_cart` com `cart_version` e aceite dos termos colhido na nossa página; Stripe Customer; várias `line_items`; formulário embutido do Checkout Studio (`client_secret`, API `2026-03-25.dahlia` em preview) |
| `/order-status` | Sessão opcional, `relation` com `anonymous`/`claimable` | Sessão obrigatória, `owner`/`other` |
| `/library` | Por produto | Por jogo, com produto de origem; acesso sem expiração |
| `/account` | Pedidos | Pedidos com itens e preferência de marketing |
| Webhook | Reembolso revoga | Sem reembolso; contestação aberta revoga, vencida devolve, perdida mantém revogado; reembolso manual revoga |
| E-mail | Só o acesso, com leitura de `email_outbox` | Fila geral por RPC, despachante interno, Brevo com templates, links HMAC, webhook da Brevo e descadastro em 1 clique |
| Login | Código e senha com `signUp` | Código, senha criada só depois do código, Google; trigger que zera senha pré-confirmação |
| CORS | `GET, POST` | `GET, POST, PUT, DELETE` |
| Erros novos | — | `EMAIL_NOT_CONFIRMED`, `ALREADY_OWNED`, `CART_EMPTY`, `CART_CHANGED`, `INVALID_TOKEN` |

### 11.1 O que mudou na v0.3.1 (I4)

- `GET /d/{token}`: token adulterado ou malformado → `401 INVALID_TOKEN`, em vez de `302` (pedido da tarefa I4); vencido continua `302 ?link=expirado`.
- `GET /free-games` e `POST /free-download`: formato da resposta descrito (6.9); o download gratuito exige sessão desde 2026-10-20.
- URL do B2 com `response-content-disposition=attachment` e `response-content-type` (6.7).
- E-mail: template da entrega no código, `EMAIL_MODE` (`log`/`brevo`), `EMAIL_LOG_MAILPIT_URL`, `EMAIL_ALLOWED_RECIPIENTS` e `API_PUBLIC_URL` (seções 8 e 10); a resposta do `email-dispatch` conta `rejected`, não `skipped`; `401`/`403` da Brevo viram `failed`.
- Webhook e `/order-status` despacham a entrega em segundo plano.

### 11.2 O que mudou na v0.3.2 (I5)

- `email-dispatch` envia `cart_reminder` e `post_purchase` (templates no código) com rodapé e headers de descadastro (8.2).
- `/email/unsubscribe` implementada; aceita também formulário `token=...` (6.10).
- `brevo-webhook`: autenticação definida (Bearer), eventos conferidos, lote aceito e resposta com contagem (8.1).
- Agenda por `private.dispatch_tick()` e segredos do Vault (8.2).

### 11.3 O que mudou na v0.3.3 (LGPD)

- `GET /account/export` e `POST /account/delete` (6.11), com o erro `409 ACCOUNT_DELETION_BLOCKED`.
- `POST /email/unsubscribe` de conta já excluída responde `200` (o `KT001` do banco, com token válido, só vem de conta inexistente).
- Agenda diária `private.purge_email_outbox()` (90 dias depois do envio).
- `TERMS_VERSION` passa a `termos-2026-10-19`, com os Termos, a Política de reembolso e a Política de privacidade publicados.

### 11.4 O que mudou na v0.3.4 (Painel)

- `GET /admin/metrics` (6.12), com o erro `403 NOT_ADMIN`.

### 6.19 `POST /csp-report`

Revisão de segurança, 2026-10-25. O site manda o CSP (`nginx.conf`; só relatório até 2026-10-26, valendo desde então) com `report-uri` nesta rota. O navegador avisa aqui o que a política barraria (ou barrou); a rota só registra no log `csp: <barraria|barrou> <diretiva> <origem barrada> em <caminho>`, sem a consulta da página (pode ter token) nem o caminho do que foi barrado, e responde `204`. Aceita o formato do `report-uri` (`application/csp-report`, `{ "csp-report": {…} }`) e o da Reporting API (lista de `{ type: "csp-violation", body }`), até 8 KB e 10 avisos por chamada; o resto é ignorado.

### 11.4.0 O que mudou na v0.3.8 (Usuários no admin)

- Rotas de usuários (6.14), os erros novos de 409 e o e-mail do presente (`kind = 'gift'`). `get_account` traz `kind` em cada pedido.

### 11.4.1 O que mudou na v0.3.7 (Blog no admin)

- Rotas do blog (6.13) e os erros `409 EDIT_CONFLICT`, `SLUG_TAKEN` e `SLUG_LOCKED`.

### 11.5 O que mudou na v0.3.5 (Sacola sem login)

- `POST /cart/quote` (pública) e `POST /cart/merge` (6.2.1); o carrinho ganha `charge`, `included_in`, `owned_products` e o `status` `included`.
- `POST /cart/items` não recusa mais o produto já possuído (deixa de responder `409 ALREADY_OWNED`); no checkout, `ALREADY_OWNED` passa a ser "nada a pagar".
- Avisos novos `COMPLETE_THE_SET` e `INCLUDED_IN_BUNDLE`; `PARTIAL_OVERLAP` fica só para itens `ok` que dividem jogos.
- O checkout cobra o pacote de "completar a coleção" com `price_data` e a metadata `base_price_<produto>`.

### 11.7 O que mudou na v0.3.9 (limpeza, 2026-10-24)

- Saem `GET /health` (ninguém chamava; o CI confere `/catalog`) e `POST /account/marketing/prompt` (o convite do site saiu em 2026-10-10), junto com a RPC `mark_marketing_prompt`.
- `PUT /account/marketing` deixa de aceitar `source: "cart"`: nenhuma tela pede consentimento na sacola.
- As exportações JSON (`GET /account/export` e `GET /admin/users/{id}/export`) não mandam mais `Content-Disposition`: o site e o admin dão o nome ao arquivo.
- Checkout: Customer apagado no painel da Stripe é trocado por um novo (6.5, passo 2), em vez de travar as compras da conta com `502`.
- Link de e-mail cortado (assinatura com menos de 43 caracteres) responde `401 INVALID_TOKEN` em `GET /d/{token}` e `400 INVALID_TOKEN` no descadastro, em vez de `500`.
- `email-dispatch` responde `400` a corpo que não é objeto; `brevo-webhook` grava sem data o evento com `ts_event` fora da faixa, em vez de `500` sem fim.

### 11.6 O que mudou na v0.3.6 (preços guardados)

- O catálogo, a sacola e o checkout leem os Prices da Stripe guardados no banco (6.1); o formato das respostas não muda.
- No site, a sacola mostra a mudança na hora (o item novo com o preço do catálogo e o total "Atualizando…" até a API confirmar) e usa a resposta de `POST /cart/items`, `DELETE /cart/items/{code}` e `POST /cart/merge` sem buscar `GET /cart` de novo.

## 12. Pendências

- **[D1]** Catálogo além do P001. **[D2]** Posse sobreposta (padrão provisório na seção 6.2). **[D3]** Fluxos e prazos de follow-up. **[D4]** Links ou anexos e validade do link. **[D5]** Reembolso parcial. **[D6]** Texto e versão do consentimento. **[D7]** Remetentes. **[D8]** Plano da Brevo e conteúdo promocional pela API. **[D9]** Métodos de pagamento, URL dos termos e validade da sessão. **[D11]** Termos, Política de reembolso e Política de privacidade escritos (2026-10-19); falta a validação jurídica. **[D12]** Condições do jogo gratuito.
- Webhook da Brevo: cadastrar na conta (tipo `transactional`, eventos `hard_bounce`, `invalid_email`, `blocked`, `spam` e `unsubscribed`, `auth` bearer com o `BREVO_WEBHOOK_SECRET`) quando houver URL pública (I6). Os eventos de marketing da Brevo (campanhas) não são usados.
- Limite de abuso nas rotas públicas que gravam (`/free-download`) e no carrinho: taxa ou CAPTCHA antes da produção.
- Login com Google configurado localmente e ainda não testado: falta credencial.
- Revisão cruzada com `docs/data-contract.md` v0.3.1 concluída: assinaturas, `outcome`, códigos `KT` e o aceite dos termos no checkout estão alinhados.
- Stripe em preview (seção 6.5.1): versão exata do SDK, `payment_intent_data` no modo `form` e versão do endpoint do webhook, a confirmar no I3.
- Brevo: envio real ainda não feito. A chave v3 está no modelo, mas a conta recusa a API por IP não autorizado (`401 unauthorized`). O responsável precisa desativar a restrição de IP da chave (as Edge Functions não têm IP fixo) ou autorizar o IP do teste, e confirmar que `EMAIL_FROM` está ativo como remetente na Brevo.
- `email-dispatch` na nuvem: criar a chave secreta nomeada `dispatch` e guardá-la no Vault para o `pg_net` (I5, com a agenda).
- `GET /d/{token}` com token inválido responde JSON `401`; uma página amigável para quem clica num link corrompido pode vir depois.
