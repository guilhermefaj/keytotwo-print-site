import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync } from 'node:fs'
import { authStorageKey, session } from './session'

// Atenção no admin (2026-10-24): o número de alertas abertos na barra lateral e nas Métricas; a lista com o que fazer
// e os links; resolver à mão com motivo; os do sistema só fecham sozinhos. A API é simulada (docs/api-contract.md 6.16).
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test.skip(() => !existsSync('admin/dist/index.html'), 'Requires `npm run build:admin`')

const ORDER = 'f4f4f4f4-0000-4000-8000-000000000004'
const ANA = 'a1a1a1a1-0000-4000-8000-000000000001'

const alert = (id: number, kind: string, over: Record<string, unknown> = {}) => ({
  id, kind, details: {}, opened_at: '2026-10-24T13:00:00Z', order_id: null, order_ref: null, order_status: null, livemode: null,
  user_id: null, resolved_at: null, resolution: null, resolved_by: null, manual: kind !== 'backup_late' && kind !== 'email_queue_stuck', ...over,
})
const DISPUTE = alert(7, 'dispute', {
  order_id: ORDER, order_ref: 'F4F4F4F4', order_status: 'disputed', livemode: true, user_id: ANA,
  details: { dispute_id: 'dp_TESTE', due_by: '2026-11-03T12:00:00+00:00', amount: 2990, currency: 'brl' },
})
const BACKUP = alert(8, 'backup_late', { details: { last_finished_at: '2026-10-23T06:30:00Z' } })
const CLOSED = alert(3, 'order_stuck', { order_id: ORDER, order_ref: 'F4F4F4F4', resolved_at: '2026-10-24T12:00:00Z', resolution: 'auto' })

const metrics = { days: 7, since: '2026-10-18', until: '2026-10-24', livemode: true, sales: { orders: 0, revenue: 0, currency: 'brl' }, accounts: 0,
  funnel: { cart: 0, checkout: 0, paid: 0 }, downloads: { paid: 0, free: 0 }, free_unlocks: 0, newsletter: { subscribed: 0 },
  daily: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${18 + i}`, orders: 0, revenue: 0, accounts: 0 })),
  marketing: { codes: [], partners: [], campaigns: [] } }

type Call = { method: string; path: string; body: unknown }
async function alertsApi(page: Page, open = [DISPUTE, BACKUP]) {
  const calls: Call[] = []
  let current = { open, resolved: [CLOSED] }
  await page.addInitScript(([key, value]) => localStorage.setItem(key, JSON.stringify(value)), [authStorageKey, session('aal2')] as const)
  await page.route('**/auth/v1/**', route => route.fulfill({ json: session('aal2').user }))
  await page.route('**/functions/v1/api/admin/**', route => {
    const request = route.request()
    const path = new URL(request.url()).pathname.split('/api')[1]
    calls.push({ method: request.method(), path, body: request.method() === 'POST' ? request.postDataJSON() : null })
    if (path === '/admin/alerts') return route.fulfill({ json: current })
    if (path === '/admin/alerts/7/resolve') {
      current = { open: current.open.filter(item => item.id !== 7), resolved: [{ ...DISPUTE, resolved_at: '2026-10-24T14:00:00Z', resolution: 'Provas enviadas na Stripe', resolved_by: 'admin@example.test' }, CLOSED] }
      return route.fulfill({ json: { resolved: true } })
    }
    return route.fulfill({ json: metrics })
  })
  return calls
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(n => n.target) }))).toEqual([])
}

test('atenção: o número na barra lateral e o aviso nas Métricas levam à lista', async ({ page }) => {
  await alertsApi(page)
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Seções do admin' })
  await expect(nav.getByRole('link', { name: 'Atenção 2 abertos' })).toBeVisible()
  // Nas Métricas, os abertos em destaque, com o título de cada um (revisão de UX, 2026-10-31).
  const callout = page.getByRole('region', { name: '2 alertas precisam de atenção' })
  await expect(callout.getByRole('listitem')).toHaveCount(2)
  await callout.getByRole('link', { name: 'Ver em Atenção' }).click()
  await expect(page).toHaveURL(/\/atencao$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Atenção' })).toBeVisible()
  await expect(nav.getByRole('link', { name: /^Atenção/ })).toHaveAttribute('aria-current', 'page')
})

test('atenção: o que fazer e os links de cada alerta; os do sistema fecham sozinhos; resolver pede o motivo', async ({ page }) => {
  const calls = await alertsApi(page)
  await page.goto('/atencao')
  const open = page.getByRole('region', { name: 'Abertos 2' })
  const dispute = open.getByRole('listitem').filter({ hasText: 'Contestação no pedido F4F4F4F4' })
  await expect(dispute).toContainText('R$ 29,90. Mande as provas na Stripe até 03 de nov., 09:00.')
  await expect(dispute.getByRole('link', { name: 'Ver o pedido' })).toHaveAttribute('href', `/pedidos/${ORDER}`)
  await expect(dispute.getByRole('link', { name: 'Ver a conta' })).toHaveAttribute('href', `/usuarios/${ANA}`)
  await expect(dispute.getByRole('link', { name: /Abrir na Stripe/ })).toHaveAttribute('href', 'https://dashboard.stripe.com/disputes/dp_TESTE')
  const backup = open.getByRole('listitem').filter({ hasText: 'Backup atrasado' })
  await expect(backup).toContainText('Fecha sozinho')
  await expect(backup.getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('region', { name: /Resolvidos/ })).toContainText('Pedido F4F4F4F4 parado')
  await expect(page.getByRole('region', { name: /Resolvidos/ })).toContainText('fechou sozinho')
  await axe(page)

  await dispute.getByRole('button', { name: 'Marcar como resolvido: Contestação no pedido F4F4F4F4' }).click()
  await page.getByRole('button', { name: 'Resolver' }).click()
  await expect(page.getByRole('alert')).toHaveText('Escreva o motivo, de 3 a 300 caracteres. Ele fica no histórico.')
  await page.getByLabel('Motivo').fill('Provas enviadas na Stripe')
  await page.getByRole('button', { name: 'Resolver' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'resolvido' })).toHaveText('Contestação no pedido F4F4F4F4: resolvido.')
  await expect(page.getByRole('region', { name: 'Abertos 1' })).toBeVisible()
  await expect(page.getByRole('region', { name: /Resolvidos/ })).toContainText('Provas enviadas na Stripe · admin@example.test')
  await expect(page.getByRole('navigation', { name: 'Seções do admin' }).getByRole('link', { name: 'Atenção 1 aberto' })).toBeVisible()
  expect(calls.find(call => call.method === 'POST')).toEqual({ method: 'POST', path: '/admin/alerts/7/resolve', body: { reason: 'Provas enviadas na Stripe' } })
})

test('atenção: sem alertas abertos, nada na barra lateral nem nas Métricas', async ({ page }) => {
  await alertsApi(page, [])
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Métricas' })).toBeVisible()
  await expect(page.getByRole('link', { name: /precisa/ })).toHaveCount(0)
  await page.getByRole('navigation', { name: 'Seções do admin' }).getByRole('link', { name: 'Atenção', exact: true }).click()
  await expect(page.getByText('Nada precisa de atenção agora.')).toBeVisible()
  await axe(page)
})

test('atenção: os alertas do Plunk (2026-11-01) dizem o que parou e fecham sozinhos', async ({ page }) => {
  const system = (id: number, kind: string, details: Record<string, unknown>) => alert(id, kind, { details, manual: false })
  await alertsApi(page, [
    system(11, 'site_down', { target: 'plunk', since: '2026-11-01T20:05:00Z', error: 'sem conexão' }),
    system(12, 'marketing_sync_stuck', { count: 3, since: '2026-11-01T18:00:00Z', error: 'plunk_contacts_http_502' }),
    system(13, 'plunk_backup_late', { last_finished_at: '2026-10-31T06:31:00Z' }),
  ])
  await page.goto('/atencao')
  const open = page.getByRole('region', { name: 'Abertos 3' })
  const item = (title: string) => open.getByRole('listitem').filter({ hasText: title })
  await expect(item('Plunk fora do ar')).toContainText('(sem conexão): os e-mails de acesso aos jogos e as novidades não saem.')
  await expect(item('Inscrições sem chegar ao Plunk')).toContainText('3 pessoas que aceitaram os e-mails estão há mais de 1 hora sem chegar ao Plunk (plunk_contacts_http_502)')
  await expect(item('Backup do Plunk atrasado')).toContainText('Confira o backup.log na VPS.')
  for (const title of ['Plunk fora do ar', 'Inscrições sem chegar ao Plunk', 'Backup do Plunk atrasado']) {
    await expect(item(title)).toContainText('Fecha sozinho')
    await expect(item(title).getByRole('button')).toHaveCount(0)
  }
  await axe(page)
})
