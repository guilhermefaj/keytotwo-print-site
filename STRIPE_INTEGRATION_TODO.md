# Integração Stripe — o que falta e como operar

Fonte única dos passos restantes da integração com a Stripe (nota "Stripe Checkout Studio", item 10). Estado em 2026-10-08, fim do I3: checkout com formulário embutido, confirmação e webhook implementados e testados localmente, **em modo de teste**. Nada foi publicado no Supabase remoto.

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
3. Webhook local sem Stripe CLI: os testes assinam eventos com `generateTestHeaderStringAsync` e o mesmo segredo da função. Alternativa opcional: `stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook`, trocando `STRIPE_WEBHOOK_SECRET` pelo segredo que o `listen` imprime.

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

**Testes automatizados** (`supabase/functions/tests`):

- **Contrato:** `checkout-webhook.test.ts`, sem rede.
- **Integração com o banco local** (`KT_INTEGRATION=1`): `checkout.integration.test.ts` cobre pagamento com cupom, reenvio idempotente, webhook e confirmação concorrentes, recusa, expiração e contestações.
- **API de teste real** (`KT_STRIPE=1`): sessão criada pelo `/checkout` e expiração com evento real.

## 6. Próximos passos

- [ ] I4: despacho do e-mail de entrega (`send_delivery` do `fulfill_order`; hoje só fica enfileirado).
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
