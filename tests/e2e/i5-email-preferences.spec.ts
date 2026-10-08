import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

// Synthetic token only. Never record real email links or authentication responses.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
const token = 'synthetic.unsubscribe-token'
const destination = `/email/preferencias?token=${token}`

test.beforeEach(async ({ page }) => {
  const html = await readFile(new URL('../../build/client/index.html', import.meta.url), 'utf8')
  test.skip(!html.includes('Ambiente de teste'), 'Requires stage=test')
  await page.route('**/functions/v1/api/**', route => route.fulfill({ json: route.request().url().endsWith('/free-game') ? { available: false } : { products: [] } }))
})

async function open(page: Page, apiMode = true) {
  await page.goto(destination)
  await page.waitForLoadState('networkidle')
  const mock = await page.getByText('Demonstração (mock): nenhuma preferência de e-mail será alterada.').count() > 0
  test.skip(apiMode ? mock : !mock, apiMode ? 'Requires VITE_EMAIL_PREFERENCES_MODE=api build' : 'Only applies to preferences mock')
}

test('public, noindex, no token: no mutation, private data or navigation entry', async ({ page }) => {
  let posts = 0
  page.on('request', request => { if (request.url().includes('/email/unsubscribe')) posts++ })
  await page.goto('/email/preferencias')
  await expect(page.getByRole('heading', { name: 'Preferências de e-mail' })).toBeVisible()
  await expect(page.getByText('Abra o link que veio no e-mail ou ajuste sua preferência em Minha conta.')).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')
  await expect(page.locator('main button')).toHaveCount(0)
  await expect(page.locator('header a[href="/email/preferencias"], footer a[href="/email/preferencias"]')).toHaveCount(0)
  await page.getByRole('link', { name: 'Minha conta', exact: true }).click()
  await expect(page).toHaveURL(/\/entrar\?next=%2Fconta$/)
  expect(posts).toBe(0)
})

test('one explicit click unsubscribes without login; repeat is idempotent; removes token', async ({ page }) => {
  let calls = 0
  await page.route('**/api/email/unsubscribe', route => {
    calls++
    expect(route.request().method()).toBe('POST')
    expect(route.request().postDataJSON()).toEqual({ token })
    expect(route.request().headers().authorization).toBeUndefined()
    expect(route.request().headers().referer).toBeUndefined()
    return route.fulfill({ json: { status: 'unsubscribed' } })
  })
  await open(page)
  expect(calls).toBe(0) // GET/hydration must never unsubscribe an email scanner.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await page.goto(destination)
    const button = page.getByRole('button', { name: 'Parar de receber novidades' })
    await button.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByText('Você está fora da lista de novidades. Se já estava, está tudo certo.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Tudo certo por aqui.' })).toBeFocused()
    await expect(page).toHaveURL(/\/email\/preferencias$/)
    expect(calls).toBe(attempt + 1)
  }
})

test('invalid link offers account without inventing an expiration state', async ({ page }) => {
  await page.route('**/api/email/unsubscribe', route => route.fulfill({ status: 400, json: { error: { code: 'INVALID_TOKEN' } } }))
  await open(page)
  await page.getByRole('button', { name: 'Parar de receber novidades' }).click()
  await expect(page.locator('main [role="alert"]')).toContainText('Este link não está funcionando')
  await expect(page.locator('main button')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Minha conta', exact: true })).toHaveAttribute('href', '/conta')
})

test('temporary failure permits retry, never fabricates success', async ({ page }) => {
  let calls = 0
  await page.route('**/api/email/unsubscribe', route => ++calls === 1 ? route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR' } } }) : route.fulfill({ json: { status: 'unsubscribed' } }))
  await open(page)
  const button = page.getByRole('button', { name: 'Parar de receber novidades' })
  await button.click()
  await expect(page.locator('main [role="alert"]')).toContainText('Não conseguimos confirmar agora')
  await expect(button).toBeEnabled()
  await expect(page.getByText('Você está fora da lista de novidades.', { exact: true })).toHaveCount(0)
  await button.click()
  await expect(page.getByRole('heading', { name: 'Tudo certo por aqui.' })).toBeVisible()
  expect(calls).toBe(2)
})

test('preferences remain responsive with doubled text', async ({ page }) => {
  await page.goto(destination)
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const size of ['16px', '32px']) {
      await page.evaluate(value => { document.documentElement.style.fontSize = value }, size)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width}/${size}`).toBe(true)
    }
  }
})

test('explicit mock never changes server preference', async ({ page }) => {
  let calls = 0
  page.on('request', request => { if (request.url().includes('/email/unsubscribe')) calls++ })
  await open(page, false)
  await page.getByRole('button', { name: 'Simular descadastro' }).click()
  await expect(page.getByText('Demonstração concluída. Nenhuma preferência foi alterada.')).toBeVisible()
  await expect(page).toHaveURL(/\/email\/preferencias$/)
  expect(calls).toBe(0)
})
