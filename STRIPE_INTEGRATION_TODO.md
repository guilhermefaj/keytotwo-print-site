# Integração Stripe — o que falta e como operar

Fonte única dos passos restantes da integração com a Stripe (nota "Stripe Checkout Studio", item 10). Estado em 2026-10-08: checkout com formulário embutido, confirmação e webhook implementados e testados localmente, **em modo de teste**; o I3-V validou o pagamento real de teste de ponta a ponta, menos o formulário no navegador (seção 5.1). Nada foi publicado no Supabase remoto.

Contrato das rotas: `docs/api-contract.md` (seções 6.5, 6.6 e 9). Código: `supabase/functions/api/routes/{checkout,order-status}.ts`, `supabase/functions/_shared/{stripe,fulfillment}.ts` e `supabase/functions/stripe-webhook/`.

## 1. Valores a substituir

Nunca cole valores neste arquivo. Os valores ficam em `D:/Maestri/keytotwo-print-site-secrets/.env` e, no local, em `supabase/functions/.env` (ignorado pelo git).

| Item | Teste (hoje) | Antes da produção |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` (funções) | `sk_test_...` da conta BR | Chave live, de preferência restrita (`rk_live_...`) às permissões usadas: Customers, Checkout Sessions, PaymentIntents (leitura) e Prices (leitura) |
| `STRIPE_WEBHOOK_SECRET` (funções) | Segredo do endpoint de teste | Segredo do endpoint live |
| `VITE_STRIPE_PUBLISHABLE_KEY` (site) | `pk_test_...` | `pk_live_...` |
| Price do P001 | "KeyToTwo pack 01", R$ 19,90, one_time, **valor de teste** (`STRIPE_PRICE_ID_P001`) | Price live com o preço aprovado pelo responsável, gravado em `products.stripe_price_id` do ambiente |
| `TERMS_VERSION` | `rascunho-2026-10-08` | Versão do texto validado por advogado (D11) |
| `SITE_URL` | `http://127.0.0.1:5178` no local (prévia do redesign); subdomínio de teste no remoto | `https://keytotwo.com.br` |
| Cupons | `TESTE10` (abaixo) | Cupons reais criados pelo responsável no modo live |

**Cupom de teste** (criado em 2026-10-08, só em modo de teste, com autorização do orquestrador):

- Coupon `80pc8vWv`: 10%, duração `once`, nome "TESTE 10% (KeyToTwo, só modo de teste)".
- Promotion Code `promo_1UOLNPEtA6WNSLpd5GjL9HaH`: código `TESTE10`.

## 2. Parâmetros configurados

**Cliente no servidor:** SDK `npm:stripe@22.0.2` (API padrão `2026-03-25.dahlia`), com `apiVersion: '2026-03-25.dahlia; custom_checkout_payment_form_preview=v1'`. A regra do `ui_mode` é `'form'` com SDK ≥ 21.0.0; abaixo disso, `'custom'`.

**Checkout Session** (`POST /checkout`, idempotency key `checkout:<order_id>`):

| Parâmetro | Valor | Origem |
| --- | --- | --- |
| `ui_mode` | `form` | Studio |
| `billing_address_collection` | `auto` | Studio (fixo) |
| `phone_number_collection` | `{ enabled: false }` | Studio (fixo) |
| `automatic_tax` | `{ enabled: false }` | Studio (fixo) |
| `submit_type` | `auto` | Studio (fixo) |
| `integration_identifier` | `custom_embedded_web_0001` | Studio (fixo) |
| `mode` | `payment` | Studio |
| `line_items` | Um por item do pedido: `{ price, quantity: 1 }` | Pedido |
| `allow_promotion_codes` | `true` (cupons) | Nossa decisão |
| `client_reference_id` | `order_id` | Nossa arquitetura |
| `customer` | Customer do usuário (criado no 1º checkout, idempotency key `customer:<user_id>`) | Nossa arquitetura |
| `metadata` | `{ order_id, terms_version }` | Nossa arquitetura |
| `payment_intent_data.metadata` | `{ order_id }`, para as contestações | Nossa arquitetura |
| `locale` | `pt-BR` | Nossa arquitetura |
| `return_url` | `SITE_URL/pedido/confirmacao?session_id={CHECKOUT_SESSION_ID}` | Nossa arquitetura |

- `payment_method_collection` não entra (só vale em `subscription`).
- Não há `consent_collection`: o aceite dos termos é colhido na nossa página e gravado no pedido.
- Verificado na API de teste em 2026-10-08: essa combinação cria a sessão `ui_mode: form` com `client_secret`, `allow_promotion_codes: true` e validade de 24 h.

**Aparência do formulário:** a da nota "Stripe Checkout Studio", sem mudanças.

## 3. Setup

**Local (feito):**

1. `supabase/functions/.env` com `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_P001`, `TERMS_VERSION`, `SITE_URL` e `ALLOWED_ORIGINS`, copiados do modelo de segredos sem exibir valores.
2. `products.stripe_price_id` do P001 no banco local igual ao Price de teste: depois de cada `db reset`, rode `node supabase/local/aplicar-price-teste.mjs` (passo do Lastro; lê `STRIPE_PRICE_ID_P001` do `.env` local). Sem ele, `POST /checkout` responde 502 ("No such price").
3. Webhook local sem Stripe CLI: os testes assinam eventos com `generateTestHeaderStringAsync` e o mesmo segredo da função.
4. Webhook real local (usado no I3-V): Stripe CLI (v1.51.1, fora do repositório) com a chave de teste em `STRIPE_API_KEY` e `STRIPE_CLI_TELEMETRY_OPTOUT=1`:
   - `stripe listen --print-secret` → o `whsec_` vai para `STRIPE_WEBHOOK_SECRET` do `.env` local (com backup do `.env`, sem exibir), e o `functions serve` é reiniciado;
   - `stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,charge.dispute.created,charge.dispute.closed,charge.refunded`;
   - no fim, restaure o `.env` do backup e reinicie o `functions serve`.

**Projeto de teste no Supabase (pendente; exige autorização de escrita remota):**

1. `supabase secrets set` com `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TERMS_VERSION`, `SITE_URL` e `ALLOWED_ORIGINS`.
2. Deploy das funções `api` e `stripe-webhook` (`verify_jwt = false` nas duas).
3. Stripe Dashboard (modo de teste) → Developers → Webhooks → Add endpoint:
   - URL: `https://oqizkhjosplnedddaakb.supabase.co/functions/v1/stripe-webhook`;
   - versão da API: `2026-03-25.dahlia`;
   - eventos: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.dispute.created`, `charge.dispute.closed` e `charge.refunded`;
   - copie o *signing secret* para `STRIPE_WEBHOOK_SECRET`.
4. Na conta Stripe: URL dos termos (Settings → Public details), métodos de pagamento (cartão; Pix e boleto se o responsável quiser, D9) e o branding do formulário.

## 4. Fluxo

1. **Carrinho:** o usuário logado, com e-mail confirmado, vê o aviso de sem reembolso, marca a caixa dos termos e clica em "Finalizar compra".
2. **`POST /checkout`** `{ cart_version, terms_accepted: true, terms_version }`: `create_order_from_cart` cria o pedido `open` com o aceite → Customer → Checkout Session → `attach_checkout_session` → `{ client_secret }`.
3. **Página de checkout:**
   - Stripe.js de `https://js.stripe.com/dahlia/stripe.js` e `Stripe(pk, { betas: ['custom_checkout_payment_form_1'] })`;
   - `initCheckoutFormSdk({ clientSecret, appearance })` e `createForm({ layout: 'expanded' })` montado em `#checkout-form`;
   - campo de cupom com `checkout.applyPromotionCode` e `removePromotionCode`;
   - `confirm` chama `actions.confirm`.
4. **Retorno:** a Stripe leva a `/pedido/confirmacao?session_id=...`, e o site chama `GET /order-status`. A rota relê a sessão na Stripe e roda a mesma liberação idempotente do webhook.
5. **Webhook:** `checkout.session.completed` (pago) → `fulfill_order`, que grava o pedido `paid` com subtotal, desconto, total e código promocional, cria um direito por item, limpa o carrinho e enfileira a entrega por e-mail (o envio entra no I4).
6. **Contestações:** `charge.dispute.created` revoga; `closed` vencida devolve; perdida mantém revogado. Reembolso total manual revoga.

## 5. Cartões e cenários de teste

| Cenário | Como |
| --- | --- |
| Pagamento aprovado | `4242 4242 4242 4242`, validade futura, qualquer CVC |
| Recusado | `4000 0000 0000 0002` (o pedido fica `open` e a confirmação mostra `failed`) |
| 3D Secure | `4000 0025 0000 3155` |
| Contestação | `4000 0000 0000 0259` gera contestação após o pagamento. Para vencer, envie a evidência `winning_evidence`; para perder, `losing_evidence` |
| Cupom | `TESTE10` no campo de cupom do formulário |
| Sessão expirada | `stripe.checkout.sessions.expire(id)` na API de teste |

Confira os números atuais em https://docs.stripe.com/testing.

### 5.1 Validação real de teste sem o navegador (I3-V, 2026-10-08)

Tudo pelo runtime local servido, com a Stripe de **teste** real: usuário criado por OTP (Mailpit) → carrinho com o P001 → `POST /checkout` com o aceite → confirmação pela API, como a fixture `checkout.session.completed` da Stripe CLI → webhook real pelo `stripe listen`.

- **Confirmação sem Stripe.js:** `GET /v1/payment_pages/{cs}` com a chave secreta (devido em `total_summary.due`) e `POST /v1/payment_pages/{cs}/confirm` com `payment_method` e `expected_amount`. O `confirm` recusa os atalhos `pm_card_*` ("No such PaymentMethod"): o PaymentMethod é criado antes de `tok_visa` (cartão 4242) ou `tok_chargeDeclined` (4000…0002), como na fixture.
- **Cupom no servidor:** `POST /v1/payment_pages/{cs}` com `promotion_code=TESTE10` aplica o código na sessão aberta (o mesmo que o `applyPromotionCode` do formulário).

| Cenário | Resultado |
| --- | --- |
| Aprovado com TESTE10 | Sessão `cs_test_b14g0VxOvVQYROkC7Xz4ZOKtMm7fa6cRZKp71u1hTw00dFHGoH8dEThLaH` (PI `pi_3UOOFEEtA6WNSLpd10Op1bTp`): devido 1990 → 1791 com o cupom; `confirm` 200 `complete`/`paid`; `checkout.session.completed` `evt_1UOOFGEtA6WNSLpd26zK70km` recebido, função respondeu 200. Pedido `9162C367` `paid`, subtotal 1990, desconto 199, total 1791, cupom `TESTE10`; 5 direitos ativos; carrinho vazio; e-mail "Seus jogos chegaram (pedido 9162C367)" no Mailpit; `GET /order-status` `paid`/`open_library`; `POST /download-url` → PDF TESTE-J01 do B2 (200, `application/pdf`, `attachment`) |
| Recusado | Sessão `cs_test_b1tmgYTbqP9PCJxc6r21EfATfyDWTkeuLZN8JLD6kYx4OLGtz4NOavQ5Nw` (PI `pi_3UOOFcEtA6WNSLpd06P4kGnN`): `confirm` 402 `card_declined`/`generic_decline`; pedido não pago, nenhum direito, carrinho mantido, `GET /order-status` `failed`. Ao expirar a sessão, `checkout.session.expired` `evt_1UOOFhEtA6WNSLpdvUBeWafn` recebido (200) e o pedido ficou `expired` |

Observação: o `stripe listen` encaminha os eventos na versão padrão da conta (`2026-08-26.dahlia`); a função tratou os dois tipos sem diferença. O endpoint do Dashboard deve continuar com `2026-03-25.dahlia` (seção 3).

**Falta validar só o formulário no navegador** (`initCheckoutFormSdk`/`createForm`, cupom pelo campo, `actions.confirm` e o retorno a `/pedido/confirmacao`). Ele exige `VITE_STRIPE_PUBLISHABLE_KEY` da **mesma conta** da `STRIPE_SECRET_KEY`: a pk atual do modelo é de outra conta, e o `payment_pages/{id}/init` responde 404 "No such checkout.session".

**Testes automatizados** (`supabase/functions/tests`):

- **Contrato:** `checkout-webhook.test.ts`, sem rede.
- **Integração com o banco local** (`KT_INTEGRATION=1`): `checkout.integration.test.ts` cobre pagamento com cupom, reenvio idempotente, webhook e confirmação concorrentes, recusa, expiração e contestações.
- **API de teste real** (`KT_STRIPE=1`): sessão criada pelo `/checkout` e expiração com evento real.

## 6. Próximos passos

- [x] I4: despacho do e-mail de entrega (`send_delivery` do `fulfill_order`, em segundo plano).
- [x] I3-V: pagamento real de teste aprovado (com cupom) e recusado, com webhook real (seção 5.1).
- [ ] Responsável: trocar `VITE_STRIPE_PUBLISHABLE_KEY` pela `pk_test_` da mesma conta da `STRIPE_SECRET_KEY` e validar o formulário no navegador (4242 e TESTE10).
- [ ] Endpoint de teste no Dashboard e segredos no projeto remoto (seção 3), com autorização.
- [ ] Confirmar se o sufixo de preview vale para a versão do endpoint de webhook.
- [ ] CSP do site (Costura): `docs/api-contract.md` 6.5.2.
- [ ] D9: Pix e boleto na conta BR (o caminho assíncrono `pending_payment` já está implementado e testado com dados simulados).
- [ ] D11: texto de sem-reembolso validado por advogado; atualizar `TERMS_VERSION`.
- [ ] Antes da produção: chave restrita, Price e cupons live, endpoint live, check-release com preço aprovado.
- [ ] Preview `custom_checkout_payment_form_preview=v1`: acompanhar mudanças. Plano B: Checkout hospedado, mudando só a rota e a página.

## 7. Links

- Suporte: https://support.stripe.com
- Stripe MCP: https://docs.stripe.com/mcp
- Testes: https://docs.stripe.com/testing
- Webhooks: https://docs.stripe.com/webhooks
- Contestações: https://docs.stripe.com/disputes
