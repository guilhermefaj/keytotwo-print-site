import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from './fixtures/test'

// Opt-in integration suite: real local Auth, Mailpit and Edge API, no admin key.
// Run after a stage=test build: $env:I2B_LOCAL_QA='1'; npm run test:e2e
// No traces/video/screenshots: authentication responses contain session secrets.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test.skip(process.env.I2B_LOCAL_QA !== '1', 'Requires the local Supabase + Mailpit stack and stage=test build')
test.describe.configure({ mode: 'serial', timeout: 120_000 })

async function mailCode(email: string, excluded: Set<string> = new Set()) {
  let code = ''
  await expect.poll(async () => {
    const response = await fetch('http://127.0.0.1:54324/api/v1/messages?limit=100')
    const inbox = await response.json()
    const message = inbox.messages.find((item: { ID: string; To: { Address: string }[] }) => !excluded.has(item.ID) && item.To.some(to => to.Address === email))
    if (!message) return false
    const detail = await fetch(`http://127.0.0.1:54324/api/v1/message/${message.ID}`).then(result => result.json())
    code = (detail.Text || detail.HTML || '').match(/\b\d{6}\b/)?.[0] || ''
    excluded.add(message.ID)
    return code.length === 6
  }, { timeout: 20_000, message: 'The local verification email should arrive' }).toBe(true)
  return code
}

async function verifyCode(page: Page, email: string, seen?: Set<string>) {
  await expect(page.getByLabel('Código de verificação')).toBeVisible()
  await page.getByLabel('Código de verificação').fill(await mailCode(email, seen))
  await page.getByRole('button', { name: 'Confirmar código', exact: true }).click()
}

async function loginWithCode(page: Page, email: string) {
  await page.getByLabel('E-mail', { exact: true }).fill(email)
  await page.getByRole('button', { name: 'Enviar código', exact: true }).click()
  await verifyCode(page, email)
}

async function noOverflow(page: Page) {
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const fontSize of ['16px', '32px']) {
      await page.evaluate(size => { document.documentElement.style.fontSize = size }, fontSize)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `overflow at ${width}px, text ${fontSize}`).toBe(true)
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = '' })
  }
}

// Without a Stripe key (CI), the real /catalog returns price null and the shop offers no purchase.
// Only the missing price is filled in here; products, composition and availability stay those of the API.
test.beforeEach(async ({ page }) => {
  await page.route('**/functions/v1/api/catalog', async route => {
    const response = await route.fetch()
    const body = await response.json()
    for (const product of body.products ?? []) product.price ??= { unit_amount: 100, currency: 'brl' }
    await route.fulfill({ response, json: body })
  })
})

test('guest add → Mailpit code → persistent cart; marketing and private views', async ({ page }) => {
  const email = `qa-cart-${randomUUID()}@example.test`
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  await page.goto('/loja/colecao-fundadores')
  await page.getByRole('button', { name: 'Adicionar à sacola', exact: true }).click()
  // Sem login, a escolha fica na sacola do navegador; ao entrar, ela se junta à sacola da conta.
  await expect(page.getByRole('dialog', { name: 'Sua sacola' }).locator('.drawer-items li')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await page.goto('/entrar?next=%2Fcarrinho')
  await noOverflow(page)
  await loginWithCode(page, email)
  await expect(page).toHaveURL(/\/carrinho$/)
  await expect(page.locator('[data-cart-product="P001"]')).toBeVisible()
  await expect(page.locator('.desktop-action').getByRole('button', { name: 'Sacola, 1 item', exact: true })).toBeVisible()
  // I3 enables checkout only when the real catalog supplies a price.
  const checkout = page.getByRole('button', { name: 'Finalizar compra', exact: true })
  if (await page.getByText('Não conseguimos carregar o preço.', { exact: true }).count()) await expect(checkout).toBeDisabled()
  else await expect(checkout).toBeEnabled()
  await expect(page.locator('.refund-notice')).toHaveCount(0)
  await expect(page.locator('.newsletter')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('[data-cart-product="P001"]')).toBeVisible()
  await page.waitForLoadState('networkidle')
  await expect(page.locator('.consent-invite')).toHaveCount(0)
  await noOverflow(page)
  await page.goto('/conta')
  await expect(page.getByText(email, { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Minha conta', exact: true })).toBeVisible()
  const form = page.locator('.marketing-form')
  await expect(form.getByRole('button', { name: 'Quero receber ideias', exact: true })).toBeVisible()
  await form.getByRole('button', { name: 'Quero receber ideias', exact: true }).click()
  await page.waitForLoadState('networkidle')
  await expect(form).toContainText('Você recebe nossas ideias')
  await form.getByRole('button', { name: 'Parar de receber', exact: true }).click()
  await page.waitForLoadState('networkidle')
  await expect(form.getByRole('button', { name: 'Quero receber ideias', exact: true })).toBeVisible()
  await noOverflow(page)
  await page.goto('/meus-jogos')
  await expect(page.getByText('Por enquanto, só o Kito mora aqui.')).toBeVisible()
  await noOverflow(page)
  await page.goto('/carrinho')
  await page.getByRole('button', { name: /^Remover / }).click()
  await expect(page.getByRole('heading', { name: 'Sua sacola está vazia', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.locator('[data-cart-product]')).toHaveCount(0)
  await page.goto('/conta')
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click()
  await expect(page).toHaveURL(/\/entrar\?next=%2Fconta$/)
  await page.goto('/meus-jogos')
  await expect(page).toHaveURL(/\/entrar\?next=%2Fmeus-jogos$/)
  expect(runtimeErrors).toEqual([])
})

test('password is created only after verified email; password login and recovery code', async ({ page }) => {
  const email = `qa-password-${randomUUID()}@example.test`
  const password = `Aa9-${randomUUID()}`
  const changedPassword = `Bb8-${randomUUID()}`
  const seen = new Set<string>()
  const authRequests: string[] = []
  page.on('request', request => { if (/\/auth\/v1\//.test(request.url())) authRequests.push(`${request.method()} ${new URL(request.url()).pathname}`) })
  await page.goto('/entrar?next=%2Fconta')
  await page.getByRole('button', { name: 'Criar conta com senha', exact: true }).click()
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await page.getByLabel('E-mail', { exact: true }).fill(email)
  await page.getByRole('button', { name: 'Enviar código', exact: true }).click()
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await verifyCode(page, email, seen)
  await expect(page.getByRole('heading', { name: 'Definir senha', exact: true })).toBeVisible()
  await expect(page.getByLabel('Nova senha', { exact: true })).toBeFocused()
  await page.getByLabel('Nova senha', { exact: true }).fill(password)
  await page.getByLabel('Confirme a senha', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Salvar senha', exact: true }).click()
  await expect(page).toHaveURL(/\/conta$/)
  expect(authRequests.some(request => request.endsWith('/signup'))).toBe(false)
  expect(authRequests.indexOf('POST /auth/v1/verify')).toBeLessThan(authRequests.indexOf('PUT /auth/v1/user'))
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click()
  await page.getByRole('button', { name: 'E-mail e senha', exact: true }).click()
  await page.getByLabel('E-mail', { exact: true }).fill(email)
  await page.getByLabel('Senha', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Entrar com senha', exact: true }).click()
  await expect(page).toHaveURL(/\/conta$/)
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click()
  await page.getByRole('button', { name: 'E-mail e senha', exact: true }).click()
  await page.getByRole('button', { name: 'Esqueci minha senha', exact: true }).click()
  await page.getByLabel('E-mail', { exact: true }).fill(email)
  await page.getByRole('button', { name: 'Enviar código', exact: true }).click()
  await verifyCode(page, email, seen)
  await page.getByLabel('Nova senha', { exact: true }).fill(changedPassword)
  await page.getByLabel('Confirme a senha', { exact: true }).fill(changedPassword)
  await page.getByRole('button', { name: 'Salvar senha', exact: true }).click()
  await expect(page).toHaveURL(/\/conta$/)
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click()
  await page.getByRole('button', { name: 'E-mail e senha', exact: true }).click()
  await page.getByLabel('E-mail', { exact: true }).fill(email)
  await page.getByLabel('Senha', { exact: true }).fill(changedPassword)
  await page.getByRole('button', { name: 'Entrar com senha', exact: true }).click()
  await expect(page).toHaveURL(/\/conta$/)
})

test('next cannot redirect to an external origin', async ({ page }) => {
  await page.goto('/entrar?next=https%3A%2F%2Fevil.invalid')
  await loginWithCode(page, `qa-next-${randomUUID()}@example.test`)
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/conta$/)
})

test('seed account has library by game and orders; full ownership prevents adding again', async ({ page }) => {
  await page.goto('/entrar?next=%2Fmeus-jogos')
  const libraryResponse = page.waitForResponse(response => response.url().endsWith('/api/library') && response.status() === 200)
  await loginWithCode(page, 'teste-a@keytotwo.test')
  const library = await (await libraryResponse).json()
  expect(library.games.length).toBeGreaterThan(0)
  expect(new Set(library.games.map((game: { code: string }) => game.code)).size).toBe(library.games.length)
  await expect(page.locator('.library-grid > li')).toHaveCount(library.games.length)
  await expect(page.getByRole('button', { name: 'Baixar PDF', exact: true })).toHaveCount(library.games.length)
  await noOverflow(page)
  const accountResponse = page.waitForResponse(response => response.url().endsWith('/api/account') && response.status() === 200)
  await page.goto('/pedidos')
  const account = await (await accountResponse).json()
  expect(account.orders.length).toBeGreaterThan(0)
  await expect(page.locator('.order-list > li')).toHaveCount(account.orders.length)
  await noOverflow(page)
  // Quem já tem o pacote vê o atalho para o Portal no lugar do botão.
  await page.goto('/loja/colecao-fundadores')
  await expect(page.locator('.shop-purchase').getByRole('link', { name: 'Já está no seu Portal' })).toHaveAttribute('href', '/meus-jogos')
  await expect(page.locator('.shop-purchase').getByRole('button', { name: 'Adicionar à sacola' })).toHaveCount(0)
})
