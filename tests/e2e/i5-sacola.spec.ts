import { expect, test, type Page } from './fixtures/test'
import { mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { authStorageKey } from './fixtures/session'

// Sacola com vários produtos: composição por item, as regras de jogo repetido (o avulso que já está no pacote, o
// pacote de completar a coleção e o produto já possuído), a sacola sem login guardada no navegador e a junção ao
// entrar, e o nome do avulso na confirmação. Fixtures sintéticas por rota, sem banco.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
const stageTest = readFileSync('build/client/index.html', 'utf8').includes('Ambiente de teste')

type Item = {
  code: string; kind: string; name: string; games: { code: string; name: string }[]; price: { unit_amount: number; currency: string } | null
  status: string; available: boolean; owned_games: string[]; included_in: string[]; shared_with: string[]; charge: { unit_amount: number; currency: string } | null
}
const p001: Item = {
  code: 'P001', kind: 'bundle', name: 'Coleção KeyToTwo: Fundadores',
  games: [
    { code: 'J001', name: 'Rabisque e Adivinhe' },
    { code: 'J002', name: 'O Sumiço de Rapadura' },
    { code: 'J003', name: 'Tabuleiro da Sorte' },
  ],
  price: { unit_amount: 2990, currency: 'brl' }, status: 'ok', available: true, owned_games: [], included_in: [], shared_with: [], charge: { unit_amount: 2990, currency: 'brl' },
}
const j001: Item = {
  code: 'J001', kind: 'single', name: 'Rabisque e Adivinhe',
  games: [{ code: 'J001', name: 'Rabisque e Adivinhe' }],
  price: { unit_amount: 990, currency: 'brl' }, status: 'ok', available: true, owned_games: [], included_in: [], shared_with: [], charge: { unit_amount: 990, currency: 'brl' },
}
const included: Item = { ...j001, status: 'included', available: false, included_in: ['P001'], shared_with: ['P001'], charge: null }
const fakeSession = { access_token: 'synthetic-i5-token', refresh_token: 'synthetic-i5-refresh', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user: { id: 'qa-i5', email: 'i5@example.test', email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} } }
const guestKey = 'keytotwo:sacola'

function subtotal(items: Item[]) {
  const paid = items.filter(item => item.status === 'ok')
  return paid.length ? { amount: paid.reduce((sum, item) => sum + item.charge!.unit_amount, 0), currency: 'brl' } : null
}
const cartBody = (items: Item[], extra: Record<string, unknown> = {}) => ({ version: 1, items, subtotal: subtotal(items), warnings: [], ...extra })

// Com sessão: a sacola da conta (GET /cart). Sem sessão: a cotação da sacola guardada no navegador (POST /cart/quote).
async function fixture(page: Page, initial: Item[], { signedIn = true, owned = [] as string[], quote = (codes: string[]) => codes.map(code => [p001, j001].find(item => item.code === code)!) } = {}) {
  let items = [...initial]
  const calls: { path: string; body: unknown }[] = []
  if (signedIn) {
    await page.addInitScript(([key, session]) => localStorage.setItem(key, JSON.stringify(session)), [authStorageKey, fakeSession] as const)
    await page.route('**/auth/v1/**', route => route.fulfill({ json: fakeSession.user }))
  }
  await page.route('**/functions/v1/api/**', route => {
    const request = route.request()
    const path = new URL(request.url()).pathname.split('/api')[1]
    const body = request.postData() ? request.postDataJSON() : null
    calls.push({ path, body })
    if (path === '/cart/quote') return route.fulfill({ json: { ...cartBody(quote(body.product_codes)), version: 0, unknown: [] } })
    if (path === '/cart/merge') { items = quote(body.product_codes); return route.fulfill({ json: cartBody(items, { owned_products: owned }) }) }
    if (path.startsWith('/cart/items')) {
      if (request.method() === 'DELETE') items = items.filter(item => item.code !== path.split('/').pop())
      return route.fulfill({ json: cartBody(items, { owned_products: owned }) })
    }
    const reply = path === '/cart' ? cartBody(items, { owned_products: owned }) : path === '/catalog' ? { products: [p001, j001] } : path === '/account' ? { email: fakeSession.user.email, marketing: { opted_in: false, prompted_at: '2026-01-01', text_version: null }, orders: [] } : { available: false }
    return route.fulfill({ json: reply })
  })
  return calls
}
async function capture(page: Page, name: string) {
  if (process.env.I5_CAPTURE !== '1') return
  await mkdir('design-review/sacola', { recursive: true })
  await page.screenshot({ path: `design-review/sacola/${name}.webp`, fullPage: true, animations: 'disabled' })
}

test('sacola com pacote e avulso: composição por item, sem suposição de pacote único', async ({ page }) => {
  test.skip(!stageTest, 'Stage test fixture')
  await fixture(page, [p001, j001])
  await page.goto('/carrinho')
  const bag = page.locator('[data-cart-product="P001"]')
  await expect(bag.locator('h3')).toHaveText('Coleção KeyToTwo: Fundadores')
  await expect(bag.locator('.cart-composition')).toContainText('Rabisque e Adivinhe')
  await expect(bag.locator('.cart-composition')).toContainText('Tabuleiro da Sorte')
  await expect(bag.locator('.cart-composition')).toContainText('Um PDF por jogo, para imprimir em casa')
  const single = page.locator('[data-cart-product="J001"]')
  await expect(single.locator('h3')).toHaveText('Rabisque e Adivinhe')
  await expect(page.locator('.cart-subtotal')).toContainText('R$ 39,80')
  await expect(page.getByRole('button', { name: 'Finalizar compra' })).toBeEnabled()
  await capture(page, 'sacola-2-itens-1280')
})

test('avulso que já vem no pacote da sacola: preço riscado, não é cobrado e não bloqueia', async ({ page }) => {
  test.skip(!stageTest, 'Stage test fixture')
  await fixture(page, [p001, included])
  await page.goto('/carrinho')
  const single = page.locator('[data-cart-product="J001"]')
  await expect(single.locator('.cart-item-price s')).toHaveText('R$ 9,90')
  await expect(single.locator('.cart-item-price')).toContainText('não é cobrado')
  await expect(single).toContainText('Já vem no pacote Coleção KeyToTwo: Fundadores da sua sacola.')
  await expect(page.locator('.cart-subtotal')).toContainText('R$ 29,90')
  await expect(page.getByRole('button', { name: 'Finalizar compra' })).toBeEnabled()
  await capture(page, 'sacola-incluido-1280')
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/carrinho')
  await expect(page.locator('[data-cart-product="J001"] .cart-item-price s')).toBeVisible()
  await capture(page, 'sacola-incluido-375')
})

test('completar a coleção: o pacote com jogo já possuído cobra só o que falta', async ({ page }) => {
  test.skip(!stageTest, 'Stage test fixture')
  await fixture(page, [{ ...p001, owned_games: ['J001'], charge: { unit_amount: 2085, currency: 'brl' } }])
  await page.goto('/carrinho')
  const bag = page.locator('[data-cart-product="P001"]')
  await expect(bag.locator('.cart-item-price s')).toHaveText('R$ 29,90')
  await expect(bag.locator('.cart-item-price')).toContainText('R$ 20,85')
  await expect(bag).toContainText('Você já tem Rabisque e Adivinhe. O pacote cobra só o que falta, com o mesmo desconto.')
  await expect(page.locator('.cart-subtotal')).toContainText('R$ 20,85')
  await expect(page.getByRole('button', { name: 'Finalizar compra' })).toBeEnabled()
})

test('produto já possuído fica riscado com o atalho para o Portal; sem nada a pagar, não segue', async ({ page }) => {
  test.skip(!stageTest, 'Stage test fixture')
  await fixture(page, [{ ...j001, status: 'already_owned', available: false, owned_games: ['J001'], charge: null }])
  await page.goto('/carrinho')
  const single = page.locator('[data-cart-product="J001"]')
  await expect(single.locator('.cart-item-price s')).toHaveText('R$ 9,90')
  await expect(single).toContainText('Você já tem este jogo no Portal.')
  await expect(single.getByRole('link', { name: 'Ver no Portal' })).toHaveAttribute('href', '/meus-jogos')
  await expect(page.locator('.cart-summary')).toContainText('Não há nada a pagar nesta sacola.')
  await expect(page.getByRole('button', { name: 'Finalizar compra' })).toBeDisabled()
})

test('quem já tem o produto vê "Já está no seu Portal" no lugar do botão', async ({ page }) => {
  test.skip(!stageTest, 'Stage test fixture')
  await fixture(page, [], { owned: ['J001'] })
  await page.goto('/loja/j001')
  await expect(page.getByRole('link', { name: 'Já está no seu Portal' }).first()).toHaveAttribute('href', '/meus-jogos')
  await expect(page.getByRole('button', { name: 'Adicionar à sacola' })).toHaveCount(0)
})

test('sem login: a sacola fica no navegador, com preços da API, e o login só aparece ao finalizar', async ({ page }) => {
  test.skip(!stageTest, 'Stage test fixture')
  const calls = await fixture(page, [], { signedIn: false })
  await page.goto('/loja/p001')
  await page.getByRole('button', { name: 'Adicionar à sacola' }).first().click()
  await expect(page.getByRole('dialog', { name: 'Sua sacola' })).toContainText('Coleção KeyToTwo: Fundadores')
  expect(await page.evaluate(key => localStorage.getItem(key), guestKey)).toBe('["P001"]')
  await page.goto('/carrinho')
  expect(page.url()).not.toContain('/entrar')
  await expect(page.locator('[data-cart-product="P001"]')).toBeVisible()
  await expect(page.locator('.cart-subtotal')).toContainText('R$ 29,90')
  await expect(page.locator('#checkout-help')).toContainText('código enviado ao seu e-mail')
  await page.getByRole('button', { name: 'Finalizar compra' }).click()
  await expect(page).toHaveURL(/\/entrar\?next=%2Fpagamento$/)
  await expect(page.locator('.auth-intro')).toContainText('Sua sacola fica guardada.')
  expect(calls.some(call => call.path === '/cart/quote' && JSON.stringify(call.body) === '{"product_codes":["P001"]}')).toBe(true)
  expect(calls.some(call => call.path === '/cart' || call.path.startsWith('/cart/items'))).toBe(false)
})

test('ao entrar, a sacola do navegador se junta à da conta e sai do navegador', async ({ page }) => {
  test.skip(!stageTest, 'Stage test fixture')
  await page.addInitScript(key => { if (!sessionStorage.getItem('i5-merge')) { sessionStorage.setItem('i5-merge', '1'); localStorage.setItem(key, '["P001","J001"]') } }, guestKey)
  const calls = await fixture(page, [], { quote: codes => codes.map(code => (code === 'J001' ? included : p001)) })
  await page.goto('/carrinho')
  await expect(page.locator('[data-cart-product="J001"]')).toContainText('não é cobrado')
  expect(calls.find(call => call.path === '/cart/merge')?.body).toEqual({ product_codes: ['P001', 'J001'] })
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), guestKey)).toBeNull()
})

test('confirmação mostra o nome do avulso, não "Jogo para imprimir"', async ({ page }) => {
  test.skip(!stageTest, 'Stage test fixture')
  await fixture(page, [])
  await page.route('**/api/order-status?*', route => route.fulfill({ json: { state: 'paid', next: 'open_library', items: [{ code: 'J001', name: '[TESTE] Rabisque e Adivinhe (avulso)' }] } }))
  await page.goto('/pedido/confirmacao?session_id=cs_test_synthetic123456')
  test.skip(page.url().includes('/entrar'), 'Requires configured stage=test build')
  await expect(page.getByRole('heading', { name: 'Pronto. Os jogos são de vocês.' })).toBeVisible()
  await expect(page.locator('.confirmation-items')).toContainText('Rabisque e Adivinhe')
  await expect(page.locator('.confirmation-items')).not.toContainText('Jogo para imprimir')
})
