import { expect, test, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync } from 'node:fs'
import { authStorageKey } from '../fixtures/session'

// Admin (admin/, 2026-10-23): entrar com Google ou código, ser admin e confirmar o segundo fator (TOTP) antes das
// métricas. O Auth e a API são simulados; o build/admin lê o mesmo .env.local do site.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test.skip(() => !existsSync('admin/dist/index.html'), 'Requires `npm run build:admin`')

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
const jwt = (claims: object) => `${base64url({ alg: 'ES256', typ: 'JWT' })}.${base64url({ sub: 'qa-admin', role: 'authenticated', aud: 'authenticated', exp: 4102444800, ...claims })}.assinatura`
const verified = { id: 'fator-1', factor_type: 'totp', status: 'verified', friendly_name: 'Admin KeyToTwo', created_at: '2026-10-23T12:00:00Z', updated_at: '2026-10-23T12:00:00Z' }

function user({ admin = true, factors = [verified] as object[] } = {}) {
  return { id: 'qa-admin', email: 'admin@example.test', email_confirmed_at: '2026-01-01', aud: 'authenticated', role: 'authenticated', app_metadata: admin ? { provider: 'google', admin: true } : { provider: 'google' }, user_metadata: {}, factors }
}
function session(aal: 'aal1' | 'aal2', who = user()) {
  return { access_token: jwt({ aal, email: who.email }), refresh_token: `refresh-${aal}`, expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user: who }
}

function metrics(days: number) {
  const daily = Array.from({ length: days }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, 23 - (days - 1) + i)).toISOString().slice(0, 10), orders: i === days - 1 ? 2 : 0, revenue: i === days - 1 ? 1980 : 0, accounts: i % 2 }))
  return { days, since: daily[0].date, until: daily.at(-1)!.date, livemode: true, sales: { orders: 2, revenue: 1980, currency: 'brl' }, accounts: 3, funnel: { cart: 10, checkout: 6, paid: 2 }, downloads: { paid: 4, free: 9 }, free_unlocks: 5, newsletter: { subscribed: 12 }, daily }
}

// Auth e API simulados. `stored`: a sessão que já está no navegador; `factors`: os fatores do usuário no Auth.
async function fixture(page: Page, { stored, who = user() }: { stored?: ReturnType<typeof session>; who?: ReturnType<typeof user> } = {}) {
  const calls: { method: string; path: string; body: unknown; auth?: string }[] = []
  let factors = who.factors
  if (stored) await page.addInitScript(([key, value]) => localStorage.setItem(key, JSON.stringify(value)), [authStorageKey, stored] as const)
  await page.route('**/auth/v1/**', async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.split('/auth/v1')[1]
    calls.push({ method: request.method(), path, body: request.postDataJSON() })
    if (path === '/user') return route.fulfill({ json: { ...who, factors } })
    if (path === '/otp') return route.fulfill({ json: {} })
    if (path === '/verify') return route.fulfill({ json: session('aal1', who) })
    if (path === '/factors' && request.method() === 'POST') {
      factors = [...factors, { ...verified, id: 'fator-novo', status: 'unverified' }]
      return route.fulfill({ json: { id: 'fator-novo', type: 'totp', friendly_name: 'Admin KeyToTwo', totp: { qr_code: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>', secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/KeyToTwo' } } })
    }
    if (/^\/factors\/[^/]+\/challenge$/.test(path)) return route.fulfill({ json: { id: 'desafio-1', type: 'totp', expires_at: 4102444800 } })
    if (/^\/factors\/[^/]+\/verify$/.test(path)) {
      const body = request.postDataJSON() as { code: string }
      if (body.code !== '123456') return route.fulfill({ status: 422, json: { error_code: 'mfa_verification_failed', msg: 'Invalid TOTP code entered' } })
      return route.fulfill({ json: session('aal2', { ...who, factors: [verified] }) })
    }
    if (path === '/logout') return route.fulfill({ status: 204, body: '' })
    return route.fulfill({ status: 404, json: {} })
  })
  await page.route('**/functions/v1/api/**', route => {
    const url = new URL(route.request().url())
    calls.push({ method: route.request().method(), path: `api${url.pathname.split('/api')[1]}${url.search}`, body: null, auth: route.request().headers().authorization })
    return route.fulfill({ json: metrics(Number(url.searchParams.get('days'))) })
  })
  return calls
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(result.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map(n => n.target) }))).toEqual([])
}

test('sem sessão: entrar com Google volta para o admin', async ({ page }) => {
  await fixture(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Entrar no admin' })).toBeVisible()
  await axe(page)
  const origin = new URL(page.url()).origin
  const authorize = page.waitForRequest(request => request.url().includes('/auth/v1/authorize'))
  await page.getByRole('button', { name: 'Continuar com Google' }).click()
  const url = new URL((await authorize).url())
  expect(url.searchParams.get('provider')).toBe('google')
  expect(url.searchParams.get('redirect_to')).toBe(`${origin}/`)
})

test('código por e-mail: não cria conta e, com o fator cadastrado, pede o código do app', async ({ page }) => {
  const calls = await fixture(page)
  await page.goto('/')
  await page.getByLabel('E-mail').fill('Admin@Example.test')
  await page.getByRole('button', { name: 'Receber código por e-mail' }).click()
  await expect(page.getByLabel('Código enviado para admin@example.test')).toBeVisible()
  expect(calls.find(call => call.path === '/otp')?.body).toMatchObject({ email: 'admin@example.test', create_user: false })
  await page.getByLabel(/Código enviado/).fill('654321')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Código do app autenticador' })).toBeVisible()
  expect(calls.some(call => call.path.startsWith('api'))).toBe(false)
})

test('conta que não é admin: acesso negado, sem fator e sem API', async ({ page }) => {
  const who = user({ admin: false, factors: [] })
  const calls = await fixture(page, { stored: session('aal1', who), who })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Esta área é só para a equipe' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ir para a loja' })).toHaveAttribute('href', /^https?:\/\//)
  await axe(page)
  expect(calls.filter(call => call.path.startsWith('/factors') || call.path.startsWith('api'))).toEqual([])
})

test('primeiro acesso de admin: cadastra o app autenticador pelo QR code e entra nas métricas', async ({ page }) => {
  const who = user({ factors: [] })
  const calls = await fixture(page, { stored: session('aal1', who), who })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Proteja o admin' })).toBeVisible()
  await expect(page.getByRole('img', { name: /QR code/ })).toHaveAttribute('src', /^data:image\/svg\+xml/)
  await page.getByText('Não consegue escanear?').click()
  await expect(page.locator('.gate-secret code')).toHaveText('JBSWY3DPEHPK3PXP')
  await axe(page)
  await page.getByLabel('Código de 6 números').fill('123456')
  await page.getByRole('button', { name: 'Confirmar e entrar' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Métricas' })).toBeVisible()
  expect(calls.filter(call => call.method === 'POST' && call.path === '/factors')).toHaveLength(1)
  const api = calls.find(call => call.path.startsWith('api'))!
  expect(api.path).toBe('api/admin/metrics?days=7')
  expect(JSON.parse(Buffer.from(api.auth!.split('.')[1], 'base64url').toString()).aal).toBe('aal2')
})

test('sessão nova de admin: código errado mostra o erro, o certo abre o admin', async ({ page }) => {
  const calls = await fixture(page, { stored: session('aal1') })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Código do app autenticador' })).toBeVisible()
  await page.getByLabel('Código de 6 números').fill('000000')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('alert')).toHaveText('Código incorreto ou vencido. Use o código que está no app agora.')
  await page.getByLabel('Código de 6 números').fill('123456')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Métricas' })).toBeVisible()
  expect(calls.some(call => call.method === 'POST' && call.path === '/factors')).toBe(false)
})

test('métricas: barra lateral com as seções, 7 e 30 dias, celular sem rolagem lateral; sair volta ao início', async ({ page }) => {
  const calls = await fixture(page, { stored: session('aal2') })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Seções do admin' })
  await expect(nav.getByRole('link')).toHaveText(['Métricas', 'Blog', 'Pedidos e reembolsos', 'Usuários'])
  await expect(nav.getByRole('list', { name: 'Em breve' }).getByRole('link')).toHaveText(['Blog', 'Pedidos e reembolsos', 'Usuários'])
  await expect(nav.getByRole('link', { name: 'Métricas' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('region', { name: 'Vendas' }).locator('.cards dd')).toHaveText(['R$ 19,80', '2', 'R$ 9,90'])
  await expect(page.locator('.bars span')).toHaveCount(7)
  await expect(page.locator('.funnel-share')).toHaveText(['60% da sacola', '20% da sacola'])
  await axe(page)
  await page.getByRole('button', { name: '30 dias' }).click()
  await expect(page.locator('.bars span')).toHaveCount(30)
  expect(calls.filter(call => call.path.startsWith('api')).map(call => call.path)).toEqual(['api/admin/metrics?days=7', 'api/admin/metrics?days=30'])

  await nav.getByRole('link', { name: /Blog/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Blog' })).toBeVisible()
  await expect(page).toHaveTitle('Blog — Admin KeyToTwo')

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  }
  await axe(page)
  await page.getByRole('button', { name: 'Sair' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Entrar no admin' })).toBeVisible()
})
