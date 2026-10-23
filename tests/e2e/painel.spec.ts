import { expect, test, type Page } from './fixtures/test'
import { readFileSync } from 'node:fs'
import { authStorageKey } from './fixtures/session'

// Painel na loja (2026-10-23): o admin é um app à parte (admin.keytotwo.com.br, tests/e2e/admin). A loja só mostra o
// link "Painel" para app_metadata.admin; /painel redireciona no nginx.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })

async function fixture(page: Page, { admin = true } = {}) {
  test.skip(!readFileSync('build/client/index.html', 'utf8').includes('Ambiente de teste'), 'Requires configured stage=test build')
  const user = { id: 'qa-admin', email: 'admin@example.test', email_confirmed_at: '2026-01-01', is_anonymous: false, aud: 'authenticated', role: 'authenticated', app_metadata: admin ? { provider: 'email', admin: true } : { provider: 'email' }, user_metadata: {} }
  const session = { access_token: 'synthetic-admin-token', refresh_token: 'synthetic-admin-refresh', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user }
  const requested: string[] = []
  await page.addInitScript(([key, value]) => localStorage.setItem(key, JSON.stringify(value)), [authStorageKey, session] as const)
  await page.route('**/auth/v1/**', route => route.fulfill({ json: user }))
  await page.route('**/functions/v1/api/**', route => {
    const path = new URL(route.request().url()).pathname.split('/api')[1]
    requested.push(path)
    const json = path === '/account' ? { email: user.email, marketing: { opted_in: false, prompted_at: '2026-10-01T12:00:00Z', updated_at: null, text_version: null }, orders: [] } : path === '/catalog' ? { products: [] } : { version: 0, items: [], subtotal: null, warnings: [] }
    return route.fulfill({ json })
  })
  return requested
}

test('admin: o link Painel do menu da conta e do menu móvel leva ao admin', async ({ page }) => {
  const requested = await fixture(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Abrir opções da conta' }).click()
  const account = page.locator('header').getByRole('navigation', { name: 'Sua conta' })
  await expect(account.getByRole('link')).toHaveText(['Meus jogos', 'Minha conta', 'Painel'])
  await expect(account.getByRole('link', { name: 'Painel', exact: true })).toHaveAttribute('href', 'https://admin.keytotwo.com.br')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Abrir menu' }).click()
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Painel', exact: true })).toHaveAttribute('href', 'https://admin.keytotwo.com.br')
  expect(requested.filter(path => path.startsWith('/admin'))).toEqual([])
})

test('admin: quem não é admin não vê o link', async ({ page }) => {
  await fixture(page, { admin: false })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Abrir opções da conta' }).click()
  await expect(page.locator('header').getByRole('navigation', { name: 'Sua conta' }).getByRole('link')).toHaveText(['Meus jogos', 'Minha conta'])
})
