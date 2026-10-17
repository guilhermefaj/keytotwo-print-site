import { expect, test } from './fixtures/test'
import AxeBuilder from '@axe-core/playwright'

// Central de ajuda (Fase 3): temas, guia de impressão sem páginas do PDF e atendimento por e-mail.
test('ajuda: temas levam às seções, guia por jogo e atendimento com cópia do e-mail', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/ajuda')
  const topics = page.getByRole('navigation', { name: 'Temas da ajuda' }).getByRole('link')
  await expect(topics).toHaveCount(4)
  await expect(topics.nth(2)).toHaveAttribute('href', '#impressao')
  await expect(page.locator('.print-guide li')).toHaveCount(5)
  await expect(page.locator('.help-game-needs h4')).toHaveText(['Rabisque e Adivinhe', 'Tabuleiro da Sorte', 'O Sumiço de Rapadura'])
  await expect(page.locator('img[src*="j001-page"]')).toHaveCount(0)
  await expect(page.getByRole('main')).not.toContainText(/em breve|preparando nosso canal/i)
  const email = page.locator('.support-email')
  await expect(email).toHaveText('contato@keytotwo.com.br')
  await expect(email).toHaveAttribute('href', 'mailto:contato@keytotwo.com.br')
  await page.getByRole('button', { name: 'Copiar e-mail' }).click()
  await expect(page.getByRole('button', { name: 'E-mail copiado' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('contato@keytotwo.com.br')
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(result.violations.map(v => v.id)).toEqual([])
})
