import { expect, test, type Page } from './fixtures/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { authStorageKey } from './fixtures/session'
import { builtStage } from './fixtures/stage'

// Synthetic API boundary fixtures, confined to this browser; no backend writes or credentials.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
const product = { code: 'P001', kind: 'bundle', name: 'Coleção KeyToTwo: Fundadores', games: Array.from({ length: 5 }, (_, i) => ({ code: `J00${i + 1}`, name: 'Fixture de teste' })), price: { unit_amount: 1990, currency: 'brl' }, status: 'ok', available: true, owned_games: [], shared_with: [] }
const fakeSession = { access_token: 'synthetic-d1-token', refresh_token: 'synthetic-d1-refresh', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user: { id: 'qa-d1', email: 'd1@example.test', email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} } }
async function fixture(page: Page, { filled = false, owned = false, failCart = false } = {}) {
  test.skip(!readFileSync('build/client/index.html', 'utf8').includes('Ambiente de teste'), 'Authenticated fixtures require the configured local stage=test build')
  let items = filled ? [product] : []
  await page.addInitScript(([key, session]) => localStorage.setItem(key, JSON.stringify(session)), [authStorageKey, fakeSession] as const)
  await page.route('**/auth/v1/**', route => route.fulfill({ json: fakeSession.user }))
  await page.route('**/functions/v1/api/**', route => {
    const path = new URL(route.request().url()).pathname.split('/api')[1]
    if (failCart && path === '/cart') return route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR' } } })
    if (path.startsWith('/cart/items')) items = route.request().method() === 'DELETE' ? [] : [product]
    const cart = { version: 1, items, subtotal: { amount: items.length * 1990, currency: 'brl' }, warnings: [] }
    const orders = owned ? [{ ref: 'synthetic-d1', status: 'paid', created_at: '2026-01-01', paid_at: '2026-01-01', amount_total: 1990, currency: 'brl', items: [product] }] : []
    const body = path.startsWith('/cart') ? cart : path === '/catalog' ? { products: [product] } : path === '/account' ? { email: fakeSession.user.email, marketing: { opted_in: false, prompted_at: '2026-01-01', text_version: null }, orders } : path === '/free-games' ? { games: [] } : { games: [], pending: [] }
    return route.fulfill({ json: body })
  })
}
async function axe(page: Page) {
  // Measure settled UI, including staggered sheet links; leave ambient loops alone.
  await page.evaluate(() => Promise.allSettled(document.getAnimations()
    .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map(animation => animation.finished)))
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(result.violations).toEqual([])
}
async function capture(page: Page, name: string) {
  if (process.env.D1_CAPTURE !== '1') return
  await mkdir('.maestri/design-review/d1', { recursive: true })
  await page.screenshot({ path: `.maestri/design-review/d1/${name}.png`, animations: 'disabled' })
}
async function trap(page: Page, closeLabel: string) {
  const dialog = page.getByRole('dialog')
  const close = dialog.getByRole('button', { name: closeLabel })
  await close.focus()
  await page.keyboard.press('Shift+Tab')
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
}

test('desktop header: shared navigation, active page, transparent top and sticky scrolled state', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const requested: string[] = []
  page.on('request', request => requested.push(request.url()))
  await page.goto('/')
  await expect(page.locator('.desktop-nav a')).toHaveText(['Início', 'Loja', 'Gratuitos', 'Blog'])
  await expect(page.locator('.desktop-action')).toContainText('Ver os jogos')
  await expect(page.locator('.desktop-nav a').first()).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('header')).toHaveAttribute('data-scrolled', 'false')
  // O carrinho existe nos stages test e live; em preview o header não o mostra.
  if (builtStage() === 'preview') await expect(page.locator('.desktop-action .cart-trigger')).toHaveCount(0)
  else await expect(page.locator('.desktop-action .cart-trigger')).toBeEnabled()
  await page.evaluate(() => document.fonts.ready)
  await capture(page, 'header-desktop-topo')
  expect(requested.some(url => url.includes('kito-caixa'))).toBe(false)
  await page.evaluate(() => window.scrollTo({ top: 800, behavior: 'instant' }))
  await expect(page.locator('header')).toHaveAttribute('data-scrolled', 'true')
  // Também no desktop o cabeçalho some ao rolar para baixo e volta ao rolar para cima.
  await expect(page.locator('header')).toHaveAttribute('data-hidden', 'true')
  await page.evaluate(() => window.scrollTo({ top: 700, behavior: 'instant' }))
  await expect(page.locator('header')).toHaveAttribute('data-hidden', 'false')
  await expect(page.locator('.desktop-nav a').first()).toHaveAttribute('aria-current', 'page')
  await capture(page, 'header-desktop-rolado')
  await page.locator('.desktop-nav').getByRole('link', { name: 'Blog', exact: true }).click()
  await expect(page.locator('.desktop-nav').getByRole('link', { name: 'Blog', exact: true })).toHaveAttribute('aria-current', 'page')
  await axe(page)
})

test('mobile sheet: touch label, focus containment, Escape, Loja and scroll direction', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const trigger = page.getByRole('button', { name: 'Abrir menu' })
  await expect(trigger).toHaveText('Menu')
  await expect(trigger).toBeEnabled()
  await capture(page, 'header-mobile-topo')
  await trigger.focus(); await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toBeVisible()
  await trap(page, 'Fechar menu')
  await capture(page, 'menu-mobile-aberto')
  await axe(page)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await page.getByRole('dialog').getByRole('link', { name: 'Loja', exact: true }).click()
  await expect(page).toHaveURL(/\/loja$/)
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())
  await page.evaluate(async () => {
    window.scrollTo({ top: 0, behavior: 'instant' })
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  await expect(page.getByRole('banner')).toHaveAttribute('data-hidden', 'false')
  await page.evaluate(async () => {
    window.scrollTo({ top: 800, behavior: 'instant' })
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  await expect(page.getByRole('banner')).toHaveAttribute('data-hidden', 'true')
  await page.evaluate(async () => {
    window.scrollTo({ top: 500, behavior: 'instant' })
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  await expect(page.getByRole('banner')).toHaveAttribute('data-hidden', 'false')
})

test('checkout focus header agrees in server HTML and hydration, with or without trailing slash', async ({ page }) => {
  await fixture(page, { filled: true })
  for (const path of ['/pagamento', '/pagamento/']) {
    const response = await page.goto(path)
    expect(await response!.text()).toContain('data-focus="true"')
    await expect(page.getByRole('heading', { name: 'Pagamento', exact: true })).toBeVisible()
    await expect(page.locator('header')).toHaveAttribute('data-focus', 'true')
    await expect(page.locator('header').getByRole('link')).toHaveCount(2)
    await expect(page.locator('header').getByRole('link', { name: 'Voltar à sacola' })).toHaveAttribute('href', '/carrinho')
  }
})

test('account menu, catalog CTA regardless of ownership and the simplified private header', async ({ page }) => {
  await fixture(page, { owned: true })
  await page.goto('/')
  await expect(page.locator('.desktop-nav a')).toHaveText(['Início', 'Loja', 'Gratuitos', 'Blog'])
  await expect(page.locator('.desktop-nav a').first()).toHaveAttribute('href', '/')
  await expect(page.locator('.desktop-action > .button')).toHaveText('Ver os jogos')
  await expect(page.locator('.desktop-action > .button')).toHaveAttribute('href', '/loja')
  await page.goto('/conta')
  // Minha área no desktop: logo, Ajuda e a conta (as abas levam aos destinos); sem CTA comercial nem carrinho.
  await expect(page.locator('header')).toHaveAttribute('data-private', 'true')
  await expect(page.locator('.desktop-nav')).toHaveCount(0)
  await expect(page.locator('.desktop-action > .nav-link')).toHaveText(['Ajuda'])
  await expect(page.getByRole('navigation', { name: 'Minha área', exact: true }).getByRole('link', { name: 'Minha conta', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.desktop-action > .button')).toHaveCount(0)
  await expect(page.locator('header .cart-trigger')).toHaveCount(0)
  const trigger = page.getByRole('button', { name: 'Abrir opções da conta' })
  await trigger.click()
  const account = page.locator('header').getByRole('navigation', { name: 'Sua conta' })
  await expect(account.getByRole('link')).toHaveText(['Meus jogos', 'Minha conta'])
  await expect(account.getByRole('button', { name: 'Sair', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await trigger.click()
  await account.getByRole('button', { name: 'Sair', exact: true }).click()
  await expect(page.locator('.desktop-action').getByRole('link', { name: 'Entrar', exact: true })).toBeVisible()
})

test('adding opens drawer without navigation; API remove, total, keyboard and checkout', async ({ page }) => {
  await fixture(page)
  await page.goto('/loja/p001')
  const add = page.getByRole('button', { name: 'Adicionar à sacola', exact: true })
  await add.click()
  const drawer = page.getByRole('dialog')
  await expect(drawer).toContainText('Coleção KeyToTwo: Fundadores')
  await expect(page).toHaveURL(/\/loja\/p001$/)
  await expect(drawer.locator('.drawer-total')).toContainText('R$ 19,90')
  await trap(page, 'Fechar sacola')
  await axe(page)
  await page.keyboard.press('Escape')
  await expect(add).toBeFocused()
  await page.locator('.desktop-action .cart-trigger').click()
  await drawer.getByRole('button', { name: 'Remover Coleção KeyToTwo: Fundadores' }).click()
  await expect(drawer).toContainText('Sua sacola está vazia')
  await page.keyboard.press('Escape')
  await expect(page.locator('.desktop-action .cart-trigger')).toBeFocused()
  await add.click()
  await drawer.getByRole('link', { name: 'Finalizar compra' }).click()
  await expect(page).toHaveURL(/\/pagamento$/)
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.locator('header')).toContainText('Compra segura')
  await expect(page.locator('header').getByRole('link')).toHaveCount(2)
})

test('returning from login to /carrinho adds the pending item without opening the drawer', async ({ page }) => {
  await fixture(page)
  // The login flow lands on /carrinho?add=P001: the page shows the cart itself, so the drawer must stay closed.
  await page.goto('/carrinho?add=P001')
  await expect(page.locator('[data-cart-product="P001"]')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Finalizar compra' })).toBeVisible()
  await expect(page).toHaveURL(/\/carrinho$/)
})

test('cart failure offers retry without presenting an empty cart', async ({ page }) => {
  await fixture(page, { failCart: true })
  await page.goto('/')
  await page.locator('.desktop-action .cart-trigger').click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Tentar novamente' })).toBeVisible()
  await expect(page.getByRole('dialog')).not.toContainText('Sua sacola está vazia')
})

test('320–1440 and 200% text: header, sheet, drawers, 404 and focus checkout fit', async ({ page }) => {
  test.setTimeout(120_000)
  await fixture(page, { filled: true })
  for (const width of [320, 390, 768, 1024, 1120, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const fontSize of ['16px', '32px']) {
      await page.goto('/')
      await page.evaluate(size => { document.documentElement.style.fontSize = size }, fontSize)
      await expect(page.locator('.cart-count').first()).toHaveText('1')
      async function fit(label: string) {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${label}, ${width}, text ${fontSize}`).toBe(true)
        const dialog = page.getByRole('dialog')
        if (await dialog.isVisible()) expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), `${label} dialog, ${width}, ${fontSize}`).toBe(true)
      }
      await fit('header')
      if (width <= 1120) {
        await page.getByRole('button', { name: 'Abrir menu' }).click()
        await fit('menu')
        await page.keyboard.press('Escape')
      }
      await page.locator(width <= 1120 ? '.mobile-navigation .cart-trigger' : '.desktop-action .cart-trigger').click()
      await fit('drawer')
      await page.keyboard.press('Escape')
      for (const route of ['/404', '/pagamento']) {
        await page.goto(route)
        await page.evaluate(size => { document.documentElement.style.fontSize = size }, fontSize)
        await fit(route)
      }
    }
  }
})

test('reveal and button movement respect reduced motion, including live preference changes', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-reveal="pending"]').first()).toBeAttached()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('[data-reveal="pending"]')).toHaveCount(0)
  const section = page.locator('.shop-showcase')
  await expect(section).toHaveCSS('opacity', '1')
  await expect(section).toHaveCSS('transform', 'none')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Abrir menu' }).click()
  await expect(page.getByRole('dialog')).toHaveCSS('animation-name', 'none')
  await expect(page.locator('.sheet-nav .nav-link').first()).toHaveCSS('animation-name', 'none')
})

for (const width of [390, 1440]) test(`captures and axe: cart states, 404 and payment at ${width}`, async ({ page }) => {
  test.setTimeout(90_000)
  await fixture(page, { filled: true })
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
  await page.goto('/')
  const trigger = page.locator(width === 390 ? '.mobile-navigation .cart-trigger' : '.desktop-action .cart-trigger')
  await trigger.click()
  await expect(page.getByRole('dialog')).toContainText('Coleção KeyToTwo: Fundadores')
  await trap(page, 'Fechar sacola')
  await capture(page, `gaveta-com-item-${width}`)
  await axe(page)
  await page.getByRole('dialog').getByRole('button', { name: 'Remover Coleção KeyToTwo: Fundadores' }).click()
  await expect(page.getByRole('dialog')).toContainText('Sua sacola está vazia')
  await expect(page.locator('.kito-empty')).toBeVisible()
  await capture(page, `gaveta-vazia-${width}`)
  await axe(page)
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await page.goto('/404')
  await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-label', 'Sacola, 0 itens')
  await expect(page.locator('.cart-count')).toHaveCount(0)
  await capture(page, `404-${width}`)
  await axe(page)
  await page.goto('/loja/p001')
  await page.getByRole('button', { name: 'Adicionar à sacola', exact: true }).click()
  await page.getByRole('dialog').getByRole('link', { name: 'Finalizar compra' }).click()
  await expect(page.getByRole('heading', { name: 'Pagamento', exact: true })).toBeVisible()
  await expect(page.locator('.payment-items')).toContainText('Coleção KeyToTwo: Fundadores')
  await expect(page.locator('header')).toContainText('Compra segura')
  await capture(page, `pagamento-${width}`)
  await axe(page)
})
