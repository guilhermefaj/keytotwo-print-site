import type Stripe from 'stripe'
import { rpc, rpcRow } from '../../_shared/admin.ts'
import { requireSessionUser } from '../../_shared/auth.ts'
import { env } from '../../_shared/env.ts'
import { type ErrorCode, HttpError, json, readJsonObject } from '../../_shared/http.ts'
import { isStripeError, livemode, stripe, STRIPE_UI_MODE, stripeErrorLabel } from '../../_shared/stripe.ts'

interface CheckoutOrder {
  outcome: string
  order_id: string | null
  email: string | null
  stripe_customer_id: string | null
  items: { product_code: string; stripe_price_id: string }[] | null
  reused: boolean | null
  detail: Record<string, unknown> | null
}

// Recusas de negócio de create_order_from_cart (docs/api-contract.md 6.5).
const REFUSALS: Record<string, [ErrorCode, string]> = {
  cart_empty: ['CART_EMPTY', 'Seu carrinho está vazio.'],
  cart_changed: ['CART_CHANGED', 'Seu carrinho mudou. Confira os itens antes de pagar.'],
  product_unavailable: ['PRODUCT_UNAVAILABLE', 'Um item do carrinho não está mais disponível.'],
  already_owned: ['ALREADY_OWNED', 'Você já tem todos os jogos de um item do carrinho.'],
}

async function withStripe<T>(step: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    if (!isStripeError(error)) throw error
    console.error(`checkout: Stripe falhou em ${step} (${stripeErrorLabel(error)})`)
    throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', 'Não foi possível iniciar o pagamento. Tente de novo em instantes.')
  }
}

// Customer por usuário: criado no 1º checkout (idempotente) e gravado no perfil; o e-mail segue o da conta.
async function customerFor(userId: string, order: CheckoutOrder): Promise<string> {
  const email = order.email ?? undefined
  if (order.stripe_customer_id) {
    const id = order.stripe_customer_id
    await withStripe('customer', () => stripe().customers.update(id, { email }))
    return id
  }
  const customer = await withStripe('customer', () =>
    stripe().customers.create({ email, metadata: { user_id: userId } }, { idempotencyKey: `customer:${userId}` }))
  return await rpc<string>('set_stripe_customer', { p_user_id: userId, p_stripe_customer_id: customer.id })
}

// POST /checkout { cart_version, terms_accepted, terms_version } → { client_secret } do formulário embutido.
export async function checkout(req: Request): Promise<Response> {
  const user = await requireSessionUser(req)
  const body = await readJsonObject(req)
  if (body.terms_accepted !== true) {
    throw new HttpError(400, 'TERMS_NOT_ACCEPTED', 'Aceite os termos para continuar.')
  }
  const termsVersion = env.termsVersion()
  if (body.terms_version !== termsVersion) {
    throw new HttpError(409, 'TERMS_CHANGED', 'Os termos foram atualizados. Leia e aceite a versão atual.', { details: { terms_version: termsVersion } })
  }
  const cartVersion = body.cart_version
  if (!Number.isInteger(cartVersion) || (cartVersion as number) < 0) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Versão do carrinho inválida.')
  }

  const order = await rpcRow<CheckoutOrder>('create_order_from_cart', {
    p_user_id: user.id,
    p_livemode: livemode(),
    p_cart_version: cartVersion,
    p_terms_version: termsVersion,
    p_terms_accepted: true,
  })
  const refusal = REFUSALS[order.outcome]
  if (refusal) throw new HttpError(409, refusal[0], refusal[1], { details: order.detail ?? undefined })
  if (order.outcome !== 'ok' || !order.order_id || !order.items?.length) {
    throw new Error(`create_order_from_cart: resultado inesperado (${order.outcome})`)
  }
  const orderId = order.order_id
  const customer = await customerFor(user.id, order)

  // Parâmetros fixos do Checkout Studio + os da nossa arquitetura (docs/api-contract.md 6.5).
  const params: Stripe.Checkout.SessionCreateParams = {
    ui_mode: STRIPE_UI_MODE,
    billing_address_collection: 'auto',
    phone_number_collection: { enabled: false },
    automatic_tax: { enabled: false },
    submit_type: 'auto',
    integration_identifier: 'custom_embedded_web_0001',
    mode: 'payment',
    line_items: order.items.map((item) => ({ price: item.stripe_price_id, quantity: 1 })),
    allow_promotion_codes: true,
    client_reference_id: orderId,
    customer,
    metadata: { order_id: orderId, terms_version: termsVersion },
    payment_intent_data: { metadata: { order_id: orderId } },
    locale: 'pt-BR',
    return_url: `${env.siteUrl()}/pedido/confirmacao?session_id={CHECKOUT_SESSION_ID}`,
  }
  // Mesmo pedido (inclusive reaproveitado) = mesma sessão, pela chave de idempotência.
  const session = await withStripe('session', () => stripe().checkout.sessions.create(params, { idempotencyKey: `checkout:${orderId}` }))
  if (!session.client_secret) throw new Error('checkout: sessão sem client_secret')

  try {
    await rpc('attach_checkout_session', {
      p_order_id: orderId,
      p_checkout_session_id: session.id,
      p_expires_at: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
    })
  } catch (error) {
    // O webhook e a confirmação acham o pedido pelo client_reference_id.
    console.error(`checkout: attach_checkout_session falhou (${error instanceof Error ? error.message : 'erro'})`)
  }
  return json({ client_secret: session.client_secret })
}
