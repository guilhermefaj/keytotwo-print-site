import { readFile } from 'node:fs/promises'
import { expect, test } from './fixtures/test'

// O nginx entrega a 404 pronta (error_page) em todo endereço que não existe; o sirv dos testes não, então a rota simula,
// com o .data do produto ou do post também em 404. A página tem de hidratar sem divergir do HTML (erro #418 do React,
// 2026-10-25: a tela de carregamento entrava por cima da 404) e acabar na página certa.
const notFound = await readFile(new URL('../../build/client/404/index.html', import.meta.url), 'utf8')

for (const [path, heading] of [['/nao-existe', 'Página não encontrada'], ['/loja/jogo-que-nao-existe', 'Página não encontrada'], ['/blog/post-que-nao-existe', /não encontrad/]] as const) {
  test(`404 do nginx em ${path}: hidrata sem divergir e mostra a página certa`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/functions/v1/api/**', route => route.fulfill({ json: { products: [], banner: null } }))
    await page.route(url => url.pathname === path || url.pathname === `${path}.data`, route => route.fulfill({ status: 404, contentType: 'text/html', body: notFound }))
    const response = await page.goto(path)
    expect(response?.status()).toBe(404)
    await expect(page.locator('html')).toHaveAttribute('data-interactive', 'true')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading)
    await expect(page.getByRole('link', { name: 'KeyToTwo — início' }).first()).toBeVisible()
    expect(errors).toEqual([])
  })
}
