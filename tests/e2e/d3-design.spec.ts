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
  await expect(page.locator('.checkout-steps [aria-current]')).toContainText('Carrinho')
  await expect(page.locator('.checkout-steps li').filter({ hasText: 'Entrar' })).toHaveAttribute('data-complete', 'true')
  await expect(page.locator('.checkout-steps li').filter({ hasText: 'Entrar' })).not.toHaveAttribute('aria-current')
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
  await expect(page.getByRole('link', { name: 'Voltar ao carrinho', exact: true })).toHaveCount(1)
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
  await expect(page.locator('.newsletter')).toHaveCount(1)
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
  // Capas tipográficas: nome do jogo na carta; jogos indefinidos ficam "Em breve" sem h3 (P0-2, P2-1).
  await expect(page.locator('.shop-showcase .shop-game h3')).toHaveText(['Rabisque e Adivinhe', 'Hora dos Artistas', 'Tabuleiro da Sorte'])
  await expect(page.locator('.shop-showcase .game-cover-preview')).toHaveCount(1)
  await expect(page.locator('.shop-showcase .game-cover-type')).toHaveCount(2)
  await expect(page.locator('.shop-showcase .game-cover-soon')).toHaveCount(0)
  await expect(page.locator('.shop-showcase .game-cover img')).toHaveCount(1)
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

test('public newsletter is a truthful stage-only preview; published posts alone enter home', async ({ page }) => {
  const writes: string[] = []
  page.on('request', request => { if (['POST', 'PUT'].includes(request.method()) && request.url().includes('/api/')) writes.push(request.url()) })
  await page.goto('/')
  const newsletter = page.locator('footer .newsletter')
  if (stageTest) {
    await expect(newsletter.getByRole('heading', { name: 'Ideias de encontro no seu e-mail' })).toBeVisible()
    await newsletter.getByLabel('Seu e-mail', { exact: true }).fill('qa-newsletter@example.test')
    await expect(newsletter.getByRole('button', { name: 'Receber ideias' })).toBeDisabled()
    await expect(newsletter).toContainText('Seu e-mail ainda não será enviado.')
    await expect(newsletter).not.toContainText(/inscrição confirmada|preferência salva/i)
  } else await expect(newsletter).toHaveCount(0)
  expect(writes).toEqual([])
  // The build's real published feed is the source of truth, not the draft listing.
  const { readBlogPosts } = await import('../../src/lib/blog.server')
  const published = await readBlogPosts({ stage: 'live' })
  await expect(page.locator('.home-posts > li')).toHaveCount(Math.min(published.length, 3))
  if (!published.length) await expect(page.locator('.from-blog')).toHaveCount(0)
  for (const post of published.slice(0, 3)) await expect(page.locator('.home-posts').getByRole('link', { name: post.title })).toHaveAttribute('href', `/blog/${post.slug}`)
})

test('logged-in newsletter uses existing consent API, stays out of checkout and is not duplicated on posts', async ({ page }) => {
  test.skip(!stageTest, 'Stage test fixture')
  await fixture(page)
  let optedIn = false
  const writes: unknown[] = []
  await page.route('**/api/account', route => route.fulfill({ json: { email: 'qa@example.test', marketing: { opted_in: optedIn, prompted_at: null }, orders: [] } }))
  await page.route('**/api/account/marketing', route => { const body = route.request().postDataJSON(); writes.push(body); optedIn = body.granted; return route.fulfill({ json: { opted_in: optedIn } }) })
  await page.goto('/')
  const newsletter = page.locator('footer .newsletter')
  await expect(newsletter.getByRole('button', { name: 'Quero receber ideias', exact: true })).toBeEnabled()
  await expect(newsletter).toContainText('Dá para sair quando quiser.')
  await expect(newsletter.getByRole('link', { name: 'Privacidade', exact: true })).toHaveAttribute('href', '/privacidade')
  await newsletter.getByRole('button', { name: 'Quero receber ideias', exact: true }).focus(); await page.keyboard.press('Enter')
  await expect(newsletter).toContainText('Você já recebe nossas ideias.')
  expect(writes).toEqual([expect.objectContaining({ granted: true, source: 'signup_prompt', text_version: expect.any(String) })])
  for (const path of ['/carrinho', '/pagamento', '/conta']) { await page.goto(path); await expect(page.locator('main')).toBeVisible(); await expect(page.locator('.newsletter')).toHaveCount(0) }
  // Em Conta, quem já está inscrito vê o estado com o link discreto de descadastro.
  await expect(page.locator('.marketing-form')).toContainText('Você recebe nossas ideias')
  await expect(page.locator('.marketing-form').getByRole('button', { name: 'Parar de receber', exact: true })).toBeVisible()
  await page.goto('/blog/exemplo-como-publicar')
  await expect(page.locator('.blog-post > .newsletter')).toHaveCount(1)
  await expect(page.locator('footer .newsletter')).toHaveCount(0)
})

test('purchase, home and newsletter fit 320–1440 with doubled text', async ({ page }) => {
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
  await page.locator('.shop-showcase').scrollIntoViewIfNeeded()
  await settle(page)
  if (process.env.D3_CAPTURE === '1') {
    await mkdir('.maestri/design-review/d3', { recursive: true })
    await page.locator('.shop-showcase').evaluate(el => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 120))
    await page.locator('.shop-showcase').screenshot({ path: `.maestri/design-review/d3/vitrine-${width}.png`, animations: 'disabled' })
    await page.locator('.footer-newsletter').scrollIntoViewIfNeeded()
    await page.locator('.footer-newsletter').screenshot({ path: `.maestri/design-review/d3/newsletter-rodape-${width}.png`, animations: 'disabled' })
  }
  await axe(page)
})
