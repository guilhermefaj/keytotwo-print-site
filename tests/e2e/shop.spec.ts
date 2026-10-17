import { expect, test, type Page } from './fixtures/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile, mkdir } from 'node:fs/promises'
import sharp from 'sharp'
import { builtStage } from './fixtures/stage'
import { authStorageKey } from './fixtures/session'

const stage = builtStage()
const single = { code: 'J001', kind: 'single', name: 'Rabisque e Adivinhe', games: [{ code: 'J001', name: 'Rabisque e Adivinhe' }], price: { unit_amount: 990, currency: 'brl' } }
const bundle = { ...single, code: 'P001', kind: 'bundle', name: 'Coleção KeyToTwo: Fundadores', price: { unit_amount: 1990, currency: 'brl' } }

async function catalog(page: Page, products = [single]) {
  await page.route('**/functions/v1/api/catalog', route => route.fulfill({ json: { products } }))
}

test('loja: pacote fora do catálogo fica em breve; jogos do pacote sem avulso ficam "No pacote"; só o avulso tem compra', async ({ page }) => {
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
  // Jogo do pacote sem avulso nunca aparece "Em breve": selo "No pacote" e o caminho até o pacote.
  for (const id of ['tabuleiro-da-sorte', 'o-sumico-de-rapadura']) {
    const card = page.locator(`[data-shop-game="${id}"]`)
    await expect(card.locator('.tag-solid')).toHaveText('No pacote')
    await expect(card.getByRole('link', { name: 'Ver o pacote: Coleção KeyToTwo: Fundadores', exact: true })).toHaveAttribute('href', '/loja/p001')
    await expect(card).not.toContainText('Em breve')
    // Cor do jogo: faixa sob a capa, vinda de games.ts.
    await expect(card.locator('.game-cover[data-accent]')).toHaveCount(1)
  }
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

test('freebies: quem já entrou não vê "Criar conta"', async ({ page }) => {
  test.skip(stage !== 'test', 'A seção de freebies só existe no stage test')
  const session = { access_token: 'synthetic-freebie-token', refresh_token: 'synthetic-freebie-refresh', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user: { id: 'qa-freebie', email: 'freebie@example.test', email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} } }
  await page.addInitScript(([key, value]) => localStorage.setItem(key, JSON.stringify(value)), [authStorageKey, session] as const)
  await page.route('**/auth/v1/**', route => route.fulfill({ json: session.user }))
  await page.route('**/functions/v1/api/**', route => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api/, '')
    const json = path === '/catalog' ? { products: [single] } : path === '/account' ? { email: session.user.email, marketing: { opted_in: false, prompted_at: '2026-01-01', text_version: null }, orders: [] } : path === '/free-game' ? { available: false } : path.startsWith('/cart') ? { version: 0, items: [], subtotal: null, warnings: [] } : { games: [], pending: [] }
    return route.fulfill({ json })
  })
  for (const path of ['/loja', '/']) {
    await page.goto(path)
    const freebies = page.locator('[data-shop-freebies]')
    await expect(freebies.locator('[data-shop-game="hora-dos-artistas"]')).toContainText('Grátis')
    // O HTML pré-renderizado traz o botão; ele precisa sumir quando a sessão é lida.
    await expect(freebies.getByRole('link', { name: 'Criar conta', exact: true })).toHaveCount(0)
  }
})

test('produto: preço vem do catálogo, compra preserva escolha e ausência não oferece compra', async ({ page }) => {
  await catalog(page)
  await page.goto('/loja/j001')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rabisque e Adivinhe')
  await expect(page.locator('main')).toContainText('Também está no pacote')
  await expect(page.locator('.shop-includes')).toContainText('O jogo completo em PDF para imprimir')
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
  // Jogos do pacote: apresentação e ficha, sem compra avulsa nem "Em breve" dentro da oferta.
  const included = page.locator('.shop-games [data-shop-game]')
  await expect(included).toHaveCount(3)
  await expect(page.locator('.shop-games').getByRole('button')).toHaveCount(0)
  await expect(page.locator('.shop-games')).not.toContainText('Em breve')
  await expect(page.locator('[data-shop-game="tabuleiro-da-sorte"] .ficha')).toContainText('Tabuleiro, perguntas e desafios')
  await expect(page.locator('[data-shop-game="o-sumico-de-rapadura"] .ficha')).toContainText('Escape room de papel')
})

test('página de produto: ficha no topo, capa, como é jogar, o que vocês precisam e o pacote', async ({ page }) => {
  const j003 = { ...single, code: 'J003', name: 'Tabuleiro da Sorte', games: [{ code: 'J003', name: 'Tabuleiro da Sorte' }], price: { unit_amount: 990, currency: 'brl' } }
  const j002 = { ...single, code: 'J002', name: 'O Sumiço de Rapadura', games: [{ code: 'J002', name: 'O Sumiço de Rapadura' }], price: { unit_amount: 1290, currency: 'brl' } }
  await catalog(page, [single, j003, j002])
  await page.goto('/loja/j001')
  await expect(page.locator('.product-facts dt')).toHaveText(['Pessoas', 'Jeito de jogar', 'Rodadas', 'Formato'])
  // Nenhuma página do PDF no site (responsável, 2026-10-16): o avulso mostra só a capa, e a URL antiga não serve imagem.
  await expect(page.locator('.product-gallery-main img')).toHaveAttribute('src', '/media/games/j001-capa-640.webp')
  await expect(page.locator('.product-gallery-thumbs')).toHaveCount(0)
  await expect(page.locator('img[src*="j001-page"]')).toHaveCount(0)
  for (const n of [1, 2, 3]) expect((await page.request.get(`/media/experience/j001-page-${n}-720.webp`)).headers()['content-type'] ?? '').not.toContain('image')
  await expect(page.locator('.moments-list li')).toHaveCount(3)
  await expect(page.locator('.needs-list li')).toHaveCount(5)
  await expect(page.locator('.product-package').getByRole('link', { name: 'Ver o pacote: Coleção KeyToTwo: Fundadores', exact: true })).toHaveAttribute('href', '/loja/p001')
  await expect(page.locator('.product-package')).not.toContainText('R$')
  // Tabuleiro e Rapadura também se vendem sozinhos (responsável, 2026-10-16); só a capa, como em todo avulso.
  for (const [slug, price] of [['j003', '9,90'], ['j002', '12,90']]) {
    await page.goto(`/loja/${slug}`)
    if (stage !== 'preview') await expect(page.locator('.shop-purchase .shop-price')).toContainText(price)
    await expect(page.locator('.product-gallery-thumbs')).toHaveCount(0)
    await expect(page.locator('.product-gallery-main img')).toHaveAttribute('src', `/media/games/${slug}-capa-640.webp`)
    await expect(page.locator('.moments-list li')).toHaveCount(3)
  }
  await page.goto('/loja/p001')
  await expect(page.getByRole('list', { name: 'Imagens do produto' }).getByRole('button')).toHaveCount(4)
  await expect(page.locator('.product-facts')).toHaveCount(0)
  await expect(page.locator('.needs-list li')).toHaveCount(11)
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
  for (const [route, title] of [['loja', 'Loja'], ['loja/p001', 'Coleção KeyToTwo: Fundadores'], ['loja/j001', 'Rabisque e Adivinhe']]) {
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
