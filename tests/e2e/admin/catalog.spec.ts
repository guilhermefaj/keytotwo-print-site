import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync } from 'node:fs'
import { authStorageKey, session } from './session'

// Catálogo no admin (2026-10-24): a lista com a situação, o preço da Stripe e o riscado, os jogos com a versão do PDF;
// a ficha troca o preço, o riscado, pausa e monta o pacote (com o presente para quem já tem). A API é simulada
// (formatos de docs/api-contract.md 6.17).
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test.skip(() => !existsSync('admin/dist/index.html'), 'Requires `npm run build:admin`')

const product = (code: string, over: Record<string, unknown> = {}) => ({
  code, name: code === 'P001' ? 'Coleção KeyToTwo: Fundadores' : `Jogo ${code}`, kind: code === 'P001' ? 'bundle' : 'single', slug: code.toLowerCase(),
  status: 'active', ready: true, sellable: true, stripe_price_id: `price_${code}`, games_expected: code === 'P001' ? 3 : 1,
  price: { unit_amount: code === 'P001' ? 2990 : 990, currency: 'brl' }, list_price: null,
  games: code === 'P001' ? [{ code: 'J001', name: 'Rabisque e Adivinhe', position: 1 }, { code: 'J003', name: 'Tabuleiro da Sorte', position: 2 }, { code: 'J002', name: 'O Sumiço de Rapadura', position: 3 }]
    : [{ code, name: `Jogo ${code}`, position: 1 }],
  paid_orders: 4, owners: 3, history: [], ...over,
})
const game = (code: string, over: Record<string, unknown> = {}) => ({
  code, name: `Jogo ${code}`, access: 'paid', status: 'published', file: { version: '1.0', filename: `${code}.pdf`, size_bytes: 1000, published_at: '2026-10-23T23:30:00Z' },
  single: code, packs: ['J001', 'J002', 'J003'].includes(code) ? ['P001'] : [], ...over,
})

type Call = { method: string; path: string; body: unknown }
async function catalogApi(page: Page) {
  const calls: Call[] = []
  let products = [
    product('P001', { list_price: { amount: 3990, label: 'Preço de lançamento' }, history: [{ action: 'product_price', created_at: '2026-10-24T12:00:00Z', by: 'admin@example.test', details: { reason: 'Lançamento' } }] }),
    product('J001'), product('J006', { status: 'archived', sellable: false }),
  ]
  await page.addInitScript(([key, value]) => localStorage.setItem(key, JSON.stringify(value)), [authStorageKey, session('aal2')] as const)
  await page.route('**/auth/v1/**', route => route.fulfill({ json: session('aal2').user }))
  await page.route('**/catalogo/versao.json', route => route.fulfill({ json: { version: 'a'.repeat(32) } }))
  await page.route('**/functions/v1/api/admin/**', route => {
    const request = route.request()
    const path = new URL(request.url()).pathname.split('/api')[1]
    const method = request.method()
    const body = method === 'POST' ? request.postDataJSON() : null
    calls.push({ method, path, body })
    if (path === '/admin/alerts') return route.fulfill({ json: { open: [], resolved: [] } })
    if (path === '/admin/catalog') {
      return route.fulfill({ json: { version: 'a'.repeat(32), livemode: true, products, games: [game('J001'), game('J002'), game('J003'), game('J006', { file: { version: '1.1', filename: 'J006.pdf', size_bytes: 1, published_at: null } })] } })
    }
    if (path === '/admin/products/P001/price') products = products.map(item => (item.code === 'P001' ? { ...item, price: { unit_amount: body.amount, currency: 'brl' } } : item))
    if (path === '/admin/products/P001/games') return route.fulfill({ json: { added: true, gifted: 2, emails_queued: 2 } })
    return route.fulfill({ json: { ok: true } })
  })
  return calls
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(n => n.target) }))).toEqual([])
}

test('catálogo: situação, preço com o riscado, pacote e os jogos com a versão do PDF; a loja em dia', async ({ page }) => {
  await catalogApi(page)
  await page.goto('/catalogo')
  await expect(page.getByRole('heading', { level: 1, name: 'Catálogo' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Seções do admin' }).getByRole('link', { name: 'Catálogo' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('status').filter({ hasText: 'em dia' })).toHaveText('A loja está em dia com o catálogo.')
  const rows = page.getByRole('list', { name: 'Produtos' }).getByRole('listitem')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('Pacote com 3 jogos')
  await expect(rows.nth(0)).toContainText('À venda')
  await expect(rows.nth(0).locator('.plain-row-amount')).toHaveText(/De R\$\s39,90 por\s+R\$\s29,90/)
  await expect(rows.nth(2)).toContainText('Pausado')
  const games = page.getByRole('region', { name: 'Jogos e PDFs' })
  await expect(games.getByRole('row').filter({ hasText: 'J006' })).toContainText('Versão 1.1')
  await axe(page)
})

test('ficha: trocar o preço, o riscado, montar o pacote com presente e pausar pedem o motivo', async ({ page }) => {
  const calls = await catalogApi(page)
  await page.goto('/catalogo/P001')
  await expect(page.getByRole('heading', { level: 1, name: 'Coleção KeyToTwo: Fundadores' })).toBeVisible()
  await expect(page.getByRole('link', { name: /price_P001/ })).toHaveAttribute('href', 'https://dashboard.stripe.com/prices/price_P001')
  await expect(page.getByRole('region', { name: 'Histórico do admin' })).toContainText('Trocou o preço: Lançamento · admin@example.test')

  await page.getByRole('button', { name: 'Trocar o preço' }).click()
  const confirm = page.getByRole('button', { name: 'Trocar o preço', exact: true }).last()
  await page.getByLabel('Preço novo, em reais').fill('29,90')
  await expect(confirm).toBeDisabled()
  await page.getByLabel('Preço novo, em reais').fill('34,90')
  await page.getByLabel('Motivo').fill('Reajuste de lançamento')
  await confirm.click()
  await expect(page.getByRole('status').filter({ hasText: 'O preço agora' })).toHaveText('O preço agora é R$ 34,90. A loja atualiza em 1 ou 2 minutos.')
  expect(calls.find(call => call.path === '/admin/products/P001/price')!.body).toEqual({ amount: 3490, reason: 'Reajuste de lançamento' })

  await page.getByRole('button', { name: 'Tirar o preço riscado' }).click()
  await page.getByLabel('Motivo').fill('Fim da promoção')
  await page.getByRole('button', { name: 'Tirar', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'riscado' })).toBeVisible()
  expect(calls.find(call => call.path === '/admin/products/P001/list-price')!.body).toEqual({ amount: null, reason: 'Fim da promoção' })

  await page.getByRole('button', { name: 'Pôr um jogo no pacote' }).click()
  await page.getByLabel('Jogo', { exact: true }).selectOption('J006')
  await expect(page.getByText('não tem o avulso à venda')).toBeVisible()
  await page.getByLabel('Motivo').fill('Jogo novo na coleção')
  await page.getByRole('button', { name: 'Pôr no pacote' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'entrou no pacote' })).toContainText('Jogo J006 entrou no pacote e foi de presente para 2 pessoas')
  expect(calls.find(call => call.path === '/admin/products/P001/games')!.body).toEqual({ game: 'J006', gift: false, notify: false, reason: 'Jogo novo na coleção' })

  await page.getByRole('button', { name: 'Tirar do pacote: Tabuleiro da Sorte' }).click()
  await page.getByLabel('Motivo').fill('Saiu da coleção')
  await page.getByRole('button', { name: 'Tirar', exact: true }).click()
  expect(calls.some(call => call.path === '/admin/products/P001/games/J003/remove')).toBe(true)

  await page.getByRole('button', { name: 'Pausar a venda' }).click()
  await page.getByLabel('Motivo').fill('Revisão das capas')
  await page.getByRole('button', { name: 'Pausar', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'pausada' })).toBeVisible()
  expect(calls.find(call => call.path === '/admin/products/P001/status')!.body).toEqual({ status: 'archived', reason: 'Revisão das capas' })
  await axe(page)
})
