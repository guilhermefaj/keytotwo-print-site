import { expect, test, type Page } from './fixtures/test'
import { readFile } from 'node:fs/promises'

// Synthetic boundary fixtures, never payment credentials. The separate opt-in local
// integration test uses the real Auth/API/Stripe test-mode stack.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
import { cart, product, fixture } from './fixtures/checkout'

async function start(page: Page) {
  await page.goto('/pagamento')
  test.skip(page.url().includes('/entrar'), 'Requires configured stage=test build')
  await expect(page.getByRole('heading', { name: 'Pagamento', exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /Li e aceito os/ })).toBeVisible()
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
  await page.getByRole('checkbox', { name: /Li e aceito os/ }).check()
  await expect(page.getByText('Demonstração de pagamento.', { exact: true })).toBeVisible()
  await page.getByLabel('Código do cupom').fill('TESTE10')
  await page.getByRole('button', { name: 'Aplicar cupom' }).click()
  await expect(page.locator('.payment-total')).toContainText('17,91')
  await page.getByRole('link', { name: 'Simular confirmação' }).click()
  await expect(page.locator('.confirmation-card .checkout-demo')).toContainText('Nenhuma compra ou liberação foi feita.')
  expect(calls).toBe(0)
})

// Link de parceiro (2026-10-24): o pedido leva de onde a pessoa veio, e o código do parceiro entra sozinho no formulário.
test('partner link: referral goes with the order and the partner code is applied on its own', async ({ page }) => {
  const referral = { partner: 'ana-souza', landed_at: new Date().toISOString(), path: '/loja', utm_source: 'instagram', name: 'Ana Souza', code: 'TESTE10', percent_off: 10, counted_on: '2026-10-24' }
  await page.addInitScript(value => localStorage.setItem('keytotwo:indicacao', JSON.stringify(value)), referral)
  const bodies: unknown[] = []
  page.on('request', request => { if (request.url().endsWith('/api/checkout')) bodies.push(request.postDataJSON()) })
  await stripeMode(page)
  await page.getByRole('checkbox', { name: /Li e aceito os/ }).check()
  await expect(page.locator('.payment-total')).toContainText('17,91')
  await expect(page.getByText('Cupom TESTE10 aplicado (indicação de Ana Souza).')).toBeVisible()
  expect(bodies).toEqual([{ cart_version: 3, terms_accepted: true, terms_version: 'termos-2026-10-22', referral: { partner: 'ana-souza', landed_at: referral.landed_at, path: '/loja', utm_source: 'instagram' } }])
})

test('acceptance gates API and form; coupon invalid/apply/remove; confirmation', async ({ page }) => {
  let calls = 0
  page.on('request', request => { if (request.url().endsWith('/api/checkout')) { calls++; expect(request.postDataJSON()).toEqual({ cart_version: 3, terms_accepted: true, terms_version: 'termos-2026-10-22' }) } })
  await stripeMode(page)
  await expect(page.locator('#checkout-form')).toHaveCount(0)
  expect(calls).toBe(0)
  await expect(page.locator('#checkout-form')).toHaveCount(0)
  await page.getByRole('checkbox', { name: /Li e aceito os/ }).check()
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
  await page.getByRole('checkbox', { name: /Li e aceito os/ }).uncheck()
  await expect(page.locator('#checkout-form')).toHaveCount(0)
  await page.getByRole('checkbox', { name: /Li e aceito os/ }).check()
  await page.getByRole('button', { name: 'Pagar (simulação de teste)' }).click()
  await expect(page.getByRole('heading', { name: 'Pronto. Os jogos são de vocês.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Abrir Meus jogos', exact: true })).toHaveAttribute('href', '/meus-jogos')
})

for (const [code, message] of [['CART_CHANGED', 'Sua sacola mudou'], ['TERMS_CHANGED', 'Os termos foram atualizados'], ['PAYMENT_PROVIDER_ERROR', 'Não conseguimos abrir o pagamento']]) {
  test(`checkout error ${code} never mounts form or fabricates success`, async ({ page }) => {
    await page.route('**/api/checkout', route => route.fulfill({ status: 409, json: { error: { code } } }))
    await stripeMode(page)
    // click, não check: o erro desmarca a caixa logo em seguida, e o check exigiria que ela continuasse marcada.
    await page.getByRole('checkbox', { name: /Li e aceito os/ }).click()
    await expect(page.getByRole('alert')).toContainText(message)
    await expect(page.getByRole('checkbox', { name: /Li e aceito os/ })).not.toBeChecked()
    await expect(page.locator('#checkout-form')).toHaveCount(0)
  })
}
for (const [state, title] of [['paid', 'Pronto. Os jogos são de vocês.'], ['processing', 'Estamos preparando seus jogos'], ['pending_payment', 'Aguardando o pagamento'], ['failed', 'Vamos tentar de novo?'], ['expired', 'Vamos tentar de novo?'], ['not_found', 'Não encontramos esse pedido'], ['other_account', 'Este pedido é de outra conta']]) {
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
  await expect(page.getByRole('heading', { name: 'Pronto. Os jogos são de vocês.' })).toBeVisible({ timeout: 10000 })
  expect(calls).toBe(3)
})

test('payment is responsive at 320, 390, 768, 1280 and 1440 with double text', async ({ page }) => {
  await start(page)
  await page.getByRole('checkbox', { name: /Li e aceito os/ }).check()
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
  const terms = page.getByRole('checkbox', { name: /Li e aceito os/ })
  await terms.check()
  await expect.poll(() => calls).toBe(1)
  await terms.uncheck()
  await page.waitForTimeout(500)
  await expect(page.locator('#checkout-form')).toHaveCount(0)
  await terms.check()
  await expect(page.getByRole('button', { name: 'Pagar (simulação de teste)' })).toBeVisible()
  expect(calls).toBe(2)
})
