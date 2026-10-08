import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

// Checks for the public sales pages, run against the prerendered build (build/client).
// Stage-specific assertions follow the stage the build was made for (robots.txt tells which).
const routes = ['/', '/preview/hero', '/entrar', '/carrinho', '/meus-jogos', '/conta', '/pedido/confirmacao', '/ajuda', '/termos', '/privacidade', '/reembolsos', '/404']
const privateRoutes = ['/preview/hero', '/entrar', '/carrinho', '/meus-jogos', '/conta', '/pedido/confirmacao', '/404']
const policyRoutes = ['/', '/ajuda', '/termos', '/reembolsos']
const refundNotice = /N[ãa]o h[áa] reembolso ap[óo]s a libera[çc][ãa]o do download/i

async function builtFile(name: string) {
  return readFile(new URL(`../../build/client/${name}`, import.meta.url), 'utf8')
}
const isLive = async () => /^Sitemap:/m.test(await builtFile('robots.txt'))

async function visibleText(page: Page) {
  return page.evaluate(() => document.body.innerText)
}

test.describe('links e botões', () => {
  test('todo link interno resolve para uma rota pré-renderizada e para um id existente', async ({ page }) => {
    const known = new Set(routes)
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

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: /Pausar anima/ }).click()
    await expect(page.getByRole('button', { name: /Retomar anima/ })).toBeVisible()
  })
})

test.describe('conteúdo', () => {
  test('nenhum preço, valor em R$, depoimento ou número de clientes', async ({ page }) => {
    for (const route of routes) {
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      const text = await visibleText(page)
      const html = await page.content()
      expect(text, `R$ em ${route}`).not.toMatch(/R\$|\bBRL\b|\breais\b|US\$|€/i)
      expect(text, `valor monetário em ${route}`).not.toMatch(/\b\d+[.,]\d{2}\b/)
      expect(text, `promoção/parcelamento em ${route}`).not.toMatch(/por apenas|desconto|promo[çc][ãa]o|parcel|\d+\s?x\s?de/i)
      expect(text, `depoimento/avaliação em ${route}`).not.toMatch(/depoimento|avalia[çc][õo]es|estrelas|★|⭐/i)
      expect(text, `número de clientes em ${route}`).not.toMatch(/\d[\d.]*\+?\s*(clientes|casais|compradores|vendas|downloads)/i)
      expect(html, `JSON-LD de produto em ${route}`).not.toMatch(/"@type"\s*:\s*"(Product|Offer|Review|AggregateRating)"/)
    }
  })

  test('só o P001, com 3 jogos nomeados e 2 PENDENTE', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const section = page.locator('section.games-section')
    const names = (await section.locator('h3').allTextContents()).map(s => s.trim())
    expect(names, 'cartões da seção de jogos').toEqual(['Rabisque e Adivinhe', 'Hora dos Artistas', 'Boardgame', 'Jogo a definir', 'Jogo a definir'])
    expect((await section.innerText()).match(/PENDENTE · composição/g)?.length, 'vagas PENDENTE').toBe(2)
    const offer = page.locator('section.offer-section')
    await expect(offer).toContainText('5 jogos')
    await expect(offer).toContainText('PENDENTE: preço e moeda')
    expect((await visibleText(page)).match(/\bP\d{3}\b/g) ?? [], 'códigos de produto além de P001').toEqual([])
  })

  test('aviso de sem reembolso: oferta, FAQ e políticas', async ({ page }) => {
    for (const route of policyRoutes) {
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      expect(await visibleText(page), `aviso em ${route}`).toMatch(refundNotice)
    }
  })

  // The conditions must come before the purchase action, not necessarily before the price.
  test('home: aviso de sem reembolso na oferta e antes de qualquer botão de compra', async ({ page }) => {
    await page.goto('/')
    const result = await page.evaluate(() => {
      const offer = document.querySelector('section.offer-section')!
      const notice = [...offer.querySelectorAll('*')].find(el => el.children.length === 0 && /N[ãa]o h[áa] reembolso/i.test(el.textContent ?? ''))
      const actions = [...offer.querySelectorAll('button, a, [role="button"]')]
        .filter(el => /adicionar|finalizar|comprar agora|carrinho/i.test(`${el.textContent} ${el.getAttribute('aria-label') ?? ''}`))
      return {
        noticeInOffer: !!notice,
        actionsBeforeNotice: actions.filter(el => !!notice && !!(el.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING)).map(el => el.textContent?.trim()),
      }
    })
    expect(result.noticeInOffer, 'aviso dentro da seção da oferta').toBe(true)
    expect(result.actionsBeforeNotice, 'botões de compra antes do aviso').toEqual([])
  })

  test('carrinho: aviso antes de Finalizar compra', async ({ page }) => {
    await page.goto('/carrinho')
    await expect(page.getByRole('link', { name: /Finalizar compra/ })).toHaveAttribute('href', '/entrar?next=%2Fcarrinho')
    const before = await page.evaluate(() => {
      const notice = [...document.querySelectorAll('main *')].find(el => el.children.length === 0 && /N[ãa]o h[áa] reembolso/i.test(el.textContent ?? ''))
      const cta = [...document.querySelectorAll('main a')].find(el => /Finalizar compra/.test(el.textContent ?? ''))
      return !!notice && !!cta && !!(notice.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING)
    })
    expect(before, 'aviso antes de Finalizar compra').toBe(true)
  })
})

test.describe('stage', () => {
  test('preview: sem Adicionar ao carrinho e sem acesso ao carrinho', async ({ page }) => {
    test.skip(await isLive(), 'build live')
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      for (const route of routes.filter(r => r !== '/carrinho')) {
        await page.goto(route)
        await page.waitForLoadState('networkidle')
        if (width === 390) await page.getByRole('button', { name: 'Abrir menu' }).click()
        expect(await page.locator('a[href^="/carrinho"]').count(), `link de carrinho em ${route} @${width}`).toBe(0)
        expect(await page.getByRole('link', { name: /carrinho/i }).count(), `link "carrinho" em ${route} @${width}`).toBe(0)
        expect(await page.getByRole('button', { name: /adicionar|carrinho|comprar/i }).count(), `botão de compra em ${route} @${width}`).toBe(0)
        expect(await visibleText(page), `texto Adicionar ao carrinho em ${route}`).not.toMatch(/Adicionar ao carrinho/i)
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
      expect(locs.length).toBe(5)
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
      const title = await page.title()
      expect(title, `title de ${route}`).not.toBe('')
      expect(await page.locator('meta[name="description"]').getAttribute('content'), `description de ${route}`).toBeTruthy()
      expect(await page.locator('link[rel="canonical"]').getAttribute('href'), `canonical de ${route}`).toBeTruthy()
      // /preview/hero is a copy of the home by design.
      if (route !== '/preview/hero') {
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
