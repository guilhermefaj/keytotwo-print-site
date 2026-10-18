import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from './fixtures/test'
import { authStorageKey } from './fixtures/session'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })
const fileId = '11111111-1111-4111-8111-111111111111'
const newerFileId = '22222222-2222-4222-8222-222222222222'
const file = { id: fileId, kind: 'pdf', version: '1.0', size_bytes: 3600000 }
const game = { code: 'TESTE-J01', name: 'Jogo de TESTE', acquired_at: '2026-10-01T12:00:00Z', products: [{ code: 'P001', name: 'Pacote de TESTE' }], files: [file] }
const fakeSession = { access_token: 'synthetic-token', refresh_token: 'synthetic-refresh', expires_at: 4102444800, token_type: 'bearer', user: { id: 'synthetic', email: 'synthetic@example.test', email_confirmed_at: '2026-01-01', is_anonymous: false, aud: 'authenticated', app_metadata: {}, user_metadata: {} } }
const fileURL = 'https://qa.s3.us-east-005.backblazeb2.com/fixture.pdf'

async function fixture(page: Page) {
  await page.addInitScript(([key, session]) => localStorage.setItem(key, JSON.stringify(session)), [authStorageKey, fakeSession] as const)
  await page.route('**/auth/v1/**', route => route.fulfill({ json: fakeSession.user }))
  await page.route('**/functions/v1/api/**', route => {
    const path = new URL(route.request().url()).pathname.split('/api')[1]
    const data = path === '/library' ? { games: [game], pending: [] } : path === '/free-game' ? { available: false } : path === '/account' ? { email: fakeSession.user.email, marketing: { opted_in: false, prompted_at: '2026-01-01' }, orders: [] } : path === '/catalog' ? { products: [] } : path === '/download-url' || path === '/free-download' ? { url: fileURL, expires_at: new Date(Date.now() + 300000).toISOString(), filename: 'jogo-teste.pdf' } : { items: [], version: 0, subtotal: null, warnings: [] }
    return route.fulfill({ json: data })
  })
  await page.route(fileURL, route => route.fulfill({ contentType: 'application/pdf', headers: { 'Content-Disposition': 'attachment; filename="jogo-teste.pdf"' }, body: '%PDF-1.4\n% Synthetic test response only; not a game\n%%EOF' }))
}

async function library(page: Page, apiMode = true) {
  await page.goto('/meus-jogos')
  await expect(page.getByRole('button', { name: 'Baixar PDF', exact: true })).toBeVisible()
  const mock = await page.getByText('Demonstração da entrega (mock): os botões ainda não baixam arquivos.').count() > 0
  test.skip(apiMode ? mock : !mock, apiMode ? 'Requires VITE_DELIVERY_MODE=api build' : 'Only applies to delivery mock')
}
test.beforeEach(async ({ page }) => {
  const html = await readFile(new URL('../../build/client/index.html', import.meta.url), 'utf8')
  test.skip(!html.includes('Ambiente de teste'), 'Requires stage=test')
  await fixture(page)
})

test('one PDF per game, native download, a fresh URL on every click', async ({ page }) => {
  let calls = 0
  page.on('request', request => { if (request.url().endsWith('/api/download-url')) { calls++; expect(request.postDataJSON()).toEqual({ file_id: fileId }) } })
  await library(page)
  await expect(page.locator('.file-meta')).toHaveText('PDF · 3,6 MB')
  for (let i = 0; i < 2; i++) {
    const downloaded = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Baixar PDF', exact: true }).click()
    const result = await downloaded
    expect(result.suggestedFilename()).toBe('jogo-teste.pdf')
    expect(await result.failure()).toBeNull()
    await expect(page.locator('.download-action [role="status"]')).toContainText('Abrimos o PDF')
  }
  expect(calls).toBe(2)
  await expect(page).toHaveURL(/\/meus-jogos#jogo-TESTE-J01$/)
})

test('expired URL gets one new link before native download', async ({ page }) => {
  let calls = 0
  await page.route('**/api/download-url', route => route.fulfill({ json: { url: fileURL, expires_at: new Date(Date.now() + (++calls === 1 ? -1000 : 300000)).toISOString(), filename: 'jogo-teste.pdf' } }))
  await library(page)
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar PDF', exact: true }).click()
  await downloaded
  expect(calls).toBe(2)
})

test('unavailable file preserves purchase, offers help and can retry', async ({ page }) => {
  await page.route('**/api/download-url', route => route.fulfill({ status: 503, json: { error: { code: 'FILE_UNAVAILABLE' } } }))
  await library(page)
  await page.getByRole('button', { name: 'Baixar PDF', exact: true }).click()
  await expect(page.locator('.download-action [role="alert"]')).toContainText('a compra continua na sua conta')
  await expect(page.locator('.download-action').getByRole('link', { name: 'Preciso de ajuda' })).toHaveAttribute('href', '/ajuda')
  await expect(page.locator('.library-grid > li')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Baixar PDF', exact: true })).toBeEnabled()
})

test('retired file refreshes library, next click requests replacement', async ({ page }) => {
  let replaced = false
  await page.route('**/api/library', route => route.fulfill({ json: { games: [{ ...game, files: [{ ...file, id: replaced ? newerFileId : fileId }] }], pending: [] } }))
  await page.route('**/api/download-url', route => {
    if (route.request().postDataJSON().file_id === fileId) { replaced = true; return route.fulfill({ status: 404, json: { error: { code: 'FILE_NOT_FOUND' } } }) }
    return route.fulfill({ json: { url: fileURL, expires_at: new Date(Date.now() + 300000).toISOString() } })
  })
  await library(page)
  const refreshed = page.waitForResponse(response => response.url().endsWith('/api/library'))
  await page.getByRole('button', { name: 'Baixar PDF', exact: true }).click()
  await refreshed
  await expect(page.locator('.download-action [role="alert"]')).toContainText('Este jogo ganhou uma versão nova do arquivo')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar PDF', exact: true }).click()
  await downloaded
})

test('expired session keeps the selected game in login next', async ({ page }) => {
  await page.route('**/api/download-url', route => route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } }))
  await library(page)
  await page.getByRole('button', { name: 'Baixar PDF', exact: true }).click()
  await expect(page).toHaveURL(/\/entrar\?next=%2Fmeus-jogos%23jogo-TESTE-J01$/)
})

test('expired email link gives guidance; library remains responsive with double text', async ({ page }) => {
  await page.goto('/meus-jogos?link=expirado#jogo-TESTE-J01')
  await expect(page.locator('.library-notice')).toContainText('O link do e-mail venceu')
  await expect(page.locator('#jogo-TESTE-J01')).toBeFocused()
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const size of ['16px', '32px']) {
      await page.evaluate(value => { document.documentElement.style.fontSize = value }, size)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width}/${size}`).toBe(true)
    }
  }
})

test('no published PDF: preparation message, retained game and disabled download', async ({ page }) => {
  await page.route('**/api/library', route => route.fulfill({ json: { games: [{ ...game, files: [] }], pending: [] } }))
  await page.goto('/meus-jogos')
  await expect(page.getByRole('button', { name: 'Baixar PDF', exact: true })).toBeDisabled()
  await expect(page.getByText(/O PDF está em preparação/)).toBeVisible()
  await expect(page.locator('.library-grid > li')).toHaveCount(1)
})

test('free game unavailable: no navigation, download button or invented game', async ({ page }) => {
  await page.goto('/jogo-gratuito')
  await expect(page.getByRole('heading', { name: 'Jogo gratuito', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /Jogo gr(átis|atuito)/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Baixar PDF', exact: true })).toHaveCount(0)
})

test('free game available: public download uses free endpoint', async ({ page }) => {
  await library(page)
  await page.route('**/api/free-game', route => route.fulfill({ json: { available: true, game: { name: 'Gratuito de TESTE' }, file } }))
  await page.goto('/jogo-gratuito')
  await expect(page.getByRole('heading', { name: 'Gratuito de TESTE' })).toBeVisible()
  await expect(page.locator('header .desktop-nav').getByRole('link', { name: 'Jogo grátis' })).toBeVisible()
  const response = page.waitForResponse(result => result.url().endsWith('/api/free-download'))
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar PDF' }).click()
  expect((await response).request().headers().authorization).toBeUndefined()
  await downloaded
})

test('delivery mock is explicit and requests no signed URL', async ({ page }) => {
  let requested = false
  page.on('request', request => { if (request.url().endsWith('/api/download-url')) requested = true })
  await library(page, false)
  await page.getByRole('button', { name: 'Baixar PDF', exact: true }).click()
  await expect(page.locator('.download-action [role="status"]')).toContainText('Nenhum arquivo foi baixado')
  expect(requested).toBe(false)
})
