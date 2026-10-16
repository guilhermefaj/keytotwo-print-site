import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { fixture } from './fixtures/checkout'
import { builtStage } from './fixtures/stage'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })
const stageTest = readFileSync('build/client/index.html', 'utf8').includes('Ambiente de teste')
async function settle(page: Page) {
  // Espera fontes e animações, com uma rodada de rAF entre verificações: transições disparadas por
  // rolagem (ex.: o cabeçalho se escondendo) só entram em getAnimations() depois do flush de estilo,
  // e o axe não pode medir contraste no meio do movimento (flaky sob carga).
  await page.evaluate(async () => {
    await document.fonts.ready
    for (let attempt = 0; attempt < 20; attempt++) {
      const pending = document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity && animation.playState !== 'finished')
      if (pending.length === 0 && attempt > 0) return
      await Promise.allSettled(pending.map(animation => animation.finished))
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    }
  })
}
async function axe(page: Page) {
  await settle(page)
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(result.violations.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target) }))).toEqual([])
}
async function capture(page: Page, name: string) {
  if (process.env.D3_CAPTURE !== '1') return
  await mkdir('.maestri/design-review/d3', { recursive: true })
  await settle(page)
  await page.screenshot({ path: `.maestri/design-review/d3/${name}.png`, fullPage: true, animations: 'disabled' })
}

test('cart loads as a skeleton, not an unavailable price or an empty cart', async ({ page }) => {
  test.skip(!stageTest, 'Stage test fixture')
  await fixture(page)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/cart', async route => { await gate; await route.fallback() })
  await page.goto('/carrinho')
  try {
    await expect(page.getByRole('status', { name: 'Carregando sua sacola' })).toBeVisible()
    await expect(page.locator('main')).not.toContainText(/indisponível|Sua sacola está vazia/i)
    await expect(page.locator('main').getByRole('button', { name: 'Finalizar compra' })).toHaveCount(0)
  } finally { release() }
  await expect(page.locator('[data-cart-product] .purchase-thumbnail')).toBeVisible()
  await expect(page.locator('.checkout-steps [aria-current]')).toContainText('Sacola')
  // Quem já entrou vê três etapas, renumeradas, sem um "Entrar" concluído fora de ordem.
  await expect(page.locator('.checkout-steps li > span:last-child')).toHaveText(['Sacola', 'Pagamento', 'Pronto'])
  await expect(page.locator('.checkout-steps .step-number').nth(1)).toHaveText('2')
})

for (const width of [390, 1440]) test(`purchase states, focused payment, keyboard and axe at ${width}`, async ({ page }) => {
  test.skip(!stageTest, 'Stage test fixture')
  test.setTimeout(90_000)
  await fixture(page)
  await page.setViewportSize({ width, height: 900 })
  await page.goto('/carrinho')
  await expect(page.locator('[data-cart-product]')).toBeVisible()
  await expect(page.locator('main')).not.toContainText(/reembolso|Stripe|indisponível|nova aba/i)
  await capture(page, `carrinho-item-${width}`); await axe(page)
  await page.getByRole('button', { name: 'Finalizar compra', exact: true }).focus(); await page.keyboard.press('Enter')
  await expect(page.locator('main').getByRole('checkbox')).toHaveCount(1)
  const terms = page.getByRole('checkbox', { name: 'Li e aceito os termos de uso', exact: true })
  await expect(terms).not.toBeChecked()
  await expect(page.getByRole('link', { name: 'Voltar à sacola', exact: true })).toHaveCount(1)
  await expect(page.locator('#checkout-form')).toHaveCount(0)
  await expect(page.locator('main')).not.toContainText(/reembolso|Stripe|nova aba/i)
  await capture(page, `pagamento-antes-${width}`); await axe(page)
  await terms.focus(); await page.keyboard.press('Space')
  await expect(page.locator('.stripe-payment')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByText('Pagamento seguro', { exact: true })).toHaveCount(1)
  await capture(page, `pagamento-depois-fixture-${width}`); await axe(page)
  await page.getByRole('button', { name: 'Pagar (simulação de teste)' }).click()
  await expect(page.getByRole('link', { name: 'Baixar agora', exact: true })).toHaveAttribute('href', '/meus-jogos')
  await expect(page.getByText('Também enviamos para o seu e-mail.')).toBeVisible()
  await expect(page.locator('.purchase-celebration')).toBeVisible()
  // Newsletter escondida até existir o envio (responsável, 2026-10-16).
  await expect(page.locator('.newsletter')).toHaveCount(0)
  await capture(page, `confirmacao-${width}`); await axe(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('.purchase-celebration img')).toHaveCSS('animation-name', 'none')
  await expect(page.locator('.confetti-piece').first()).toHaveCSS('animation-name', 'none')
  await page.route('**/api/order-status?*', route => route.fulfill({ json: { state: 'failed' } }))
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Vamos tentar de novo?' })).toBeVisible()
  // Falha de pagamento: Kito em pose neutra (quadro 01 do atlas), nunca a caixa com lágrima.
  await expect(page.locator('.kito-still')).toBeVisible()
  await expect(page.locator('.kito-empty')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Baixar agora', exact: true })).toHaveCount(0)
  await capture(page, `falha-${width}`); await axe(page)
  await page.route('**/api/cart', route => route.fulfill({ json: { version: 1, items: [], subtotal: null, warnings: [] } }))
  await page.goto('/carrinho')
  await expect(page.locator('.purchase-empty .kito-empty')).toBeVisible()
  await expect(page.locator('.cart-summary')).toHaveCount(0)
  await capture(page, `carrinho-vazio-${width}`); await axe(page)
})

test('vitrine curta com três jogos na home; carrossel e relatos só por ação do usuário no celular', async ({ page }) => {
  await page.goto('/')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  // Vitrine (decisão 9): o pacote e até 3 jogos; a folha completa dos 5 ficou só na Loja.
  await expect(page.locator('.shop-showcase .shop-game')).toHaveCount(3)
  // Capa oficial dos jogos confirmados (a tipográfica fica para quem não tem arte). Nunca a prévia do PDF.
  await expect(page.locator('.shop-showcase .shop-game h3')).toHaveText(['Rabisque e Adivinhe', 'Tabuleiro da Sorte', 'O Sumiço de Rapadura'])
  await expect(page.locator('.shop-showcase .shop-game .game-cover-art img')).toHaveCount(3)
  // O pacote tem a capa própria (Coleção KeyToTwo: Fundadores).
  await expect(page.locator('.shop-showcase .shop-bundle .game-cover-art img')).toHaveAttribute('src', '/media/games/p001-capa-640.webp')
  await expect(page.locator('.shop-showcase .game-cover-type')).toHaveCount(0)
  await expect(page.locator('.shop-showcase img[src*="/media/experience/j001-page"]')).toHaveCount(0)
  await expect(page.locator('.game-number')).toHaveCount(0)
  await page.locator('.shop-showcase').scrollIntoViewIfNeeded()
  await page.setViewportSize({ width: 390, height: 844 })
  if (builtStage() === 'test') {
    // Relatos de exemplo só no stage test, sempre marcados; nunca nota ou contagem.
    const social = page.locator('.social-carousel .snap-track')
    await social.focus(); await page.keyboard.press('End')
    await expect(page.locator('.social-carousel .carousel-position')).toHaveText('3 de 3')
    await expect(page.locator('.social-card blockquote')).toHaveCount(3)
    await expect(page.locator('.social-card[data-placeholder="true"] .tag-solid')).toHaveCount(3)
  } else {
    // Em preview e live só relatos reais aparecem; sem nenhum, a seção não existe (P0-1).
    await expect(page.locator('.social-section')).toHaveCount(0)
    await expect(page.locator('.social-card')).toHaveCount(0)
  }
  await expect(page.locator('.social-metrics')).toHaveCount(0)
})

test('public newsletter stays hidden until sending exists; published posts alone enter home', async ({ page }) => {
  const writes: string[] = []
  page.on('request', request => { if (['POST', 'PUT'].includes(request.method()) && request.url().includes('/api/')) writes.push(request.url()) })
  await page.goto('/')
  // Escondida em todos os stages (responsável, 2026-10-16); o rodapé público fecha com o chão do Kito.
  await expect(page.locator('.newsletter')).toHaveCount(0)
  await expect(page.locator('.footer-ground .footer-kito')).toHaveCount(1)
  expect(writes).toEqual([])
  // The build's real published feed is the source of truth, not the draft listing.
  const { readBlogPosts } = await import('../../src/lib/blog.server')
  const published = await readBlogPosts({ stage: 'live' })
  await expect(page.locator('.home-posts > li')).toHaveCount(Math.min(published.length, 3))
  if (!published.length) await expect(page.locator('.from-blog')).toHaveCount(0)
  for (const post of published.slice(0, 3)) await expect(page.locator('.home-posts').getByRole('link', { name: post.title })).toHaveAttribute('href', `/blog/${post.slug}`)
})

test('logged-in: newsletter hidden everywhere, Conta keeps the e-mail preference, payment footer stays minimal', async ({ page }) => {
  test.skip(!stageTest, 'Stage test fixture')
  await fixture(page)
  await page.route('**/api/account', route => route.fulfill({ json: { email: 'qa@example.test', marketing: { opted_in: false, prompted_at: null }, orders: [] } }))
  for (const path of ['/', '/carrinho', '/pagamento', '/blog/exemplo-como-publicar']) { await page.goto(path); await expect(page.locator('main')).toBeVisible(); await expect(page.locator('.newsletter')).toHaveCount(0) }
  // Pagamento em modo foco: só a linha legal, sem o chão nem os convites do rodapé público.
  await page.goto('/pagamento')
  await expect(page.locator('footer .footer-ground')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Informações legais', exact: true }).getByRole('link')).toHaveText(['Termos de uso', 'Privacidade', 'Ajuda'])
  await page.goto('/conta')
  await expect(page.locator('.marketing-form').getByRole('button', { name: 'Quero receber ideias', exact: true })).toBeEnabled()
})

test('purchase and home fit 320–1440 with doubled text', async ({ page }) => {
  test.skip(!stageTest, 'Stage test fixture')
  test.setTimeout(120_000)
  await fixture(page)
  for (const width of [320, 390, 600, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const path of ['/', '/carrinho', '/pagamento', '/pedido/confirmacao?session_id=cs_test_synthetic123456']) {
      await page.goto(path)
      await expect(page.locator('main h1')).toBeVisible()
      if (path === '/pagamento') { await page.getByRole('checkbox', { name: 'Li e aceito os termos de uso' }).check(); await expect(page.locator('.stripe-payment')).toHaveAttribute('data-ready', 'true') }
      for (const size of ['16px', '32px']) {
        await page.evaluate(value => { document.documentElement.style.fontSize = value }, size)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${path} at ${width}/${size}`).toBe(true)
      }
    }
  }
})

for (const width of [390, 1440]) test(`home carousel and footer captures plus axe at ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1100 })
  await page.goto('/')
  // Folga para o cabeçalho fixo: sem ela o axe conta o link da vitrine como coberto pelo cabeçalho.
  await page.locator('.shop-showcase').evaluate(el => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 120))
  await settle(page)
  if (process.env.D3_CAPTURE === '1') {
    await mkdir('.maestri/design-review/d3', { recursive: true })
    await page.locator('.shop-showcase').evaluate(el => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 120))
    await page.locator('.shop-showcase').screenshot({ path: `.maestri/design-review/d3/vitrine-${width}.png`, animations: 'disabled' })
    await page.locator('.footer-ground').scrollIntoViewIfNeeded()
    await page.locator('.site-footer').screenshot({ path: `.maestri/design-review/d3/rodape-${width}.png`, animations: 'disabled' })
  }
  await axe(page)
})
