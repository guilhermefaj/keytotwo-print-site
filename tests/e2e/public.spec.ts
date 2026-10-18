import { mkdir, readFile } from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import { expect, test, type Page } from './fixtures/test'

// Checks for the public sales pages, run against the prerendered build (build/client).
// Stage-specific assertions follow the stage the build was made for (robots.txt tells which).
const routes = ['/', '/preview/hero', '/entrar', '/carrinho', '/pagamento', '/meus-jogos', '/pedidos', '/conta', '/pedido/confirmacao', '/jogo-gratuito', '/email/preferencias', '/ajuda', '/termos', '/privacidade', '/loja', '/loja/p001', '/loja/j001', '/404']
// A rota ainda existe, mas redireciona para /termos#reembolso; links internos continuam resolvendo.
const redirectRoutes = ['/reembolsos']
const blogRoutes = readdirSync('build/client/blog', { withFileTypes: true }).filter(file => file.isDirectory()).map(file => `/blog/${file.name}`)
routes.push('/blog', ...blogRoutes)
const shopRoutes = readdirSync('build/client/loja', { withFileTypes: true }).filter(file => file.isDirectory()).map(file => `/loja/${file.name}`)
routes.push(...shopRoutes.filter(route => !routes.includes(route)))
const privateRoutes = ['/preview/hero', '/entrar', '/carrinho', '/pagamento', '/meus-jogos', '/pedidos', '/conta', '/pedido/confirmacao', '/jogo-gratuito', '/email/preferencias', '/404']
const protectedRoutes = ['/carrinho', '/pagamento', '/meus-jogos', '/pedidos', '/conta', '/pedido/confirmacao']
const refundNotice = /N[ãa]o h[áa] reembolso ap[óo]s a libera[çc][ãa]o do download/i

async function builtFile(name: string) {
  return readFile(new URL(`../../build/client/${name}`, import.meta.url), 'utf8')
}
const isLive = async () => /^Sitemap:/m.test(await builtFile('robots.txt'))
const isPreview = async () => !(await isLive()) && !(await builtFile('index.html')).includes('Ambiente de teste')

async function visibleText(page: Page) {
  return page.evaluate(() => document.body.innerText)
}

test.describe('links e botões', () => {
  test('todo link interno resolve para uma rota pré-renderizada e para um id existente', async ({ page }) => {
    const known = new Set([...routes, ...redirectRoutes])
    const ids = new Map<string, Set<string>>()
    const links: { from: string; href: string }[] = []

    for (const route of routes) {
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      ids.set(route, new Set(await page.locator('[id]').evaluateAll(els => els.map(el => el.id))))
      const hrefs = await page.locator('a[href]').evaluateAll(els => els.map(el => el.getAttribute('href') ?? ''))
      for (const href of hrefs) links.push({ from: route, href })
    }

    // The mobile menu is only mounted when open.
    await page.setViewportSize({ width: 390, height: 800 })
    await page.goto('/')
    await page.getByRole('button', { name: 'Abrir menu' }).click()
    const sheetHrefs = await page.locator('[role="dialog"] a[href]').evaluateAll(els => els.map(el => el.getAttribute('href') ?? ''))
    for (const href of sheetHrefs) links.push({ from: '/', href })
    expect(sheetHrefs.length, 'menu mobile sem links').toBeGreaterThan(0)

    const problems: string[] = []
    for (const { from, href } of links) {
      if (href === '' || href === '#' || /^javascript:/i.test(href)) { problems.push(`${from}: href inválido "${href}"`); continue }
      if (/^(https?:|mailto:|tel:)/i.test(href)) continue
      if (href === '/blog/rss.xml') continue // Static XML checked by blog.spec.ts.
      // Âncora antiga da oferta: os links que sobram (nav, cabeçalho e rodapé) são do I6, que os troca por /loja.
      if (href === '/#comprar') continue
      const url = new URL(href, `http://x${from}`)
      const target = url.pathname.replace(/\/$/, '') || '/'
      if (!known.has(target)) { problems.push(`${from}: ${href} aponta para rota inexistente`); continue }
      const id = decodeURIComponent(url.hash.slice(1))
      if (id && !ids.get(target)?.has(id)) problems.push(`${from}: ${href} aponta para id inexistente`)
    }
    expect(problems).toEqual([])
  })

  test('botões têm nome acessível e agem', async ({ page }) => {
    for (const route of routes) {
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      const unnamed = await page.locator('button').evaluateAll(els =>
        els.filter(el => !(el.getAttribute('aria-label') || el.textContent?.trim())).map(el => el.outerHTML.slice(0, 80)))
      expect(unnamed, `botões sem nome em ${route}`).toEqual([])
    }
    await page.setViewportSize({ width: 390, height: 800 })
    await page.goto('/')
    await page.getByRole('button', { name: 'Abrir menu' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
  })
})

test.describe('conteúdo', () => {
  test('nenhum preço, valor em R$, depoimento ou número de clientes', async ({ page }) => {
    const preview = await isPreview()
    for (const route of routes) {
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      const text = await visibleText(page)
      const html = await page.content()
      // I2b: test/live prices can come from the API. Preview still invents none.
      if (preview) {
        expect(text, `R$ em ${route}`).not.toMatch(/R\$|\bBRL\b|\breais\b|US\$|€/i)
        expect(text, `valor monetário em ${route}`).not.toMatch(/\b\d+[.,]\d{2}\b/)
      }
      expect(text, `promoção/parcelamento em ${route}`).not.toMatch(/por apenas|desconto|promo[çc][ãa]o|parcel|\d+\s?x\s?de/i)
      expect(text, `depoimento/avaliação em ${route}`).not.toMatch(/depoimento|avalia[çc][õo]es|estrelas|★|⭐/i)
      expect(text, `número de clientes em ${route}`).not.toMatch(/\d[\d.]*\+?\s*(clientes|casais|compradores|vendas|downloads)/i)
      expect(html, `JSON-LD de produto em ${route}`).not.toMatch(/"@type"\s*:\s*"(Product|Offer|Review|AggregateRating)"/)
    }
  })

  test('experiência, um CTA na hero e prova social explicitamente reservada', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.hero-copy a')).toHaveText(['Ver os jogos', 'Como funciona'])
    await expect(page.locator('.hero-copy mark')).toHaveText('encontro.')
    await expect(page.locator('.hero-benefits')).toHaveCount(0)
    await expect(page.locator('.steps-list li')).toHaveCount(3)
    await expect(page.locator('.faq-item')).toHaveCount(4)
    if (await isPreview() || await isLive()) {
      // Sem relato real autorizado a seção de relatos não renderiza (P0-1).
      await expect(page.locator('.social-section')).toHaveCount(0)
      await expect(page.locator('.social-card')).toHaveCount(0)
    } else {
      await expect(page.locator('.social-card[data-placeholder="true"]')).toHaveCount(3)
      await expect(page.locator('.social-card blockquote')).toHaveCount(3)
    }
    await expect(page.locator('.social-metrics')).toHaveCount(0)
    // Vitrine curta (decisão 9): o pacote e até 3 jogos, sem a oferta antiga nem a folha completa.
    await expect(page.locator('.shop-showcase')).toHaveCount(1)
    await expect(page.locator('.shop-showcase [data-shop-product]')).toHaveCount(1)
    await expect(page.locator('.shop-showcase [data-shop-product]')).toHaveAttribute('data-shop-product', 'P001')
    await expect(page.locator('.shop-showcase .cover-tile')).toHaveCount(3)
    await expect(page.locator('section.offer-section')).toHaveCount(0)
    await expect(page.locator('.package-game')).toHaveCount(0)
    await expect(page.locator('.mobile-purchase-bar')).toHaveCount(0)
    expect(await visibleText(page)).not.toMatch(/PENDENTE/)
    expect((await visibleText(page)).match(/\bP\d{3}\b/g) ?? [], 'códigos de produto além de P001').toEqual([])
  })

  test('condição de reembolso: nos termos de uso, não nas páginas de venda', async ({ page }) => {
    // The refund condition belongs in the terms of use, not in the buyer's face.
    for (const route of ['/', '/ajuda']) {
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      expect(await visibleText(page), `sem condição de reembolso em ${route}`).not.toMatch(refundNotice)
    }
    await page.goto('/termos')
    await page.waitForLoadState('networkidle')
    expect(await visibleText(page), 'condição nos termos de uso').toMatch(refundNotice)
    await expect(page.locator('#reembolso')).toHaveText('Reembolsos e contestações')
  })

  // The refund condition must not appear on the home; it moved to the terms.
  test('home: sem linha de reembolso', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.refund-notice')).toHaveCount(0)
    expect(await visibleText(page)).not.toMatch(refundNotice)
  })

  test('carrinho exige login e preserva o destino', async ({ page }) => {
    await page.goto('/carrinho')
    await expect(page).toHaveURL(/\/entrar\?next=%2Fcarrinho$/)
    await expect(page.getByRole('heading', { name: 'Entrar', exact: true })).toBeVisible()
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
    // Authenticated checkout content is checked by the D3 suite.
  })
})

test.describe('stage', () => {
  test('preview: sem Adicionar à sacola e sem acesso ao carrinho', async ({ page }) => {
    test.skip(!(await isPreview()), 'build test/live has an authenticated cart')
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      for (const route of routes.filter(r => r !== '/carrinho')) {
        await page.goto(route)
        await page.waitForLoadState('networkidle')
        if (width === 390) await page.getByRole('button', { name: 'Abrir menu' }).click()
        expect(await page.locator('a[href^="/carrinho"]').count(), `link de carrinho em ${route} @${width}`).toBe(0)
        expect(await page.getByRole('link', { name: /carrinho/i }).count(), `link "carrinho" em ${route} @${width}`).toBe(0)
        expect(await page.getByRole('button', { name: /adicionar|carrinho|comprar/i }).count(), `botão de compra em ${route} @${width}`).toBe(0)
        expect(await visibleText(page), `texto Adicionar à sacola em ${route}`).not.toMatch(/Adicionar à sacola/i)
      }
    }
  })

  test('robots e sitemap coerentes com o stage', async () => {
    const robots = await builtFile('robots.txt')
    const sitemap = await builtFile('sitemap.xml')
    const locs = sitemap.match(/<loc>[^<]+<\/loc>/g) ?? []
    if (!(await isLive())) {
      expect(robots).toMatch(/^User-agent: \*\s+Disallow: \/\s*$/m)
      expect(robots).not.toMatch(/Sitemap:/)
      expect(locs).toEqual([])
    } else {
      expect(locs.length).toBe(5 + blogRoutes.length)
      for (const route of privateRoutes) expect(sitemap).not.toContain(`${route}</loc>`)
      expect(robots).toMatch(/Disallow: \/carrinho/)
    }
  })

  test('rotas privadas têm noindex', async ({ page }) => {
    for (const route of privateRoutes) {
      await page.goto(route)
      await expect(page.locator('meta[name="robots"]'), route).toHaveAttribute('content', /noindex/)
    }
  })

  test('title, description e canonical por rota', async ({ page }) => {
    const titles = new Map<string, string>()
    for (const route of routes) {
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      const title = await page.title()
      expect(title, `title de ${route}`).not.toBe('')
      expect(await page.locator('meta[name="description"]').getAttribute('content'), `description de ${route}`).toBeTruthy()
      expect(await page.locator('link[rel="canonical"]').getAttribute('href'), `canonical de ${route}`).toBeTruthy()
      // /preview/hero is a copy of the home by design.
      if (route !== '/preview/hero' && !protectedRoutes.includes(route)) {
        expect(titles.get(title), `title repetido em ${route} e ${titles.get(title)}`).toBeUndefined()
        titles.set(title, route)
      }
    }
  })
})

test.describe('rolagem horizontal', () => {
  for (const width of [320, 390, 1440]) {
    test(`sem rolagem horizontal em ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      for (const route of routes) {
        await page.goto(route)
        await page.waitForLoadState('networkidle')
        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }))
        expect(scrollWidth, `${route} @${width}: scrollWidth ${scrollWidth} > ${clientWidth}`).toBeLessThanOrEqual(clientWidth)
      }
    })
  }
})

test('home: matriz responsiva, texto 200%, cena preservada e capturas', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const captureDir = process.env.REDESIGN_QA_DIR
  if (captureDir) await mkdir(captureDir, { recursive: true })
  for (const [width, height] of [[320, 800], [390, 844], [768, 1024], [1280, 720], [1440, 900]]) {
    await page.setViewportSize({ width, height })
    await page.goto('/')
    await page.evaluate(() => document.fonts.ready)
    const scene = page.locator('.hero-scene-region')
    await expect(scene).toHaveAttribute('data-running', 'false')
    expect(await page.locator('.kito-sprite').evaluate(el => getComputedStyle(el).backgroundImage)).toContain('kito-pixel-pose.webp')
    for (const zoom of [100, 200]) {
      if (zoom === 200) await page.evaluate(() => {
        const sizes = [...document.querySelectorAll<HTMLElement>('body *')].map(el => [el, parseFloat(getComputedStyle(el).fontSize)] as const)
        for (const [el, size] of sizes) el.style.fontSize = `${size * 2}px`
      })
      const overflow = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('body *')].filter(el => {
        if (!el.checkVisibility() || el.closest('[aria-hidden="true"]') || el.classList.contains('skip-link')) return false
        const rect = el.getBoundingClientRect()
        // Cards outside a scroll-snap viewport are intentional; text must still fit each card.
        const track = el.closest('.snap-track')
        if (track && getComputedStyle(track).overflowX === 'auto') {
          return el === track ? rect.left < -1 || rect.right > innerWidth + 1 : el.scrollWidth > el.clientWidth + 2
        }
        return rect.left < -1 || rect.right > innerWidth + 1 || el.scrollWidth > el.clientWidth + 2
      }).map(el => ({ tag: el.tagName, class: el.className, width: el.clientWidth, scroll: el.scrollWidth })))
      expect(overflow, `home ${width}px, text ${zoom}%`).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const copy = await page.locator('.hero-copy').boundingBox()
      const stage = await page.locator('.hero-scene').boundingBox()
      expect(copy!.y + copy!.height).toBeLessThan(stage!.y)
      if (captureDir && zoom === 100 && [390, 1440].includes(width)) {
        await page.screenshot({ path: `${captureDir}/home-${width}.png`, fullPage: true })
        await page.screenshot({ path: `${captureDir}/hero-${width}.png` })
      }
    }
  }
})

test('favicon do Kito: os ícones declarados no head existem e são imagens', async ({ page, request }) => {
  await page.goto('/')
  const icons = await page.locator('link[rel="icon"], link[rel="apple-touch-icon"]').evaluateAll(links => links.map(link => link.getAttribute('href') ?? ''))
  expect(icons).toEqual(['/favicon.ico', '/media/icons/kito-192.png', '/media/icons/apple-touch-icon.png'])
  // Pela assinatura dos bytes: o sirv dos testes não manda Content-Type para .ico (o nginx manda image/x-icon).
  const signatures: Record<string, string> = { '.ico': '00000100', '.png': '89504e47' }
  for (const href of icons) {
    const response = await request.get(href)
    expect(response.status(), href).toBe(200)
    const body = await response.body()
    expect(body.subarray(0, 4).toString('hex'), href).toBe(signatures[href.slice(href.lastIndexOf('.'))])
  }
})
