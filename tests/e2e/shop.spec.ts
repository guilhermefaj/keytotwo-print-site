import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile, mkdir } from 'node:fs/promises'
import sharp from 'sharp'
import { builtStage } from './fixtures/stage'

const stage = builtStage()
const single = { code: 'J001', kind: 'single', name: 'Rabisque e Adivinhe', games: [{ code: 'J001', name: 'Rabisque e Adivinhe' }], price: { unit_amount: 990, currency: 'brl' } }
const bundle = { ...single, code: 'P001', kind: 'bundle', name: 'Pacote KeyToTwo', price: { unit_amount: 1990, currency: 'brl' } }

async function catalog(page: Page, products = [single]) {
  await page.route('**/functions/v1/api/catalog', route => route.fulfill({ json: { products } }))
}

test('loja: pacote e jogos sem produto ficam em breve; apenas o avulso disponível tem compra e detalhes', async ({ page }) => {
  await catalog(page)
  await page.goto('/loja')
  await expect(page.getByRole('heading', { name: 'Loja', exact: true })).toBeVisible()
  const pack = page.locator('[data-shop-product="P001"]')
  await expect(pack).toContainText('Pacote de jogos')
  await expect(pack.locator('.shop-bundle-games li')).toHaveText(['Rabisque e Adivinhe', 'Tabuleiro da Sorte', 'O Sumiço de Rapadura'])
  await expect(pack).toContainText('Em breve')
  await expect(pack.getByRole('link')).toHaveCount(0)
  // Jogos do pacote: só os disponíveis; capas oficiais no lugar da prévia do PDF.
  const paid = page.locator('.shop-games [data-shop-game]')
  await expect(paid).toHaveCount(3)
  await expect(page.locator('[data-shop-game="tabuleiro-da-sorte"]')).toContainText('Em breve')
  await expect(page.locator('[data-shop-game="o-sumico-de-rapadura"]')).toContainText('Em breve')
  await expect(page.locator('.shop-games .game-cover-art img')).toHaveCount(3)
  await expect(page.locator('[data-shop-game] img[src*="/media/experience/j001-page"]')).toHaveCount(0)
  // Freebies: Hora dos Artistas grátis e o segundo em preparação; a seção só existe no stage test.
  const freebies = page.locator('[data-shop-freebies]')
  if (stage === 'test') {
    await expect(freebies.locator('[data-shop-game]')).toHaveCount(2)
    await expect(freebies.locator('[data-shop-game="hora-dos-artistas"]')).toContainText('Grátis')
    await expect(freebies.getByRole('link', { name: 'Criar conta', exact: true })).toHaveAttribute('href', '/entrar')
    await expect(freebies.locator('[data-shop-game="freebie-2"] .game-cover-soon')).toHaveText('Em breve')
  } else {
    await expect(freebies).toHaveCount(0)
  }
  const details = page.getByRole('link', { name: 'Ver detalhes: Rabisque e Adivinhe', exact: true })
  if (stage === 'preview') {
    await expect(details).toHaveCount(0)
    await expect(page.locator('main')).not.toContainText('R$')
  } else {
    await expect(details).toHaveAttribute('href', '/loja/j001')
    await expect(page.locator('[data-shop-game="rabisque-e-adivinhe"] .shop-price')).toContainText('9,90')
    await expect(page.getByRole('button', { name: 'Adicionar à sacola: Rabisque e Adivinhe', exact: true })).toBeEnabled()
    await details.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/loja\/j001$/)
  }
})

test('produto: preço vem do catálogo, compra preserva escolha e ausência não oferece compra', async ({ page }) => {
  await catalog(page)
  await page.goto('/loja/j001')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rabisque e Adivinhe')
  await expect(page.locator('main')).toContainText('Também está no pacote')
  await expect(page.locator('.shop-includes')).toContainText('PDF de 4 páginas A4')
  if (stage === 'preview') {
    await expect(page.locator('.shop-purchase')).toContainText('Em breve')
    await expect(page.locator('.shop-purchase button')).toHaveCount(0)
  } else {
    const buy = page.getByRole('button', { name: 'Adicionar à sacola', exact: true })
    await expect(buy).toBeEnabled()
    await buy.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/entrar\?next=%2Fcarrinho&add=J001$/)
  }
  await page.goto('/loja/p001')
  await expect(page.locator('.shop-purchase')).toContainText('Em breve')
  await expect(page.locator('.shop-purchase button')).toHaveCount(0)
})

test('produto listado sem preço não oferece compra; falha permite retry', async ({ page }) => {
  test.skip(stage === 'preview', 'Preview não consulta disponibilidade comercial na tela')
  let fail = true
  await page.route('**/functions/v1/api/catalog', route => fail
    ? route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR' } } })
    : route.fulfill({ json: { products: [{ ...single, price: null }] } }))
  await page.goto('/loja/j001')
  await expect(page.locator('.shop-purchase [role="alert"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Adicionar à sacola' })).toHaveCount(0)
  fail = false
  await page.getByRole('button', { name: 'Tentar novamente' }).click()
  await expect(page.locator('.shop-purchase')).toContainText('Não conseguimos carregar o preço.')
  await expect(page.getByRole('button', { name: 'Adicionar à sacola' })).toHaveCount(0)
})

test('carregamento não antecipa preço nem compra', async ({ page }) => {
  test.skip(stage === 'preview', 'Preview sem catálogo remoto')
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/functions/v1/api/catalog', async route => { await gate; await route.fulfill({ json: { products: [] } }) })
  await page.goto('/loja/j001')
  try {
    await expect(page.locator('.shop-purchase [role="status"]')).toContainText('Consultando disponibilidade…')
    await expect(page.locator('.shop-purchase button')).toHaveCount(0)
    await expect(page.locator('.shop-price')).toHaveCount(0)
  } finally { release() }
  await expect(page.locator('.shop-purchase')).toContainText('Em breve')
})

test('slugs sem produto e desconhecidos usam a 404 existente', async ({ page }) => {
  for (const slug of ['inexistente', 'hora-dos-artistas', 'tabuleiro-da-sorte', 'jogo-4', 'jogo-5']) {
    await page.goto(`/loja/${slug}`)
    await expect(page.getByRole('heading', { name: 'Página não encontrada', exact: true })).toBeVisible()
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
  }
})

test('prerender e SEO: loja e produtos confirmados, sem páginas das vagas', async () => {
  for (const [route, title] of [['loja', 'Loja'], ['loja/p001', 'Pacote KeyToTwo'], ['loja/j001', 'Rabisque e Adivinhe']]) {
    const html = await readFile(`build/client/${route}/index.html`, 'utf8')
    expect(html).toContain(`<title>${title} — KeyToTwo</title>`)
    expect(html).toContain(`<h1>${title}</h1>`)
    expect(html).not.toContain('Adicionar à sacola')
  }
  await expect(readFile('build/client/loja/hora-dos-artistas/index.html')).rejects.toThrow()
})

for (const width of [375, 1280]) test(`loja e detalhes: axe e capturas em ${width}`, async ({ page }) => {
  await catalog(page, [single, bundle])
  await page.setViewportSize({ width, height: 900 })
  for (const slug of ['', '/p001', '/j001']) {
    await page.goto(`/loja${slug}`)
    await page.evaluate(async () => { await document.fonts.ready })
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    expect(result.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([])
    if (process.env.SHOP_CAPTURE === '1') {
      await mkdir('design-review/loja', { recursive: true })
      await sharp(await page.screenshot({ fullPage: true, animations: 'disabled' })).webp({ quality: 85 }).toFile(`design-review/loja/${stage}-loja${slug.replace('/', '-')}-${width}.webp`)
    }
  }
})

test('loja e detalhes sem rolagem horizontal em 320–1440 e texto 200%', async ({ page }) => {
  await catalog(page, [single, bundle])
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const route of ['/loja', '/loja/p001', '/loja/j001']) {
      await page.goto(route)
      await page.addStyleTag({ content: 'html { font-size: 200%; }' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${route} em ${width}`).toBe(true)
    }
  }
})
