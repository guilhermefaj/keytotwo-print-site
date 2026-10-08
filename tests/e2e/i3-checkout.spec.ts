import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

// Synthetic boundary fixtures, never payment credentials. The separate opt-in local
// integration test uses the real Auth/API/Stripe test-mode stack.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
const product = { code: 'P001', kind: 'bundle', name: 'Pacote de TESTE', games: [{ code: 'J001', name: 'Jogo de TESTE' }], price: { unit_amount: 1990, currency: 'brl' }, status: 'ok', available: true, owned_games: [], shared_with: [] }
const cart = { version: 3, items: [product], subtotal: { amount: 1990, currency: 'brl' }, warnings: [] }
const fakeSession = { access_token: 'synthetic-e2e-token', refresh_token: 'synthetic-e2e-refresh', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user: { id: 'qa-synthetic', email: 'synthetic@example.test', email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} } }
const stripeStub = `window.Stripe = (key, options) => ({ initCheckoutFormSdk({appearance}) {
  if (options.betas[0] !== 'custom_checkout_payment_form_1' || appearance.variables.colorPrimary !== '#0570de') throw Error('Studio settings changed');
  let discount = 0; let change = () => {}; let handlers = {}; let button;
  const session = () => ({id:'cs_test_synthetic123456', currency:'brl', livemode:false, status:{type:'open'}, total:{subtotal:{minorUnitsAmount:1990}, discount:{minorUnitsAmount:discount}, total:{minorUnitsAmount:1990-discount}}, discountAmounts: discount ? [{promotionCode:'TESTE10',displayName:'TESTE10'}] : []});
  const actions = {getSession: session, async applyPromotionCode(code) { if(code !== 'TESTE10') return {type:'error',error:{code:'invalidCode'}}; discount=199; change(session()); return {type:'success',session:session()}; }, async removePromotionCode() { discount=0; change(session()); return {type:'success',session:session()}; }, async confirm({formConfirmEvent}) { if(!formConfirmEvent) throw Error('Missing form event'); return {type:'success',session:session()}; }};
  return {on(event,handler) {change=handler}, async loadActions() {return {type:'success',actions}}, createForm(options) { if(options.layout!=='expanded') throw Error('Not expanded'); return {on(event,handler){handlers[event]=handler}, mount(host){button=document.createElement('button');button.textContent='Pagar (simulação de teste)';button.onclick=()=>handlers.confirm({source:'checkout-form-pay-button',paymentMethodType:'card'});host.append(button);handlers.ready()},destroy(){button?.remove()}}; }};
}});`

async function fixture(page: Page) {
  await page.addInitScript(session => localStorage.setItem('sb-127-auth-token', JSON.stringify(session)), fakeSession)
  await page.route('**/auth/v1/**', route => route.fulfill({ json: fakeSession.user }))
  await page.route('**/functions/v1/api/**', route => {
    const path = new URL(route.request().url()).pathname.split('/api')[1]
    const data = path === '/cart' ? cart : path === '/catalog' ? { products: [product] } : path === '/account' ? { email: fakeSession.user.email, marketing: { opted_in: false, prompted_at: '2026-01-01', text_version: null }, orders: [] } : path === '/checkout' ? { client_secret: 'synthetic-only-no-stripe-secret' } : path === '/order-status' ? { state: 'paid', next: 'open_library', items: [{ code: 'P001', name: product.name }] } : { games: [], pending: [] }
    return route.fulfill({ json: data })
  })
  await page.route('https://js.stripe.com/dahlia/stripe.js', route => route.fulfill({ contentType: 'application/javascript', body: stripeStub }))
}
async function start(page: Page) {
  await page.goto('/pagamento')
  test.skip(page.url().includes('/entrar'), 'Requires configured stage=test build')
  await expect(page.getByRole('heading', { name: 'Pagamento', exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /Aceito os/ })).toBeVisible()
}
async function stripeMode(page: Page) {
  await start(page)
  test.skip(await page.getByText('Demonstração: o pagamento real ainda não está conectado neste ambiente.').count() > 0, 'Run with VITE_CHECKOUT_MODE=stripe to exercise Stripe boundary')
}
test.beforeEach(async ({ page }) => {
  const html = await readFile(new URL('../../build/client/index.html', import.meta.url), 'utf8')
  test.skip(!html.includes('Ambiente de teste'), 'Synthetic authenticated tests require stage=test')
  await fixture(page)
})

test('explicit mock: acceptance, coupon and simulated confirmation without a checkout request', async ({ page }) => {
  let calls = 0
  page.on('request', request => { if (request.url().endsWith('/api/checkout') || request.url().includes('js.stripe.com')) calls++ })
  await start(page)
  test.skip(await page.getByText('Demonstração: o pagamento real ainda não está conectado neste ambiente.').count() === 0, 'Only applies to mock builds')
  await expect(page.locator('#checkout-form')).toHaveCount(0)
  await page.getByRole('checkbox', { name: /Aceito os/ }).check()
  await expect(page.getByText('Demonstração de pagamento (mock).', { exact: true })).toBeVisible()
  await page.getByLabel('Código do cupom').fill('TESTE10')
  await page.getByRole('button', { name: 'Aplicar cupom' }).click()
  await expect(page.locator('.payment-total')).toContainText('17,91')
  await page.getByRole('link', { name: 'Simular confirmação' }).click()
  await expect(page.locator('.confirmation-card .checkout-demo')).toContainText('Nenhuma compra ou liberação foi feita.')
  expect(calls).toBe(0)
})

test('acceptance gates API and form; coupon invalid/apply/remove; confirmation', async ({ page }) => {
  let calls = 0
  page.on('request', request => { if (request.url().endsWith('/api/checkout')) { calls++; expect(request.postDataJSON()).toEqual({ cart_version: 3, terms_accepted: true, terms_version: 'rascunho-2026-10-08' }) } })
  await stripeMode(page)
  await expect(page.locator('#checkout-form')).toHaveCount(0)
  expect(calls).toBe(0)
  await expect(page.locator('#checkout-form')).toHaveCount(0)
  await page.getByRole('checkbox', { name: /Aceito os/ }).check()
  await expect(page.getByRole('button', { name: 'Pagar (simulação de teste)' })).toBeVisible()
  expect(calls).toBe(1)
  await page.getByLabel('Código do cupom').fill('INVALIDO')
  await page.getByRole('button', { name: 'Aplicar cupom' }).click()
  await expect(page.getByRole('alert')).toContainText('Esse cupom não pôde ser aplicado')
  await page.getByLabel('Código do cupom').fill('TESTE10')
  await page.getByRole('button', { name: 'Aplicar cupom' }).click()
  await expect(page.locator('.payment-total')).toContainText('17,91')
  await page.getByRole('button', { name: 'Remover cupom' }).click()
  await expect(page.locator('.payment-total')).toContainText('19,90')
  await page.getByRole('checkbox', { name: /Aceito os/ }).uncheck()
  await expect(page.locator('#checkout-form')).toHaveCount(0)
  await page.getByRole('checkbox', { name: /Aceito os/ }).check()
  await page.getByRole('button', { name: 'Pagar (simulação de teste)' }).click()
  await expect(page.getByRole('heading', { name: 'O próximo encontro é de vocês!' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ir para Meus jogos', exact: true })).toHaveAttribute('href', '/meus-jogos')
})

for (const [code, message] of [['CART_CHANGED', 'Seu carrinho mudou'], ['TERMS_CHANGED', 'Os termos foram atualizados'], ['PAYMENT_PROVIDER_ERROR', 'Não conseguimos abrir o pagamento']]) {
  test(`checkout error ${code} never mounts form or fabricates success`, async ({ page }) => {
    await page.route('**/api/checkout', route => route.fulfill({ status: 409, json: { error: { code } } }))
    await stripeMode(page)
    await page.getByRole('checkbox', { name: /Aceito os/ }).check()
    await expect(page.getByRole('alert')).toContainText(message)
    await expect(page.getByRole('checkbox', { name: /Aceito os/ })).not.toBeChecked()
    await expect(page.locator('#checkout-form')).toHaveCount(0)
  })
}
for (const [state, title] of [['paid', 'O próximo encontro é de vocês!'], ['processing', 'Estamos preparando seus jogos'], ['pending_payment', 'Aguardando o pagamento'], ['failed', 'Vamos tentar de novo?'], ['expired', 'O tempo para pagar terminou'], ['not_found', 'Não encontramos esse pedido'], ['other_account', 'Este pedido é de outra conta']]) {
  test(`confirmation ${state}`, async ({ page }) => {
    await page.route('**/api/order-status?*', route => route.fulfill({ json: state === 'other_account' ? { state: 'paid', next: 'other_account' } : { state, next: state === 'paid' ? 'open_library' : undefined } }))
    await page.goto('/pedido/confirmacao?session_id=cs_test_synthetic123456')
    test.skip(page.url().includes('/entrar'), 'Requires configured stage=test build')
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    if (state === 'other_account') {
      await expect(page.locator('.confirmation-items')).toHaveCount(0)
      await page.getByRole('button', { name: 'Entrar com outra conta' }).click()
      await expect(page).toHaveURL(/\/entrar\?next=%2Fpedido%2Fconfirmacao%3Fsession_id%3Dcs_test_synthetic123456/)
    }
  })
}

test('processing polls with backoff, then shows paid', async ({ page }) => {
  let calls = 0
  await page.route('**/api/order-status?*', route => route.fulfill({ json: ++calls < 3 ? { state: 'processing' } : { state: 'paid', next: 'open_library' } }))
  await page.goto('/pedido/confirmacao?session_id=cs_test_synthetic123456')
  test.skip(page.url().includes('/entrar'), 'Requires configured stage=test build')
  await expect(page.getByRole('heading', { name: 'Estamos preparando seus jogos' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'O próximo encontro é de vocês!' })).toBeVisible({ timeout: 10000 })
  expect(calls).toBe(3)
})

test('payment is responsive at 320, 390, 768, 1280 and 1440 with double text', async ({ page }) => {
  await start(page)
  await page.getByRole('checkbox', { name: /Aceito os/ }).check()
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    for (const size of ['16px', '32px']) {
      await page.evaluate(value => { document.documentElement.style.fontSize = value }, size)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width}/${size}`).toBe(true)
    }
  }
})

test('cart without price cannot finalize; preview mock is explicit when enabled', async ({ page }) => {
  await page.route('**/api/cart', route => route.fulfill({ json: { ...cart, items: [{ ...product, price: null }], subtotal: null, warnings: [{ code: 'PRICE_UNAVAILABLE', product_code: 'P001' }] } }))
  await page.goto('/carrinho')
  test.skip(page.url().includes('/entrar'), 'Requires configured stage=test build')
  await expect(page.getByRole('button', { name: 'Finalizar compra' })).toBeDisabled()
})

test('unchecking terms cancels an in-flight checkout; accepting again creates a fresh form', async ({ page }) => {
  let calls = 0
  await page.route('**/api/checkout', async route => {
    calls++
    await new Promise(resolve => setTimeout(resolve, 450))
    await route.fulfill({ json: { client_secret: 'synthetic-only-no-stripe-secret' } }).catch(() => {})
  })
  await stripeMode(page)
  const terms = page.getByRole('checkbox', { name: /Aceito os/ })
  await terms.check()
  await expect.poll(() => calls).toBe(1)
  await terms.uncheck()
  await page.waitForTimeout(500)
  await expect(page.locator('#checkout-form')).toHaveCount(0)
  await terms.check()
  await expect(page.getByRole('button', { name: 'Pagar (simulação de teste)' })).toBeVisible()
  expect(calls).toBe(2)
})
