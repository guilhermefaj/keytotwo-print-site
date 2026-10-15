import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdir, readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { builtStage } from './fixtures/stage'

const stage = builtStage()
const hasBlogPosts = readFileSync('build/client/blog/index.html', 'utf8').includes('class="blog-entry')
const links = ['Início', 'Loja', ...(hasBlogPosts ? ['Blog'] : [])]

async function capture(page: Page, name: string) {
  if (process.env.MENU_CAPTURE !== '1') return
  await mkdir('design-review/menu', { recursive: true })
  await page.evaluate(() => document.fonts.ready)
  await sharp(await page.screenshot({ animations: 'disabled' })).webp({ quality: 85 }).toFile(`design-review/menu/${stage}-${name}.webp`)
}

test('menu: Blog corresponde aos posts do build, inclusive no fallback e na navegação SPA', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  for (const path of ['index.html', 'loja/index.html', '__spa-fallback.html']) {
    const html = await readFile(`build/client/${path}`, 'utf8')
    expect(html).toContain('hasBlogPosts')
    if (path === '__spa-fallback.html') expect(html).not.toContain('Como publicar pelo painel do blog')
  }
  await page.goto('/endereco-inexistente-i6')
  await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible()
  await expect(page.locator('.desktop-nav a')).toHaveText(links)
  const dataRequests: string[] = []
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('.data')) dataRequests.push(request.url()) })
  await page.locator('.desktop-nav').getByRole('link', { name: 'Loja', exact: true }).click()
  await expect(page).toHaveURL(/\/loja$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Loja' })).toBeVisible()
  await page.locator('.desktop-action').getByRole('link', { name: 'Ajuda', exact: true }).click()
  await expect(page).toHaveURL(/\/ajuda$/)
  await expect(page.locator('.desktop-nav a')).toHaveText(links)
  await expect(page.locator('footer').getByRole('link', { name: 'Blog', exact: true })).toHaveCount(hasBlogPosts ? 1 : 0)
  expect(dataRequests).toEqual([])
  expect(errors).toEqual([])
})

test('menu: Loja ativa nos detalhes e CTA oculto; rodapé preserva Como funciona', async ({ page }) => {
  for (const path of ['/loja', '/loja/j001', '/loja/p001/']) {
    await page.goto(path)
    await expect(page.locator('.desktop-nav [aria-current="page"]')).toHaveText('Loja')
    await expect(page.locator('header').getByRole('link', { name: 'Ver os jogos' })).toHaveCount(0)
  }
  const footer = page.getByRole('navigation', { name: 'Explorar', exact: true })
  await expect(footer.getByRole('link')).toHaveText(['Início', 'Loja', 'Como funciona', ...(hasBlogPosts ? ['Blog'] : [])])
  await expect(footer.getByRole('link', { name: 'Como funciona' })).toHaveAttribute('href', '/#como-funciona')
  await page.goto('/ajuda')
  const cta = page.locator('.desktop-action').getByRole('link', { name: 'Ver os jogos' })
  await cta.focus()
  expect(await cta.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/loja$/)
})

for (const width of [375, 1280]) test(`menu: teclado, axe e capturas em ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/ajuda')
  await capture(page, `cabecalho-${width}`)
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])
  if (width === 375) {
    const trigger = page.getByRole('button', { name: 'Abrir menu' })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('.sheet-nav a')).toHaveText(links)
    await expect(dialog.getByRole('link', { name: 'Ver os jogos' })).toHaveAttribute('href', '/loja')
    await capture(page, 'menu-aberto-375')
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([])
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
    await trigger.click()
    await dialog.getByRole('link', { name: 'Loja', exact: true }).click()
    await expect(dialog).toBeHidden()
    await trigger.click()
    await expect(dialog.locator('[aria-current="page"]')).toHaveText('Loja')
    await expect(dialog.getByRole('link', { name: 'Ver os jogos' })).toHaveCount(0)
    await capture(page, 'menu-loja-375')
  } else {
    await page.locator('.desktop-nav').getByRole('link', { name: 'Loja', exact: true }).click()
    await capture(page, 'cabecalho-loja-1280')
  }
})

test('menu: cabeçalho e painel cabem em 320–1440 com texto 200%', async ({ page }) => {
  for (const width of [320, 375, 768, 1024, 1120, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/ajuda')
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (width <= 1120) {
      await page.getByRole('button', { name: 'Abrir menu' }).click()
      expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    }
  }
})

test('menu: Jogo grátis depende da disponibilidade, em desktop e celular', async ({ page }) => {
  test.skip(stage === 'preview', 'Preview não consulta o jogo gratuito')
  for (const available of [false, true]) {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.route('**/functions/v1/api/free-game', route => route.fulfill({ json: { available } }))
    await page.goto('/ajuda')
    await expect(page.locator('.desktop-nav').getByRole('link', { name: 'Jogo grátis' })).toHaveCount(available ? 1 : 0)
    await page.setViewportSize({ width: 375, height: 900 })
    await page.getByRole('button', { name: 'Abrir menu' }).click()
    await expect(page.getByRole('dialog').getByRole('link', { name: 'Jogo grátis' })).toHaveCount(available ? 1 : 0)
    await page.keyboard.press('Escape')
    await page.unroute('**/functions/v1/api/free-game')
  }
})
