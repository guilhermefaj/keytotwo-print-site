import { expect, test, type Page } from '@playwright/test'

// The 12 routes pre-rendered into build/client/<route>/index.html.
const routes = [
  '/',
  '/preview/hero',
  '/entrar',
  '/carrinho',
  '/meus-jogos',
  '/conta',
  '/pedido/confirmacao',
  '/ajuda',
  '/termos',
  '/privacidade',
  '/reembolsos',
  '/404',
]

const viewports = [
  { name: '320', width: 320, height: 640 },
  { name: '1440', width: 1440, height: 900 },
]
const protectedRoutes = ['/carrinho', '/meus-jogos', '/conta', '/pedido/confirmacao']

// Collects anything that signals a runtime or hydration failure.
function trackErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`)
  })
  page.on('requestfailed', request => errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`))
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`http ${response.status()}: ${response.url()}`)
  })
  return errors
}

// Hydration is done once React has attached its internal fiber key to the root content.
async function waitForHydration(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.waitForFunction(() => {
    const root = document.body.firstElementChild
    return [document.body, root, ...document.body.querySelectorAll('*')].some(
      el => el && Object.keys(el).some(key => key.startsWith('__reactFiber') || key.startsWith('__reactProps')),
    )
  })
}

for (const route of routes) {
  test.describe(`rota ${route}`, () => {
    test('carrega direto com 200, sem erro de console nem de hidratação, e é noindex', async ({ page }) => {
      const errors = trackErrors(page)
      const response = await page.goto(route)
      // /404 is a static document for the host; it is still served directly here.
      expect(response?.status(), `status de ${route}`).toBe(200)
      await waitForHydration(page)

      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
      await expect(page.locator('h1').first()).toBeVisible()
      if (protectedRoutes.includes(route)) {
        await expect(page).toHaveURL(new RegExp(`/entrar\\?next=${encodeURIComponent(route)}$`))
        await expect(page.getByRole('heading', { name: 'Entrar', exact: true })).toBeVisible()
      }
      expect(errors, `erros em ${route}`).toEqual([])
    })

    for (const viewport of viewports) {
      test(`sem rolagem horizontal em ${viewport.name}px`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await page.goto(route)
        await waitForHydration(page)
        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }))
        expect(scrollWidth, `scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`).toBeLessThanOrEqual(clientWidth)
      })
    }
  })
}

test('H1 da hero em /', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('h1#hero-title')).toContainText('A próxima fase')
  await expect(page.locator('h1#hero-title')).toContainText('é de vocês dois.')
  await expect(page.locator('h1')).toHaveCount(1)
})
