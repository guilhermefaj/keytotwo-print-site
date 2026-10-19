import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from './fixtures/test'
import { authStorageKey } from './fixtures/session'

// Direitos do titular em Minha conta (Política de privacidade › Seus direitos), com a API simulada:
// baixar os dados (GET /account/export) e excluir a conta (POST /account/delete) com confirmação digitada na página.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
const user = { id: 'qa-lgpd', email: 'lgpd@example.test', email_confirmed_at: '2026-01-01', is_anonymous: false, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
const session = { access_token: 'synthetic-lgpd-token', refresh_token: 'synthetic-lgpd-refresh', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user }
const exported = { generated_at: '2026-10-19T12:00:00Z', account: { email: user.email }, orders: [{ ref: 'A1B2C3D4', status: 'paid' }], library: [], consents: [] }

async function fixture(page: Page) {
  test.skip(!readFileSync('build/client/index.html', 'utf8').includes('Ambiente de teste'), 'Requires configured stage=test build')
  const calls: { path: string; method: string; body: unknown; authorization: string | null }[] = []
  const state = { deletion: { status: 200, json: { deleted: true } as unknown } }
  await page.addInitScript(([key, value]) => { if (!sessionStorage.getItem('lgpd-loaded')) { sessionStorage.setItem('lgpd-loaded', '1'); localStorage.setItem(key, JSON.stringify(value)) } }, [authStorageKey, session] as const)
  await page.route('**/auth/v1/**', route => route.fulfill({ json: user }))
  await page.route('**/functions/v1/api/**', route => {
    const request = route.request()
    const path = new URL(request.url()).pathname.split('/api')[1]
    calls.push({ path, method: request.method(), body: request.postDataJSON(), authorization: request.headers().authorization ?? null })
    if (path === '/account/export') return route.fulfill({ json: exported })
    if (path === '/account/delete') return route.fulfill({ status: state.deletion.status, json: state.deletion.json })
    const json = path === '/account' ? { email: user.email, marketing: { opted_in: true, prompted_at: '2026-01-01', updated_at: '2026-01-01', text_version: 'mkt-2026-10-19' }, orders: [] }
      : path === '/library' ? { games: [], pending: [] } : path === '/catalog' ? { products: [] } : path === '/free-game' ? { available: false } : { version: 0, items: [], subtotal: null, warnings: [] }
    return route.fulfill({ json })
  })
  page.on('dialog', dialog => { throw new Error(`diálogo do navegador inesperado: ${dialog.type()} ${dialog.message()}`) })
  return { calls, state }
}

test('Minha conta: baixar meus dados salva o JSON da API, com a sessão', async ({ page }) => {
  const { calls } = await fixture(page)
  await page.goto('/conta')
  await expect(page.getByRole('heading', { name: 'Seus dados', exact: true })).toBeVisible()
  // Retirar o consentimento nunca fica bloqueado (LGPD, art. 8º, § 5º).
  await expect(page.locator('.marketing-form').getByRole('button', { name: 'Parar de receber', exact: true })).toBeEnabled()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar meus dados', exact: true }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^keytotwo-meus-dados-\d{4}-\d{2}-\d{2}\.json$/)
  expect(JSON.parse(await readFile((await file.path())!, 'utf8'))).toEqual(exported)
  await expect(page.getByRole('status').filter({ hasText: 'Pronto. O arquivo com seus dados foi baixado.' })).toBeVisible()
  expect(calls.filter(call => call.path === '/account/export').map(call => [call.method, call.authorization])).toEqual([['GET', `Bearer ${session.access_token}`]])
})

test('Excluir minha conta: confirmação digitada na página, recusa explicada e saída para o início', async ({ page }) => {
  const { calls, state } = await fixture(page)
  await page.goto('/conta')
  const opener = page.getByRole('button', { name: 'Excluir minha conta', exact: true })
  await opener.click()
  const input = page.getByLabel('Para confirmar, digite EXCLUIR')
  await expect(input).toBeFocused()
  await expect(page.locator('form.account-form li')).toHaveCount(4)
  const confirm = page.getByRole('button', { name: 'Excluir conta definitivamente', exact: true })
  await expect(confirm).toBeDisabled()
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(opener).toBeFocused()
  expect(calls.some(call => call.path === '/account/delete')).toBe(false)

  await opener.click()
  await input.fill('excluir')
  await expect(confirm).toBeEnabled()
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(n => n.target) }))).toEqual([])

  state.deletion = { status: 409, json: { error: { code: 'ACCOUNT_DELETION_BLOCKED', message: 'x', details: { reason: 'payment_pending' } } } }
  await confirm.click()
  await expect(page.getByRole('alert').filter({ hasText: 'Há um pagamento em andamento ou uma contestação aberta nesta conta.' })).toBeVisible()
  await expect(page).toHaveURL(/\/conta$/)

  state.deletion = { status: 200, json: { deleted: true } }
  await confirm.click()
  await expect(page).toHaveURL(/\/$/)
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), authStorageKey)).toBeNull()
  expect(calls.filter(call => call.path === '/account/delete').map(call => [call.method, call.body])).toEqual([['POST', { confirmation: 'EXCLUIR' }], ['POST', { confirmation: 'EXCLUIR' }]])
})
