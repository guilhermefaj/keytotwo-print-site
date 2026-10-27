import type Stripe from 'stripe'
import { rpc, rpcRow } from '../../_shared/admin.ts'
import { requireSessionUser } from '../../_shared/auth.ts'
import { type ChargeableItem, orderItemCharge } from '../../_shared/cart-pricing.ts'
import { env } from '../../_shared/env.ts'
import { basePriceKey } from '../../_shared/fulfillment.ts'
import { type ErrorCode, errorLabel, HttpError, isUuid, json, readJsonObject } from '../../_shared/http.ts'
import { primePrices, stripePriceProduct } from '../../_shared/prices.ts'
import { isStripeError, livemode, stripe, STRIPE_UI_MODE, stripeErrorLabel } from '../../_shared/stripe.ts'
import { verifyReferralToken } from '../../_shared/tokens.ts'

interface CheckoutOrder {
  outcome: string
  order_id: string | null
  email: string | null
  stripe_customer_id: string | null
  items: (ChargeableItem & { product_code: string })[] | null
  reused: boolean | null
  detail: Record<string, unknown> | null
}

// Recusas de negócio de create_order_from_cart (docs/api-contract.md 6.5).
const REFUSALS: Record<string, [ErrorCode, string]> = {
  cart_empty: ['CART_EMPTY', 'Seu carrinho está vazio.'],
  cart_changed: ['CART_CHANGED', 'Seu carrinho mudou. Confira os itens antes de pagar.'],
  product_unavailable: ['PRODUCT_UNAVAILABLE', 'Um item do carrinho não está mais disponível.'],
  already_owned: ['ALREADY_OWNED', 'Tudo o que está na sacola já é seu ou já está num pacote dela.'],
}
type LineItem = NonNullable<Stripe.Checkout.SessionCreateParams['line_items']>[number]
const providerError = () => new HttpError(502, 'PAYMENT_PROVIDER_ERROR', 'Não foi possível iniciar o pagamento. Tente de novo em instantes.')

async function withStripe<T>(step: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    if (!isStripeError(error)) throw error
    console.error(`checkout: Stripe falhou em ${step} (${stripeErrorLabel(error)})`)
    throw providerError()
  }
}

// Item cheio vai pelo Price. O pacote de "completar a coleção" vai com price_data no mesmo produto da Stripe, pelo
// valor que falta; a metadata da sessão guarda o Price de tabela do produto, para a liberação reconhecer o item.
async function lineItems(items: ChargeableItem[]) {
  const metadata: Record<string, string> = {}
  const reduced = items.filter((item) => item.kind === 'bundle' && item.owned_games.length)
  await primePrices(reduced.flatMap((item) => [item.stripe_price_id, ...item.games.map((game) => game.single_price_id)]))
  const lines = await Promise.all(items.map(async (item): Promise<LineItem> => {
    if (item.kind !== 'bundle' || !item.owned_games.length) return { price: item.stripe_price_id, quantity: 1 }
    const [charge, product] = await Promise.all([orderItemCharge(item), stripePriceProduct(item.stripe_price_id)])
    if (!charge || !product) {
      console.error('checkout: Price do pacote não lido na Stripe')
      throw providerError()
    }
    metadata[basePriceKey(product)] = item.stripe_price_id
    return { price_data: { currency: charge.currency, unit_amount: charge.unit_amount, product }, quantity: 1 }
  }))
  return { lines, metadata }
}

// Customer por usuário: criado no 1º checkout (idempotente) e gravado no perfil; o e-mail segue o da conta.
// Customer apagado no painel da Stripe: cria outro e troca o guardado, senão nenhuma compra da conta passaria.
async function customerFor(userId: string, order: CheckoutOrder): Promise<string> {
  const email = order.email ?? undefined
  const stored = order.stripe_customer_id
  if (stored) {
    const kept = await withStripe('customer', async () => {
      try {
        await stripe().customers.update(stored, { email })
        return true
      } catch (error) {
        if (isStripeError(error) && error.code === 'resource_missing') return false
        throw error
      }
    })
    if (kept) return stored
  }
  // A chave do 1º checkout devolveria, por 24 horas, o mesmo Customer apagado: a troca tem chave própria.
  const customer = await withStripe('customer', () =>
    stripe().customers.create({ email, metadata: { user_id: userId } }, { idempotencyKey: stored ? `customer:${userId}:${stored}` : `customer:${userId}` }))
  return await rpc<string>('set_stripe_customer', { p_user_id: userId, p_stripe_customer_id: customer.id, ...(stored ? { p_replaces: stored } : {}) })
}

// A indicação que vai para o pedido (2026-10-25): o parceiro e a chegada vêm só do comprovante assinado da visita
// (token). Sem ele, ou vencido, ficam a página, a chegada e as marcas de campanha, que não mexem em comissão.
async function verifiedReferral(referral: Record<string, unknown>): Promise<Record<string, unknown>> {
  const rest = Object.fromEntries(Object.entries(referral).filter(([key]) => key !== 'partner' && key !== 'token'))
  const verified = typeof referral.token === 'string' ? await verifyReferralToken(referral.token) : null
  return verified?.ok ? { ...rest, partner: verified.claims.p, landed_at: new Date(verified.claims.l * 1000).toISOString() } : rest
}

const termsChanged = (termsVersion: string) =>
  new HttpError(409, 'TERMS_CHANGED', 'Os termos foram atualizados. Leia e aceite a versão atual.', { details: { terms_version: termsVersion } })

// POST /checkout { cart_version, terms_version, terms_accepted?, referral? } → { client_secret, order_id } do formulário
// embutido. Desde 2026-10-24 o formulário abre com a página, travado até o aceite: o pedido nasce sem ele e
// POST /checkout/terms grava quando a pessoa marca a caixa (terms_accepted = true, do site anterior, já grava aqui).
// referral (2026-10-24): de onde veio quem compra (o parceiro do link e as marcas de campanha); o banco confere e
// descarta o que não vale, e uma falha aqui não impede o pagamento.
export async function checkout(req: Request): Promise<Response> {
  const user = await requireSessionUser(req)
  // A prévia do lançamento (2026-10-27): antes da abertura das vendas, nenhum pedido nasce.
  const opening = await rpc<string | null>('get_sales_opening')
  if (opening) throw new HttpError(409, 'SALES_NOT_OPEN', 'A loja ainda não abriu.', { details: { sales_open_at: new Date(opening).toISOString() } })
  const body = await readJsonObject(req)
  const termsVersion = env.termsVersion()
  if (body.terms_version !== termsVersion) throw termsChanged(termsVersion)
  const cartVersion = body.cart_version
  if (!Number.isInteger(cartVersion) || (cartVersion as number) < 0) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Versão do carrinho inválida.')
  }

  const order = await rpcRow<CheckoutOrder>('create_order_from_cart', {
    p_user_id: user.id,
    p_livemode: livemode(),
    p_cart_version: cartVersion,
    p_terms_version: termsVersion,
    p_terms_accepted: body.terms_accepted === true,
  })
  const refusal = REFUSALS[order.outcome]
  if (refusal) throw new HttpError(409, refusal[0], refusal[1], { details: order.detail ?? undefined })
  if (order.outcome !== 'ok' || !order.order_id || !order.items?.length) {
    throw new Error(`create_order_from_cart: resultado inesperado (${order.outcome})`)
  }
  const orderId = order.order_id
  if (body.referral && typeof body.referral === 'object' && !Array.isArray(body.referral)) {
    await verifiedReferral(body.referral as Record<string, unknown>)
      .then((referral) => rpc('set_order_referral', { p_user_id: user.id, p_order_id: orderId, p_referral: referral }))
      .catch((error) => console.error(`checkout: indicação não gravada (${errorLabel(error)})`))
  }
  const customer = await customerFor(user.id, order)
  const { lines, metadata } = await lineItems(order.items)

  // Parâmetros fixos do Checkout Studio + os da nossa arquitetura (docs/api-contract.md 6.5).
  const params: Stripe.Checkout.SessionCreateParams = {
    ui_mode: STRIPE_UI_MODE,
    billing_address_collection: 'auto',
    phone_number_collection: { enabled: false },
    automatic_tax: { enabled: false },
    submit_type: 'auto',
    integration_identifier: 'custom_embedded_web_0001',
    mode: 'payment',
    line_items: lines,
    allow_promotion_codes: true,
    client_reference_id: orderId,
    customer,
    metadata: { order_id: orderId, terms_version: termsVersion, ...metadata },
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
    console.error(`checkout: attach_checkout_session falhou (${errorLabel(error)})`)
  }
  return json({ client_secret: session.client_secret, order_id: orderId })
}

// POST /checkout/terms { order_id, terms_version } → { accepted: true }: a pessoa marcou o "Li e aceito" acima do
// formulário. Grava o momento no pedido aberto dela (uma vez); o site só destrava o formulário depois disto.
export async function checkoutTerms(req: Request): Promise<Response> {
  const user = await requireSessionUser(req)
  const body = await readJsonObject(req)
  if (!isUuid(body.order_id)) throw new HttpError(400, 'INVALID_REQUEST', 'Pedido inválido.')
  const termsVersion = env.termsVersion()
  if (body.terms_version !== termsVersion) throw termsChanged(termsVersion)
  const outcome = await rpc<string>('accept_order_terms', { p_user_id: user.id, p_order_id: body.order_id, p_terms_version: termsVersion })
  if (outcome === 'terms_changed') throw termsChanged(termsVersion)
  if (outcome !== 'ok') throw new HttpError(404, 'NOT_FOUND', 'Este pagamento não está mais aberto. Volte à sacola.')
  return json({ accepted: true })
}
