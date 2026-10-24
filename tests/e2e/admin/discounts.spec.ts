import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync } from 'node:fs'
import { authStorageKey, session } from './session'

// Cupons e parceiros no admin (2026-10-24): a lista de cupons com as regras, o uso e as ações; o cupom novo; os
// parceiros com o link, a comissão e os números; a ficha com o repasse e a planilha. A API é simulada (formatos de
// docs/api-contract.md 6.18).
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test.skip(() => !existsSync('admin/dist/index.html'), 'Requires `npm run build:admin`')

const PARTNER = '4d5e6f7a-8b9c-4d0e-9f1a-3b4c5d6e7f80'
const ANA = { id: PARTNER, slug: 'ana-souza', name: 'Ana Souza' }
const stats = (orders = 0) => ({ orders, revenue: orders * 891, discount: orders * 99 })
const discount = (code: string, over: Record<string, unknown> = {}) => ({
  id: `0000000${code.length}-0000-4000-8000-${code.padEnd(12, '0').slice(0, 12).replace(/[^0-9a-f]/gi, '0')}`, code, percent_off: 10, product_codes: null,
  starts_at: null, ends_at: null, max_redemptions: null, first_time_only: false, minimum_amount: null, campaign: null, banner: null, partner: null,
  state: 'active', effective_state: 'active', created_at: '2026-10-24T12:00:00Z', stats: stats(), ...over,
})
const partnerRow = { ...ANA, handle: '@anasouza', contact: null, commission_percent: 12.5, status: 'active', notes: null, created_at: '2026-10-01T12:00:00Z', visits_30d: 40, orders: 3, revenue: 2673, codes: ['ANA10'] }

type Call = { method: string; path: string; body: unknown }
async function discountsApi(page: Page) {
  const calls: Call[] = []
  await page.addInitScript(([key, value]) => localStorage.setItem(key, JSON.stringify(value)), [authStorageKey, session('aal2')] as const)
  await page.route('**/auth/v1/**', route => route.fulfill({ json: session('aal2').user }))
  await page.route('**/functions/v1/api/admin/**', route => {
    const request = route.request()
    const path = new URL(request.url()).pathname.split('/api')[1] + new URL(request.url()).search
    const method = request.method()
    const body = method === 'POST' ? request.postDataJSON() : null
    calls.push({ method, path, body })
    if (path === '/admin/alerts') return route.fulfill({ json: { open: [], resolved: [] } })
    if (path === '/admin/discounts' && method === 'GET') {
      return route.fulfill({ json: {
        discounts: [
          discount('PRIMEIRA10', { first_time_only: true, banner: 'Primeira compra? Usem o cupom {cupom} no pagamento e ganhem 10% de desconto.', stats: stats(5) }),
          discount('ANA10', { partner: ANA, stats: stats(2) }),
          discount('NATAL26', { percent_off: 20, product_codes: ['P001'], starts_at: '2026-12-01T03:00:00Z', ends_at: '2026-12-26T02:59:59Z', state: 'scheduled', effective_state: 'scheduled', campaign: 'Natal 2026' }),
          discount('VELHO5', { state: 'ended', effective_state: 'ended' }),
        ],
        partners: [{ ...ANA, status: 'active' }],
        products: [{ code: 'P001', name: 'Coleção KeyToTwo: Fundadores', stripe_product: 'prod_P001' }, { code: 'J001', name: 'Rabisque e Adivinhe', stripe_product: 'prod_J001' }],
      } })
    }
    if (path === '/admin/discounts') return route.fulfill({ status: 201, json: { id: 'novo', state: 'scheduled' } })
    if (path === '/admin/partners' && method === 'GET') return route.fulfill({ json: { partners: [partnerRow] } })
    if (path === '/admin/partners') return route.fulfill({ status: 201, json: { id: 'novo' } })
    if (path === `/admin/partners/${PARTNER}` && method === 'GET') {
      return route.fulfill({ json: {
        partner: { id: PARTNER, slug: 'ana-souza', name: 'Ana Souza', handle: '@anasouza', contact: 'ana@example.test', commission_percent: 12.5, status: 'active', notes: null, created_at: '2026-09-01T12:00:00Z' },
        months: [
          { month: '2026-10-01', orders: 1, revenue: 891, commission: 111, closed: false, payout: null },
          { month: '2026-09-01', orders: 2, revenue: 1782, commission: 223, closed: true, payout: null },
        ],
        visits: { last_30_days: 40, total: 95 },
        discounts: [discount('ANA10', { partner: ANA, stats: stats(2) })],
        orders: [{ id: 'f4f4f4f4-0000-4000-8000-000000000001', ref: 'F4F4F4F4', paid_at: '2026-10-21T10:00:00Z', amount_total: 891, promotion_code: 'ANA10', source: 'code' }],
      } })
    }
    if (path.startsWith(`/admin/partners/${PARTNER}/export`)) return route.fulfill({ body: '﻿Pedido;Total\r\n', headers: { 'Content-Type': 'text/csv; charset=utf-8' } })
    return route.fulfill({ json: { ok: true, amount: 223, state: 'paused' } })
  })
  return calls
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(n => n.target) }))).toEqual([])
}

test('cupons: regras, uso e faixa; pausar pede o motivo; o cupom novo vai com as regras para a API', async ({ page }) => {
  const calls = await discountsApi(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/cupons')
  await expect(page.getByRole('heading', { level: 1, name: 'Cupons e parceiros' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Seções do admin' }).getByRole('link', { name: 'Cupons e parceiros' })).toHaveAttribute('aria-current', 'page')
  const rows = page.getByRole('list', { name: 'Cupons', exact: true }).getByRole('listitem')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('10% em tudo · sem prazo · só na primeira compra')
  await expect(rows.nth(0)).toContainText('5 vendas')
  await expect(rows.nth(0)).toContainText('Faixa do topo: “Primeira compra? Usem o cupom PRIMEIRA10 no pagamento')
  await expect(rows.nth(1).getByRole('link', { name: 'Ana Souza' })).toHaveAttribute('href', `/cupons/parceiros/${PARTNER}`)
  await expect(rows.nth(2)).toContainText('20% em P001 · de 01 de dez. de 2026 a 25 de dez. de 2026')
  await expect(rows.nth(2)).toContainText('Agendado')
  await expect(page.getByRole('list', { name: 'Cupons encerrados' }).getByRole('listitem')).toHaveCount(1)
  await axe(page)

  await rows.nth(1).getByRole('button', { name: 'Pausar ANA10' }).click()
  await page.getByLabel('Motivo').fill('Fim da parceria de outubro')
  await page.getByRole('button', { name: 'Pausar', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'pausado' })).toHaveText('ANA10 foi pausado.')
  expect(calls.find(call => call.path.endsWith('/state'))!.body).toEqual({ state: 'paused', reason: 'Fim da parceria de outubro' })

  await page.getByRole('button', { name: 'Novo cupom' }).click()
  const create = page.getByRole('button', { name: 'Criar o cupom' })
  await page.getByLabel('Código').fill('black26')
  await page.getByLabel('Desconto, em %').fill('30')
  await page.getByLabel('Começa em').fill('2026-11-27')
  await page.getByLabel('Termina em').fill('2026-12-01')
  await page.getByLabel('Campanha').fill('Black Friday 2026')
  await page.getByLabel('Faixa do topo da loja').fill('Black Friday: 30% em tudo')
  await expect(create).toBeDisabled()
  await page.getByLabel('Faixa do topo da loja').fill('Black Friday: 30% em tudo com o cupom {cupom}.')
  await page.getByLabel('Motivo').fill('Black Friday')
  await axe(page)
  await create.click()
  await expect(page.getByRole('status').filter({ hasText: 'BLACK26' })).toHaveText('BLACK26 foi criado e começa a valer no dia do início.')
  expect(calls.find(call => call.method === 'POST' && call.path === '/admin/discounts')!.body).toEqual({
    code: 'BLACK26', percent_off: 30, product_codes: null, starts_at: '2026-11-27T00:00:00-03:00', ends_at: '2026-12-01T23:59:59-03:00',
    max_redemptions: null, minimum_amount: null, first_time_only: false, campaign: 'Black Friday 2026', partner: null,
    banner: 'Black Friday: 30% em tudo com o cupom {cupom}.', reason: 'Black Friday',
  })
})

test('parceiros: lista com o link e os números; cadastro; ficha com repasse do mês fechado e a planilha', async ({ page }) => {
  const calls = await discountsApi(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/cupons/parceiros')
  const row = page.getByRole('list', { name: 'Parceiros' }).getByRole('listitem')
  await expect(row).toContainText('@anasouza · 12,5% de comissão · cupom ANA10')
  await expect(row).toContainText('40 visitas em 30 dias · 3 vendas')
  await axe(page)

  await page.getByRole('button', { name: 'Novo parceiro' }).click()
  await page.getByLabel('Nome').fill('Bia Lima')
  await page.getByLabel('Apelido do link').fill('Bia Lima!')
  await expect(page.getByText(/O link fica .*\/\?p=bialima/)).toBeVisible()
  await page.getByLabel('Apelido do link').fill('bia-lima')
  await page.getByLabel('Comissão, em %').fill('0')
  await page.getByLabel('Motivo').fill('Amiga do casal')
  await page.getByRole('button', { name: 'Cadastrar' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Bia Lima' })).toContainText('Bia Lima foi cadastrado. O link é')
  expect(calls.find(call => call.method === 'POST' && call.path === '/admin/partners')!.body).toEqual({
    slug: 'bia-lima', name: 'Bia Lima', handle: null, contact: null, commission_percent: 0, status: 'active', notes: null, reason: 'Amiga do casal',
  })

  await row.getByRole('link', { name: 'Ana Souza' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Ana Souza' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Cadastro' })).toContainText(/\/\?p=ana-souza/)
  const months = page.getByRole('region', { name: 'Vendas e comissão por mês' })
  await expect(months.getByRole('row').nth(1)).toContainText('outubro de 2026 · em andamento')
  await expect(months.getByRole('row').nth(1)).toContainText('O mês ainda não fechou')
  await expect(page.getByRole('region', { name: /Últimas vendas/ })).toContainText('pelo cupom ANA10')
  await axe(page)

  const download = page.waitForEvent('download')
  await months.getByRole('row').nth(2).getByRole('button', { name: 'Baixar planilha' }).click()
  expect((await download).suggestedFilename()).toBe('parceiro-ana-souza-2026-09.csv')
  await months.getByRole('button', { name: 'Marcar setembro de 2026 como pago' }).click()
  await page.getByLabel('Motivo').fill('Pix de setembro')
  await page.getByRole('button', { name: 'Marcar como pago', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'pago' })).toHaveText('setembro de 2026 ficou como pago.')
  expect(calls.find(call => call.path.endsWith('/payouts'))!.body).toEqual({ month: '2026-09', reason: 'Pix de setembro' })
})

test('celular: cupons, parceiros e a ficha sem rolagem lateral, com o texto a 200%', async ({ page }) => {
  await discountsApi(page)
  await page.setViewportSize({ width: 390, height: 844 })
  const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
  for (const path of ['/cupons', '/cupons/parceiros', `/cupons/parceiros/${PARTNER}`]) {
    await page.goto(path)
    await expect(page.locator('h1')).toBeVisible()
    expect(await noSideScroll(), path).toBe(true)
    await page.addStyleTag({ content: 'html { font-size: 200%; }' })
    expect(await noSideScroll(), `${path} a 200%`).toBe(true)
  }
})
