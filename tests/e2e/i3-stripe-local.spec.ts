import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// Explicit opt-in, real TEST-mode payment only. No traces, HAR, video, saved auth
// or automatic screenshots: Stripe client secrets and Auth responses must not be recorded.
// Requested captures show the form BEFORE entering test card details and the return page.
test.use({ baseURL: 'http://127.0.0.1:5178', trace: 'off', screenshot: 'off', video: 'off' })
test.skip(process.env.I3_STRIPE_QA !== '1', 'Requires I3 local database, TESTE10 and test Stripe configuration')
test.setTimeout(150000)

async function fillStripe(page: Page, selector: string, value: string) {
  await expect.poll(async () => {
    for (const frame of page.frames()) {
      const input = frame.locator(selector).first()
      if (await input.isVisible().catch(() => false)) { await input.fill(value); return true }
    }
    return false
  }, { timeout: 20000, message: `Stripe field ready: ${selector}` }).toBe(true)
}

async function startPayment(page: Page) {
  const email = `qa-checkout-${randomUUID()}@example.test`
  await page.goto('/entrar?next=%2Fcarrinho&add=P001')
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('Ambiente de teste — sem cobranças reais.')).toBeVisible()
  await page.getByLabel('E-mail', { exact: true }).fill(email)
  await page.getByRole('button', { name: 'Enviar código', exact: true }).click()
  await expect(page.getByLabel('Código de verificação')).toBeVisible()
  let code = ''
  await expect.poll(async () => {
    const inbox = await fetch('http://127.0.0.1:54324/api/v1/messages?limit=100').then(response => response.json())
    const message = inbox.messages.find((item: { ID: string; To: { Address: string }[] }) => item.To.some(to => to.Address === email))
    if (!message) return false
    const detail = await fetch(`http://127.0.0.1:54324/api/v1/message/${message.ID}`).then(response => response.json())
    code = (detail.Text || detail.HTML || '').match(/\b\d{6}\b/)?.[0] || ''
    return Boolean(code)
  }, { timeout: 20000, message: 'Mailpit delivered verification code' }).toBe(true)
  await page.getByLabel('Código de verificação').fill(code)
  await page.getByRole('button', { name: 'Confirmar código', exact: true }).click()
  await expect(page.locator('[data-cart-product="P001"]')).toBeVisible()
  const productName = await page.locator('[data-cart-product="P001"] h3').innerText()
  await page.getByRole('button', { name: 'Finalizar compra', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Pagamento', exact: true })).toBeVisible()
  await expect(page.locator('.checkout-demo')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Continuar para pagamento' })).toBeDisabled()
  await page.getByRole('checkbox', { name: /Aceito os/ }).check()
  const checkoutResponse = page.waitForResponse(response => response.url().endsWith('/api/checkout'))
  await page.getByRole('button', { name: 'Continuar para pagamento' }).click()
  const response = await checkoutResponse
  expect(response.status(), 'POST /checkout succeeds against real local backend').toBe(200)
  const body = await response.json()
  // Only the non-secret session ID may be used in the return URL; never log/store the secret.
  const sessionId = String(body.client_secret).split('_secret_')[0]
  const retry = page.getByRole('button', { name: 'Recarregar formulário' })
  await expect(page.locator('#checkout-form iframe').first().or(retry)).toBeVisible({ timeout: 35000 })
  if (await retry.isVisible()) await retry.click()
  await expect(page.locator('#checkout-form iframe').first()).toBeVisible({ timeout: 30000 })
  await page.getByText('Tenho um cupom', { exact: true }).click()
  await page.getByLabel('Código do cupom', { exact: true }).fill('TESTE10')
  await page.getByRole('button', { name: 'Aplicar cupom', exact: true }).click()
  await expect(page.locator('.payment-total')).toContainText('17,91', { timeout: 15000 })
  await page.getByRole('button', { name: 'Remover cupom', exact: true }).click()
  await expect(page.locator('.payment-total')).toContainText('19,90')
  await page.getByLabel('Código do cupom', { exact: true }).fill('TESTE10')
  await page.getByRole('button', { name: 'Aplicar cupom', exact: true }).click()
  await expect(page.locator('.payment-total')).toContainText('17,91')
  return { sessionId, productName }
}

async function payWithCard(page: Page, number: string) {
  await fillStripe(page, 'input[name="number"]', number)
  await fillStripe(page, 'input[name="expiry"]', '1230')
  await fillStripe(page, 'input[name="cvc"]', '123')
  // Some account configurations ask billing name/postal code; fill only visible fields.
  for (const frame of page.frames()) {
    for (const [selector, value] of [['input[name="name"]', 'Pessoa Teste'], ['input[name="postalCode"]', '01310100']]) {
      const field = frame.locator(selector).first()
      if (await field.isVisible().catch(() => false)) await field.fill(value)
    }
  }
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `actual Stripe form at ${width}`).toBe(true)
  }
  await expect.poll(async () => {
    for (const frame of page.frames()) {
      const button = frame.getByRole('button', { name: /^(Pagar|Pay)(\s|$)/ }).first()
      if (await button.isVisible().catch(() => false) && await button.isEnabled()) { await button.click(); return true }
    }
    return false
  }, { timeout: 20000, message: 'Stripe TEST payment button is ready' }).toBe(true)
}

test('Mailpit → cart → terms → TESTE10 → 4242 → paid → library and empty cart', async ({ page }) => {
  const { productName } = await startPayment(page)
  const captureDir = process.env.I3_QA_DIR
  if (captureDir) {
    await mkdir(captureDir, { recursive: true })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({ path: join(captureDir, 'pagamento-cupom.png'), fullPage: true })
  }
  await payWithCard(page, '4242424242424242')
  await expect(page.getByRole('heading', { name: 'O próximo encontro é de vocês!' })).toBeVisible({ timeout: 45000 })
  if (captureDir) await page.screenshot({ path: join(captureDir, 'confirmacao.png'), fullPage: true })
  await page.getByRole('link', { name: 'Ir para Meus jogos', exact: true }).click()
  await expect(page.locator('.library-grid > li')).toHaveCount(5)
  await expect(page.locator('.library-grid')).toContainText(productName)
  await page.goto('/carrinho')
  await expect(page.getByRole('heading', { name: 'Seu carrinho está vazio', exact: true })).toBeVisible()
})

test('declined test card stays unpaid, preserves cart and grants no games', async ({ page }) => {
  const { sessionId } = await startPayment(page)
  await payWithCard(page, '4000000000000002')
  await expect(page.locator('.stripe-payment > .form-error')).toContainText('O pagamento não foi concluído', { timeout: 30000 })
  await expect(page).toHaveURL(/\/pagamento$/)
  await page.goto(`/pedido/confirmacao?session_id=${encodeURIComponent(sessionId)}`)
  await expect(page.getByRole('heading', { name: 'Vamos tentar de novo?' })).toBeVisible()
  await page.goto('/meus-jogos')
  await expect(page.getByText('Você ainda não tem jogos liberados.')).toBeVisible()
  await page.goto('/carrinho')
  await expect(page.locator('[data-cart-product="P001"]')).toBeVisible()
})
