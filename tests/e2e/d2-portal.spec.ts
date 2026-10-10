import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'

// Browser-only fixtures exercise the existing API contract without account writes.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
const user = { id: 'qa-d2', email: 'd2@example.test', email_confirmed_at: '2026-01-01', is_anonymous: false, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { full_name: 'Pessoa de teste' } }
const session = { access_token: 'synthetic-d2-token', refresh_token: 'synthetic-d2-refresh', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user }
const product = { code: 'P001', name: 'Pacote de teste', unit_amount: 1990, currency: 'brl' }
const games = ['TESTE-J01', 'J002', 'J003', 'J004', 'J005'].map((code, i) => ({ code, name: `Jogo de teste ${i + 1}`, acquired_at: '2026-10-01T12:00:00Z', products: [product], files: [{ id: `pdf-${i}`, kind: 'pdf', version: '1.0', size_bytes: 3600000 }] }))
async function fixture(page: Page, { empty = false, failLibrary = false } = {}) {
  test.skip(!readFileSync('build/client/index.html', 'utf8').includes('Ambiente de teste'), 'Requires configured stage=test build')
  let optedIn = false
  let failed = false
  const writes: unknown[] = []
  await page.addInitScript(value => localStorage.setItem('sb-127-auth-token', JSON.stringify(value)), session)
  await page.route('**/auth/v1/**', route => route.fulfill({ json: user }))
  await page.route('**/functions/v1/api/**', route => {
    const path = new URL(route.request().url()).pathname.split('/api')[1]
    if (path === '/library' && failLibrary && !failed) { failed = true; return route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR' } } }) }
    if (path === '/account/marketing') { const body = route.request().postDataJSON(); writes.push(body); optedIn = body.granted; return route.fulfill({ json: { opted_in: optedIn } }) }
    const orders = empty ? [] : ['paid', 'pending_payment'].map((status, i) => ({ ref: `synthetic-d2-${i}`, status, created_at: '2026-10-01T12:00:00Z', paid_at: status === 'paid' ? '2026-10-01T12:00:00Z' : null, amount_total: 1990, currency: 'brl', items: [product] }))
    const json = path === '/library' ? { games: empty ? [] : games, pending: [] } : path === '/account' ? { email: user.email, marketing: { opted_in: optedIn, prompted_at: null, updated_at: null, text_version: null }, orders } : path === '/catalog' ? { products: [] } : path === '/free-game' ? { available: false } : { version: 0, items: [], subtotal: null, warnings: [] }
    return route.fulfill({ json })
  })
  return writes
}
async function settled(page: Page) {
  await page.evaluate(() => Promise.allSettled(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished)))
}
async function axe(page: Page) {
  await settled(page)
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(result.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map(n => n.target) }))).toEqual([])
}
async function capture(page: Page, name: string) {
  if (process.env.D2_CAPTURE !== '1') return
  await mkdir('.maestri/design-review/d2', { recursive: true })
  await page.screenshot({ path: `.maestri/design-review/d2/${name}.png`, fullPage: true, animations: 'disabled' })
}

test('D1 touchups: zero badge hidden, secondary help and internal arrows', async ({ page }) => {
  await fixture(page)
  await page.goto('/meus-jogos')
  await expect(page.locator('.desktop-action .cart-trigger')).toHaveAttribute('aria-label', 'Carrinho, 0 itens')
  await expect(page.locator('.cart-count')).toHaveCount(0)
  await expect(page.locator('.desktop-action').getByRole('link', { name: 'Ajuda', exact: true })).toHaveAttribute('href', '/ajuda')
  await page.setViewportSize({ width: 320, height: 800 })
  const trigger = page.getByRole('button', { name: 'Abrir menu' })
  await expect(trigger).toBeEnabled()
  await trigger.focus(); await page.keyboard.press('Enter')
  await expect(page.locator('.sheet-nav .nav-link > span')).toHaveText(['→', '→', '→', '→'])
  const help = page.getByRole('dialog').getByRole('link', { name: 'Ajuda', exact: true })
  await help.focus(); await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/ajuda$/)
  await expect(page.getByRole('dialog')).toBeHidden()
})

test('portal: real preview, existing art, stagger and keyboard navigation between persistent tabs', async ({ page }) => {
  await fixture(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/meus-jogos')
  await expect(page.locator('.portal-greeting')).toHaveText('Olá, Pessoa!')
  await expect(page.locator('.portal-game')).toHaveCount(5)
  await expect(page.locator('.game-cover img').first()).toHaveAttribute('src', '/media/experience/j001-page-1-720.webp')
  await expect(page.locator('.game-cover img').nth(2)).toHaveAttribute('src', '/media/experience/kito-tabuleiro-240.webp')
  await expect(page.getByRole('button', { name: 'Baixar PDF', exact: true })).toHaveCount(5)
  for (const link of await page.getByRole('link', { name: 'Como imprimir', exact: true }).all()) await expect(link).toHaveAttribute('href', '/ajuda#impressao')
  await expect(page.locator('.portal-game').nth(1)).toHaveCSS('animation-delay', '0.06s')
  const tabs = page.getByRole('navigation', { name: 'Minha área', exact: true })
  await tabs.getByRole('link', { name: 'Meus jogos', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(tabs.getByRole('link', { name: 'Pedidos', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Pedidos', exact: true })).toBeFocused()
  await expect(tabs.getByRole('link', { name: 'Pedidos', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.order-status')).toHaveText(['Pagamento confirmado', 'Aguardando pagamento'])
  await expect(page.locator('.order-total strong')).toHaveText(['R$ 19,90', 'R$ 19,90'])
  const details = page.getByText('Detalhes do pedido', { exact: true }).first()
  await details.focus(); await page.keyboard.press('Enter')
  await expect(page.getByText('synthetic-d2-0', { exact: true })).toBeVisible()
  await tabs.getByRole('link', { name: 'Conta', exact: true }).focus(); await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Conta', exact: true })).toBeFocused()
  await expect(page.getByText(user.email, { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Definir ou alterar senha' })).toHaveAttribute('href', '/entrar?mode=recover&next=%2Fconta')
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).focus(); await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/entrar\?next=%2Fconta$/)
  expect(errors).toEqual([])
})

test('newsletter preference in Conta: one click subscribes, discreet link unsubscribes', async ({ page }) => {
  const writes = await fixture(page)
  for (const path of ['/meus-jogos/', '/pedidos/', '/conta/']) {
    await page.goto(path)
    await expect(page.locator('#portal-title')).toBeVisible()
    await expect(page.locator('.consent-invite')).toHaveCount(0)
    await expect(page.getByText('Quer receber novidades?', { exact: true })).toHaveCount(0)
    await expect(page.locator('.marketing-form')).toHaveCount(path === '/conta/' ? 1 : 0)
  }
  const form = page.locator('.marketing-form')
  await expect(form.getByRole('button', { name: 'Quero receber ideias', exact: true })).toBeVisible()
  await expect(form).toContainText('Dá para sair quando quiser.')
  await expect(form.getByRole('link', { name: 'Privacidade', exact: true })).toHaveAttribute('href', '/privacidade')
  await form.getByRole('button', { name: 'Quero receber ideias', exact: true }).focus(); await page.keyboard.press('Enter')
  await expect(form).toContainText('Você recebe nossas ideias')
  expect(writes).toEqual([expect.objectContaining({ granted: true, source: 'account', text_version: expect.any(String) })])
  await form.getByRole('button', { name: 'Parar de receber', exact: true }).focus(); await page.keyboard.press('Enter')
  await expect(form.getByRole('button', { name: 'Quero receber ideias', exact: true })).toBeVisible()
  expect(writes[1]).toEqual(expect.objectContaining({ granted: false, source: 'account' }))
  await page.reload()
  await expect(page.locator('.marketing-form').getByRole('button', { name: 'Quero receber ideias', exact: true })).toBeVisible()
})

test('library error retries and reduced motion removes card entrance', async ({ page }) => {
  await fixture(page, { failLibrary: true })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/meus-jogos')
  await expect(page.locator('.portal-empty')).toHaveCount(0)
  await page.getByRole('button', { name: 'Tentar novamente' }).click()
  await expect(page.locator('.portal-game')).toHaveCount(5)
  await expect(page.locator('.portal-game').first()).toHaveCSS('animation-name', 'none')
  await expect(page.locator('.portal-game').first()).toHaveCSS('opacity', '1')
})

test('portal fits 320–1440 and 200% text; overflowing tabs stay reachable and sticky', async ({ page }) => {
  test.setTimeout(120_000)
  await fixture(page)
  for (const width of [320, 390, 600, 768, 1024, 1120, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const path of ['/meus-jogos', '/pedidos', '/conta']) {
      await page.goto(path)
      await expect(page.locator(path === '/meus-jogos' ? '.portal-game' : path === '/pedidos' ? '.portal-order' : '.portal-settings').first()).toBeVisible()
      for (const size of ['16px', '32px']) {
        await page.evaluate(value => { document.documentElement.style.fontSize = value }, size)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${path} at ${width}, text ${size}`).toBe(true)
        expect(await page.locator('.portal-content').evaluate(el => el.scrollWidth <= el.clientWidth), `${path} content at ${width}, text ${size}`).toBe(true)
      }
    }
  }
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/meus-jogos')
  await page.evaluate(() => { document.documentElement.style.fontSize = '32px' })
  const tabs = page.getByRole('navigation', { name: 'Minha área', exact: true })
  const account = tabs.getByRole('link', { name: 'Conta', exact: true })
  await tabs.getByRole('link', { name: 'Meus jogos', exact: true }).focus()
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab')
  await expect(account).toBeFocused()
  expect(await account.evaluate(el => { const rect = el.getBoundingClientRect(); return rect.left >= 0 && rect.right <= window.innerWidth })).toBe(true)
  await page.keyboard.press('Enter'); await expect(page.locator('#portal-title')).toBeFocused()
  await page.evaluate(async () => { (document.activeElement as HTMLElement).blur(); window.scrollTo({ top: 500, behavior: 'instant' }); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) })
  expect(await page.locator('.portal-tabs-bar').evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0)
  expect(await page.locator('.portal-tabs-bar').evaluate(el => el.getBoundingClientRect().top)).toBeLessThanOrEqual(112)
})

for (const width of [390, 1440]) test(`axe across three tabs and empty states at ${width}`, async ({ page }) => {
  test.setTimeout(90_000)
  await fixture(page)
  await page.setViewportSize({ width, height: 900 })
  for (const path of ['/meus-jogos', '/pedidos', '/conta']) {
    await page.goto(path)
    await expect(page.locator(path === '/meus-jogos' ? '.portal-game' : path === '/pedidos' ? '.portal-order' : '.portal-settings').first()).toBeVisible()
    await axe(page)
  }
  await page.route('**/api/library', route => route.fulfill({ json: { games: [], pending: [] } }))
  await page.goto('/meus-jogos')
  await expect(page.locator('.portal-empty .kito-empty')).toBeVisible()
  await expect(page.locator('.portal-empty').getByRole('link', { name: 'Conhecer o pacote' })).toHaveAttribute('href', '/#comprar')
  await capture(page, `vazio-${width}`)
  await axe(page)
  await page.setViewportSize({ width: 320, height: 900 })
  await page.evaluate(() => { document.documentElement.style.fontSize = '32px' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('empty orders use the existing account response and keep portal navigation', async ({ page }) => {
  await fixture(page, { empty: true })
  await page.goto('/pedidos')
  await expect(page.getByRole('heading', { name: 'Você ainda não tem pedidos' })).toBeVisible()
  await expect(page.locator('.portal-orders')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Minha área', exact: true }).getByRole('link')).toHaveCount(3)
})
