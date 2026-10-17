import { test as base, type Page } from '@playwright/test'

export { expect, type Page } from '@playwright/test'

// O JS do site só começa depois da primeira pintura (scripts/html-priorities.mjs). Depois de cada goto/reload,
// espera a página ficar interativa (html[data-interactive], ligado pelo root.tsx) antes de o teste agir, para
// um clique ou uma tecla não cair antes da hidratação. Páginas que não são do site seguem sem espera.
async function waitInteractive(page: Page) {
  if (!/^https?:\/\/127\.0\.0\.1(:\d+)?\//.test(page.url())) return
  const isHtml = await page.evaluate(() => document.contentType === 'text/html' && Boolean(document.querySelector('#conteudo, main'))).catch(() => false)
  if (isHtml) await page.locator('html[data-interactive="true"]').waitFor({ state: 'attached', timeout: 15_000 })
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page)
    const reload = page.reload.bind(page)
    page.goto = async (url, options) => { const response = await goto(url, options); await waitInteractive(page); return response }
    page.reload = async options => { const response = await reload(options); await waitInteractive(page); return response }
    await use(page)
  },
})
