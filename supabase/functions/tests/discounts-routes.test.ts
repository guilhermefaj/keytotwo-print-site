// Testes de contrato dos cupons, parceiros e indicações (docs/api-contract.md 6.18), sem rede e sem banco: a Stripe e o
// banco são falsos (contract-helpers).
import { assert, assertEquals } from '@std/assert'
import { adminToken as admin, captureErrors, contractTest, ok, onRpc, onStripe, request, row, rpcCalls, send, SECRET_KEY, sessionToken, stripeCalls, userId } from './contract-helpers.ts'
import { handleRequest } from '../api/router.ts'
import { verifyReferralToken } from '../_shared/tokens.ts'

const DISCOUNT = '3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f'
const PARTNER = '4d5e6f7a-8b9c-4d0e-9f1a-3b4c5d6e7f80'
const list = (over: Record<string, unknown> = {}) => ({
  discounts: [{ id: DISCOUNT, code: 'BLACK26', state: 'active', starts_at: null, stripe_promotion_code_id: 'promo_BLACK26' }],
  partners: [{ id: PARTNER, slug: 'ana-souza', name: 'Ana Souza', status: 'active' }],
  products: [{ code: 'P001', name: 'Pacote', stripe_product: 'prod_P001' }, { code: 'J009', name: 'Sem preço', stripe_product: null }],
  ...over,
})
function discountsDb(actions: Record<string, Record<string, unknown>> = {}) {
  onRpc((fn) => {
    if (fn === 'admin_list_discounts') return row({ outcome: 'ok', result: list() })
    if (fn in actions) return row(actions[fn])
    return { status: 500, body: {} }
  })
}
const stripeOk = () => onStripe((call) => {
  if (call.path === '/v1/coupons') return ok({ id: 'coupon_NOVO', object: 'coupon' })
  if (call.path === '/v1/promotion_codes') return ok({ id: 'promo_NOVO', object: 'promotion_code' })
  if (call.path.startsWith('/v1/promotion_codes/')) return ok({ id: call.path.split('/').pop(), object: 'promotion_code' })
  return { status: 404, body: {} }
})

contractTest('cupons e parceiros no admin: sem sessão 401; sem o segundo fator 403 MFA_REQUIRED, antes do banco', async () => {
  onRpc(() => ({ status: 200, body: null }))
  const aal1 = await sessionToken({ aal: 'aal1' })
  const routes: [string, string][] = [
    ['/admin/discounts', 'GET'], ['/admin/discounts', 'POST'], [`/admin/discounts/${DISCOUNT}/state`, 'POST'],
    ['/admin/partners', 'GET'], ['/admin/partners', 'POST'], [`/admin/partners/${PARTNER}`, 'GET'], [`/admin/partners/${PARTNER}`, 'POST'],
    [`/admin/partners/${PARTNER}/payouts`, 'POST'], [`/admin/partners/${PARTNER}/export?month=2026-10`, 'GET'],
  ]
  for (const [path, method] of routes) {
    const body = method === 'GET' ? undefined : {}
    assertEquals((await send(path, { method, body })).body.error.code, 'UNAUTHENTICATED', `${method} ${path}`)
    assertEquals((await send(path, { method, token: aal1, body })).body.error.code, 'MFA_REQUIRED', `${method} ${path}`)
  }
  assertEquals(rpcCalls.length, 0)
})

contractTest('POST /admin/discounts: cria o cupom e o código na Stripe (idempotentes pelo código) e guarda; o produto vira o da Stripe', async () => {
  const token = await admin()
  discountsDb({ admin_create_discount: { outcome: 'ok', id: DISCOUNT } })
  stripeOk()
  const body = {
    code: ' natal26 ', percent_off: 20, product_codes: ['P001'], ends_at: '2099-12-26T03:00:00.000Z', max_redemptions: 100,
    first_time_only: true, minimum_amount: 2000, campaign: 'Natal 2026', banner: 'Natal: 20% com {cupom}', reason: 'Campanha de Natal',
  }
  const res = await send('/admin/discounts', { method: 'POST', token, body })
  assertEquals([res.status, res.body], [201, { id: DISCOUNT, state: 'active' }])
  const [coupon, promotion] = stripeCalls
  assertEquals([coupon.path, promotion.path], ['/v1/coupons', '/v1/promotion_codes'])
  assert(/^coupon:NATAL26:[0-9a-f]{16}$/.test(coupon.idempotencyKey!) && promotion.idempotencyKey === coupon.idempotencyKey!.replace('coupon:', 'promotion:'))
  const c = Object.fromEntries(coupon.params)
  assertEquals([c.percent_off, c.duration, c['applies_to[products][0]'], c.name], ['20', 'once', 'prod_P001', 'NATAL26'])
  const p = Object.fromEntries(promotion.params)
  assertEquals([p['promotion[type]'], p['promotion[coupon]'], p.code, p.active, p.max_redemptions, p.expires_at], ['coupon', 'coupon_NOVO', 'NATAL26', 'true', '100', String(Math.floor(Date.parse('2099-12-26T03:00:00Z') / 1000))])
  assertEquals([p['restrictions[first_time_transaction]'], p['restrictions[minimum_amount]'], p['restrictions[minimum_amount_currency]']], ['true', '2000', 'brl'])
  const saved = rpcCalls.find((call) => call.fn === 'admin_create_discount')!.args
  assertEquals([saved.p_stripe_coupon_id, saved.p_stripe_promotion_code_id, saved.p_reason], ['coupon_NOVO', 'promo_NOVO', 'Campanha de Natal'])
  assertEquals((saved.p_discount as Record<string, unknown>).code, 'NATAL26')

  // a mesma tentativa repete as chaves; outras regras, outras chaves
  await send('/admin/discounts', { method: 'POST', token, body })
  await send('/admin/discounts', { method: 'POST', token, body: { ...body, percent_off: 25 } })
  const keys = stripeCalls.filter((call) => call.path === '/v1/coupons').map((call) => call.idempotencyKey)
  assertEquals([keys[1] === keys[0], keys[2] === keys[0]], [true, false])

  // começa depois: o código nasce desligado
  await send('/admin/discounts', { method: 'POST', token, body: { code: 'ANONOVO', percent_off: 15, starts_at: '2099-01-01T03:00:00.000Z', reason: 'Ano novo' } })
  assertEquals(Object.fromEntries(stripeCalls.filter((call) => call.path === '/v1/promotion_codes').at(-1)!.params).active, 'false')
})

contractTest('POST /admin/discounts: conferido antes da Stripe (código usado, produto sem preço, faixa com parceiro); o banco recusa e o código sai', async () => {
  const token = await admin()
  discountsDb({ admin_create_discount: { outcome: 'code_taken', id: null } })
  stripeOk()
  const cases: [Record<string, unknown>, number][] = [
    [{ code: 'A', percent_off: 10 }, 400], [{ code: 'BOA10', percent_off: 0 }, 400], [{ code: 'BOA10', percent_off: 10.555 }, 400],
    [{ code: 'BOA10', percent_off: 10, ends_at: '2020-01-01T00:00:00Z' }, 400], [{ code: 'BOA10', percent_off: 10, banner: 'Faixa {cupom}', partner: 'ana-souza' }, 400], [{ code: 'BOA10', percent_off: 10, banner: 'Faixa sem o código' }, 400],
    [{ code: 'black26', percent_off: 10 }, 409], [{ code: 'BOA10', percent_off: 10, product_codes: ['J009'] }, 409], [{ code: 'BOA10', percent_off: 10, partner: 'nao-existe' }, 404],
  ]
  for (const [body, status] of cases) {
    assertEquals((await send('/admin/discounts', { method: 'POST', token, body: { ...body, reason: 'Campanha' } })).status, status, JSON.stringify(body))
  }
  assertEquals(stripeCalls.length, 0)
  const { result: res } = await captureErrors(() => send('/admin/discounts', { method: 'POST', token, body: { code: 'BOA10', percent_off: 10, reason: 'Campanha' } }))
  assertEquals(res.status, 409)
  const off = stripeCalls.find((call) => call.path === '/v1/promotion_codes/promo_NOVO')!
  assertEquals(Object.fromEntries(off.params).active, 'false')
})

contractTest('POST /admin/discounts/:id/state: liga ou desliga na Stripe antes do banco; encerrado não volta', async () => {
  const token = await admin()
  discountsDb({ admin_set_discount_state: { outcome: 'ok', state: 'paused' } })
  stripeOk()
  const res = await send(`/admin/discounts/${DISCOUNT}/state`, { method: 'POST', token, body: { state: 'paused', reason: 'Fim de semana' } })
  assertEquals([res.status, res.body], [200, { state: 'paused' }])
  assertEquals([stripeCalls[0].path, Object.fromEntries(stripeCalls[0].params).active], ['/v1/promotion_codes/promo_BLACK26', 'false'])
  assertEquals(rpcCalls.find((call) => call.fn === 'admin_set_discount_state')!.args, { p_user_id: userId(token), p_id: DISCOUNT, p_state: 'paused', p_reason: 'Fim de semana' })
  onRpc((fn) => (fn === 'admin_list_discounts' ? row({ outcome: 'ok', result: list({ discounts: [{ id: DISCOUNT, code: 'BLACK26', state: 'ended', starts_at: null, stripe_promotion_code_id: 'promo_BLACK26' }] }) }) : { status: 500, body: {} }))
  assertEquals((await send(`/admin/discounts/${DISCOUNT}/state`, { method: 'POST', token, body: { state: 'active', reason: 'Reabrir' } })).status, 409)
})

contractTest('POST /internal/discounts/tick: só com a chave do despacho; liga os agendados que começaram', async () => {
  onRpc((fn) => (fn === 'due_discounts' ? ok([{ id: DISCOUNT, code: 'NATAL26', stripe_promotion_code_id: 'promo_NATAL26' }]) : ok([{ outcome: 'ok' }])))
  stripeOk()
  assertEquals((await handleRequest(request('/internal/discounts/tick', { method: 'POST', body: {}, headers: { apikey: 'outra' } }))).status, 401)
  const res = await handleRequest(request('/internal/discounts/tick', { method: 'POST', body: {}, headers: { apikey: SECRET_KEY } }))
  assertEquals([res.status, await res.json()], [200, { due: 1, started: 1 }])
  assertEquals([stripeCalls[0].path, Object.fromEntries(stripeCalls[0].params).active], ['/v1/promotion_codes/promo_NATAL26', 'true'])
  assertEquals(rpcCalls.map((call) => call.fn), ['due_discounts', 'mark_discount_started'])
  // Na nuvem, desde 2026-10-25, um segredo próprio (DISPATCH_SECRET): a chave secreta do Supabase não vale mais.
  Deno.env.set('DISPATCH_SECRET', 'segredo-da-agenda-de-teste')
  try {
    assertEquals((await handleRequest(request('/internal/discounts/tick', { method: 'POST', body: {}, headers: { apikey: SECRET_KEY } }))).status, 401)
    assertEquals((await handleRequest(request('/internal/discounts/tick', { method: 'POST', body: {}, headers: { apikey: 'segredo-da-agenda-de-teste' } }))).status, 200)
  } finally {
    Deno.env.delete('DISPATCH_SECRET')
  }
})

contractTest('parceiros: criar e editar com conferência; o repasse e a planilha do mês, sem e-mail de cliente', async () => {
  const token = await admin()
  onRpc((fn) => {
    if (fn === 'admin_save_partner') return row({ outcome: 'ok', id: PARTNER })
    if (fn === 'admin_mark_partner_paid') return row({ outcome: 'ok', amount: 235 })
    if (fn === 'admin_partner_orders') {
      return row({ outcome: 'ok', result: { partner: { slug: 'ana-souza', name: 'Ana Souza', commission_percent: 12.5 },
        orders: [{ ref: 'A1B2C3D4', paid_at: '2026-10-21T10:00:00Z', amount_total: 891, amount_discount: 99, promotion_code: 'ANA10' }, { ref: 'B2C3D4E5', paid_at: '2026-10-22T10:00:00Z', amount_total: 990, amount_discount: 0, promotion_code: null }] } })
    }
    return { status: 500, body: {} }
  })
  for (const body of [{ slug: 'Ana Souza', name: 'Ana' }, { slug: 'ana', name: 'A' }, { slug: 'ana', name: 'Ana', commission_percent: 101 }]) {
    assertEquals((await send('/admin/partners', { method: 'POST', token, body: { ...body, reason: 'Parceria' } })).status, 400, JSON.stringify(body))
  }
  const created = await send('/admin/partners', { method: 'POST', token, body: { slug: 'Ana-Souza', name: ' Ana Souza ', handle: '@ana', commission_percent: 12.5, reason: 'Parceria do lançamento' } })
  assertEquals([created.status, created.body], [201, { id: PARTNER }])
  assertEquals(rpcCalls.at(-1)!.args, { p_user_id: userId(token), p_id: null, p_reason: 'Parceria do lançamento',
    p_partner: { slug: 'ana-souza', name: 'Ana Souza', handle: '@ana', contact: null, commission_percent: 12.5, status: 'active', notes: null } })
  assertEquals((await send(`/admin/partners/${PARTNER}`, { method: 'POST', token, body: { name: 'Ana', commission_percent: 0, reason: 'Virou amiga' } })).status, 200)
  assertEquals(rpcCalls.at(-1)!.args.p_id, PARTNER)

  assertEquals((await send(`/admin/partners/${PARTNER}/payouts`, { method: 'POST', token, body: { month: '2026-13', reason: 'Pix' } })).status, 400)
  const paid = await send(`/admin/partners/${PARTNER}/payouts`, { method: 'POST', token, body: { month: '2026-10', note: 'Pix 123', reason: 'Pix do mês' } })
  assertEquals([paid.status, paid.body], [200, { amount: 235 }])
  assertEquals(rpcCalls.at(-1)!.args, { p_user_id: userId(token), p_id: PARTNER, p_month: '2026-10-01', p_note: 'Pix 123', p_reason: 'Pix do mês', p_livemode: false })

  const csv = await handleRequest(request(`/admin/partners/${PARTNER}/export?month=2026-10`, { token }))
  assertEquals(csv.status, 200)
  assertEquals(csv.headers.get('Content-Disposition'), 'attachment; filename="parceiro-ana-souza-2026-10.csv"')
  const text = await csv.text()
  assert(text.includes('A1B2C3D4;2026-10-21T10:00:00Z;8,91;0,99;ANA10;1,11'), text)
  assert(text.includes('Total;;18,81;;;2,35'), text)
  assertEquals(text.includes('@'), false)
})

contractTest('POST /referral/visit (pública): o parceiro ativo devolve o nome, o código e o comprovante da visita; o resto 404', async () => {
  onRpc(() => row({ outcome: 'ok', slug: 'ana-souza', name: 'Ana Souza', code: 'ANA10', percent_off: '10.00' }))
  const res = await handleRequest(request('/referral/visit', { method: 'POST', body: { partner: ' Ana-Souza ' } }))
  const { token, ...visit } = await res.json()
  assertEquals([res.status, visit], [200, { partner: 'ana-souza', name: 'Ana Souza', code: 'ANA10', percent_off: 10 }])
  const verified = await verifyReferralToken(token)
  assert(verified.ok && verified.claims.p === 'ana-souza' && Math.abs(verified.claims.l * 1000 - Date.now()) < 5000)
  assertEquals(rpcCalls[0].args, { p_slug: 'ana-souza' })
  assertEquals((await handleRequest(request('/referral/visit', { method: 'POST', body: { partner: 'ana souza' } }))).status, 404)
  assertEquals(rpcCalls.length, 1)
  onRpc(() => row({ outcome: 'not_found', slug: null, name: null, code: null, percent_off: null }))
  assertEquals((await handleRequest(request('/referral/visit', { method: 'POST', body: { partner: 'pausado' } }))).status, 404)
})
