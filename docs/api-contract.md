# Contrato da API — KeyToTwo (v0.3.3)

| | |
| --- | --- |
| Versão | 0.3.3, 2026-10-19 (direitos do titular, LGPD: seção 6.11). 0.3.2, 2026-10-08. Modelo de vendas do Plano do site P2: carrinho, login obrigatório, entrega por e-mail, consentimento e contestações. Inclui o formulário de pagamento embutido configurado no Checkout Studio (nota "Stripe Checkout Studio"). Substitui a v0.2. O que mudou está na seção 11; a v0.3.1 registra o I4 (seção 11.1) e a v0.3.2, o I5 (seção 11.2). |
| Dono | Ferrolho (Backend sênior). Banco, permissões e RPCs: `docs/data-contract.md` v0.3 (Lastro). |
| Estado | I4: além do I3 (`POST /checkout`, `GET /order-status`, `stripe-webhook`), implementadas `POST /download-url`, `GET /d/{token}`, `GET /free-game`, `POST /free-download` e a função `email-dispatch` (entrega; modo log no local). I5: e-mails de marketing (`cart_reminder`, `post_purchase`) no `email-dispatch`, `GET`/`POST /email/unsubscribe`, a função `brevo-webhook` e a agenda (`pg_cron` + `pg_net`, migração do Lastro). Testes em `supabase/functions/tests`. Passos restantes da Stripe: `STRIPE_INTEGRATION_TODO.md`. |
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
| 400 | `TERMS_NOT_ACCEPTED` | Checkout sem o aceite dos termos (`terms_accepted` diferente de `true`) |
| 401 | `UNAUTHENTICATED` | Rota de sessão sem sessão válida; função interna sem chave válida |
| 403 | `EMAIL_NOT_CONFIRMED` | Sessão de conta sem e-mail confirmado |
| 403 | `NOT_ENTITLED` | Sem direito ao arquivo |
| 403 | `FREE_GAMES_LOCKED` | Gratuito pedido por conta que nunca aceitou os e-mails (6.9) |
| 403 | `ORIGIN_NOT_ALLOWED` | `Origin` fora da lista |
| 404 | `NOT_FOUND` | Rota inexistente |
| 404 | `FILE_NOT_FOUND` | Arquivo inexistente, não publicado, trocado por versão nova ou fora do escopo |
| 405 | `METHOD_NOT_ALLOWED` | Método não aceito (header `Allow`) |
| 409 | `PRODUCT_UNAVAILABLE` | Produto inexistente, inativo ou sem preço no ambiente |
| 409 | `ALREADY_OWNED` | O usuário já tem todos os jogos do produto |
| 409 | `CART_EMPTY` | Checkout com carrinho vazio |
| 409 | `CART_CHANGED` | `cart_version` diferente da atual: o site recarrega o carrinho |
| 409 | `TERMS_CHANGED` | `terms_version` diferente da vigente: o site mostra o texto atual e pede o aceite de novo |
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
| `GET /account` | `get_account(uid)` | I2b |
| `PUT /account/marketing` | `set_marketing_consent(uid, granted, source, text_version)` → `get_account(uid)` | I2b |
| `POST /account/marketing/prompt` | `mark_marketing_prompt(uid)` → `get_account(uid)` | I2b |
| `GET /library` | `get_library(uid)` | I2b |
| `GET /account/export` | `export_account_data(uid)` | LGPD |
| `POST /account/delete` | `delete_account_data(uid)` → Auth admin `DELETE /auth/v1/admin/users/{uid}` (só com `deleted`) | LGPD |
| `POST /checkout` | `create_order_from_cart(uid, livemode, cart_version, terms_version, terms_accepted)` → Stripe Customer, se faltar → `set_stripe_customer(uid, customer_id)` → Checkout Session do formulário embutido → `attach_checkout_session(order_id, session_id, expires_at)` | I3 |
| `GET /order-status` | Stripe lê a sessão → `fulfill_order` ou `set_order_status`, se preciso → `get_order_status(order_id, uid)` | I3 |
| `POST /download-url` | `resolve_download(uid, file_id)` → assina no B2 | I4 |
| `GET /d/{token}` | `resolve_delivery(entitlement_id, game_id)` → assina no B2 | I4 |
| `GET /free-games` | `list_free_games()` | Gratuitos (2026-10-20) |
| `POST /free-download` | `resolve_free_download(user_id, file_id)` → assina no B2 | Gratuitos (2026-10-20) |
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
| `GET /health` | Pública | I0 | Implementada |
| `GET /catalog` | Pública | I2b | Implementada |
| `GET /cart` · `POST /cart/items` · `DELETE /cart/items/{code}` | Sessão | I2b | Implementada |
| `GET /account` · `PUT /account/marketing` · `POST /account/marketing/prompt` | Sessão | I2b | Implementada |
| `GET /library` | Sessão | I2b | Implementada |
| `GET /account/export` · `POST /account/delete` | Sessão | LGPD | Implementada |
| `POST /checkout` · `GET /order-status` | Sessão | I3 | Implementada |
| `POST /download-url` | Sessão | I4 | Planejada |
| `GET /d/{token}` | Token HMAC | I4 | Planejada |
| `GET /free-games` | Pública | Gratuitos | Implementada |
| `POST /free-download` | Sessão + aceite de e-mails registrado alguma vez | Gratuitos | Implementada |
| `GET` e `POST /email/unsubscribe` | Token HMAC | I5 | Planejada |

Rota ainda não implementada responde `404 NOT_FOUND`.

### 6.1 `GET /catalog`

Produtos à venda (`get_catalog()`: produtos ativos e vendáveis, com jogos). O preço é lido da Stripe pelo `stripe_price_id` de cada produto (`GET /v1/prices/{id}`, `Stripe-Version: 2026-03-25.dahlia`), com cache em memória de 5 minutos. O `stripe_price_id` não é exposto. Sem `STRIPE_SECRET_KEY` (local sem Stripe), com Price inativo ou inexistente, o preço sai `null`; em falha transitória, vale o último valor em cache.

`200`, com `Cache-Control: public, max-age=60`:

```json
{
  "products": [
    {
      "code": "P001",
      "kind": "bundle",
      "name": "<nome>",
      "games": [{ "code": "J001", "name": "<jogo>" }],
      "price": { "unit_amount": 0, "currency": "brl" }
    }
  ]
}
```

- `kind` é `bundle` ou `single`. Hoje só existe o P001 **[D1]**; o site não inventa produto nem preço.
- `price: null` quando não há preço lido da Stripe: sem chave (local), Price inexistente ou placeholder (seed), ou Stripe fora do ar sem cache. O site mostra "preço indisponível". **Adicionar ao carrinho continua permitido**: quem decide se o produto é vendável é o banco (`cart_add`), não o preço. **Finalizar compra fica desativado** enquanto o carrinho tiver `subtotal: null` ou aviso `PRICE_UNAVAILABLE`, `PRODUCT_UNAVAILABLE` ou `ALREADY_OWNED`.

### 6.2 Carrinho: `GET /cart`, `POST /cart/items`, `DELETE /cart/items/{code}`

Um carrinho por usuário, guardado no banco (vale entre aparelhos). Não há carrinho anônimo: sem sessão, o site leva a `/entrar?next=/carrinho&add=<code>` e adiciona o item depois do login.

- `POST /cart/items`, corpo `{ "product_code": "P001" }` → `cart_add`:

  | `outcome` | HTTP |
  | --- | --- |
  | `added` ou `noop` (já estava no carrinho) | `200` com o carrinho |
  | `already_owned` | `409 ALREADY_OWNED` |
  | `product_unavailable` (inexistente ou não vendável) | `409 PRODUCT_UNAVAILABLE` |

- `DELETE /cart/items/{code}` → `cart_remove` (`removed` ou `noop`): sempre `200` com o carrinho.
- As três rotas respondem o carrinho atualizado (`get_cart`, sem o `stripe_price_id`):

```json
{
  "version": 3,
  "items": [
    {
      "code": "P001",
      "kind": "bundle",
      "name": "<nome>",
      "games": [{ "code": "J001", "name": "<jogo>" }],
      "price": { "unit_amount": 0, "currency": "brl" },
      "status": "ok",
      "available": true,
      "owned_games": ["J001"],
      "shared_with": []
    }
  ],
  "subtotal": { "amount": 0, "currency": "brl" },
  "warnings": [{ "code": "PARTIAL_OVERLAP", "product_code": "P001" }]
}
```

| Campo ou aviso | Significado |
| --- | --- |
| `version` | Sobe a cada mudança e na compra. O checkout envia a versão que o usuário viu. Sem carrinho: `0` e `items: []` |
| `status` | `ok`, `unavailable` (deixou de ser vendável) ou `already_owned` (o usuário passou a ter todos os jogos). `available` é `status = ok`. O checkout recusa enquanto houver item fora de `ok` |
| `owned_games` | Jogos do produto que o usuário já tem (sobreposição parcial; padrão provisório **[D2]**: aceita, com aviso, sem desconto) |
| `shared_with` | Outros produtos do carrinho com jogos em comum |
| `subtotal` | Soma dos itens disponíveis; `null` se faltar preço de algum |
| Aviso `PARTIAL_OVERLAP` | Item com `owned_games` ou `shared_with` não vazio |
| Aviso `PRODUCT_UNAVAILABLE` / `ALREADY_OWNED` | Item com esse `status` |
| Aviso `PRICE_UNAVAILABLE` | Preço não lido da Stripe |

`POST /cart/items` também responde `400 INVALID_REQUEST` para código fora do formato.

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

- `source` aceito do site: `account`, `signup_prompt`, `cart` ou `free_games` (página Gratuitos). `signup_prompt`, `cart` e `free_games` só concedem; para retirar, `source` é `account`. As demais origens (`unsubscribe_link`, `brevo_webhook`, `support`) são só do servidor. Fora dessas regras, `400 INVALID_REQUEST`.
- `text_version` é obrigatório para conceder e opcional para revogar. Segue `^[A-Za-z0-9._-]{1,40}$`, o mesmo formato do banco, e é a versão do texto que a pessoa viu **[D6]**.
- Consentimento é sempre opcional: comprar não depende dele. Cada mudança vira uma linha no histórico; repetir o mesmo estado não cria linha (`noop`).

**Convite pós-login** (uma vez por conta, em qualquer aparelho):

- `marketing.prompted_at` é `null` enquanto o convite não foi respondido. O site mostra o convite após o login só com `opted_in = false` e `prompted_at = null`. A caixa no carrinho não depende disso.
- **Dispensar:** `POST /account/marketing/prompt`, sem corpo → `mark_marketing_prompt(uid)`. É idempotente: grava a primeira vez e mantém a data depois. Responde `200 { "marketing": { ... } }`.
- **Aceitar:** `PUT /account/marketing` com `source: "signup_prompt"`, que também preenche `prompted_at`.
- **Ver ou dispensar o convite não é consentimento.** O histórico de consentimento registra só as ações explícitas de conceder ou retirar.
- Com `prompted_at` ausente na resposta (API antiga), o site pode usar a dispensa no `localStorage` por usuário como fallback; com o campo presente, vale só o servidor.

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

Corpo: `{ "cart_version": 3, "terms_accepted": true, "terms_version": "termos-2026-10" }`.

O aceite dos termos (sem reembolso) é colhido **na nossa página**, numa caixa obrigatória antes de montar o formulário. O Studio não configurou `consent_collection`.

0. **Validação:**
   - `terms_accepted` diferente de `true` → `400 TERMS_NOT_ACCEPTED`;
   - `terms_version` diferente de `TERMS_VERSION` → `409 TERMS_CHANGED`;
   - `cart_version` inteiro ≥ 0, senão `400 INVALID_REQUEST`.
1. `create_order_from_cart(uid, livemode, cart_version, terms_version, terms_accepted)` confere a versão e os itens. Cria o pedido `open` com `order_items` e grava `terms_version` e `terms_accepted_at` (data-contract v0.3.1; `KT007` se o aceite não for `true`). Reaproveita o pedido `open` da mesma versão do carrinho e dos termos (`reused`). Devolve `outcome`, `order_id`, itens (`product_code`, `stripe_price_id`), e-mail da conta, `stripe_customer_id` e `detail`.

   | `outcome` | HTTP |
   | --- | --- |
   | `ok` | segue |
   | `cart_empty` | `409 CART_EMPTY` |
   | `cart_changed` | `409 CART_CHANGED`, com `details.cart_version` |
   | `product_unavailable` | `409 PRODUCT_UNAVAILABLE`, com `details.product_codes` |
   | `already_owned` | `409 ALREADY_OWNED`, com `details.product_codes` (comprado em outra aba) |

2. **Customer.** Sem `stripe_customer_id`, cria o Customer com o e-mail da conta, `metadata.user_id` e idempotency key `customer:<user_id>`, e grava com `set_stripe_customer(uid, customer_id)`. A RPC devolve o id vigente; se outra requisição gravou antes, vale o dela. Se o e-mail da conta mudou, atualiza o Customer antes.
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
   | `line_items` | Uma por item do pedido: `{ price: stripe_price_id, quantity: 1 }`, na ordem de `position` | Pedido |
   | `client_reference_id` | `order_id` | Nossa arquitetura |
   | `customer` | `stripe_customer_id` | Nossa arquitetura |
   | `metadata` | `{ order_id, terms_version }` | Nossa arquitetura |
   | `allow_promotion_codes` | `true`: o cliente digita o cupom no formulário | Nossa decisão (cupons) |
   | `payment_intent_data.metadata` | `{ order_id }`, para achar o pedido nas contestações; se faltar, a rota busca a sessão pelo `payment_intent` | Nossa arquitetura |
   | `locale` | `'pt-BR'` | Nossa arquitetura |
   | `return_url` | `SITE_URL/pedido/confirmacao?session_id={CHECKOUT_SESSION_ID}` | Nossa arquitetura |

   - `payment_method_collection` **não entra**: o Studio só o usa em `mode: subscription`.
   - Não há `consent_collection`, `custom_text`, `success_url` nem `cancel_url`: no formulário embutido não existem; quem desiste fica na nossa página.
   - Os métodos de pagamento seguem a conta Stripe **[D9]**.
4. `attach_checkout_session(order_id, session_id, expires_at)`. Se falhar, só vai para o log: webhook e confirmação acham o pedido pelo `client_reference_id`.

`200 { "client_secret": "<client_secret da sessão>" }`.

- O `client_secret` permite concluir aquele pagamento: nunca vai para log nem URL, e a resposta é `no-store`.
- Pedido reaproveitado devolve a mesma sessão (mesma chave de idempotência), dentro da janela de 24 h da Stripe.
- A sessão expira no prazo padrão da Stripe **[D9]**. Ao expirar, o webhook marca o pedido `expired` e o funil registra `checkout_expired`.

Erros: `400 INVALID_REQUEST`, `400 TERMS_NOT_ACCEPTED`, `409 TERMS_CHANGED`, os da tabela do passo 1, `401`, `403 EMAIL_NOT_CONFIRMED` e `502 PAYMENT_PROVIDER_ERROR`.

**Verificado na API de teste (2026-10-08):** `ui_mode: 'form'` com os parâmetros do Studio, `allow_promotion_codes: true` e `payment_intent_data.metadata` criam a sessão juntos, com `client_secret` e validade de 24 h.

**Cupons:**

- O cliente aplica o código no formulário embutido (`checkout.applyPromotionCode` e `checkout.removePromotionCode`), e o total se atualiza antes de confirmar. Os cupons são criados pelo responsável na Stripe (Coupon e Promotion Code).
- O valor que vale é sempre o cobrado pela Stripe. Na liberação, o pedido grava `amount_subtotal` (preço cheio), `amount_discount` (`total_details.amount_discount`), `amount_total` e o texto do código promocional. Os itens guardam o preço unitário cheio.
- `/account` mostra esses campos por pedido. O site não exibe preço riscado fictício.
- `payment_status = no_payment_required` (cupom de 100%) só é aceito pelo banco com total 0 e desconto maior que zero.

### 6.5.1 Stripe: versão da API, SDK e risco do preview

- **Cliente no servidor:** `new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2026-03-25.dahlia; custom_checkout_payment_form_preview=v1' })`.
- **SDK fixo:** `npm:stripe@22.0.2` no `supabase/functions/deno.json`, cuja API padrão é a `2026-03-25.dahlia` (registrado no `STRIPE_INTEGRATION_TODO.md`). Nunca faixa de versão. Cliente HTTP por `fetch`; criptografia do webhook pelo Web Crypto.
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

`GET /account/export` → `export_account_data(uid)`. Responde `200` com o JSON da cópia e `Content-Disposition: attachment; filename="keytotwo-meus-dados.json"`; o site salva o arquivo. Sem ids internos (pedidos pelo `ref` de 8 caracteres):

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

- **Autenticação:** header `apikey` igual a uma chave secreta do projeto, comparada em tempo constante. Na nuvem é a chave nomeada `dispatch`, criada no painel e guardada no Vault para o `pg_net`; no local, a `default`. Não precisa de variável nova. Sem chave válida → `401`.
- **Corpo:** `{ "limit": 20 }` (de 1 a 100), ou `{ "outbox_id": "<uuid>" }` para um e-mail específico. Corpo inválido → `400`; método diferente de `POST` → `405`.
- **Passos:**
  1. `claim_email_batch(limit, outbox_id)` (o terceiro parâmetro, `p_now`, só serve aos testes). A RPC troca as linhas para `sending` com `SKIP LOCKED` e retoma as presas em `sending` há mais de 10 minutos.
     - Marketing: pula (`skipped`, com motivo) quem não tem opt-in, quem está suprimido, o lembrete de carrinho que mudou ou foi pago e o pós-compra de pedido fora de `paid`. O limite de 1 e-mail de marketing por dia adia para o dia seguinte.
     - Entrega: cancela se o pedido não está `paid` ou se algum direito foi revogado.
  2. Para cada linha, monta o e-mail a partir do `payload`. Entrega: assunto "Seus jogos chegaram (pedido <ref>)", um botão por jogo com link `GET /d/{token}` (30 dias, base `API_PUBLIC_URL`), o botão Meus jogos (`SITE_URL/meus-jogos`) e o link de ajuda. Lembrete de carrinho: assunto "Ficou um jogo no carrinho", os itens e o botão Voltar ao carrinho (`/carrinho`). Pós-compra: "Já rolou a primeira partida?", os jogos, Meus jogos e as dicas de impressão (`/ajuda#impressao`). Todo marketing leva o rodapé de descadastro (seção 6.10) e os headers `List-Unsubscribe: <API_PUBLIC_URL/email/unsubscribe?token=...>` e `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Marketing sem `user_id` ou sem itens e `kind` desconhecido → `rejected`.
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
| `charge.dispute.created` | `set_order_status('disputed')`: revoga todos os itens |
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
| **`EMAIL_LINK_SECRET`** (+ `EMAIL_LINK_SECRET_PREVIOUS` opcional) | `api`, `email-dispatch` | **Nova, secreta** |
| **`BREVO_WEBHOOK_SECRET`** | `brevo-webhook` | **Nova, secreta**, já no modelo. É o token Bearer cadastrado no webhook da Brevo |
| **`BREVO_TEMPLATE_DELIVERY`**, **`BREVO_TEMPLATE_CART_REMINDER`**, **`BREVO_TEMPLATE_POST_PURCHASE`** | `email-dispatch` | **Novas**, ids (não secretos) |
| **`TERMS_VERSION`** | `api` | **Nova**, não secreta. Versão vigente dos termos mostrada na página de checkout; o aceite precisa vir com ela. Desde 2026-10-19: `termos-2026-10-19` (`src/content/legal.ts`, `termsVersion`); o site manda a mesma, salvo `VITE_TERMS_VERSION` **[D11]** |

`STRIPE_PRICE_ID_P001` deixa de ser lida pelas funções: o Price de cada ambiente fica em `products.stripe_price_id`, gravado pelo script do ambiente.

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

## 12. Pendências

- **[D1]** Catálogo além do P001. **[D2]** Posse sobreposta (padrão provisório na seção 6.2). **[D3]** Fluxos e prazos de follow-up. **[D4]** Links ou anexos e validade do link. **[D5]** Reembolso parcial. **[D6]** Texto e versão do consentimento. **[D7]** Remetentes. **[D8]** Plano da Brevo e conteúdo promocional pela API. **[D9]** Métodos de pagamento, URL dos termos e validade da sessão. **[D11]** Termos, Política de reembolso e Política de privacidade escritos (2026-10-19); falta a validação jurídica. **[D12]** Condições do jogo gratuito.
- Webhook da Brevo: cadastrar na conta (tipo `transactional`, eventos `hard_bounce`, `invalid_email`, `blocked`, `spam` e `unsubscribed`, `auth` bearer com o `BREVO_WEBHOOK_SECRET`) quando houver URL pública (I6). Os eventos de marketing da Brevo (campanhas) não são usados.
- Página `/email/preferencias` no site (Aquarela).
- Limite de abuso nas rotas públicas que gravam (`/free-download`) e no carrinho: taxa ou CAPTCHA antes da produção.
- Login com Google configurado localmente e ainda não testado: falta credencial.
- Revisão cruzada com `docs/data-contract.md` v0.3.1 concluída: assinaturas, `outcome`, códigos `KT` e o aceite dos termos no checkout estão alinhados.
- Stripe em preview (seção 6.5.1): versão exata do SDK, `payment_intent_data` no modo `form` e versão do endpoint do webhook, a confirmar no I3.
- Brevo: envio real ainda não feito. A chave v3 está no modelo, mas a conta recusa a API por IP não autorizado (`401 unauthorized`). O responsável precisa desativar a restrição de IP da chave (as Edge Functions não têm IP fixo) ou autorizar o IP do teste, e confirmar que `EMAIL_FROM` está ativo como remetente na Brevo.
- `email-dispatch` na nuvem: criar a chave secreta nomeada `dispatch` e guardá-la no Vault para o `pg_net` (I5, com a agenda).
- `GET /d/{token}` com token inválido responde JSON `401`; uma página amigável para quem clica num link corrompido pode vir depois.
