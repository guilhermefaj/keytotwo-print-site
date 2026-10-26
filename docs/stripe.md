# Stripe

Pagamento com Checkout Session em `ui_mode: form` (formulário embutido no `/pagamento`), confirmação pela própria página e pelo webhook, e liberação idempotente nos dois caminhos. A conta live é a única em uso: o teste.keytotwo.com.br recusa `pk_live` e não paga. Contrato das rotas: `docs/api-contract.md` (6.5, 6.6 e 9). Código: `supabase/functions/api/routes/{checkout,order-status}.ts`, `supabase/functions/_shared/{stripe,fulfillment}.ts` e `supabase/functions/stripe-webhook/`.

## Valores

Nenhum valor neste repositório (ele é público). Ficam no arquivo de segredos do responsável e nos segredos das funções no Supabase:

- `STRIPE_SECRET_KEY` (chave restrita `rk_live_…` às permissões usadas; desde a Fase 3 do admin, 2026-10-24, inclui a **escrita em Reembolsos**, para o reembolso pelo admin), `STRIPE_WEBHOOK_SECRET`, `TERMS_VERSION`, `SITE_URL`, `ALLOWED_ORIGINS` nas funções;
- `VITE_STRIPE_PUBLISHABLE_KEY` no build do site;
- o Price de cada produto em `products.stripe_price_id` do banco, por ambiente, nunca versionado.

## Checkout Session

Criada por `POST /checkout`, com chave de idempotência `checkout:<order_id>` (o mesmo pedido reaproveitado volta à mesma sessão). SDK `npm:stripe@22.0.2`, API `2026-03-25.dahlia; custom_checkout_payment_form_preview=v1`.

| Parâmetro | Valor | Origem |
| --- | --- | --- |
| `ui_mode` | `form` | Checkout Studio |
| `billing_address_collection`, `phone_number_collection`, `automatic_tax`, `submit_type`, `integration_identifier` | `auto`, desligado, desligado, `auto`, `custom_embedded_web_0001` | Checkout Studio (fixos) |
| `mode` / `line_items` | `payment`; um item por produto do pedido, `quantity: 1` | Pedido |
| `allow_promotion_codes` | `true` (o cupom entra pelo campo do site, `applyPromotionCode`) | Nossa decisão |
| `client_reference_id`, `metadata`, `payment_intent_data.metadata` | o `order_id` (e a versão dos termos) | Nossa arquitetura |
| `customer` | o Customer da conta (criado no primeiro checkout, chave `customer:<user_id>`) | Nossa arquitetura |
| `locale` / `return_url` | `pt-BR`; `SITE_URL/pedido/confirmacao?session_id={CHECKOUT_SESSION_ID}` | Nossa arquitetura |

No navegador: Stripe.js de `https://js.stripe.com/dahlia/stripe.js` com `betas: ['custom_checkout_payment_form_1']`, `initCheckoutFormSdk` com a aparência do Studio e a fonte DM Sans, e `createForm({ layout: 'expanded', features: { promotionCodeCollection: 'never' } })`.

## Fluxo

1. A sacola funciona sem login; o login vem no `/pagamento`, onde fica o aceite expresso (termos, reembolso e entrega imediata).
2. `POST /checkout` cria o pedido `open` com o aceite, o Customer e a sessão, e devolve o `client_secret`.
3. A Stripe volta a `/pedido/confirmacao?session_id=…`; `GET /order-status` relê a sessão e roda a mesma liberação do webhook.
4. Webhook: `checkout.session.completed` e `async_payment_succeeded` pagos liberam (`fulfill_order`: pedido `paid` com subtotal, desconto, total e cupom, um direito por item, sacola limpa, e-mail de entrega em segundo plano); `async_payment_failed` e `expired` encerram; contestação aberta revoga, vencida devolve, perdida mantém revogado; reembolso total revoga.

Eventos do endpoint live (versão `2026-03-25.dahlia`): `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.dispute.created`, `charge.dispute.closed` e `charge.refunded`.

## Testes

Automatizados em `supabase/functions/tests`: contrato sem rede (`checkout-webhook.test.ts`), integração com a stack efêmera do CI (`KT_INTEGRATION=1`, `checkout.integration.test.ts`) e API de teste real (`KT_STRIPE=1`). Cartões de teste: https://docs.stripe.com/testing (aprovado `4242 4242 4242 4242`, recusado `4000 0000 0000 0002`, 3D Secure `4000 0025 0000 3155`, contestação `4000 0000 0000 0259`).

## Em aberto

- **CSP do site:** o `nginx.conf` manda `Content-Security-Policy` com nonce e `'strict-dynamic'` desde 2026-10-26: o Stripe.js entra pelo script do site, sem lista de domínios (ver `docs/api-contract.md` 6.5.2).
- **Formulário em preview:** `custom_checkout_payment_form_preview=v1` é recurso em prévia da Stripe; se mudar, o plano B é o Checkout hospedado, trocando só a rota e a página.
