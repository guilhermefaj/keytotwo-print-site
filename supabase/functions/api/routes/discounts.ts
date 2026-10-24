import { rpc, rpcRow } from '../../_shared/admin.ts'
import { requireAdminSession } from '../../_shared/auth.ts'
import { sameSecret } from '../../_shared/compare.ts'
import { env } from '../../_shared/env.ts'
import { HttpError, isUuid, json, readJsonObject } from '../../_shared/http.ts'
import { isStripeError, livemode, stripe, stripeErrorLabel } from '../../_shared/stripe.ts'
import { reasonOf, settle } from './outcome.ts'

// Cupons no admin (2026-10-24, decisões do responsável): cada cupom é um cupom e um código promocional da Stripe, com
// percentual, para o que vale, início e fim, limite, primeira compra, valor mínimo, a campanha, a faixa do topo e o
// parceiro. A Stripe confere o código no pagamento; o banco guarda o que o admin e a loja precisam. O código é único
// para sempre (a venda não troca de dono). A Stripe não agenda o início: a agenda do banco chama /internal/discounts/tick.

const notFound = () => new HttpError(404, 'NOT_FOUND', 'Cupom não encontrado.')
const conflict = (message: string) => () => new HttpError(409, 'CATALOG_CONFLICT', message)
const invalid = (message: string) => new HttpError(400, 'INVALID_REQUEST', message)

interface DiscountRow {
  id: string
  code: string
  state: 'scheduled' | 'active' | 'paused' | 'ended'
  starts_at: string | null
  stripe_promotion_code_id: string
}
interface DiscountList {
  discounts: DiscountRow[]
  partners: { id: string; slug: string; name: string; status: string }[]
  products: { code: string; name: string | null; stripe_product: string | null }[]
}

async function listDiscounts(adminId: string): Promise<DiscountList> {
  const list = await rpcRow<{ outcome: string; result: DiscountList | null }>('admin_list_discounts', { p_user_id: adminId, p_livemode: livemode() })
  settle(list.outcome)
  return list.result!
}

function stripeFailure(step: string, error: unknown): never {
  if (!isStripeError(error)) throw error
  console.error(`admin: ${step} na Stripe falhou (${stripeErrorLabel(error)})`)
  throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', error.statusCode === 403
    ? 'A chave da Stripe não tem permissão para cupons. Libere a escrita de Cupons e de Códigos promocionais na chave restrita.'
    : error.code === 'resource_already_exists' ? 'A Stripe já tem um código ativo com esse nome. Escolha outro.'
      : 'A Stripe recusou agora. Nada mudou; tente de novo.')
}

const optionalText = (value: unknown, min: number, max: number, label: string): string | null => {
  if (value === null || value === undefined || value === '') return null
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length < min || text.length > max) throw invalid(`${label}: de ${min} a ${max} caracteres.`)
  return text
}
const optionalDate = (value: unknown, label: string): Date | null => {
  if (value === null || value === undefined || value === '') return null
  const date = typeof value === 'string' ? new Date(value) : new Date(NaN)
  if (Number.isNaN(date.getTime())) throw invalid(`${label}: data inválida.`)
  return date
}
const optionalInteger = (value: unknown, min: number, max: number, label: string): number | null => {
  if (value === null || value === undefined) return null
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw invalid(`${label}: de ${min} a ${max}.`)
  return value as number
}

// GET /admin/discounts: { discounts, partners, products } (os cupons com o uso nos pedidos pagos do modo da chave).
export async function adminDiscounts(req: Request): Promise<Response> {
  const user = await requireAdminSession(req)
  return json(await listDiscounts(user.id))
}

// POST /admin/discounts { code, percent_off, product_codes, starts_at, ends_at, max_redemptions, first_time_only,
// minimum_amount, campaign, banner, partner, reason }: cria o cupom e o código na Stripe (idempotente pelo código) e
// guarda no banco. Começa depois: o código nasce inativo e a agenda liga.
export async function adminCreateDiscount(req: Request): Promise<Response> {
  const user = await requireAdminSession(req)
  const body = await readJsonObject(req)
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
  if (!/^[A-Z0-9]{3,30}$/.test(code)) throw invalid('O código tem de 3 a 30 letras e números, sem espaço.')
  const percent = body.percent_off
  if (typeof percent !== 'number' || !(percent > 0 && percent <= 100) || Math.round(percent * 100) !== percent * 100) {
    throw invalid('O desconto é um percentual de 0,01 a 100.')
  }
  const startsAt = optionalDate(body.starts_at, 'Início')
  const endsAt = optionalDate(body.ends_at, 'Fim')
  if (endsAt && endsAt.getTime() <= Math.max(Date.now(), startsAt?.getTime() ?? 0)) throw invalid('O fim precisa ser depois de agora e do início.')
  const maxRedemptions = optionalInteger(body.max_redemptions, 1, 100_000, 'Limite de usos')
  const minimum = optionalInteger(body.minimum_amount, 100, 100_000, 'Valor mínimo (centavos)')
  const campaign = optionalText(body.campaign, 2, 60, 'Campanha')
  const banner = optionalText(body.banner, 5, 140, 'Faixa do topo')
  if (banner && !banner.includes('{cupom}')) throw invalid('Escreva {cupom} na faixa do topo, onde o código deve aparecer.')
  const partner = body.partner === null || body.partner === undefined || body.partner === '' ? null : String(body.partner)
  if (banner && partner) throw invalid('Cupom de parceiro não usa a faixa do topo: ela aparece sozinha para quem chega pelo link.')
  if (body.first_time_only !== undefined && typeof body.first_time_only !== 'boolean') throw invalid('Primeira compra é sim ou não.')
  const codes = body.product_codes === null || body.product_codes === undefined ? null : body.product_codes
  if (codes !== null && (!Array.isArray(codes) || !codes.length || codes.length > 20 || !codes.every((item) => typeof item === 'string'))) {
    throw invalid('Escolha os produtos do cupom, ou nenhum para valer em tudo.')
  }
  const reason = reasonOf(body)

  const list = await listDiscounts(user.id)
  if (list.discounts.some((item) => item.code === code)) throw conflict('Esse código já foi usado. O código é único para sempre; escolha outro.')()
  if (partner && !list.partners.some((item) => item.slug === partner)) throw new HttpError(404, 'NOT_FOUND', 'Parceiro não encontrado.')
  const stripeProducts = codes?.map((item) => {
    const product = list.products.find((entry) => entry.code === item)
    if (!product?.stripe_product) throw conflict(`O produto ${item} não está à venda com preço na Stripe.`)()
    return product.stripe_product
  })

  const scheduled = Boolean(startsAt && startsAt.getTime() > Date.now())
  // A mesma tentativa repetida (rede, clique duplo) não cria outro cupom; com outras regras, a chave muda e a Stripe
  // recusa o código repetido enquanto o anterior estiver ativo.
  const attempt = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([percent, stripeProducts, startsAt, endsAt, maxRedemptions, minimum, body.first_time_only === true, partner, scheduled])))))
    .slice(0, 8).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  const coupon = await stripe().coupons.create({
    percent_off: percent, duration: 'once', name: code, metadata: { code, source: 'admin' },
    ...(stripeProducts ? { applies_to: { products: stripeProducts } } : {}),
  }, { idempotencyKey: `coupon:${code}:${attempt}` }).catch((error) => stripeFailure('o cupom', error))
  const promotion = await stripe().promotionCodes.create({
    promotion: { type: 'coupon', coupon: coupon.id }, code, active: !scheduled,
    ...(endsAt ? { expires_at: Math.floor(endsAt.getTime() / 1000) } : {}),
    ...(maxRedemptions ? { max_redemptions: maxRedemptions } : {}),
    restrictions: { first_time_transaction: body.first_time_only === true, ...(minimum ? { minimum_amount: minimum, minimum_amount_currency: 'brl' } : {}) },
    metadata: { code, source: 'admin', ...(partner ? { partner } : {}) },
  }, { idempotencyKey: `promotion:${code}:${attempt}` }).catch((error) => stripeFailure('o código promocional', error))

  const saved = await rpcRow<{ outcome: string; id: string | null }>('admin_create_discount', {
    p_user_id: user.id,
    p_discount: {
      code, percent_off: percent, product_codes: codes, starts_at: startsAt?.toISOString() ?? null, ends_at: endsAt?.toISOString() ?? null,
      max_redemptions: maxRedemptions, first_time_only: body.first_time_only === true, minimum_amount: minimum, campaign, banner, partner,
    },
    p_stripe_coupon_id: coupon.id, p_stripe_promotion_code_id: promotion.id, p_reason: reason,
  })
  if (saved.outcome !== 'ok') {
    // O banco recusou depois da Stripe: o código não fica valendo sem estar no admin.
    await stripe().promotionCodes.update(promotion.id, { active: false }).catch(() => console.error('admin: código órfão na Stripe não desativado'))
  }
  settle(saved.outcome, {
    code_taken: conflict('Esse código já foi usado. Escolha outro.'),
    partner_not_found: () => new HttpError(404, 'NOT_FOUND', 'Parceiro não encontrado.'),
  })
  return json({ id: saved.id, state: scheduled ? 'scheduled' : 'active' }, 201)
}

// POST /admin/discounts/:id/state { state: active | paused | ended, reason }: liga ou desliga o código na Stripe e
// guarda. Voltar a valer antes do início deixa agendado (inativo na Stripe até a agenda ligar).
export async function adminDiscountState(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  if (!isUuid(params.id)) throw notFound()
  const body = await readJsonObject(req)
  if (!['active', 'paused', 'ended'].includes(String(body.state))) throw invalid('A situação é active, paused ou ended.')
  const reason = reasonOf(body)
  const discount = (await listDiscounts(user.id)).discounts.find((item) => item.id === params.id)
  if (!discount) throw notFound()
  if (discount.state === 'ended') throw conflict('Cupom encerrado não volta.')()
  const waiting = body.state === 'active' && discount.starts_at !== null && new Date(discount.starts_at).getTime() > Date.now()
  await stripe().promotionCodes.update(discount.stripe_promotion_code_id, { active: body.state === 'active' && !waiting })
    .catch((error) => stripeFailure('a situação do código', error))
  const result = await rpcRow<{ outcome: string; state: string | null }>('admin_set_discount_state', {
    p_user_id: user.id, p_id: params.id, p_state: body.state, p_reason: reason,
  })
  settle(result.outcome, { not_found: notFound, unchanged: conflict('O cupom já está assim.') })
  return json({ state: result.state })
}

// POST /internal/discounts/tick (a agenda do banco, com a chave do despacho): liga na Stripe os agendados cujo início
// chegou e marca no banco. Um que falha fica para a próxima rodada.
export async function internalDiscountsTick(req: Request): Promise<Response> {
  if (!(await sameSecret(req.headers.get('apikey') ?? '', env.dispatchKey()))) throw new HttpError(401, 'UNAUTHENTICATED', 'Chave inválida.')
  const due = (await rpc<DiscountRow[] | null>('due_discounts')) ?? []
  let started = 0
  for (const discount of due) {
    try {
      await stripe().promotionCodes.update(discount.stripe_promotion_code_id, { active: true })
      await rpcRow('mark_discount_started', { p_id: discount.id })
      started++
    } catch (error) {
      console.error(`discounts: ${discount.code} não ligou (${isStripeError(error) ? stripeErrorLabel(error) : 'erro'})`)
    }
  }
  return json({ due: due.length, started })
}
