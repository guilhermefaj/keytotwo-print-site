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

// O aviso de cookies fica fixo no canto da tela: nos testes, a escolha já vem feita ("Recusar"), para ele não cobrir
// o que o teste clica. O próprio aviso é testado em cookies.spec.ts, que apaga essa escolha.
export const cookieChoiceKey = 'keytotwo:cookies'
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(key => {
      try { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ value: 'denied', at: new Date().toISOString(), version: 1 })) } catch { /* sem armazenamento */ }
    }, cookieChoiceKey)
    const goto = page.goto.bind(page)
    const reload = page.reload.bind(page)
    page.goto = async (url, options) => { const response = await goto(url, options); await waitInteractive(page); return response }
    page.reload = async options => { const response = await reload(options); await waitInteractive(page); return response }
    await use(page)
  },
})
