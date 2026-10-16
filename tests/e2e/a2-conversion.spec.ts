import { expect, test } from '@playwright/test'
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
  await expect(page.locator('.experience-section .sample-page')).toHaveCount(3)
  const showcase = page.locator('.shop-showcase')
  await expect(showcase.locator('.shop-price')).toHaveText('R$ 19,90')
  await expect(showcase.getByRole('link', { name: 'Ver detalhes: Rabisque e Adivinhe' })).toHaveAttribute('href', '/loja/j001')
  // O pacote não está no catálogo (incompleto): aparece "Em breve", sem botão de compra.
  await expect(showcase.locator('[data-shop-product="P001"] .shop-soon')).toHaveText('Em breve')
  await expect(showcase.locator('[data-shop-product="P001"]').getByRole('button')).toHaveCount(0)
  await expect(showcase.getByRole('button', { name: 'Adicionar à sacola: Rabisque e Adivinhe', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ver os jogos' }).first()).toHaveAttribute('href', '/loja')
})
