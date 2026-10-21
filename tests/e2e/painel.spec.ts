import { expect, test, type Page } from './fixtures/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { authStorageKey } from './fixtures/session'

// Painel (/painel, responsável, 2026-10-21): só para app_metadata.admin, métricas de GET /admin/metrics em 7 ou 30 dias.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })

function daily(days: number) {
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.UTC(2026, 9, 21 - (days - 1) + i)).toISOString().slice(0, 10)
    return { date, orders: i === days - 1 ? 2 : i % 3 === 0 ? 1 : 0, revenue: i === days - 1 ? 3980 : i % 3 === 0 ? 2990 : 0, accounts: i % 2 }
  })
}
function metrics(days: number) {
  const items = daily(days)
  const orders = items.reduce((sum, item) => sum + item.orders, 0)
  return {
    days, since: items[0].date, until: items.at(-1)!.date, livemode: false,
    sales: { orders, revenue: items.reduce((sum, item) => sum + item.revenue, 0), currency: 'brl' },
    accounts: days === 7 ? 4 : 18, funnel: { cart: 10, checkout: 6, paid: 3 }, downloads: { paid: 9, free: 21 },
    free_unlocks: 5, newsletter: { subscribed: 42 }, daily: items,
  }
}

async function fixture(page: Page, { admin = true, apiAdmin = admin } = {}) {
  test.skip(!readFileSync('build/client/index.html', 'utf8').includes('Ambiente de teste'), 'Requires configured stage=test build')
  const user = { id: 'qa-admin', email: 'admin@example.test', email_confirmed_at: '2026-01-01', is_anonymous: false, aud: 'authenticated', role: 'authenticated', app_metadata: admin ? { provider: 'email', admin: true } : { provider: 'email' }, user_metadata: { full_name: 'Pessoa de teste' } }
  const session = { access_token: 'synthetic-admin-token', refresh_token: 'synthetic-admin-refresh', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user }
  const requested: string[] = []
  await page.addInitScript(([key, value]) => localStorage.setItem(key, JSON.stringify(value)), [authStorageKey, session] as const)
  await page.route('**/auth/v1/**', route => route.fulfill({ json: user }))
  await page.route('**/functions/v1/api/**', route => {
    const url = new URL(route.request().url())
    const path = url.pathname.split('/api')[1]
    if (path === '/admin/metrics') {
      requested.push(url.searchParams.get('days') ?? '')
      if (!apiAdmin) return route.fulfill({ status: 403, json: { error: { code: 'NOT_ADMIN', message: 'Esta área é só para a equipe da KeyToTwo.' } } })
      return route.fulfill({ json: metrics(Number(url.searchParams.get('days'))) })
    }
    const json = path === '/account' ? { email: user.email, marketing: { opted_in: false, prompted_at: '2026-10-01T12:00:00Z', updated_at: null, text_version: null }, orders: [] } : path === '/catalog' ? { products: [] } : path === '/free-games' ? { games: [] } : path === '/library' ? { games: [], pending: [] } : { version: 0, items: [], subtotal: null, warnings: [] }
    return route.fulfill({ json })
  })
  return requested
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(result.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map(n => n.target) }))).toEqual([])
}

test('admin: link Painel no menu da conta, métricas de 7 e 30 dias, funil e dia a dia', async ({ page }) => {
  const requested = await fixture(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Abrir opções da conta' }).click()
  const account = page.locator('header').getByRole('navigation', { name: 'Sua conta' })
  await expect(account.getByRole('link')).toHaveText(['Meus jogos', 'Minha conta', 'Painel'])
  await account.getByRole('link', { name: 'Painel', exact: true }).click()
  await expect(page).toHaveURL(/\/painel$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Painel' })).toBeVisible()
  const sales = page.getByRole('region', { name: 'Vendas' })
  await expect(sales.locator('.admin-cards dd')).toHaveText(['R$ 99,60', '4', 'R$ 24,90'])
  await expect(page.locator('.admin-range')).toContainText('vendas do modo de teste da Stripe')
  await expect(page.locator('.admin-bars span')).toHaveCount(7)
  await expect(page.locator('.admin-funnel li strong')).toHaveText(['10', '6', '3'])
  await expect(page.locator('.admin-funnel-share')).toHaveText(['60% da sacola', '30% da sacola'])
  await expect(page.getByRole('region', { name: 'Contas e e-mails' }).locator('dd:not(.admin-card-note)')).toHaveText(['4', '5', '42'])
  await expect(page.getByRole('region', { name: 'Downloads' }).locator('dd')).toHaveText(['9', '21'])
  await page.getByText('Ver dia a dia').click()
  await expect(page.locator('.admin-daily tbody tr')).toHaveCount(7)
  await expect(page.locator('.admin-daily tbody tr').first().locator('th')).toHaveText('21/10')
  await axe(page)

  await page.getByRole('button', { name: '30 dias' }).click()
  await expect(page.getByRole('button', { name: '30 dias' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.admin-bars span')).toHaveCount(30)
  await expect(page.getByRole('region', { name: 'Contas e e-mails' }).locator('dd').first()).toHaveText('18')
  expect(requested).toEqual(['7', '30'])

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  }
  await axe(page)
})

test('admin: quem não é admin não vê o link nem chama a API', async ({ page }) => {
  const requested = await fixture(page, { admin: false })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Abrir opções da conta' }).click()
  await expect(page.locator('header').getByRole('navigation', { name: 'Sua conta' }).getByRole('link')).toHaveText(['Meus jogos', 'Minha conta'])
  await page.goto('/painel')
  await expect(page.getByRole('heading', { name: 'Esta área é só para a equipe' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ir para o Portal' })).toHaveAttribute('href', '/meus-jogos')
  await expect(page.locator('.admin-cards')).toHaveCount(0)
  expect(requested).toEqual([])
})

test('admin: a API decide; NOT_ADMIN com o link no JWT mostra a recusa', async ({ page }) => {
  const requested = await fixture(page, { apiAdmin: false })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/painel')
  await expect(page.getByRole('heading', { name: 'Esta área é só para a equipe' })).toBeVisible()
  await expect(page.locator('.admin-cards')).toHaveCount(0)
  expect(requested).toEqual(['7'])
  await page.getByRole('button', { name: 'Abrir menu' }).click()
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Painel', exact: true })).toHaveAttribute('href', '/painel')
})
