import { rpcRow } from '../../_shared/admin.ts'
import { requireAdminSession } from '../../_shared/auth.ts'
import { runInBackground } from '../../_shared/background.ts'
import { dispatchEmails } from '../../_shared/email.ts'
import { HttpError, json, readJsonObject } from '../../_shared/http.ts'
import { primePrices, stripePrice, stripePriceProduct } from '../../_shared/prices.ts'
import { isStripeError, livemode, stripe, stripeErrorLabel } from '../../_shared/stripe.ts'
import { reasonOf, settle } from './outcome.ts'

// Catálogo no admin (2026-10-24, decisões do responsável): a lista com o preço da Stripe, pausar e voltar a vender,
// trocar o preço (Price novo na Stripe, o produto passa para ele e o antigo é arquivado), o preço riscado e montar o
// pacote. O banco confere o admin e guarda cada ação com o motivo. A troca de PDF continua por script.

const MIN_AMOUNT = 100
const MAX_AMOUNT = 100_000

const notFound = () => new HttpError(404, 'NOT_FOUND', 'Produto não encontrado.')
const conflict = (message: string) => () => new HttpError(409, 'CATALOG_CONFLICT', message)

interface AdminProduct {
  code: string
  kind: 'single' | 'bundle'
  stripe_price_id: string | null
  [key: string]: unknown
}

function codeParam(value: string | undefined): string {
  if (!value || !/^[A-Z][A-Z0-9-]{1,23}$/.test(value)) throw notFound()
  return value
}

// Valor em centavos (de R$ 1,00 a R$ 1.000,00).
function amountOf(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < MIN_AMOUNT || (value as number) > MAX_AMOUNT) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Informe o valor em centavos, de R$ 1,00 a R$ 1.000,00.')
  }
  return value as number
}

async function listCatalog(adminId: string) {
  const list = await rpcRow<{ outcome: string; result: { version: string; products: AdminProduct[]; games: unknown[] } | null }>(
    'admin_list_catalog', { p_user_id: adminId, p_livemode: livemode() })
  settle(list.outcome)
  return list.result!
}

// GET /admin/catalog: { version, livemode, products, games }. Cada produto com o preço da Stripe (null se não houver ou
// estiver arquivado); a versão é a do catálogo público, para o admin dizer se a loja está em dia.
export async function adminCatalog(req: Request): Promise<Response> {
  const user = await requireAdminSession(req)
  const { version, products, games } = await listCatalog(user.id)
  await primePrices(products.map((product) => product.stripe_price_id))
  const withPrices = await Promise.all(products.map(async (product) => ({
    ...product,
    price: product.stripe_price_id ? await stripePrice(product.stripe_price_id) : null,
  })))
  return json({ version, livemode: livemode(), products: withPrices, games })
}

// POST /admin/products/:code/status { status: active | archived, reason }: voltar a vender ou pausar.
export async function adminProductStatus(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  const code = codeParam(params.code)
  const body = await readJsonObject(req)
  if (body.status !== 'active' && body.status !== 'archived') throw new HttpError(400, 'INVALID_REQUEST', 'A situação é active ou archived.')
  const reason = reasonOf(body)
  const result = await rpcRow<{ outcome: string }>('admin_set_product_status', { p_user_id: user.id, p_code: code, p_status: body.status, p_reason: reason })
  settle(result.outcome, {
    not_found: notFound,
    unchanged: conflict(body.status === 'active' ? 'Este produto já está à venda.' : 'Este produto já está pausado.'),
    not_ready: conflict('Ainda falta algo para vender este produto: o preço, o nome ou um jogo publicado com o PDF.'),
  })
  return json({ status: body.status })
}

// POST /admin/products/:code/price { amount, reason }: cria o Price novo no mesmo produto da Stripe (a chave de
// idempotência é do produto, do Price atual e do valor: repetir não cria outro), passa o produto para ele e arquiva o
// antigo. Quem está no meio do pagamento paga o valor antigo; a sacola já mostra o novo.
export async function adminProductPrice(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  const code = codeParam(params.code)
  const body = await readJsonObject(req)
  const amount = amountOf(body.amount)
  const reason = reasonOf(body)
  const product = (await listCatalog(user.id)).products.find((item) => item.code === code)
  if (!product) throw notFound()
  const current = product.stripe_price_id
  const stripeProduct = current ? await stripePriceProduct(current) : null
  if (!current || !stripeProduct) throw conflict('Este produto não tem um preço na Stripe para trocar.')()
  if ((await stripePrice(current))?.unit_amount === amount) throw conflict('O preço já é esse.')()

  let price
  try {
    price = await stripe().prices.create(
      { product: stripeProduct, unit_amount: amount, currency: 'brl', metadata: { code, source: 'admin' } },
      { idempotencyKey: `price:${code}:${current}:${amount}` },
    )
  } catch (error) {
    if (!isStripeError(error)) throw error
    console.error(`admin: preço novo na Stripe falhou (${stripeErrorLabel(error)})`)
    throw new HttpError(502, 'PAYMENT_PROVIDER_ERROR', error.statusCode === 403
      ? 'A chave da Stripe não tem permissão para criar preços. Libere a escrita de Preços na chave restrita.'
      : 'A Stripe recusou o preço novo agora. Nada mudou; tente de novo.')
  }
  const result = await rpcRow<{ outcome: string; previous_price_id: string | null }>('admin_set_product_price', {
    p_user_id: user.id, p_code: code, p_price_id: price.id, p_unit_amount: amount, p_currency: 'brl', p_stripe_product: stripeProduct, p_reason: reason,
  })
  settle(result.outcome, { not_found: notFound, unchanged: conflict('O preço já é esse.') })
  // O antigo sai da venda na Stripe; se falhar, nada quebra (o produto já aponta para o novo) e fica no log.
  try {
    await stripe().prices.update(current, { active: false })
  } catch (error) {
    console.error(`admin: o Price antigo não foi arquivado (${isStripeError(error) ? stripeErrorLabel(error) : 'erro'})`)
  }
  return json({ price: { unit_amount: amount, currency: 'brl' } })
}

// POST /admin/products/:code/list-price { amount | null, label, reason }: o preço riscado da promoção, ou nada.
export async function adminProductListPrice(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  const code = codeParam(params.code)
  const body = await readJsonObject(req)
  const amount = body.amount === null ? null : amountOf(body.amount)
  const label = typeof body.label === 'string' ? body.label.trim() : ''
  if (amount !== null && (label.length < 2 || label.length > 40)) throw new HttpError(400, 'INVALID_REQUEST', 'Escreva o rótulo da promoção, de 2 a 40 caracteres.')
  const reason = reasonOf(body)
  const result = await rpcRow<{ outcome: string }>('admin_set_list_price', {
    p_user_id: user.id, p_code: code, p_amount: amount, p_label: amount === null ? null : label, p_reason: reason,
  })
  settle(result.outcome, { not_found: notFound, unchanged: conflict('O preço riscado já está assim.') })
  return json({ list_price: amount === null ? null : { amount, label } })
}

// POST /admin/products/:code/games { game, gift, notify, reason }: põe o jogo no fim do pacote. Com gift, quem tem o
// pacote e ainda não tem o jogo ganha o avulso dele (e o e-mail de presente, com notify).
export async function adminAddPackGame(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  const code = codeParam(params.code)
  const body = await readJsonObject(req)
  const game = codeParam(typeof body.game === 'string' ? body.game : undefined)
  if (typeof body.gift !== 'boolean' || typeof body.notify !== 'boolean') throw new HttpError(400, 'INVALID_REQUEST', 'Diga se o jogo vai de presente para quem já tem o pacote.')
  const reason = reasonOf(body)
  const result = await rpcRow<{ outcome: string; gifted: number; outbox_ids: string[] | null }>('admin_add_pack_game', {
    p_user_id: user.id, p_code: code, p_game_code: game, p_gift: body.gift, p_notify: body.gift && body.notify, p_reason: reason, p_livemode: livemode(),
  })
  settle(result.outcome, {
    not_found: () => new HttpError(404, 'NOT_FOUND', 'Pacote ou jogo não encontrado.'),
    unchanged: conflict('Este jogo já está no pacote.'),
    not_allowed: conflict('Só um jogo pago e publicado entra num pacote.'),
    no_single: conflict('Para dar de presente, o jogo precisa do avulso à venda. Ponha sem presente ou ponha o avulso à venda antes.'),
  })
  const queued = result.outbox_ids?.length ?? 0
  if (queued) runInBackground('admin: presentes do pacote', () => dispatchEmails({ limit: Math.min(queued, 100) }))
  return json({ added: true, gifted: result.gifted, emails_queued: queued })
}

// POST /admin/products/:code/games/:game/remove { reason }: tira o jogo do pacote (fica com pelo menos dois).
export async function adminRemovePackGame(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  const code = codeParam(params.code)
  const game = codeParam(params.game)
  const reason = reasonOf(await readJsonObject(req))
  const result = await rpcRow<{ outcome: string }>('admin_remove_pack_game', { p_user_id: user.id, p_code: code, p_game_code: game, p_reason: reason })
  settle(result.outcome, {
    not_found: notFound,
    unchanged: conflict('Este jogo não está no pacote.'),
    not_allowed: conflict('O pacote precisa ficar com pelo menos dois jogos.'),
  })
  return json({ removed: true })
}
