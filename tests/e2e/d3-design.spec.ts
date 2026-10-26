import { expect, test, type Page } from './fixtures/test'
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
  await expect(page.locator('main')).not.toContainText(/Stripe|indisponível|nova aba/i)
  // Aviso de reembolso antes do pagamento (responsável, 2026-10-19), com o link para a política; desde 2026-10-24 no pé
  // da sacola, fora do resumo com o Finalizar compra.
  await expect(page.locator('.cart-legal')).toContainText('Fora dos casos da Política de reembolso e da lei, não há reembolso depois da liberação')
  await expect(page.locator('.cart-legal').getByRole('link', { name: 'Política de reembolso' })).toHaveAttribute('href', '/reembolsos')
  await expect(page.locator('.cart-summary')).not.toContainText('não há reembolso')
  await capture(page, `carrinho-item-${width}`); await axe(page)
  await page.getByRole('button', { name: 'Finalizar compra', exact: true }).focus(); await page.keyboard.press('Enter')
  await expect(page.locator('main').getByRole('checkbox')).toHaveCount(1)
  // Aceite expresso (Política de reembolso): termos, reembolso e entrega imediata no nome da caixa.
  const terms = page.getByRole('checkbox', { name: /^Li e aceito os termos de uso e a política de reembolso ?, e peço a entrega imediata dos jogos\.$/ })
  await expect(terms).not.toBeChecked()
  await expect(page.getByRole('link', { name: 'Voltar à sacola', exact: true })).toHaveCount(1)
  // desde 2026-10-24 o formulário aparece com a página, travado até o aceite
  await expect(page.locator('.stripe-payment')).toHaveAttribute('data-ready', 'true')
  await expect(page.locator('.payment-lock').first()).toHaveAttribute('data-locked', 'true')
  await expect(page.locator('main')).not.toContainText(/Stripe|nova aba/i)
  await expect(page.locator('.payment-card').getByRole('link', { name: 'política de reembolso' })).toHaveAttribute('href', '/reembolsos')
  await capture(page, `pagamento-antes-${width}`); await axe(page)
  await terms.focus(); await page.keyboard.press('Space')
  await expect(page.locator('.payment-lock').first()).toHaveAttribute('data-locked', 'false')
  await expect(page.getByText('Pagamento seguro', { exact: true })).toHaveCount(1)
  await capture(page, `pagamento-depois-fixture-${width}`); await axe(page)
  await page.getByRole('button', { name: 'Pagar (simulação de teste)' }).click()
  await expect(page.getByRole('link', { name: 'Abrir Meus jogos', exact: true })).toHaveAttribute('href', '/meus-jogos')
  await expect(page.getByText('Também enviamos para o seu e-mail.')).toBeVisible()
  await expect(page.locator('.purchase-celebration')).toBeVisible()
  await capture(page, `confirmacao-${width}`); await axe(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('.purchase-celebration img')).toHaveCSS('animation-name', 'none')
  await expect(page.locator('.confetti-piece').first()).toHaveCSS('animation-name', 'none')
  await page.route('**/api/order-status?*', route => route.fulfill({ json: { state: 'failed' } }))
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Vamos tentar de novo?' })).toBeVisible()
  // Falha de pagamento: Kito em pose neutra (quadro 01 do atlas), nunca a caixa com lágrima.
  await expect(page.locator('.kito-dizzy')).toBeVisible()
  await expect(page.locator('.kito-empty')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Abrir Meus jogos', exact: true })).toHaveCount(0)
  await capture(page, `falha-${width}`); await axe(page)
  await page.route('**/api/cart', route => route.fulfill({ json: { version: 1, items: [], subtotal: null, warnings: [] } }))
  await page.goto('/carrinho')
  await expect(page.locator('.purchase-empty .kito-empty')).toBeVisible()
  await expect(page.locator('.cart-summary')).toHaveCount(0)
  await capture(page, `carrinho-vazio-${width}`); await axe(page)
})

test('vitrine com os jogos do pacote na home; carrossel e relatos só por ação do usuário no celular', async ({ page }) => {
  await page.goto('/')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  // Vitrine: o pacote e os 5 jogos dele (responsável, 2026-10-24; antes, só os 3 primeiros). Os cards com compra ficam na Loja.
  // Fileira de capas clicáveis (Fase 2): cada jogo leva à própria página, sem card completo.
  await expect(page.locator('.shop-showcase .cover-tile')).toHaveCount(5)
  // Capa oficial dos jogos confirmados (a tipográfica fica para quem não tem arte). Nunca a prévia do PDF.
  await expect(page.locator('.shop-showcase .cover-tile-name')).toHaveText(['Rabisque e Adivinhe', 'Tabuleiro da Sorte', 'O Sumiço de Rapadura', 'A Rota da Fornalha', 'Retrospectiva a Dois'])
  await expect(page.locator('.shop-showcase .cover-tile .game-cover-art img')).toHaveCount(5)
  expect(await page.locator('.shop-showcase .cover-tile a').evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(['/loja/rabisque-e-adivinhe', '/loja/tabuleiro-da-sorte', '/loja/o-sumico-de-rapadura', '/loja/a-rota-da-fornalha', '/loja/retrospectiva-a-dois'])
  // O pacote tem a capa própria (Coleção KeyToTwo: Fundadores).
  await expect(page.locator('.shop-showcase .shop-bundle-side > .game-cover-art img')).toHaveAttribute('src', '/media/games/p001-capa-640.webp')
  // Sob a capa do pacote, os 5 jogos dele com o jeito de jogar, sem miniatura (2026-10-24: a de 88 px não se lia).
  await expect(page.locator('.shop-showcase .shop-bundle-games .pack-game-name')).toHaveText(['Rabisque e Adivinhe', 'Tabuleiro da Sorte', 'O Sumiço de Rapadura', 'A Rota da Fornalha', 'Retrospectiva a Dois'])
  await expect(page.locator('.shop-showcase .shop-bundle-games .game-cover')).toHaveCount(0)
  await expect(page.locator('.shop-showcase .game-cover[data-accent]')).toHaveCount(0)
  await expect(page.locator('.shop-showcase .game-cover-type')).toHaveCount(0)
  await expect(page.locator('.shop-showcase img[src*="/media/experience/j001-page"]')).toHaveCount(0)
  await expect(page.locator('.game-number')).toHaveCount(0)
  await page.locator('.shop-showcase').scrollIntoViewIfNeeded()
  await page.setViewportSize({ width: 390, height: 844 })
  if (builtStage() === 'test') {
    // Relatos de exemplo só no stage test, sempre marcados, com a nota de cada um; nunca média ou contagem.
    // A faixa repete a lista uma vez para o laço; a cópia fica fora da leitura e do foco.
    const own = page.locator('.social-track > li:not([aria-hidden])')
    await expect(own.locator('.social-card blockquote')).toHaveCount(8)
    await expect(own.locator('.social-card[data-placeholder="true"]')).toHaveCount(8)
    await expect(own.locator('.social-card .tag-solid')).toHaveCount(0)
    await expect(own.locator('.social-stars[aria-label="Nota 5 de 5"]')).toHaveCount(8)
    await expect(own.locator('.social-photo')).toHaveCount(8)
    await expect(page.locator('.social-track > li[aria-hidden="true"][inert]')).toHaveCount(8)
    // Movimento reduzido: fileira parada que rola à mão, sem a cópia do laço.
    const track = page.locator('.social-track')
    await expect(track).toHaveCSS('animation-name', 'none')
    await expect(page.locator('.social-track > li[aria-hidden="true"]').first()).toBeHidden()
    // Sem a preferência, desliza sem parar e para com o foco.
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(track).toHaveCSS('animation-name', 'social-slide')
    await page.locator('.social-marquee').focus()
    await expect(track).toHaveCSS('animation-play-state', 'paused')
  } else {
    // Em preview e live só relatos reais aparecem; sem nenhum, a seção não existe (P0-1).
    await expect(page.locator('.social-section')).toHaveCount(0)
    await expect(page.locator('.social-card')).toHaveCount(0)
  }
  await expect(page.locator('.social-metrics')).toHaveCount(0)
})

test('home sem escrita na API, com o Kito e o balão dele no rodapé; só posts publicados entram', async ({ page }) => {
  const writes: string[] = []
  page.on('request', request => { if (['POST', 'PUT'].includes(request.method()) && request.url().includes('/api/')) writes.push(request.url()) })
  await page.goto('/')
  await expect(page.locator('.footer-hello .footer-kito')).toHaveCount(1)
  await expect(page.locator('.footer-hello .footer-bubble')).toHaveText('Oi, eu sou o Kito! Vou te acompanhar em novas aventuras.')
  expect(writes).toEqual([])
  // The build's real published feed is the source of truth, not the draft listing.
  const { readBlogPosts } = await import('../../src/lib/blog.server')
  const published = await readBlogPosts({ stage: 'live' })
  await expect(page.locator('.home-posts > li')).toHaveCount(Math.min(published.length, 3))
  if (!published.length) await expect(page.locator('.from-blog')).toHaveCount(0)
  for (const post of published.slice(0, 3)) await expect(page.locator('.home-posts').getByRole('link', { name: post.title })).toHaveAttribute('href', `/blog/${post.slug}`)
})

test('logged-in: Conta keeps the e-mail preference, payment footer stays minimal', async ({ page }) => {
  test.skip(!stageTest, 'Stage test fixture')
  await fixture(page)
  await page.route('**/api/account', route => route.fulfill({ json: { email: 'qa@example.test', marketing: { opted_in: false }, orders: [] } }))
  // Pagamento em modo foco: só a linha legal, sem o Kito nem os convites do rodapé público.
  await page.goto('/pagamento')
  await expect(page.locator('footer .footer-hello')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Informações legais', exact: true }).getByRole('link')).toHaveText(['Termos de uso', 'Reembolsos', 'Privacidade', 'Ajuda'])
  await expect(page.locator('footer')).toContainText('CNPJ 66.782.936/0001-20')
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
      if (path === '/pagamento') await expect(page.locator('.stripe-payment')).toHaveAttribute('data-ready', 'true')
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
    await page.locator('.footer-hello').scrollIntoViewIfNeeded()
    await page.locator('.site-footer').screenshot({ path: `.maestri/design-review/d3/rodape-${width}.png`, animations: 'disabled' })
  }
  await axe(page)
})
