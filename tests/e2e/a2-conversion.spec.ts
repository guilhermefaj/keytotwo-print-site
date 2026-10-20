import { expect, test } from './fixtures/test'
import { readFile } from 'node:fs/promises'

// A vitrine do Início aplica a regra da Loja: à venda só com sale + catálogo (preço real vindo do
// /catalog); o pacote incompleto e os jogos sem avulso aparecem "Em breve". A prévia real do J001 fica
// na seção de experiência; nos cards a imagem é a capa oficial.
test('real previews and catalog price on the home showcase', async ({ page }) => {
  const html = await readFile(new URL('../../build/client/index.html', import.meta.url), 'utf8')
  test.skip(!html.includes('Ambiente de teste'), 'Stage test required')
  await page.route('**/api/catalog', route => route.fulfill({ json: { products: [{ code: 'J001', kind: 'single', name: 'Rabisque e Adivinhe', price: { unit_amount: 1990, currency: 'brl' }, games: [{ code: 'J001', name: 'Rabisque e Adivinhe' }] }] } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  // Páginas só dos gratuitos, numa arte (responsável, 2026-10-20); dos jogos pagos, nenhuma página (2026-10-16).
  await expect(page.locator('.experience-art img')).toHaveAttribute('src', '/media/experience/gratuitos-paginas-840.webp')
  await expect(page.locator('.experience-art figcaption').getByRole('link', { name: 'os jogos gratuitos' })).toHaveAttribute('href', '/gratuitos')
  await expect(page.locator('img[src*="j001-page"]')).toHaveCount(0)
  const showcase = page.locator('.shop-showcase')
  // Fileira de capas: cada jogo leva à própria página, com o preço do avulso quando o catálogo o lista.
  const tile = showcase.locator('[data-shop-game="rabisque-e-adivinhe"]')
  await expect(tile.getByRole('link')).toHaveAttribute('href', '/loja/j001')
  await expect(tile.locator('.cover-tile-meta')).toHaveText('R$ 19,90')
  await expect(showcase.locator('[data-shop-game="tabuleiro-da-sorte"] .cover-tile-meta')).toHaveText('No pacote')
  // O pacote não está no catálogo (incompleto): aparece "Em breve", sem botão de compra.
  await expect(showcase.locator('[data-shop-product="P001"] .shop-soon')).toHaveText('Em breve')
  await expect(showcase.locator('[data-shop-product="P001"]').getByRole('button')).toHaveCount(0)
  await expect(showcase.getByRole('button', { name: /Adicionar à sacola/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Ver os jogos' }).first()).toHaveAttribute('href', '/loja')
})
