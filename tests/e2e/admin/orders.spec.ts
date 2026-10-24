import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync } from 'node:fs'
import { authStorageKey, session } from './session'

// Pedidos e reembolsos no admin (2026-10-24, Fase 3): lista com busca, filtros e páginas; ficha com valores, jogos,
// linha do tempo, e-mails e histórico; reembolso do pedido inteiro com o código digitado, conferir com a Stripe e
// reenviar o acesso. A API é simulada (formatos de docs/api-contract.md 6.15).
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test.skip(() => !existsSync('admin/dist/index.html'), 'Requires `npm run build:admin`')

const ANA = 'a1a1a1a1-0000-4000-8000-000000000001'
const PAID = 'f4f4f4f4-0000-4000-8000-000000000004'
const OPEN = 'e5e5e5e5-0000-4000-8000-000000000005'

const summary = (index: number) => ({
  id: index === 0 ? PAID : index === 1 ? OPEN : `b0b0b0b0-0000-4000-8000-${String(index).padStart(12, '0')}`,
  ref: index === 0 ? 'F4F4F4F4' : index === 1 ? 'E5E5E5E5' : `B0B0${String(index).padStart(4, '0')}`,
  kind: index === 2 ? 'courtesy' : 'purchase', status: index === 1 ? 'open' : 'paid', email: index < 2 ? 'ana@example.test' : `pessoa${index}@example.test`,
  user_id: ANA, created_at: '2026-10-21T09:58:00Z', paid_at: index === 1 ? null : '2026-10-21T10:00:00Z',
  amount_total: index === 2 ? 0 : 990, currency: 'brl', promotion_code: index === 0 ? 'PRIMEIRA10' : null, items: ['Rabisque e Adivinhe'],
})

function detail(id: string, refunded = false) {
  const open = id === OPEN
  return {
    order: {
      id, ref: open ? 'E5E5E5E5' : 'F4F4F4F4', kind: 'purchase', status: open ? 'open' : refunded ? 'refunded' : 'paid',
      created_at: '2026-10-21T09:58:00Z', paid_at: open ? null : '2026-10-21T10:00:00Z', refunded_at: refunded ? '2026-10-24T12:00:00Z' : null,
      checkout_expires_at: null, amount_subtotal: 1100, amount_discount: 110, amount_total: 990, currency: 'brl', promotion_code: 'PRIMEIRA10', livemode: true,
      terms_version: 'termos-2026-10-22', terms_accepted_at: '2026-10-21T09:58:00Z', stripe_checkout_session_id: 'cs_live_TESTE',
      stripe_payment_intent_id: open ? null : 'pi_TESTE123', deliverable: !open && !refunded, refundable: !open && !refunded, reconcilable: open,
    },
    person: { id: ANA, email: 'ana@example.test', order_email: 'ana@example.test', exists: true, stripe_customer_id: 'cus_TESTE123' },
    items: [{ code: 'J001', name: 'Rabisque e Adivinhe', kind: 'single', unit_amount: 1100, currency: 'brl' }],
    events: open ? [] : [{ from_status: 'open', to_status: 'paid', source: 'webhook', reason: null, created_at: '2026-10-21T10:00:00Z' },
      ...(refunded ? [{ from_status: 'paid', to_status: 'refunded', source: 'admin', reason: 'admin_refund', created_at: '2026-10-24T12:00:00Z' }] : [])],
    entitlements: open ? [] : [{ id: 'e1e1e1e1-0000-4000-8000-000000000001', status: refunded ? 'revoked' : 'active', revoke_reason: refunded ? 'refund' : null,
      granted_at: '2026-10-21T10:00:00Z', revoked_at: refunded ? '2026-10-24T12:00:00Z' : null, product: { code: 'J001', name: 'Rabisque e Adivinhe', kind: 'single' },
      games: [{ code: 'J001', name: 'Rabisque e Adivinhe' }] }],
    downloads: { count: open ? 0 : 2, last_at: open ? null : '2026-10-22T15:05:00Z' },
    emails: open ? [] : [{ kind: 'delivery', status: 'sent', skip_reason: null, created_at: '2026-10-21T10:00:00Z', sent_at: '2026-10-21T10:00:05Z' },
      ...(refunded ? [{ kind: 'refund', status: 'queued', skip_reason: null, created_at: '2026-10-24T12:00:00Z', sent_at: null }] : [])],
    history: refunded ? [{ action: 'order_refund', created_at: '2026-10-24T12:00:00Z', by: 'admin@example.test', details: { reason: 'Pediu por e-mail' } }] : [],
  }
}

type Call = { method: string; path: string; body: unknown }
async function ordersApi(page: Page) {
  const calls: Call[] = []
  let refunded = false
  await page.addInitScript(([key, value]) => localStorage.setItem(key, JSON.stringify(value)), [authStorageKey, session('aal2')] as const)
  await page.route('**/auth/v1/**', route => route.fulfill({ json: session('aal2').user }))
  await page.route('**/functions/v1/api/admin/**', route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.split('/api')[1]
    const method = request.method()
    calls.push({ method, path: `${path}${url.search}`, body: method === 'POST' ? request.postDataJSON() : null })
    if (path === '/admin/orders') {
      const filter = url.searchParams.get('filter') ?? 'all'
      const pageNumber = Number(url.searchParams.get('page') ?? '1')
      const all = Array.from({ length: 55 }, (_, index) => summary(index))
      const query = url.searchParams.get('q')?.toUpperCase().replace('#', '')
      const matching = all.filter(order => (!query || order.ref.includes(query)) && (filter !== 'courtesy' || order.kind === 'courtesy'))
      return route.fulfill({ json: { total: matching.length, offset: (pageNumber - 1) * 50, limit: 50, page: pageNumber, orders: matching.slice((pageNumber - 1) * 50, pageNumber * 50) } })
    }
    const [, , , id, action] = path.split('/')
    if (path.startsWith('/admin/users/')) return route.fulfill({ status: 202, json: { queued: true } })
    if (!action) return route.fulfill({ json: detail(id, id === PAID && refunded) })
    if (action === 'refund') {
      refunded = true
      return route.fulfill({ json: { refunded: true, refund_status: 'succeeded', email_queued: true } })
    }
    if (action === 'reconcile') return route.fulfill({ json: { outcome: 'applied', status: 'paid' } })
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Pedido não encontrado.' } } })
  })
  return calls
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(n => n.target) }))).toEqual([])
}
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test('pedidos: a seção está pronta na barra lateral, sem o grupo "Em breve"', async ({ page }) => {
  await ordersApi(page)
  await page.goto('/pedidos')
  const nav = page.getByRole('navigation', { name: 'Seções do admin' })
  await expect(nav.getByRole('link')).toHaveText(['Métricas', 'Atenção', 'Pedidos e reembolsos', 'Catálogo', 'Usuários', 'Blog'])
  await expect(nav.getByText('Em breve')).toHaveCount(0)
  await expect(nav.getByRole('link', { name: 'Pedidos e reembolsos' })).toHaveAttribute('aria-current', 'page')
})

test('lista: busca pelo código, filtros e páginas no endereço; o pedido abre e volta para a mesma lista', async ({ page }) => {
  const calls = await ordersApi(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/pedidos')
  await expect(page.getByRole('heading', { level: 1, name: 'Pedidos e reembolsos' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'de 55 pedidos' })).toHaveText('1–50 de 55 pedidos')
  const first = page.getByRole('list', { name: 'Pedidos' }).getByRole('listitem').first()
  await expect(first).toContainText('ana@example.test')
  await expect(first).toContainText('cupom PRIMEIRA10')
  await expect(first).toContainText('Pago')
  await axe(page)

  await page.getByRole('button', { name: 'Próxima' }).click()
  await expect(page).toHaveURL(/page=2/)
  await page.getByRole('button', { name: 'Presentes' }).click()
  await expect(page).toHaveURL(/filter=courtesy/)
  await expect(page).not.toHaveURL(/page=2/)
  await page.getByRole('button', { name: 'Todos' }).click()
  await page.getByRole('searchbox', { name: 'Buscar pelo código do pedido ou pelo e-mail' }).fill('#f4f4')
  await expect(page).toHaveURL(/q=%23f4f4/)
  await expect(page.getByRole('list', { name: 'Pedidos' }).getByRole('listitem')).toHaveCount(1)
  await page.getByRole('link', { name: 'Pedido F4F4F4F4' }).click()
  await expect(page).toHaveURL(new RegExp(`/pedidos/${PAID}$`))
  await page.getByRole('link', { name: 'Todos os pedidos' }).click()
  await expect(page).toHaveURL(/\/pedidos\?q=%23f4f4/)
  expect(calls.filter(call => call.path.startsWith('/admin/orders?')).length).toBeGreaterThan(3)
})

test('ficha: valores com cupom, jogos e downloads, linha do tempo, e-mails; reembolso exige o código e mostra o resultado', async ({ page }) => {
  const calls = await ordersApi(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/pedidos/${PAID}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Pedido F4F4F4F4' })).toBeVisible()
  const values = page.getByRole('region', { name: 'Valores' })
  await expect(values).toContainText(/R\$\s11,00/)
  await expect(values).toContainText(/R\$\s1,10, cupom PRIMEIRA10/)
  await expect(values).toContainText(/R\$\s9,90/)
  await expect(values.getByRole('link', { name: /pi_TESTE123/ })).toHaveAttribute('href', 'https://dashboard.stripe.com/payments/pi_TESTE123')
  await expect(page.getByRole('region', { name: /Jogos liberados/ })).toContainText('2 downloads depois do pagamento')
  await expect(page.getByRole('region', { name: 'Linha do tempo' })).toContainText('Pago, pelo aviso da Stripe')
  await expect(page.getByRole('link', { name: 'ana@example.test' })).toHaveAttribute('href', `/usuarios/${ANA}`)
  await expect(page.getByRole('button', { name: 'Conferir com a Stripe' })).toHaveCount(0)
  await axe(page)

  await page.getByRole('button', { name: 'Reenviar o e-mail de acesso' }).click()
  await expect(page.locator('.notice')).toHaveText('O e-mail de acesso do pedido F4F4F4F4 foi para a fila de envio.')
  expect(calls.some(call => call.method === 'POST' && call.path === `/admin/users/${ANA}/orders/${PAID}/resend`)).toBe(true)

  await page.getByRole('button', { name: /Reembolsar R\$/ }).click()
  const form = page.getByRole('form', { name: /Reembolsar R\$/ })
  await expect(form).toContainText('Não dá para desfazer.')
  const confirm = form.getByRole('button', { name: 'Reembolsar de vez' })
  await form.getByLabel('Motivo').fill('Pediu por e-mail')
  await form.getByLabel('Digite o código do pedido (F4F4F4F4) para confirmar').fill('F4F4')
  await expect(confirm).toBeDisabled()
  await form.getByLabel('Digite o código do pedido (F4F4F4F4) para confirmar').fill('#f4f4f4f4')
  await expect(confirm).toBeEnabled()
  await axe(page)
  await confirm.click()
  await expect(page.locator('.notice')).toHaveText('O pedido F4F4F4F4 foi reembolsado e o aviso está saindo.')
  await expect(page.locator('.notice')).toBeFocused()
  expect(calls.find(call => call.path === `/admin/orders/${PAID}/refund`)!.body).toEqual({ reason: 'Pediu por e-mail', confirm_ref: '#f4f4f4f4' })
  // A ficha volta reembolsada: sem as ações, com o aviso na lista de e-mails e o histórico.
  await expect(page.getByRole('heading', { level: 1, name: 'Pedido F4F4F4F4' })).toBeVisible()
  await expect(page.locator('.user-badges .badge').first()).toHaveText('Reembolsado')
  await expect(page.getByRole('region', { name: 'E-mails do pedido' })).toContainText('Aviso de reembolso')
  await expect(page.getByRole('region', { name: 'Histórico do admin' })).toContainText('Reembolsou o pedido: Pediu por e-mail')
  await expect(page.getByRole('button', { name: /Reembolsar/ })).toHaveCount(0)
})

test('ficha do pedido aberto: conferir com a Stripe pede o motivo e mostra o novo estado', async ({ page }) => {
  const calls = await ordersApi(page)
  await page.goto(`/pedidos/${OPEN}`)
  await expect(page.getByRole('region', { name: 'Valores' })).toContainText('Ainda não')
  await expect(page.getByRole('button', { name: /Reembolsar/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Conferir com a Stripe' }).click()
  const form = page.getByRole('form', { name: 'Conferir com a Stripe' })
  await form.getByLabel('Motivo').fill('Webhook não chegou')
  await form.getByRole('button', { name: 'Conferir agora' }).click()
  await expect(page.locator('.notice')).toHaveText('Conferido com a Stripe: o pedido está pago.')
  expect(calls.find(call => call.path === `/admin/orders/${OPEN}/reconcile`)!.body).toEqual({ reason: 'Webhook não chegou' })
})

test('celular: lista e ficha sem rolagem lateral, com o texto a 200%', async ({ page }) => {
  await ordersApi(page)
  await page.setViewportSize({ width: 390, height: 844 })
  for (const path of ['/pedidos', `/pedidos/${PAID}`]) {
    await page.goto(path)
    await expect(page.locator('h1')).toBeVisible()
    expect(await noSideScroll(page), path).toBe(true)
    await page.addStyleTag({ content: 'html { font-size: 200%; }' })
    expect(await noSideScroll(page), `${path} a 200%`).toBe(true)
  }
})
