import { expect, test, type Page } from './fixtures/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile, mkdir } from 'node:fs/promises'
import sharp from 'sharp'
import { builtStage } from './fixtures/stage'

const stage = builtStage()
const single = { code: 'J001', kind: 'single', name: 'Rabisque e Adivinhe', games: [{ code: 'J001', name: 'Rabisque e Adivinhe' }], price: { unit_amount: 990, currency: 'brl' } }
// O riscado da promoção vem do /catalog (o admin define; 2026-10-24).
const bundle = { ...single, code: 'P001', kind: 'bundle', name: 'Coleção KeyToTwo: Fundadores', price: { unit_amount: 1990, currency: 'brl' }, list_price: { amount: 3990, label: 'Preço de lançamento' } }
// Produto lançado fora do /catalog (pausado no admin): "Indisponível no momento"; no preview, sem preço, "Em breve".
const unavailable = stage === 'preview' ? 'Em breve' : 'Indisponível no momento'

async function catalog(page: Page, products = [single]) {
  await page.route('**/functions/v1/api/catalog', route => route.fulfill({ json: { products } }))
  // Sacola de quem não entrou: a cotação devolve os produtos pedidos, com o preço do catálogo.
  await page.route('**/functions/v1/api/cart/quote', route => {
    const items = (route.request().postDataJSON().product_codes as string[]).map(code => products.find(product => product.code === code)).filter(Boolean)
      .map(product => ({ ...product!, status: 'ok', available: true, owned_games: [], included_in: [], shared_with: [], charge: product!.price }))
    const amount = items.reduce((sum, item) => sum + item.price.unit_amount, 0)
    return route.fulfill({ json: { version: 0, items, subtotal: items.length ? { amount, currency: 'brl' } : null, warnings: [], unknown: [] } })
  })
}

test('loja: pacote fora do catálogo fica indisponível; jogos do pacote sem avulso ficam "No pacote"; só o avulso tem compra', async ({ page }) => {
  await catalog(page)
  await page.goto('/loja')
  await expect(page.getByRole('heading', { name: 'Loja', exact: true })).toBeVisible()
  const pack = page.locator('[data-shop-product="P001"]')
  await expect(pack).toContainText('Pacote de jogos')
  await expect(pack.locator('.shop-bundle-games .pack-game-name')).toHaveText(['Rabisque e Adivinhe', 'Tabuleiro da Sorte', 'O Sumiço de Rapadura', 'A Rota da Fornalha', 'Retrospectiva a Dois'])
  await expect(pack.locator('.shop-bundle-games .pack-game-kind').first()).toHaveText('Desenho e adivinhação')
  await expect(pack).toContainText(unavailable)
  await expect(pack.getByRole('link')).toHaveCount(0)
  // Jogos do pacote: só os disponíveis; capas oficiais no lugar da prévia do PDF.
  const paid = page.locator('.shop-games [data-shop-game]')
  await expect(paid).toHaveCount(5)
  // Jogo do pacote sem avulso nunca aparece "Em breve": selo "No pacote" e o caminho até o pacote.
  for (const id of ['tabuleiro-da-sorte', 'o-sumico-de-rapadura', 'a-rota-da-fornalha', 'retrospectiva-a-dois']) {
    const card = page.locator(`[data-shop-game="${id}"]`)
    await expect(card.locator('.tag-solid')).toHaveText('No pacote')
    await expect(card.getByRole('link', { name: 'Ver o pacote: Coleção KeyToTwo: Fundadores', exact: true })).toHaveAttribute('href', '/loja/colecao-fundadores')
    await expect(card).not.toContainText('Em breve')
    // Capa oficial sem faixa de cor (2026-10-23) e o jeito de jogar, da ficha, sobre o nome.
    await expect(card.locator('.game-cover[data-accent]')).toHaveCount(0)
    await expect(card.locator('.shop-game-kind')).not.toBeEmpty()
  }
  await expect(page.locator('[data-shop-game="a-rota-da-fornalha"] .shop-game-kind')).toHaveText('Escape room de papel')
  await expect(page.locator('.shop-games [data-shop-game] .game-cover-art img')).toHaveCount(5)
  // Capas até 800 px: as folhas dos jogos pagos aparecem, mas não dão para usar.
  expect(await page.locator('.shop-games [data-shop-game] .game-cover-art img').first().getAttribute('srcset')).toMatch(/-capa-800\.webp 800w$/)
  await expect(page.locator('[data-shop-game] img[src*="/media/experience/j001-page"]')).toHaveCount(0)
  // Gratuitos: os dois jogos com o selo e o atalho para a página Gratuitos, em todos os stages.
  const freebies = page.locator('[data-shop-freebies]')
  await expect(freebies.locator('[data-shop-game]')).toHaveCount(2)
  for (const id of ['hora-dos-artistas', 'pote-de-planos']) await expect(freebies.locator(`[data-shop-game="${id}"]`)).toContainText('Grátis')
  await expect(freebies.getByRole('link', { name: 'Ver os gratuitos', exact: true })).toHaveAttribute('href', '/gratuitos')
  const details = page.getByRole('link', { name: 'Ver detalhes: Rabisque e Adivinhe', exact: true })
  if (stage === 'preview') {
    await expect(details).toHaveCount(0)
    await expect(page.locator('main')).not.toContainText('R$')
  } else {
    await expect(details).toHaveAttribute('href', '/loja/rabisque-e-adivinhe')
    await expect(page.locator('[data-shop-game="rabisque-e-adivinhe"] .shop-price')).toContainText('9,90')
    await expect(page.getByRole('button', { name: 'Adicionar à sacola: Rabisque e Adivinhe', exact: true })).toBeEnabled()
    await details.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/loja\/rabisque-e-adivinhe$/)
  }
})

test('produto: preço vem do catálogo, compra preserva escolha e ausência não oferece compra', async ({ page }) => {
  await catalog(page)
  await page.goto('/loja/rabisque-e-adivinhe')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rabisque e Adivinhe')
  await expect(page.locator('main')).toContainText('Também está no pacote')
  await expect(page.locator('.shop-includes')).toContainText('O jogo completo em PDF para imprimir')
  if (stage === 'preview') {
    await expect(page.locator('.shop-purchase')).toContainText('Em breve')
    await expect(page.locator('.shop-purchase button')).toHaveCount(0)
  } else {
    // Sem login, a escolha vai para a sacola guardada no navegador; o login fica para o pagamento.
    const buy = page.getByRole('button', { name: 'Adicionar à sacola', exact: true })
    await expect(buy).toBeEnabled()
    await buy.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Sua sacola' })).toContainText('Rabisque e Adivinhe')
    await expect(page).toHaveURL(/\/loja\/rabisque-e-adivinhe$/)
    expect(await page.evaluate(() => localStorage.getItem('keytotwo:sacola'))).toBe('["J001"]')
    await page.keyboard.press('Escape')
  }
  await page.goto('/loja/colecao-fundadores')
  await expect(page.locator('.shop-purchase')).toContainText(unavailable)
  await expect(page.locator('.shop-purchase button')).toHaveCount(0)
  // Jogos do pacote: apresentação e ficha, sem compra avulsa nem "Em breve" dentro da oferta.
  const included = page.locator('.shop-games [data-shop-game]')
  await expect(included).toHaveCount(5)
  await expect(page.locator('.shop-games').getByRole('button')).toHaveCount(0)
  await expect(page.locator('.shop-games')).not.toContainText('Em breve')
  await expect(page.locator('[data-shop-game="tabuleiro-da-sorte"] .shop-game-facts')).toContainText('Tabuleiro, perguntas e desafios')
  await expect(page.locator('[data-shop-game="o-sumico-de-rapadura"] .shop-game-facts')).toContainText('Escape room de papel')
})

test('página de produto: ficha no topo, capa, como é jogar, o que vocês precisam e o pacote', async ({ page }) => {
  const j003 = { ...single, code: 'J003', name: 'Tabuleiro da Sorte', games: [{ code: 'J003', name: 'Tabuleiro da Sorte' }], price: { unit_amount: 990, currency: 'brl' } }
  const j002 = { ...single, code: 'J002', name: 'O Sumiço de Rapadura', games: [{ code: 'J002', name: 'O Sumiço de Rapadura' }], price: { unit_amount: 1290, currency: 'brl' } }
  await catalog(page, [single, j003, j002])
  await page.goto('/loja/rabisque-e-adivinhe')
  await expect(page.locator('.product-facts dt')).toHaveText(['Pessoas', 'Jeito de jogar', 'Rodadas', 'Formato'])
  // Nenhuma página do PDF no site (responsável, 2026-10-16): o avulso mostra só a capa, e a URL antiga não serve imagem.
  await expect(page.locator('.product-gallery-main img')).toHaveAttribute('src', '/media/games/j001-capa-640.webp')
  await expect(page.locator('.product-gallery-thumbs')).toHaveCount(0)
  await expect(page.locator('img[src*="j001-page"]')).toHaveCount(0)
  for (const n of [1, 2, 3]) expect((await page.request.get(`/media/experience/j001-page-${n}-720.webp`)).headers()['content-type'] ?? '').not.toContain('image')
  await expect(page.locator('.moments-list li')).toHaveCount(3)
  await expect(page.locator('.needs-list li')).toHaveCount(5)
  await expect(page.locator('.product-package').getByRole('link', { name: 'Ver o pacote: Coleção KeyToTwo: Fundadores', exact: true })).toHaveAttribute('href', '/loja/colecao-fundadores')
  await expect(page.locator('.product-package')).not.toContainText('R$')
  // Tabuleiro e Rapadura também se vendem sozinhos (responsável, 2026-10-16); só a capa, como em todo avulso.
  for (const [slug, code, price] of [['tabuleiro-da-sorte', 'j003', '9,90'], ['o-sumico-de-rapadura', 'j002', '12,90']]) {
    await page.goto(`/loja/${slug}`)
    if (stage !== 'preview') await expect(page.locator('.shop-purchase .shop-price')).toContainText(price)
    await expect(page.locator('.product-gallery-thumbs')).toHaveCount(0)
    await expect(page.locator('.product-gallery-main img')).toHaveAttribute('src', `/media/games/${code}-capa-640.webp`)
    await expect(page.locator('.moments-list li')).toHaveCount(3)
  }
  await page.goto('/loja/colecao-fundadores')
  await expect(page.getByRole('list', { name: 'Imagens do produto' }).getByRole('button')).toHaveCount(6)
  await expect(page.locator('.product-facts')).toHaveCount(0)
  await expect(page.locator('.needs-list li')).toHaveCount(13)
})

test('pacote: preço de lançamento riscado só quando o cobrado é menor; leitor de tela ouve "De … por …"', async ({ page }) => {
  test.skip(stage === 'preview', 'preview não mostra preço')
  await catalog(page, [{ ...bundle, price: { unit_amount: 2990, currency: 'brl' } }])
  await page.goto('/loja')
  const pack = page.locator('[data-shop-product="P001"]')
  await expect(pack.locator('.shop-price-tag')).toHaveText('Preço de lançamento')
  await expect(pack.locator('.shop-price-list')).toHaveText(/R\$\s39,90/)
  await expect(pack.locator('.shop-price')).toHaveText(/^De R\$\s39,90 por R\$\s29,90$/)
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await catalog(page, [{ ...bundle, price: { unit_amount: 3990, currency: 'brl' } }])
  await page.goto('/loja')
  await expect(pack.locator('.shop-price')).toHaveText(/^R\$\s39,90$/)
  await expect(pack.locator('.shop-price-tag, .shop-price-list')).toHaveCount(0)
})

// Fora do Portal: d2-portal.spec.ts, com a sessão de teste.
test('barrinha do cupom: acima do cabeçalho nas páginas públicas', async ({ page }) => {
  await catalog(page)
  await page.goto('/loja')
  const bar = page.getByRole('complementary', { name: 'Cupom de desconto' })
  await expect(bar).toHaveText('Primeira compra? Usem o cupom PRIMEIRA10 no pagamento e ganhem 10% de desconto.')
  await expect(bar.locator('.promo-code')).toHaveText('PRIMEIRA10')
  // Vem antes do cabeçalho na página e rola com ela (o cabeçalho é que gruda no topo).
  const [barBox, headerBox] = [await bar.boundingBox(), await page.locator('.site-header-shell').boundingBox()]
  expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(headerBox!.y + 1)
})

// Cupons do admin (2026-10-24): a faixa vem do cupom com faixa (o /catalog na hora; o build traz a mesma); quem chega
// pelo link de um parceiro vê o cupom dele, que fica guardado no navegador.
test('barrinha do cupom: a faixa do /catalog e o cupom do parceiro do link', async ({ page }) => {
  test.skip(stage === 'preview', 'Preview não consulta a API')
  await page.route('**/functions/v1/api/catalog', route => route.fulfill({ json: { products: [bundle], banner: { code: 'BLACK26', text: 'Black Friday: 30% em tudo com o cupom {cupom}.' } } }))
  const visits: unknown[] = []
  await page.route('**/functions/v1/api/referral/visit', route => {
    visits.push(route.request().postDataJSON())
    return route.fulfill({ json: { partner: 'ana-souza', name: 'Ana Souza', code: 'ANA10', percent_off: 12.5 } })
  })
  await page.goto('/loja')
  const bar = page.getByRole('complementary', { name: 'Cupom de desconto' })
  await expect(bar).toHaveText('Black Friday: 30% em tudo com o cupom BLACK26.')
  await page.goto('/loja?p=ana-souza&utm_source=instagram')
  await expect(bar).toHaveText('Indicação de Ana Souza: 12,5% de desconto no pagamento, com o cupom ANA10')
  expect(visits).toEqual([{ partner: 'ana-souza' }])
  // Guardado: as próximas páginas mostram o mesmo, sem contar a visita de novo.
  await page.goto('/')
  await expect(bar).toContainText('Indicação de Ana Souza')
  expect(visits).toHaveLength(1)
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('keytotwo:indicacao') ?? 'null'))
  expect([stored.partner, stored.utm_source, stored.path]).toEqual(['ana-souza', 'instagram', '/loja'])
})

test('produto listado sem preço não oferece compra; falha permite retry', async ({ page }) => {
  test.skip(stage === 'preview', 'Preview não consulta disponibilidade comercial na tela')
  let fail = true
  await page.route('**/functions/v1/api/catalog', route => fail
    ? route.fulfill({ status: 503, json: { error: { code: 'INTERNAL_ERROR' } } })
    : route.fulfill({ json: { products: [{ ...single, price: null }] } }))
  await page.goto('/loja/rabisque-e-adivinhe')
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
  await page.goto('/loja/rabisque-e-adivinhe')
  try {
    await expect(page.locator('.shop-purchase [role="status"]')).toContainText('Consultando o preço…')
    await expect(page.locator('.shop-purchase button')).toHaveCount(0)
    await expect(page.locator('.shop-price')).toHaveCount(0)
  } finally { release() }
  // Fora do catálogo que chegou: o avulso lançado fica indisponível, sem compra.
  await expect(page.locator('.shop-purchase')).toContainText('Indisponível no momento')
})

test('slugs sem produto e desconhecidos usam a 404 existente', async ({ page }) => {
  // Os códigos (p001, j003) eram as URLs antigas: em produção o nginx redireciona; sem ele, não são páginas.
  for (const slug of ['inexistente', 'hora-dos-artistas', 'p001', 'j003', 'jogo-4', 'jogo-5']) {
    await page.goto(`/loja/${slug}`)
    await expect(page.getByRole('heading', { name: 'Página não encontrada', exact: true })).toBeVisible()
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
  }
})

test('prerender e SEO: loja e produtos confirmados, sem páginas das vagas', async () => {
  for (const [route, heading, title] of [['loja', 'Loja', 'Loja de jogos para casais imprimirem'], ['loja/colecao-fundadores', 'Coleção KeyToTwo: Fundadores', 'Coleção KeyToTwo: Fundadores, pacote de jogos para casais'], ['loja/rabisque-e-adivinhe', 'Rabisque e Adivinhe', 'Rabisque e Adivinhe, jogo de desenho para casais']]) {
    const html = await readFile(`build/client/${route}/index.html`, 'utf8')
    expect(html).toContain(`<title>${title} — KeyToTwo</title>`)
    expect(html).toContain(`<h1>${heading}</h1>`)
    expect(html).not.toContain('Adicionar à sacola')
  }
  await expect(readFile('build/client/loja/hora-dos-artistas/index.html')).rejects.toThrow()
  await expect(readFile('build/client/loja/p001/index.html')).rejects.toThrow()
})

test('compartilhamento e dados estruturados: imagem 1200×630, cartão grande e produto com preço', async () => {
  const jsonLd = (html: string) => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(match => JSON.parse(match[1]))
  const home = await readFile('build/client/index.html', 'utf8')
  expect(home).toMatch(/<meta property="og:image" content="https?:\/\/[^"]+\/media\/og\/p001\.jpg"/)
  expect(home).toContain('<meta property="og:image:width" content="1200"/>')
  expect(home).toContain('<meta name="twitter:card" content="summary_large_image"/>')
  expect(jsonLd(home)[0]['@graph'].map((node: { '@type': string }) => node['@type'])).toEqual(['Organization', 'WebSite'])
  const pack = await readFile('build/client/loja/colecao-fundadores/index.html', 'utf8')
  expect(pack).toMatch(/<meta property="og:image" content="[^"]+\/media\/og\/p001\.jpg"/)
  const [product, breadcrumb] = jsonLd(pack)[0]['@graph']
  expect([product['@type'], product.name, product.sku, product.offers.price, product.offers.priceCurrency]).toEqual(['Product', 'Coleção KeyToTwo: Fundadores', 'P001', '29.90', 'BRL'])
  expect(breadcrumb.itemListElement.map((item: { name: string }) => item.name)).toEqual(['Início', 'Loja', 'Coleção KeyToTwo: Fundadores'])
  const single = await readFile('build/client/loja/o-sumico-de-rapadura/index.html', 'utf8')
  expect(single).toMatch(/\/media\/og\/j002\.jpg/)
  expect(jsonLd(single)[0]['@graph'][0].offers.price).toBe('12.90')
  expect(await readFile('build/client/gratuitos/index.html', 'utf8')).toMatch(/\/media\/og\/f001\.jpg/)
  for (const code of ['p001', 'j001', 'j002', 'j003', 'f001']) expect((await readFile(`build/client/media/og/${code}.jpg`)).length).toBeGreaterThan(20_000)
})

for (const width of [375, 1280]) test(`loja e detalhes: axe e capturas em ${width}`, async ({ page }) => {
  await catalog(page, [single, bundle])
  await page.setViewportSize({ width, height: 900 })
  for (const slug of ['', '/colecao-fundadores', '/rabisque-e-adivinhe']) {
    await page.goto(`/loja${slug}`)
    await page.evaluate(async () => { await document.fonts.ready })
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    expect(result.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([])
    if (process.env.SHOP_CAPTURE === '1') {
      await mkdir('.maestri/design-review/loja', { recursive: true })
      await sharp(await page.screenshot({ fullPage: true, animations: 'disabled' })).webp({ quality: 85 }).toFile(`.maestri/design-review/loja/${stage}-loja${slug.replace('/', '-')}-${width}.webp`)
    }
  }
})

test('loja e detalhes sem rolagem horizontal em 320–1440 e texto 200%', async ({ page }) => {
  await catalog(page, [single, bundle])
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const route of ['/loja', '/loja/colecao-fundadores', '/loja/rabisque-e-adivinhe']) {
      await page.goto(route)
      await page.addStyleTag({ content: 'html { font-size: 200%; }' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${route} em ${width}`).toBe(true)
    }
  }
})

test('loja: o pacote fecha a grade dos jogos como último card, com o preço de lançamento', async ({ page }) => {
  test.skip(stage === 'preview', 'preview não mostra preço')
  await catalog(page, [single, { ...bundle, price: { unit_amount: 2990, currency: 'brl' } }])
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/loja')
  const cards = page.locator('.shop-games .shop-game-grid > li')
  await expect(cards).toHaveCount(6)
  const pack = cards.last()
  await expect(pack).toHaveAttribute('data-pack-card', 'P001')
  await expect(pack.locator('.shop-game-kind')).toHaveText('Pacote de jogos')
  await expect(pack.locator('.shop-price')).toHaveText(/^De R\$\s39,90 por R\$\s29,90$/)
  await expect(pack.getByRole('link', { name: 'Ver detalhes: Coleção KeyToTwo: Fundadores' })).toHaveAttribute('href', '/loja/colecao-fundadores')
  // Três colunas: 5 jogos + o pacote fecham duas linhas inteiras.
  const tops = await cards.evaluateAll(items => items.map(item => Math.round(item.getBoundingClientRect().top)))
  expect(new Set(tops).size).toBe(2)
})

test('celular: card de jogo horizontal, com a capa ao lado do nome e a compra na largura toda', async ({ page }) => {
  await catalog(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/loja')
  const card = page.locator('[data-shop-game="rabisque-e-adivinhe"]')
  const [cover, head, body] = await Promise.all(['.game-cover', '.shop-game-head', '.shop-game-body'].map(selector => card.locator(selector).boundingBox()))
  expect(cover!.x + cover!.width).toBeLessThanOrEqual(head!.x + 1)
  expect(Math.abs(cover!.y - head!.y)).toBeLessThan(cover!.height)
  expect(body!.y).toBeGreaterThanOrEqual(cover!.y + cover!.height - 1)
  expect(body!.width).toBeGreaterThan(cover!.width * 2)
})

test('gratuitos no Início e na Loja: selo Grátis e o caminho para a página Gratuitos', async ({ page }) => {
  await catalog(page)
  for (const route of ['/', '/loja']) {
    await page.goto(route)
    const card = page.locator('[data-shop-freebies] [data-shop-game="hora-dos-artistas"]')
    await expect(card.locator('.tag-solid')).toHaveText('Grátis')
    await expect(card.getByRole('link', { name: 'Como baixar: Hora dos Artistas' })).toHaveAttribute('href', '/gratuitos')
    await expect(card.locator('.shop-price')).toHaveCount(0)
  }
})

test('pacote: as miniaturas da galeria cabem numa linha só', async ({ page }) => {
  await catalog(page, [bundle])
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/loja/colecao-fundadores')
    const tops = await page.getByRole('list', { name: 'Imagens do produto' }).getByRole('button').evaluateAll(items => items.map(item => Math.round(item.getBoundingClientRect().top)))
    expect(tops, `em ${width}`).toHaveLength(6)
    expect(new Set(tops).size, `em ${width}`).toBe(1)
  }
})

test('rodapé: a tesoura e o chão do Kito também em Entrar e na Sacola', async ({ page }) => {
  await catalog(page)
  for (const route of ['/entrar', '/carrinho']) {
    await page.goto(route)
    await expect(page.locator('.site-footer .cut-line'), route).toHaveCount(1)
    await expect(page.locator('.site-footer .footer-ground'), route).toHaveCount(1)
  }
})
