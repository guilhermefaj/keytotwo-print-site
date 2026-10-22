import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { cookieChoiceKey, expect, test, type Page } from './fixtures/test'

// Aviso de cookies (DESIGN.md › Aviso de cookies). No stage test ele aparece para revisão, mas aceitar não carrega o
// Google Analytics, que só existe no domínio real do build live. Em preview, nem o aviso nem o "Cookies" do rodapé.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
const stageTest = readFileSync('build/client/index.html', 'utf8').includes('Ambiente de teste')

// Primeira visita: apaga a escolha que a fixture deixa pronta (só no primeiro carregamento, para o reload valer).
async function firstVisit(page: Page) {
  await page.addInitScript(key => { if (!sessionStorage.getItem('cookies-spec')) { sessionStorage.setItem('cookies-spec', '1'); localStorage.removeItem(key) } }, cookieChoiceKey)
  const analytics: string[] = []
  page.on('request', request => { if (/googletagmanager\.com|google-analytics\.com/.test(request.url())) analytics.push(request.url()) })
  return analytics
}

test('primeira visita: o Kito come o cookie dele, recusar vale depois do reload e o rodapé reabre', async ({ page }) => {
  const analytics = await firstVisit(page)
  await page.goto('/')
  const notice = page.getByRole('region', { name: 'O Kito já pegou o cookie dele.' })
  if (!stageTest) {
    await expect(notice).toHaveCount(0)
    await expect(page.locator('footer').getByRole('button', { name: 'Cookies' })).toHaveCount(0)
    return
  }
  await expect(notice).toBeVisible()
  await expect(notice.locator('img')).toHaveAttribute('src', '/media/experience/kito-cookie-187.webp')
  await expect(notice).toContainText('Google Analytics')
  await expect(notice.getByRole('link', { name: 'Política de privacidade' })).toHaveAttribute('href', '/privacidade#navegador')
  // Mede depois da entrada (a animação passa por opacidade parcial); as que repetem (mastigar, migalhas) seguem.
  await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished)))
  const result = await new AxeBuilder({ page }).include('.cookie-notice').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(result.violations).toEqual([])
  await notice.getByRole('button', { name: 'Recusar' }).click()
  await expect(notice).toHaveCount(0)
  expect(JSON.parse(await page.evaluate(key => localStorage.getItem(key) ?? 'null', cookieChoiceKey)).value).toBe('denied')
  await page.reload()
  await expect(page.getByRole('region', { name: 'O Kito já pegou o cookie dele.' })).toHaveCount(0)
  await page.locator('footer').getByRole('button', { name: 'Cookies' }).click()
  await expect(page.getByRole('heading', { name: 'O Kito já pegou o cookie dele.' })).toBeFocused()
  await page.getByRole('button', { name: 'Aceitar' }).click()
  await expect(page.getByRole('region', { name: 'O Kito já pegou o cookie dele.' })).toHaveCount(0)
  expect(JSON.parse(await page.evaluate(key => localStorage.getItem(key) ?? 'null', cookieChoiceKey)).value).toBe('granted')
  // Fora do domínio real (aqui, o stage test), aceitar não carrega o Google Analytics.
  await page.waitForTimeout(500)
  expect(analytics).toEqual([])
})

test('no celular o aviso cabe na tela, e com movimento reduzido o Kito fica parado', async ({ page }) => {
  test.skip(!stageTest, 'O aviso só aparece no stage test (ou no domínio real)')
  await firstVisit(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/loja')
  const notice = page.locator('.cookie-notice')
  await expect(notice).toBeVisible()
  const box = (await notice.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(320)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  expect(await notice.locator('img').evaluate(img => getComputedStyle(img).animationName)).toBe('none')
})
