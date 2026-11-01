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
  // O perfil começa com o nome da conta Google, ainda sem salvar (2026-11-01).
  const state = {
    deletion: { status: 200, json: { deleted: true } as unknown },
    profile: { name: 'Ana Souza', birth_date: null as string | null, whatsapp: null as string | null, saved: false } as { name: string | null; birth_date: string | null; whatsapp: string | null; saved: boolean },
    optedIn: true,
  }
  await page.addInitScript(([key, value]) => { if (!sessionStorage.getItem('lgpd-loaded')) { sessionStorage.setItem('lgpd-loaded', '1'); localStorage.setItem(key, JSON.stringify(value)) } }, [authStorageKey, session] as const)
  await page.route('**/auth/v1/**', route => route.fulfill({ json: user }))
  await page.route('**/functions/v1/api/**', route => {
    const request = route.request()
    const path = new URL(request.url()).pathname.split('/api')[1]
    calls.push({ path, method: request.method(), body: request.postDataJSON(), authorization: request.headers().authorization ?? null })
    if (path === '/account/export') return route.fulfill({ json: exported })
    if (path === '/account/delete') return route.fulfill({ status: state.deletion.status, json: state.deletion.json })
    if (path === '/account/profile') {
      const body = request.postDataJSON()
      state.profile = { name: body.name, birth_date: body.birth_date, whatsapp: body.whatsapp, saved: true }
      return route.fulfill({ json: { profile: state.profile } })
    }
    if (path === '/account/marketing') { state.optedIn = request.postDataJSON().granted; return route.fulfill({ json: { marketing: { opted_in: state.optedIn } } }) }
    const json = path === '/account' ? { email: user.email, profile: state.profile, marketing: { opted_in: state.optedIn, prompted_at: '2026-01-01', updated_at: '2026-01-01', text_version: 'mkt-2026-10-19' }, orders: [] }
      : path === '/library' ? { games: [], pending: [] } : path === '/catalog' ? { products: [] } : path === '/free-games' ? { games: [] } : { version: 0, items: [], subtotal: null, warnings: [] }
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

// Perfil, botão vermelho e despedida das novidades (responsável, 2026-11-01).
const axe = async (page: Page) => {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(n => n.target) }))).toEqual([])
}

test('Sobre você: o nome do Google vem preenchido, os campos avisam antes de enviar e o WhatsApp vai no formato internacional', async ({ page }) => {
  const { calls } = await fixture(page)
  await page.goto('/conta')
  const name = page.getByLabel('Nome', { exact: true })
  const birth = page.getByLabel('Data de nascimento', { exact: true })
  const phone = page.getByLabel('WhatsApp', { exact: true })
  await expect(name).toHaveValue('Ana Souza')
  await expect(page.getByText('Veio da sua conta Google. Pode trocar se quiser.', { exact: true })).toBeVisible()
  await expect(page.locator('.portal-greeting')).toHaveText('Olá, Ana!')
  await expect(birth).toHaveAttribute('autocomplete', 'bday')
  await expect(phone).toHaveAttribute('autocomplete', 'tel')
  await axe(page)

  // Um dia depois do limite dos 18 anos e um número incompleto: o aviso fica no campo, e nada vai para a API.
  const limit = (await birth.getAttribute('max'))!
  const underage = new Date(Date.parse(`${limit}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  await birth.fill(underage)
  await phone.fill('9123-45')
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(birth).toBeFocused()
  await expect(birth).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByText('A conta da KeyToTwo é só para maiores de 18 anos.', { exact: true })).toBeVisible()
  await expect(phone).toHaveAttribute('aria-invalid', 'true')
  await expect(phone).toHaveAccessibleDescription(/Confira o número/)
  await axe(page)
  expect(calls.some(call => call.path === '/account/profile')).toBe(false)

  await name.fill('  Bia   Lima ')
  await birth.fill(limit)
  await phone.fill('11 91234 5678')
  await page.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Pronto, seus dados foram salvos.' })).toBeVisible()
  expect(calls.filter(call => call.path === '/account/profile').map(call => [call.method, call.body, call.authorization]))
    .toEqual([['PUT', { name: 'Bia Lima', birth_date: limit, whatsapp: '+5511912345678' }, `Bearer ${session.access_token}`]])
  await expect(name).toHaveValue('Bia Lima')
  await expect(phone).toHaveValue('(11) 91234-5678')
  await expect(page.getByText('Veio da sua conta Google.', { exact: false })).toHaveCount(0)
  await expect(page.locator('.portal-greeting')).toHaveText('Olá, Bia!')
})

test('Excluir minha conta: os dois botões em vermelho (Erro), sem cor nova', async ({ page }) => {
  await fixture(page)
  await page.goto('/conta')
  const opener = page.getByRole('button', { name: 'Excluir minha conta', exact: true })
  await expect(opener).toHaveCSS('color', 'rgb(153, 53, 24)')
  await expect(opener).toHaveCSS('border-top-color', 'rgb(153, 53, 24)')
  await opener.click()
  await page.getByLabel('Para confirmar, digite EXCLUIR').fill('EXCLUIR')
  await expect(page.getByRole('button', { name: 'Excluir conta definitivamente', exact: true })).toHaveCSS('background-color', 'rgb(153, 53, 24)')
})

test('Parar de receber: a janela mostra o que a pessoa perde; continuar não grava, e sair fica a um clique', async ({ page }) => {
  const { calls } = await fixture(page)
  await page.goto('/conta')
  const form = page.locator('.marketing-form')
  await form.getByRole('button', { name: 'Parar de receber', exact: true }).click()
  const leave = page.getByRole('dialog', { name: 'Vamos sentir sua falta' })
  await expect(leave).toBeVisible()
  await expect(leave).toHaveAccessibleDescription('Sem as novidades por e-mail, você deixa de receber:')
  await expect(leave.getByRole('listitem')).toHaveCount(3)
  await expect(leave.locator('img')).toHaveAttribute('src', '/media/portal/kito-coracao-96.webp')
  await axe(page)
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 640 })
    const box = (await leave.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(width)
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  await leave.getByRole('button', { name: 'Quero continuar recebendo', exact: true }).click()
  await expect(leave).toBeHidden()
  await expect(form).toContainText('Você recebe nossas ideias')
  expect(calls.some(call => call.path === '/account/marketing')).toBe(false)

  await form.getByRole('button', { name: 'Parar de receber', exact: true }).click()
  await leave.getByRole('button', { name: 'Parar de receber', exact: true }).click()
  await expect(form.getByRole('button', { name: 'Quero receber ideias', exact: true })).toBeVisible()
  await expect(page.getByText('Combinado. Você não recebe mais ideias.', { exact: true })).toBeVisible()
  expect(calls.filter(call => call.path === '/account/marketing').map(call => call.body)).toEqual([expect.objectContaining({ granted: false, source: 'account' })])
})
