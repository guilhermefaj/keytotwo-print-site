import { expect, test, type Page } from './fixtures/test'
import { mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { authStorageKey } from './fixtures/session'

// Sacola com vários produtos (I5): composição por item, os três casos de sobreposição (D-16,
// padrão provisório) e o nome do avulso na confirmação. Fixtures sintéticas por rota, sem banco.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
const stageTest = readFileSync('build/client/index.html', 'utf8').includes('Ambiente de teste')

const p001 = {
  code: 'P001', kind: 'bundle', name: 'Coleção KeyToTwo: Fundadores',
  games: [
    { code: 'J001', name: 'Rabisque e Adivinhe' },
    { code: 'J002', name: 'O Sumiço de Rapadura' },
    { code: 'J003', name: 'Tabuleiro da Sorte' },
    { code: 'J004', name: 'Jogo 4' },
    { code: 'J005', name: 'Jogo 5' },
  ],
  price: { unit_amount: 4990, currency: 'brl' }, status: 'ok', available: true, owned_games: [] as string[], shared_with: [] as string[],
}
const j001 = {
  code: 'J001', kind: 'single', name: 'Rabisque e Adivinhe',
  games: [{ code: 'J001', name: 'Rabisque e Adivinhe' }],
  price: { unit_amount: 990, currency: 'brl' }, status: 'ok', available: true, owned_games: [] as string[], shared_with: [] as string[],
}
const fakeSession = { access_token: 'synthetic-i5-token', refresh_token: 'synthetic-i5-refresh', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user: { id: 'qa-i5', email: 'i5@example.test', email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} } }

async function fixture(page: Page, initial: typeof p001[], { addFails = false } = {}) {
  let items = [...initial]
  await page.addInitScript(([key, session]) => localStorage.setItem(key, JSON.stringify(session)), [authStorageKey, fakeSession] as const)
  await page.route('**/auth/v1/**', route => route.fulfill({ json: fakeSession.user }))
  await page.route('**/functions/v1/api/**', route => {
    const request = route.request()
    const path = new URL(request.url()).pathname.split('/api')[1]
    if (path.startsWith('/cart/items')) {
      if (request.method() === 'DELETE') items = items.filter(item => item.code !== path.split('/').pop())
      if (addFails) return route.fulfill({ status: 409, json: { error: { code: 'ALREADY_OWNED' } } })
      return route.fulfill({ json: { version: 2, items, subtotal: subtotal(items), warnings: [] } })
    }
    const body = path === '/cart' ? { version: 1, items, subtotal: subtotal(items), warnings: [] } : path === '/catalog' ? { products: [p001, j001] } : path === '/account' ? { email: fakeSession.user.email, marketing: { opted_in: false, prompted_at: '2026-01-01', text_version: null }, orders: [] } : { available: false }
    return route.fulfill({ json: body })
  })
}
function subtotal(items: typeof p001[]) {
  const amount = items.reduce((sum, item) => sum + (item.price?.unit_amount ?? 0), 0)
  return amount ? { amount, currency: 'brl' } : null
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
  await expect(bag.locator('.cart-composition')).toContainText('Arquivos digitais em PDF')
  const single = page.locator('[data-cart-product="J001"]')
  await expect(single.locator('h3')).toHaveText('Rabisque e Adivinhe')
  await expect(single.locator('.cart-composition')).toContainText('Rabisque e Adivinhe')
  await expect(page.locator('.cart-subtotal')).toContainText('R$ 59,80')
  await expect(page.getByRole('button', { name: 'Finalizar compra' })).toBeEnabled()
  await capture(page, 'sacola-2-itens-1280')
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/carrinho')
  await expect(page.locator('[data-cart-product="J001"]')).toBeVisible()
  await capture(page, 'sacola-2-itens-375')
})

test('sobreposição (a): avulso também no pacote avisa e oferece Remover avulso', async ({ page }) => {
  test.skip(!stageTest, 'Stage test fixture')
  await fixture(page, [{ ...p001, shared_with: ['J001'] }, { ...j001, shared_with: ['P001'] }])
  await page.goto('/carrinho')
  const bag = page.locator('[data-cart-product="P001"]')
  await expect(bag).toContainText('Este item já inclui Rabisque e Adivinhe. Para não pagar duas vezes, remova o avulso da sacola.')
  const removeSingle = bag.getByRole('button', { name: 'Remover avulso Rabisque e Adivinhe' })
  await expect(removeSingle).toHaveText('Remover avulso')
  await capture(page, 'sacola-aviso-1280')
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/carrinho')
  await expect(page.locator('[data-cart-product="P001"]')).toContainText('Remover avulso')
  await capture(page, 'sacola-aviso-375')
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/carrinho')
  await page.locator('[data-cart-product="P001"]').getByRole('button', { name: 'Remover avulso Rabisque e Adivinhe' }).click()
  await expect(page.locator('[data-cart-product="J001"]')).toHaveCount(0)
  await expect(page.locator('[data-cart-product="P001"]')).toBeVisible()
  await expect(page.locator('[data-cart-product="P001"]')).not.toContainText('Remover avulso')
  await expect(page.locator('.cart-subtotal')).toContainText('R$ 49,90')
})

test('sobreposição (b): jogo já possuído no pacote avisa sem desconto e não bloqueia', async ({ page }) => {
  test.skip(!stageTest, 'Stage test fixture')
  await fixture(page, [{ ...p001, owned_games: ['J001'] }])
  await page.goto('/carrinho')
  await expect(page.locator('[data-cart-product="P001"]')).toContainText('Você já tem Rabisque e Adivinhe. O valor não é reduzido por isso.')
  await expect(page.getByRole('button', { name: 'Finalizar compra' })).toBeEnabled()
  await expect(page.locator('.cart-subtotal')).toContainText('R$ 49,90')
})

test('sobreposição (c): produto com todos os jogos já possuídos é recusado com link para Meus jogos', async ({ page }) => {
  test.skip(!stageTest, 'Stage test fixture')
  await fixture(page, [], { addFails: true })
  await page.goto('/carrinho?add=J001')
  const alert = page.locator('main [role="alert"]')
  await expect(alert).toContainText('Você já tem todos os jogos deste produto.')
  await expect(alert.getByRole('link', { name: 'Ver Meus jogos' })).toHaveAttribute('href', '/meus-jogos')
})

test('confirmação mostra o nome do avulso, não "Jogo para imprimir"', async ({ page }) => {
  test.skip(!stageTest, 'Stage test fixture')
  await fixture(page, [])
  await page.route('**/api/order-status?*', route => route.fulfill({ json: { state: 'paid', next: 'open_library', items: [{ code: 'J001', name: '[TESTE] Rabisque e Adivinhe (avulso)' }] } }))
  await page.goto('/pedido/confirmacao?session_id=cs_test_synthetic123456')
  test.skip(page.url().includes('/entrar'), 'Requires configured stage=test build')
  await expect(page.getByRole('heading', { name: 'O próximo encontro é de vocês!' })).toBeVisible()
  await expect(page.locator('.confirmation-items')).toContainText('Rabisque e Adivinhe')
  await expect(page.locator('.confirmation-items')).not.toContainText('Jogo para imprimir')
})
