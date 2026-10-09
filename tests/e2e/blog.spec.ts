import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const slug = 'exemplo-como-publicar'
const exampleExists = existsSync(`build/client/blog/${slug}/index.html`)
const live = readFileSync('build/client/robots.txt', 'utf8').includes('Sitemap:')

for (const width of [320, 390, 768, 1280]) {
  for (const route of ['/blog', `/blog/${slug}`]) {
    test(`${route}: renderiza, axe AA e sem rolagem lateral em ${width}px`, async ({ page }, testInfo) => {
      test.skip(route !== '/blog' && !exampleExists, 'O rascunho não é publicado em live')
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      const response = await page.goto(route)
      expect(response?.status()).toBe(200)
      await page.evaluate(() => document.fonts.ready)
      await expect(page.locator('main h1')).toHaveCount(1)
      await expect(page.locator('main h1')).toBeVisible()
      if (route !== '/blog') {
        await expect(page.locator('.blog-draft')).toHaveText('Rascunho')
        await expect(page.locator('.blog-prose h2')).toHaveCount(3)
        await expect(page.locator('.blog-prose blockquote')).toBeVisible()
        await expect(page.locator('.blog-package a')).toHaveAttribute('href', '/#comprar')
      }
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
      expect(result.violations).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(errors).toEqual([])
      await page.screenshot({ path: testInfo.outputPath(`blog-${route === '/blog' ? 'list' : 'post'}-${width}.png`), fullPage: true })
      // Exercise text scaling, including long code tokens and nested lists.
      await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    })
  }
}

test('navega da lista ao post e volta com metadados próprios e foco visível', async ({ page }) => {
  test.skip(!exampleExists, 'Rascunho excluído do live')
  await page.goto('/blog')
  const link = page.getByRole('link', { name: 'Como publicar pelo painel do blog', exact: true })
  await link.focus()
  expect(await link.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/blog/${slug}$`))
  await expect(page).toHaveTitle('Como publicar pelo painel do blog — KeyToTwo')
  await expect(page.locator('meta[name="description"]')).toHaveCount(1)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/blog/${slug}$`))
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article')
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
  const json = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() ?? '{}')
  expect(json['@type']).toBe('BlogPosting')
  expect(json.headline).toBe('Como publicar pelo painel do blog')
  expect(json.datePublished).toBe('2026-10-09')
  await page.getByRole('link', { name: 'Voltar ao blog' }).first().click()
  await expect(page).toHaveTitle('Blog — KeyToTwo')
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0)
})

test('link Blog está no cabeçalho, menu mobile e rodapé', async ({ page }) => {
  await page.goto('/blog')
  await expect(page.getByRole('navigation', { name: 'Navegação principal', exact: true }).getByRole('link', { name: 'Blog', exact: true })).toBeVisible()
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Blog', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 320, height: 800 })
  await page.getByRole('button', { name: 'Abrir menu' }).click()
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Blog', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Abrir menu' })).toBeFocused()
})

test('RSS e sitemap respeitam stage; admin é estático, fixado e noindex', async ({ request }) => {
  const rss = await request.get('/blog/rss.xml')
  expect(rss.ok()).toBe(true)
  expect(rss.headers()['content-type']).toMatch(/xml/)
  expect(await rss.text()).toContain('<rss version="2.0"')
  const sitemap = readFileSync('build/client/sitemap.xml', 'utf8')
  expect(sitemap).not.toContain('/admin')
  if (live) {
    expect(await rss.text()).not.toContain(slug)
    expect(sitemap).not.toContain(slug)
    expect(exampleExists).toBe(false)
    expect(existsSync(`build/client/blog/${slug}.data`)).toBe(false)
  } else {
    expect(await rss.text()).toContain(`Rascunho: Como publicar pelo painel`)
    expect(await rss.text()).toContain(slug)
  }
  const admin = await request.get('/admin/')
  expect(admin.ok()).toBe(true)
  expect(await admin.text()).toContain('content="noindex, nofollow"')
  expect(await admin.text()).toContain('@sveltia/cms@0.221.0/dist/sveltia-cms.js')
  const config = await request.get('/admin/config.yml')
  expect(await config.text()).toContain('repo: guilhermefaj/keytotwo-print-site')
  expect(await config.text()).toContain('branch: main')
})

test('live sem artigos mostra estado vazio e mantém CTA útil', async ({ page }) => {
  test.skip(!live || exampleExists, 'Somente para build live sem artigos publicados')
  await page.goto('/blog')
  await expect(page.getByRole('heading', { name: 'Ainda não há artigos publicados.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Conhecer o pacote de jogos' })).toHaveAttribute('href', '/#comprar')
  await expect(page.locator('.blog-draft')).toHaveCount(0)
})
