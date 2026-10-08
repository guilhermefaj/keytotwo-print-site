# Contrato da API — KeyToTwo

Estado: I0, 2026-10-08, alinhado com `docs/data-contract.md` v0.2 (11 RPCs). Só `GET /health` está implementada; as demais rotas entram nos incrementos indicados. Fontes: nota "Plano do site P1" (seção 4 e ajustes do orquestrador) e a especificação "Marketing/Site - Compra e acesso" da base. Mudanças neste contrato passam pelo Backend sênior; schema, permissões e RPCs seguem `docs/data-contract.md` (Dados).

## 1. Funções e endereço

| Função | Uso | `verify_jwt` | CORS |
| --- | --- | --- | --- |
| `api` | Rotas chamadas pelo site, com roteamento interno | `false` | Lista de origens |
| `stripe-webhook` (I4) | Eventos da Stripe; corpo bruto e assinatura | `false` | Não |

Base da `api`: `<SUPABASE_URL>/functions/v1/api/<rota>`.

- Local: `http://127.0.0.1:54321/functions/v1/api/<rota>`.
- Teste: projeto `keytotwo-print-db` (sa-east-1). Deploy só com autorização da tarefa.

## 2. Autenticação

O projeto assina os tokens de sessão com chave assimétrica (ES256, conferido no JWKS público em 2026-10-08). O site usa a chave publishable (`sb_publishable_...`), que não é JWT. Por isso o gateway não valida nada (`verify_jwt = false`) e cada rota decide no código (`_shared/auth.ts`):

- **Pública:** ignora o `Authorization`.
- **Sessão opcional:** sem token, ou com token inválido ou expirado, a rota segue como anônima. A compra feita assim é vinculada depois pelo e-mail verificado.
- **Sessão obrigatória:** sem token válido, `401 UNAUTHENTICATED`. O site pede nova entrada e volta ao destino.

Headers enviados pelo site:

| Header | Quando | Valor |
| --- | --- | --- |
| `apikey` | Sempre | Chave publishable do ambiente |
| `Authorization` | Só com sessão | `Bearer <access_token>` do Supabase Auth |
| `Content-Type` | Rotas `POST` | `application/json` |

Uma chave de API (`sb_...`) no `Authorization` não conta como sessão. Token válido só conta como sessão com `role = authenticated` e usuário não anônimo. A validação usa `auth.getClaims()` com cache do JWKS. Falha de rede ao validar gera `500 INTERNAL_ERROR`, e não `401`, para o site não encerrar a sessão por instabilidade.

O login não tem rota própria. O site usa o supabase-js: `signInWithOtp` (código de 6 dígitos, `shouldCreateUser: true`), `verifyOtp` (`type: 'email'`) e `signOut`. A mensagem exibida após o envio do código é a mesma para qualquer e-mail.

## 3. CORS e origem

- `ALLOWED_ORIGINS` (segredo da função) lista as origens do site, separadas por vírgula. Sem valor, nenhuma origem de navegador é aceita.
- `OPTIONS` responde `204`. Com origem permitida, inclui `Access-Control-Allow-Origin` (a própria origem, nunca `*`), `Allow-Headers: authorization, apikey, content-type, x-client-info`, `Allow-Methods: GET, POST, OPTIONS` e `Max-Age: 600`.
- Requisição com `Origin` fora da lista: `403 ORIGIN_NOT_ALLOWED`, sem executar a rota.
- Requisição sem `Origin` (curl, servidor) segue para a rota; a autorização continua valendo.
- Respostas de sucesso e de erro levam `Access-Control-Allow-Origin` quando a origem é permitida, para o site ler o código do erro.
- No ambiente local, o gateway da CLI (Kong, porta 54321) responde o `OPTIONS` sozinho e troca o `Access-Control-Allow-Origin` por `*`. O `403 ORIGIN_NOT_ALLOWED` continua valendo. Os headers de CORS da função só podem ser conferidos no projeto de teste ou chamando o edge runtime direto na rede do Docker.

## 4. Formato

- Corpo JSON em UTF-8. Respostas com `Cache-Control: no-store` e `X-Content-Type-Options: nosniff`.
- `POST` exige `Content-Type: application/json` e corpo de até 16 KB.
- Datas em ISO 8601 (UTC). Valores monetários em unidade mínima da moeda (centavos), com `currency` em minúsculas, como na Stripe (ex.: `brl`).
- Identificadores de arquivo são UUID. Campos novos podem ser acrescentados; o site ignora campos desconhecidos.
- Erro: `{ "error": { "code": "<CÓDIGO>", "message": "<texto em pt-BR>" } }`. O site decide pelo `code`; a `message` serve de apoio.

| HTTP | `code` | Quando |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | Corpo, JSON ou parâmetro inválido |
| 401 | `UNAUTHENTICATED` | Rota com sessão obrigatória sem sessão válida |
| 403 | `NOT_ENTITLED` | Sessão válida sem direito ao arquivo |
| 403 | `ORIGIN_NOT_ALLOWED` | `Origin` fora de `ALLOWED_ORIGINS` |
| 404 | `NOT_FOUND` | Rota inexistente |
| 404 | `FILE_NOT_FOUND` | Arquivo inexistente, não publicado ou fora do escopo da rota |
| 405 | `METHOD_NOT_ALLOWED` | Método não aceito (header `Allow` indica os aceitos) |
| 409 | `PRODUCT_UNAVAILABLE` | Produto inexistente, inativo ou sem preço no ambiente |
| 413 | `PAYLOAD_TOO_LARGE` | Corpo acima de 16 KB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | `POST` sem `application/json` |
| 500 | `INTERNAL_ERROR` | Falha inesperada ou de configuração |
| 502 | `PAYMENT_PROVIDER_ERROR` | Falha ao falar com o provedor de pagamento |
| 503 | `FILE_UNAVAILABLE` | Direito confirmado, arquivo temporariamente indisponível |

Logs registram só tipo e mensagem do erro. Nunca registram e-mail, token, corpo ou URL assinada.

## 5. Banco de dados

- `anon` e `authenticated` não têm GRANT em tabela, sequência nem função (decisão do orquestrador; data-contract D-1). O site nunca lê o banco direto: biblioteca, conta e demais leituras passam por esta API.
- As funções usam a chave secreta (`SUPABASE_SECRET_KEYS`, em `_shared/admin.ts`, I2) e chamam só as RPCs `SECURITY DEFINER` com `EXECUTE` para `service_role`. Nenhuma rota lê tabela direto. A única exceção é o envio do e-mail de acesso: o `service_role` mantém `SELECT` só em `email_outbox` (P-14, aprovado) e troca as colunas de envio por compara-e-troca.
- A rota valida a sessão (seção 2) e passa ao banco só o `user_id` validado. Nenhum dado do navegador vira argumento sem validação de formato.
- Cada RPC é uma transação. Stripe e B2 ficam fora dela: a rota lê a Stripe, chama a RPC com os dados lidos e só assina a URL do B2 depois da RPC.
- `livemode` vem da chave da Stripe do ambiente (`sk_test_...` = `false`), nunca do navegador.
- Resultados de negócio voltam em `outcome`. Erros `KT...`: `KT003` vira `409 PRODUCT_UNAVAILABLE`; os demais e `23505` indicam defeito e viram `500 INTERNAL_ERROR`, registrados só com o código.

## 6. Rotas da `api`

| Método e rota | Sessão | Chamadas ao banco | Incremento | Estado |
| --- | --- | --- | --- | --- |
| `GET /health` | Pública | Nenhuma | I0 | Implementada |
| `GET /library` | Obrigatória | `claim_orders(uid)` → `get_library(uid)` | I2 | Planejada |
| `GET /account` | Obrigatória | `claim_orders(uid)` → `get_account(uid)` | I2 | Planejada |
| `POST /download-url` | Obrigatória | `resolve_download(uid, file_id)` → assina no B2 | I3 | Planejada |
| `GET /free-game` | Pública | `get_free_game()` | I3 | Planejada |
| `POST /free-download` | Pública | `resolve_free_download(file_id)` → assina no B2 | I3 | Planejada |
| `POST /checkout` | Opcional | `create_order` → Stripe cria a sessão → `attach_checkout_session` | I4 | Planejada; depende da decisão sobre o Stripe |
| `GET /order-status` | Opcional | Stripe lê a sessão → `fulfill_order` ou `set_order_status` se preciso → `get_order_status` | I4 | Planejada; depende da decisão sobre o Stripe |

Rota ainda não implementada responde `404 NOT_FOUND`.

### `GET /health`

Verifica só se a função está no ar; não consulta banco nem serviços externos.

`200 { "status": "ok", "service": "api" }`

### `GET /library`

Biblioteca do usuário (Meus jogos). Primeiro `claim_orders(uid)` vincula ao usuário os pedidos sem dono cujo e-mail seja igual ao e-mail confirmado da conta (`email_confirmed_at`), sem nunca trocar o dono de um pedido. Depois `get_library(uid)` devolve só direitos ativos, com a composição registrada na compra e a versão publicada vigente de cada jogo.

`200`:

```json
{
  "products": [
    {
      "code": "P001",
      "name": "<nome do pacote>",
      "purchased_at": "2026-10-08T12:00:00Z",
      "games": [
        {
          "code": "J001",
          "name": "<nome do jogo>",
          "files": [{ "id": "<uuid>", "kind": "pdf", "version": "<versão>", "size_bytes": 0 }]
        }
      ],
      "bundle_file": { "id": "<uuid>", "kind": "zip", "version": "<versão>", "size_bytes": 0 }
    }
  ],
  "pending": [{ "product_name": "<nome do pacote>", "created_at": "2026-10-08T12:00:00Z" }]
}
```

- `products: []` é o estado sem compras. Um item por produto, mesmo com mais de um pedido pago; `purchased_at` é a primeira liberação.
- Jogo com `files: []` está temporariamente indisponível; a compra continua valendo e o site mostra a mensagem de indisponível.
- `bundle_file` é `null` sem ZIP publicado (decisão pendente).
- `pending` lista pedidos `pending_payment`, do mais recente ao mais antigo, para quem pagou por método assíncrono não ver o estado sem compras.
- `name` e `product_name` vêm `null` enquanto o nome comercial estiver pendente.
- Nunca traz chave do B2 nem URL.

Erros: `401 UNAUTHENTICATED`.

### `GET /account`

`claim_orders(uid)` e depois `get_account(uid)`. Lista os pedidos do usuário, do mais recente ao mais antigo, sem os checkouts abandonados (`open` e `expired`).

`200`:

```json
{
  "email": "<e-mail da conta>",
  "orders": [
    {
      "ref": "<referência curta do pedido>",
      "product_name": "<nome do pacote>",
      "created_at": "2026-10-08T12:00:00Z",
      "paid_at": "2026-10-08T12:01:00Z",
      "amount_total": 0,
      "currency": "brl",
      "status": "paid",
      "receipt_url": "<comprovante, quando disponível>"
    }
  ]
}
```

- `ref` é derivada do id do pedido (8 caracteres, como no contrato de dados).
- `status` usa os estados de pedido do contrato de dados: `pending_payment`, `paid`, `failed`, `refunded` ou `disputed`. `paid_at` é `null` fora de `paid`, `refunded` e `disputed`.
- `email` é `null` se a conta foi removida.
- `receipt_url` é opcional e está pendente. O banco não guarda URL (I-11). Se for adotado, a rota busca o comprovante na Stripe no momento da consulta; para isso, `get_account` precisará devolver o intent de cada pedido.

Erros: `401 UNAUTHENTICATED`.

### `POST /download-url`

Corpo: `{ "file_id": "<uuid>" }`.

`resolve_download(uid, file_id)` confere direito ativo ao jogo ou pacote do arquivo e arquivo publicado. Só com `outcome = ok` a rota assina a URL pré-assinada do bucket privado no Backblaze B2, com `bucket`, `object_key` e `filename` vindos da RPC e validade curta (proposta: 300 s). Ao expirar, o site chama a rota de novo. A RPC registra o `download_event` (sem IP) ao emitir a URL; o registro não comprova que o download terminou.

`200 { "url": "<url assinada>", "expires_at": "2026-10-08T12:05:00Z", "filename": "<nome do arquivo>" }`

| `outcome` | HTTP |
| --- | --- |
| `ok` | `200` |
| `not_found` (id inexistente, arquivo grátis ou não publicado para quem não tem direito) | `404 FILE_NOT_FOUND` |
| `not_entitled` (outro usuário, direito revogado) | `403 NOT_ENTITLED` |
| `unavailable` (direito válido, arquivo não publicado) | `503 FILE_UNAVAILABLE` |

Erros: `400 INVALID_REQUEST` (`file_id` fora do formato UUID, validado antes da RPC) e `401 UNAUTHENTICATED`. Conhecer um `file_id` não basta: sem direito, `403`. Com `404`, o site recarrega a biblioteca, porque o arquivo pode ter sido trocado por uma versão nova.

### `GET /free-game`

`200 { "available": false }`, ou:

```json
{ "available": true, "game": { "name": "<nome>" }, "file": { "id": "<uuid>", "version": "<versão>", "size_bytes": 0 } }
```

Vem de `get_free_game()`, que só responde `available: true` com jogo `free` publicado e PDF `free` publicado. A rota repassa só `name`, `id`, `version` e `size_bytes`. Com `available: false`, o site não mostra botão nem link. Conteúdo e condições do jogo gratuito estão pendentes; condições futuras (ex.: e-mail) entram no servidor sem mudar esta rota.

### `POST /free-download`

Corpo: `{ "file_id": "<uuid>" }`. Assina só arquivo `access = free` e publicado, sem login e separado da autorização paga.

`200 { "url": "<url assinada>", "expires_at": "2026-10-08T12:05:00Z" }`

`resolve_free_download(file_id)`: `ok` assina a URL; `not_found` (inclusive id de arquivo pago) vira `404`. A RPC registra `download_event` gratuito sem `user_id`.

Erros: `400 INVALID_REQUEST`, `404 FILE_NOT_FOUND`, `503 FILE_UNAVAILABLE` (falha do B2). Rota pública que grava no banco: limite de abuso pendente (seção 8).

### `POST /checkout`

Corpo: `{ "product_code": "P001" }`.

1. `create_order(product_code, livemode, uid ou null, e-mail da conta ou null)` cria o pedido `open` e devolve o `stripe_price_id` do ambiente. `livemode` é obrigatório. `KT003` (produto não vendável) vira `409 PRODUCT_UNAVAILABLE`.
2. A Stripe cria a Checkout Session hospedada: pagamento único, Price do produto no ambiente, `client_reference_id = order_id`, idempotency key = `order_id`, locale pt-BR, métodos conforme a conta e e-mail pré-preenchido quando há sessão. Falha vira `502 PAYMENT_PROVIDER_ERROR`; o pedido `open` sem sessão fica inofensivo.
3. `attach_checkout_session(order_id, session_id, expires_at)`. Se falhar, só vai para o log: webhook e `/order-status` acham o pedido pelo `client_reference_id`.

O preço vem do Price do produto no banco, nunca do site.

`200 { "checkout_url": "<url da Stripe>" }`. O site redireciona e não carrega Stripe.js.

Erros: `400 INVALID_REQUEST`, `409 PRODUCT_UNAVAILABLE`, `502 PAYMENT_PROVIDER_ERROR`.

### `GET /order-status?session_id=<id da Checkout Session>`

Usada pela página de confirmação. A URL não prova pagamento:

1. A rota lê a sessão na Stripe pelo `session_id` (formato `cs_...` validado antes) e pega o `order_id` do `client_reference_id`. Não depende de `attach_checkout_session` ter gravado a sessão.
2. Se a Stripe pede mudança e o pedido ainda não chegou lá, roda a mesma liberação idempotente do webhook com `p_source = 'return_page'`: `fulfill_order` para sessão paga; `set_order_status` para `pending_payment` ou `expired`.
3. `get_order_status(order_id, uid ou null)` devolve `outcome` (`ok` ou `not_found`), o estado do pedido, o nome do produto e a relação da sessão com o pedido. O e-mail do comprador não sai do banco.

`200`:

```json
{ "state": "paid", "product_name": "<nome do pacote>", "next": "sign_in", "email_hint": "<pendente>" }
```

| `state` | Situação | Ação do site |
| --- | --- | --- |
| `paid` | Pagamento confirmado e acesso liberado | Conforme `next` |
| `processing` | Pagamento confirmado, liberação em andamento | Consultar de novo com recuo; oferecer Ajuda |
| `pending_payment` | Pagamento assíncrono aguardando confirmação | Avisar que o acesso sai após a confirmação |
| `failed` | Pagamento não concluído ou recusado | Orientar nova tentativa, sem afirmar cobrança |
| `expired` | Checkout expirado sem pagamento | Voltar à oferta |
| `not_found` | Sessão desconhecida | Orientar Ajuda |

Origem do `state`:

| Pedido no banco / sessão na Stripe | `state` |
| --- | --- |
| `paid` | `paid` |
| Sessão paga, mas a liberação falhou (erro transitório) | `processing` |
| `pending_payment` | `pending_payment` |
| `failed`, ou sessão ainda `open` (pagamento não concluído) | `failed` |
| `expired` | `expired` |
| Sessão inexistente na Stripe, sem `client_reference_id` válido, ou `get_order_status` com `outcome = not_found` | `not_found` |
| `refunded` ou `disputed` | `not_found` até a regra de reembolso ser decidida (orienta Ajuda) |

`next` vem só com `paid`, conforme o `relation` devolvido por `get_order_status`:

| `relation` | `next` |
| --- | --- |
| `anonymous` | `sign_in` |
| `owner` ou `claimable` (pedido sem dono com o mesmo e-mail confirmado da sessão; a biblioteca o vincula) | `open_library` |
| `other` | `other_account`. Nenhum dado do comprador é exibido |

Em `processing` não há `next`: o pedido ainda está `open` e sem e-mail gravado, então `relation` daria `other` mesmo para o comprador. O site mostra "Estamos preparando seu acesso", consulta de novo e oferece Ajuda.

`email_hint` (e-mail mascarado) depende de decisão pendente e fica fora até ser aprovado. Fora a dica, a resposta não traz dado pessoal.

Erros: `400 INVALID_REQUEST`, `502 PAYMENT_PROVIDER_ERROR`.

## 7. `stripe-webhook` (I4, depende da decisão sobre o Stripe)

`POST` da Stripe com corpo bruto e header `Stripe-Signature`.

Ordem:

1. Confere a assinatura no corpo bruto. Se for inválida, responde `400` sem tocar no banco.
2. Identifica o pedido. Nos eventos `checkout.session.*`, pelo `client_reference_id`; sessão sem UUID nosso (não criada pela api) responde `200` com log, sem RPC. Nos eventos `charge.*`, a rota busca na Stripe a sessão do `payment_intent` e usa o `client_reference_id` dela. Não depende de o banco já ter o intent gravado.
3. Faz uma única RPC. O `event.id` é gravado em `stripe_events` na mesma transação do efeito (data-contract D-4); falha antes do commit não deixa rastro e a Stripe reenvia.
4. Responde. O e-mail de acesso sai depois do commit, em segundo plano (`EdgeRuntime.waitUntil`), só quando a RPC devolve `send_access_email = true`. O envio usa compara-e-troca em `email_outbox`. Se o e-mail falhar, o acesso continua valendo.

| Evento | RPC |
| --- | --- |
| `checkout.session.completed` com `payment_status = paid` | `fulfill_order` |
| `checkout.session.completed` com `payment_status = unpaid` | `set_order_status('pending_payment')` com e-mail, valor e intent |
| `checkout.session.async_payment_succeeded` | `fulfill_order` |
| `checkout.session.async_payment_failed` | `set_order_status('failed')` |
| `checkout.session.expired` | `set_order_status('expired')` |
| `charge.refunded` com reembolso total | `set_order_status('refunded')`; reembolso parcial responde `200` sem RPC (P-7) |
| `charge.dispute.created` (depois do P1) | `set_order_status('disputed')` |

A Stripe não garante a ordem de entrega dos eventos. Por isso `async_payment_failed` antes do `completed` aplica `open → failed`, e reembolso ou contestação antes da liberação devolvem `deferred`.

| Resultado | Resposta |
| --- | --- |
| `applied`, `noop`, `duplicate_event`, `ignored`, `not_found` | `200` |
| `deferred`: reembolso ou contestação com pedido ainda `open` ou `pending_payment`; nada muda e o evento não é gravado | `500`, para a Stripe reenviar depois da liberação |
| `KT001`, `KT002` (ex.: `no_payment_required`), `KT004`, `KT005`, `KT007` ou `23505` | `200` com log de erro; reenviar não resolve |
| Falha de rede ou de banco, ou timeout | `500`, para a Stripe reenviar |

## 8. Pendências

- [PENDENTE] Decisão sobre o Stripe: condiciona `/checkout`, `/order-status`, `stripe-webhook` e `receipt_url`.
- [PENDENTE] Dica de e-mail mascarado em `/order-status` (`email_hint`).
- [PENDENTE] Regra de reembolso e contestação: efeito sobre o acesso e o `status` em `/account`.
- [PENDENTE] Jogo gratuito: conteúdo, condições e nome da rota no site.
- [PENDENTE] ZIP completo (`bundle_file`).
- [PENDENTE] Origens de teste e produção em `ALLOWED_ORIGINS` (domínio e subdomínio de teste na VPS).
- [PENDENTE] Limite de abuso nas rotas públicas que gravam no banco (`/checkout`, `/free-download`): taxa por cliente ou CAPTCHA antes da produção.
- [PENDENTE] Nome do pacote no e-mail de acesso: com `SELECT` só em `email_outbox` (P-14), o envio não lê o produto. O contrato de dados precisa guardar o nome na fila ou devolvê-lo por RPC.
