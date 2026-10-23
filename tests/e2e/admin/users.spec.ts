import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync } from 'node:fs'
import { authStorageKey, session } from './session'

// Usuários no admin (2026-10-23, Fase 4): abas Contas | Acompanhamento | Equipe; lista com busca, filtros e páginas;
// ficha com presente (um ou vários jogos), retirar jogo, reenviar acesso, novidades, bloqueio, equipe, exportar e
// excluir. A API é simulada (formatos de docs/api-contract.md 6.14).
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test.skip(() => !existsSync('admin/dist/index.html'), 'Requires `npm run build:admin`')

const ANA = 'a1a1a1a1-0000-4000-8000-000000000001'
const CHEFE = 'c2c2c2c2-0000-4000-8000-000000000002'
const ENT = 'e3e3e3e3-0000-4000-8000-000000000003'
const ORDER = 'f4f4f4f4-0000-4000-8000-000000000004'

const summary = (index: number, extra: Record<string, unknown> = {}) => ({
  id: index === 0 ? ANA : `b0b0b0b0-0000-4000-8000-${String(index).padStart(12, '0')}`, email: index === 0 ? 'ana@example.test' : `pessoa${index}@example.test`,
  created_at: '2026-10-20T12:00:00Z', last_sign_in_at: index % 3 ? null : '2026-10-22T15:00:00Z', confirmed: index !== 2, blocked: index === 4, admin: false,
  providers: [index % 2 ? 'google' : 'email'], newsletter: index % 2 === 0, purchases: index === 0 ? 1 : 0, games: index === 0 ? 1 : 0, ...extra,
})

function detail(id: string, extra: { admin?: boolean; self?: boolean } = {}) {
  return {
    account: { id, email: id === ANA ? 'ana@example.test' : 'chefe@example.test', created_at: '2026-10-20T12:00:00Z', confirmed_at: '2026-10-20T12:01:00Z',
      last_sign_in_at: '2026-10-22T15:00:00Z', providers: ['google'], name: id === ANA ? 'Ana Souza' : null, blocked: false, banned_until: null,
      admin: extra.admin ?? false, self: extra.self ?? false, stripe_customer_id: id === ANA ? 'cus_TESTE123' : null },
    newsletter: { opted_in: true, opted_in_at: '2026-10-20T12:02:00Z', history: [{ action: 'granted', source: 'signup_prompt', occurred_at: '2026-10-20T12:02:00Z' }] },
    library: [{ entitlement_id: ENT, status: 'active', revoke_reason: null, granted_at: '2026-10-21T10:00:00Z', revoked_at: null,
      product: { code: 'J001', name: 'Rapadura', kind: 'single' }, order: { id: ORDER, ref: 'F4F4F4F4', kind: 'purchase' }, games: [{ code: 'J001', name: 'Rapadura' }] }],
    orders: [{ id: ORDER, ref: 'F4F4F4F4', kind: 'purchase', status: 'paid', created_at: '2026-10-21T09:58:00Z', paid_at: '2026-10-21T10:00:00Z', refunded_at: null,
      amount_total: 1990, amount_discount: 0, currency: 'brl', promotion_code: null, livemode: true, deliverable: true, items: [{ code: 'J001', name: 'Rapadura', unit_amount: 1990 }] }],
    emails: [{ kind: 'delivery', status: 'sent', skip_reason: null, created_at: '2026-10-21T10:00:00Z', sent_at: '2026-10-21T10:00:05Z', order_ref: 'F4F4F4F4' },
      { kind: 'cart_reminder', status: 'skipped', skip_reason: 'already_purchased', created_at: '2026-10-21T08:00:00Z', sent_at: null, order_ref: null }],
    suppressions: [],
    downloads: { count: 3, last_at: '2026-10-22T15:05:00Z' },
    history: [],
    giftable: [{ code: 'J001', name: 'Rapadura', kind: 'single', owned: true }, { code: 'P001', name: 'Pacote completo', kind: 'bundle', owned: false },
      { code: 'J005', name: 'Mapa do Casal', kind: 'single', owned: false }],
  }
}

const followUp = {
  cart: { total: 1, items: [{ user_id: ANA, email: 'ana@example.test', since: '2026-10-20T10:00:00Z', last_added: '2026-10-20T10:00:00Z', items: ['Rapadura'], reminded: true }] },
  no_download: { total: 1, items: [{ user_id: ANA, email: 'ana@example.test', order_id: ORDER, order_ref: 'F4F4F4F4', order_kind: 'purchase', paid_at: '2026-10-19T10:00:00Z', items: ['Rapadura'] }] },
  delivery: { total: 1, items: [{ user_id: CHEFE, email: 'chefe@example.test', order_id: null, order_ref: null, problem: 'suppressed', reason: 'hard_bounce', at: '2026-10-21T10:00:00Z' }] },
  unconfirmed: { total: 0, items: [] },
}

type Call = { method: string; path: string; body: unknown }
async function usersApi(page: Page, { failGift = false } = {}) {
  const calls: Call[] = []
  await page.addInitScript(([key, value]) => localStorage.setItem(key, JSON.stringify(value)), [authStorageKey, session('aal2')] as const)
  await page.route('**/auth/v1/**', route => route.fulfill({ json: session('aal2').user }))
  await page.route('**/functions/v1/api/admin/follow-up', route => {
    calls.push({ method: 'GET', path: '/admin/follow-up', body: null })
    return route.fulfill({ json: followUp })
  })
  await page.route('**/functions/v1/api/admin/users**', route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.split('/api')[1]
    const method = request.method()
    calls.push({ method, path: `${path}${url.search}`, body: method === 'POST' ? request.postDataJSON() : null })
    if (path === '/admin/users') {
      const filter = url.searchParams.get('filter') ?? 'all'
      const page = Number(url.searchParams.get('page') ?? '1')
      const all = Array.from({ length: 60 }, (_, index) => summary(index))
      if (filter === 'admins') return route.fulfill({ json: { total: 2, offset: 0, limit: 50, page: 1, users: [summary(1, { id: 'qa-admin', email: 'admin@example.test', admin: true }), summary(2, { id: CHEFE, email: 'chefe@example.test', admin: true })] } })
      const matching = all.filter(user => (!url.searchParams.get('q') || user.email.includes(url.searchParams.get('q')!)) && (filter !== 'buyers' || user.purchases > 0))
      return route.fulfill({ json: { total: matching.length, offset: (page - 1) * 50, limit: 50, page, users: matching.slice((page - 1) * 50, page * 50) } })
    }
    const [, , , id, ...rest] = path.split('/')
    const action = rest.join('/')
    if (!action) return route.fulfill({ json: detail(id, id === CHEFE ? { admin: true } : {}) })
    if (action === 'gifts' && failGift) return route.fulfill({ status: 409, json: { error: { code: 'GIFT_OVERLAP', message: 'Estes têm jogo em comum: P001, J005.', details: { products: ['P001', 'J005'] } } } })
    if (action === 'gifts') return route.fulfill({ status: 201, json: { order_id: ORDER, email_queued: request.postDataJSON().notify } })
    if (action === 'export') return route.fulfill({ json: { generated_at: '2026-10-23T12:00:00Z', orders: [] }, headers: { 'Content-Disposition': 'attachment' } })
    if (action === 'delete') return route.fulfill({ json: { deleted: true, orders_anonymized: 1 } })
    if (action.endsWith('/resend')) return route.fulfill({ status: 202, json: { queued: true } })
    return route.fulfill({ json: { ok: true } })
  })
  return calls
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(n => n.target) }))).toEqual([])
}
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
const lists = (calls: Call[]) => calls.filter(call => call.method === 'GET' && call.path.startsWith('/admin/users?')).map(call => call.path)

test('lista: busca no endereço, filtros e páginas; a ficha abre e volta para a mesma lista', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const calls = await usersApi(page)
  await page.goto('/usuarios')
  await expect(page.getByRole('heading', { level: 1, name: 'Usuários' })).toBeVisible()
  const list = page.getByRole('list', { name: 'Contas' })
  await expect(list.getByRole('listitem')).toHaveCount(50)
  await expect(page.getByText('1–50 de 60 contas')).toBeVisible()
  await expect(list.getByRole('listitem').nth(4).locator('.badge-danger')).toHaveText('Bloqueada')
  await axe(page)

  await page.getByRole('button', { name: 'Próxima' }).click()
  await expect(page.getByText('51–60 de 60 contas')).toBeVisible()
  await expect(page).toHaveURL(/page=2/)
  await page.getByRole('button', { name: 'Com compra' }).click()
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await expect(page).toHaveURL(/filter=buyers/)
  await expect(page).not.toHaveURL(/page=/)
  await page.getByRole('button', { name: 'Todas' }).click()
  await page.getByLabel('Buscar pelo e-mail').fill('ana@')
  await expect(page).toHaveURL(/q=ana%40/)
  await expect(list.getByRole('listitem')).toHaveCount(1)
  expect(lists(calls)).toEqual(['/admin/users?filter=all&page=1', '/admin/users?filter=all&page=2', '/admin/users?filter=buyers&page=1', '/admin/users?filter=all&page=1', '/admin/users?q=ana%40&filter=all&page=1'])

  await list.getByRole('link', { name: 'ana@example.test' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'ana@example.test' })).toBeVisible()
  await expect(page.getByText('Ana Souza · conta de')).toBeVisible()
  await page.getByRole('link', { name: 'Todos os usuários' }).click()
  await expect(page).toHaveURL(/\/usuarios\?q=ana%40&filter=all&page=1$/)
  await expect(page.getByLabel('Buscar pelo e-mail')).toHaveValue('ana@')
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 })
    expect(await noSideScroll(page)).toBe(true)
  }
})

test('ficha: presente com motivo e e-mail, retirar um jogo e reenviar o acesso; cada ação recarrega a ficha', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const calls = await usersApi(page)
  await page.goto(`/usuarios/${ANA}`)
  const games = page.getByRole('region', { name: /Jogos/ })
  await expect(games.getByText('Pedido F4F4F4F4', { exact: false })).toBeVisible()
  await expect(page.getByRole('link', { name: /cus_TESTE123/ })).toHaveAttribute('href', 'https://dashboard.stripe.com/customers/cus_TESTE123')
  await expect(page.getByRole('region', { name: 'Últimos e-mails' })).toContainText('Não enviado (já comprou)')

  await games.getByRole('button', { name: 'Dar um jogo de presente' }).click()
  const gift = page.getByRole('form', { name: 'Dar um jogo de presente' })
  const choices = gift.getByRole('group', { name: 'Jogos' }).getByRole('checkbox')
  await expect(choices).toHaveCount(2)
  await expect(choices.first()).toBeFocused()
  await expect(gift.getByRole('button', { name: 'Dar o presente' })).toBeDisabled()
  await gift.getByLabel('Pacote completo (pacote)').check()
  await gift.getByLabel('Mapa do Casal').check()
  await expect(gift.getByLabel(/Enviar o e-mail do presente/)).toBeChecked()
  await gift.getByLabel('Motivo').fill('oi')
  await gift.getByRole('button', { name: 'Dar os 2 presentes' }).click()
  await expect(gift.getByRole('alert')).toHaveText('Escreva o motivo, de 3 a 300 caracteres. Ele fica no histórico.')
  await axe(page)
  await gift.getByLabel('Motivo').fill('Compensação pelo atraso')
  await gift.getByRole('button', { name: 'Dar os 2 presentes' }).click()
  await expect(page.locator('.notice')).toHaveText('Pacote completo e Mapa do Casal foram dados de presente e o e-mail está saindo.')
  await expect(page.locator('.notice')).toBeFocused()
  expect(calls.find(call => call.path.endsWith('/gifts'))!.body).toEqual({ product_codes: ['P001', 'J005'], reason: 'Compensação pelo atraso', notify: true })

  await games.getByRole('button', { name: 'Retirar Rapadura' }).click()
  const revoke = page.getByRole('form', { name: 'Retirar Rapadura' })
  await expect(revoke).toContainText('O pedido não muda: para devolver o dinheiro, faça o reembolso.')
  await revoke.getByRole('button', { name: 'Cancelar' }).click()
  await expect(games.getByRole('button', { name: 'Retirar Rapadura' })).toBeFocused()
  await games.getByRole('button', { name: 'Retirar Rapadura' }).click()
  await page.getByRole('form', { name: 'Retirar Rapadura' }).getByLabel('Motivo').fill('Pedido por engano')
  await page.getByRole('form', { name: 'Retirar Rapadura' }).getByRole('button', { name: 'Retirar o jogo' }).click()
  await expect(page.locator('.notice')).toHaveText('Rapadura foi retirado da conta.')

  await page.getByRole('button', { name: 'Reenviar o e-mail de acesso do pedido F4F4F4F4' }).click()
  await expect(page.locator('.notice')).toHaveText('O e-mail de acesso do pedido F4F4F4F4 foi para a fila de envio.')
  expect(calls.filter(call => call.method === 'POST').map(call => [call.path, call.body])).toEqual([
    [`/admin/users/${ANA}/gifts`, { product_codes: ['P001', 'J005'], reason: 'Compensação pelo atraso', notify: true }],
    [`/admin/users/${ANA}/entitlements/${ENT}/revoke`, { reason: 'Pedido por engano' }],
    [`/admin/users/${ANA}/orders/${ORDER}/resend`, null],
  ])
  expect(calls.filter(call => call.method === 'GET' && call.path === `/admin/users/${ANA}`)).toHaveLength(4)
})

test('novidades, bloqueio, exportar e excluir com o e-mail digitado; recusa da API aparece no formulário', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const calls = await usersApi(page, { failGift: true })
  await page.goto(`/usuarios/${ANA}`)
  await page.getByRole('button', { name: 'Tirar das novidades' }).click()
  await page.getByRole('form', { name: 'Tirar das novidades' }).getByLabel('Motivo').fill('Pediu por e-mail')
  await page.getByRole('form', { name: 'Tirar das novidades' }).getByRole('button', { name: 'Tirar das novidades' }).click()
  await expect(page.locator('.notice')).toHaveText('A conta saiu das novidades.')

  await page.getByRole('button', { name: 'Bloquear o login' }).click()
  const block = page.getByRole('form', { name: 'Bloquear o login' })
  await expect(block).toContainText('Uma sessão já aberta cai em até 1 hora.')
  await block.getByLabel('Motivo').fill('Abuso no cupom')
  await block.getByRole('button', { name: 'Bloquear' }).click()
  await expect(page.locator('.notice')).toHaveText('O login foi bloqueado.')

  await page.getByRole('button', { name: 'Tornar admin' }).click()
  const promote = page.getByRole('form', { name: 'Tornar admin' })
  await expect(promote).toContainText('Ela cadastra o app autenticador no primeiro acesso.')
  await promote.getByLabel('Motivo').fill('Vai cuidar do blog')
  await promote.getByRole('button', { name: 'Tornar admin' }).click()
  await expect(page.locator('.notice')).toHaveText('A conta entrou na equipe. A pessoa vê o admin quando entrar de novo.')

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar os dados (LGPD)' }).click()
  expect((await download).suggestedFilename()).toBe('keytotwo-dados-a1a1a1a1.json')
  await expect(page.locator('.notice')).toHaveText('Os dados foram baixados. A exportação fica no histórico.')

  await page.getByRole('button', { name: 'Dar um jogo de presente' }).click()
  const gift = page.getByRole('form', { name: 'Dar um jogo de presente' })
  await gift.getByLabel('Pacote completo (pacote)').check()
  await gift.getByLabel('Mapa do Casal').check()
  await gift.getByLabel('Motivo').fill('Sorteio')
  await gift.getByRole('button', { name: 'Dar os 2 presentes' }).click()
  await expect(gift.getByRole('alert')).toHaveText('Pacote completo e Mapa do Casal têm jogo em comum (um pacote e um jogo que já vem nele). Escolha só um.')
  await gift.getByRole('button', { name: 'Cancelar' }).click()

  await page.getByRole('button', { name: 'Excluir a conta' }).click()
  const remove = page.getByRole('form', { name: 'Excluir a conta' })
  await expect(remove.getByLabel('Digite o e-mail da conta para confirmar')).toBeFocused()
  await remove.getByLabel('Motivo').fill('Pedido da pessoa por e-mail')
  await expect(remove.getByRole('button', { name: 'Excluir de vez' })).toBeDisabled()
  await remove.getByLabel('Digite o e-mail da conta para confirmar').fill('ANA@example.test')
  await axe(page)
  await remove.getByRole('button', { name: 'Excluir de vez' }).click()
  await expect(page).toHaveURL(/\/usuarios$/)
  await expect(page.locator('.notice')).toHaveText('A conta ana@example.test foi excluída e 1 pedido ficou anonimizado.')
  expect(calls.filter(call => call.method === 'POST').map(call => call.path.split('/').slice(4).join('/'))).toEqual(['newsletter/off', 'block', 'admin', 'gifts', 'delete'])
  expect(calls.find(call => call.path.endsWith('/admin'))!.body).toEqual({ admin: true, reason: 'Vai cuidar do blog' })
  expect(calls.find(call => call.path.endsWith('/delete'))!.body).toEqual({ reason: 'Pedido da pessoa por e-mail', confirm_email: 'ANA@example.test' })
})

test('abas: Acompanhamento com as quatro listas e o reenvio; Equipe com remover e adicionar admin pelo e-mail', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const calls = await usersApi(page)
  await page.goto('/usuarios')
  const tabs = page.getByRole('navigation', { name: 'Usuários' })
  await expect(tabs.getByRole('link')).toHaveText(['Contas', 'Acompanhamento', 'Equipe'])
  await expect(tabs.getByRole('link', { name: 'Contas' })).toHaveAttribute('aria-current', 'page')

  await tabs.getByRole('link', { name: 'Acompanhamento' }).click()
  await expect(page).toHaveURL(/\/usuarios\/acompanhamento$/)
  await expect(tabs.getByRole('link', { name: 'Acompanhamento' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('list', { name: 'Resumo' }).getByRole('link')).toHaveText(['1Sacola esquecida', '1Comprou e não baixou', '1Entrega com problema', '0Conta sem confirmação'])
  await expect(page.getByRole('region', { name: /Sacola esquecida/ })).toContainText('O lembrete automático já saiu.')
  await expect(page.getByRole('region', { name: /Entrega com problema/ })).toContainText('A Brevo não entrega para este endereço: o endereço não existe (devolução permanente)')
  await expect(page.getByRole('region', { name: /Conta sem confirmação/ })).toContainText('Ninguém aqui agora.')
  await axe(page)
  await page.getByRole('region', { name: /Comprou e não baixou/ }).getByRole('button', { name: 'Reenviar o e-mail de acesso do pedido F4F4F4F4' }).click()
  await expect(page.getByText('E-mail de acesso do pedido F4F4F4F4 na fila de envio.')).toBeVisible()
  expect(calls.filter(call => call.method === 'POST').map(call => call.path)).toEqual([`/admin/users/${ANA}/orders/${ORDER}/resend`])

  await tabs.getByRole('link', { name: 'Equipe' }).click()
  const team = page.getByRole('list', { name: 'Admins' })
  await expect(team.getByRole('listitem')).toHaveCount(2)
  await expect(team.getByRole('listitem').first().locator('.badge')).toHaveText('Você')
  await expect(team.getByRole('listitem').first().getByRole('button')).toHaveCount(0)
  await team.getByRole('button', { name: 'Remover chefe@example.test da equipe' }).click()
  await page.getByRole('form', { name: 'Remover chefe@example.test da equipe' }).getByLabel('Motivo').fill('Saiu da empresa')
  await page.getByRole('form', { name: 'Remover chefe@example.test da equipe' }).getByRole('button', { name: 'Remover admin' }).click()
  await expect(page.locator('.notice')).toHaveText('chefe@example.test saiu da equipe.')

  await page.getByRole('button', { name: 'Adicionar à equipe' }).click()
  const add = page.getByRole('form', { name: 'Adicionar à equipe' })
  await expect(add.getByLabel('E-mail da conta')).toBeFocused()
  await expect(add.getByRole('button', { name: 'Tornar admin' })).toBeDisabled()
  await add.getByLabel('E-mail da conta').fill('ninguem@example.test')
  await add.getByLabel('Motivo').fill('Nova pessoa')
  await add.getByRole('button', { name: 'Tornar admin' }).click()
  await expect(add.getByRole('alert')).toHaveText('Nenhuma conta com esse e-mail. A pessoa precisa entrar na loja uma vez antes.')
  await add.getByLabel('E-mail da conta').fill('ANA@example.test')
  await add.getByRole('button', { name: 'Tornar admin' }).click()
  await expect(page.locator('.notice')).toHaveText('ana@example.test entrou na equipe. Ela vê o admin quando entrar de novo e cadastra o app autenticador no primeiro acesso.')
  expect(calls.filter(call => call.method === 'POST').map(call => [call.path, call.body]).slice(1)).toEqual([
    [`/admin/users/${CHEFE}/admin`, { admin: false, reason: 'Saiu da empresa' }],
    [`/admin/users/${ANA}/admin`, { admin: true, reason: 'Nova pessoa' }],
  ])
  await axe(page)
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 })
    expect(await noSideScroll(page)).toBe(true)
  }
})

test('conta de admin: sem bloquear, excluir nem retirar jogo; celular sem rolagem lateral', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await usersApi(page)
  await page.goto(`/usuarios/${CHEFE}`)
  await expect(page.getByRole('heading', { level: 1, name: 'chefe@example.test' })).toBeVisible()
  await expect(page.getByText('Esta é uma conta de admin: bloquear, excluir e retirar jogos não valem aqui.')).toBeVisible()
  for (const name of ['Bloquear o login', 'Excluir a conta', 'Retirar Rapadura', 'Tornar admin']) await expect(page.getByRole('button', { name })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Remover admin' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Dar um jogo de presente' })).toBeVisible()
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 })
    expect(await noSideScroll(page)).toBe(true)
  }
  await axe(page)
})
