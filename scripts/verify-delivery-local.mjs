import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Explicit local integration only. No tokens, signed URLs or sessions in artifacts.
const email = process.env.KTT_QA_EMAIL
const deliveryId = process.env.KTT_DELIVERY_MAIL_ID
const marketingId = process.env.KTT_MARKETING_MAIL_ID
if (!email || !deliveryId || !marketingId) throw new Error('Set KTT_QA_EMAIL, KTT_DELIVERY_MAIL_ID and KTT_MARKETING_MAIL_ID after preparing a local paid order and marketing email')
const origin = 'http://127.0.0.1:5178'
const mailpit = 'http://127.0.0.1:54324/api/v1'
const output = path.resolve(process.env.KTT_QA_DIR || 'D:/Maestri/qa/keytotwo-a2/integration')
await mkdir(output, { recursive: true })
const browser = await chromium.launch()
const report = { origin, checks: [], status: 'RUNNING' }
let step = 'login'
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  const previous = new Set((await fetch(`${mailpit}/messages?limit=100`).then(r => r.json())).messages.map(m => m.ID))
  await page.goto(`${origin}/entrar?next=/meus-jogos`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel('E-mail', { exact: true }).fill(email)
  await page.getByRole('button', { name: 'Enviar código', exact: true }).click()
  await expect(page.getByLabel('Código de verificação')).toBeVisible()
  let code = ''
  await expect.poll(async () => {
    const inbox = await fetch(`${mailpit}/messages?limit=100`).then(r => r.json())
    const message = inbox.messages.find(m => !previous.has(m.ID) && m.To.some(to => to.Address === email))
    if (!message) return false
    const detail = await fetch(`${mailpit}/message/${message.ID}`).then(r => r.json())
    code = (detail.Text || detail.HTML || '').match(/\b\d{6}\b/)?.[0] || ''
    return code.length === 6
  }, { timeout: 20000 }).toBe(true)
  await page.getByLabel('Código de verificação').fill(code)
  await page.getByRole('button', { name: 'Confirmar código', exact: true }).click()
  await expect(page).toHaveURL(/\/meus-jogos$/)
  report.checks.push('Login with real Mailpit code')
  step = 'library PDF'
  await expect(page.getByRole('button', { name: 'Baixar PDF', exact: true })).toHaveCount(5)
  await expect(page.locator('main')).toContainText('Coleção KeyToTwo: Fundadores')
  await expect(page.locator('main')).not.toContainText('Demonstração')
  const response = page.waitForResponse(r => r.url().endsWith('/api/download-url'))
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Baixar PDF', exact: true }).first().click()
  expect((await response).status()).toBe(200)
  const download = await downloaded
  expect(await download.failure()).toBeNull()
  const filename = path.join(output, path.basename(download.suggestedFilename()))
  await download.saveAs(filename)
  const pdf = await readFile(filename)
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  report.checks.push({ libraryGames: 5, downloadStatus: 200, pdfBytes: pdf.length, pdfSignature: '%PDF-', filename })
  await page.screenshot({ path: path.join(output, 'library-desktop.png'), fullPage: true })

  async function emailLinks(id) {
    const message = await fetch(`${mailpit}/message/${id}`).then(r => r.json())
    return [...(message.HTML || '').matchAll(/href=["']([^"']+)["']/g)].map(match => match[1].replaceAll('&amp;', '&'))
  }
  step = 'email download redirect'
  const deliveryLink = (await emailLinks(deliveryId)).find(url => new URL(url).pathname.includes('/api/d/'))
  expect(Boolean(deliveryLink)).toBe(true)
  const redirect = await fetch(deliveryLink, { redirect: 'manual' })
  expect(redirect.status).toBe(302)
  const destination = new URL(redirect.headers.get('location'))
  expect(destination.protocol).toBe('https:')
  expect(destination.hostname).toMatch(/backblazeb2\.com$/)
  report.checks.push({ emailDownloadRedirect: 302, destination: 'B2 HTTPS (signed URL not stored)' })

  step = 'public unsubscribe'
  const marketingLink = (await emailLinks(marketingId)).find(url => new URL(url).pathname === '/email/preferencias')
  expect(Boolean(marketingLink)).toBe(true)
  const token = new URL(marketingLink).searchParams.get('token')
  const apiLink = `http://127.0.0.1:54321/functions/v1/api/email/unsubscribe?${new URLSearchParams({ token })}`
  const getResult = await fetch(apiLink, { redirect: 'manual' })
  expect(getResult.status).toBe(302)
  expect(new URL(getResult.headers.get('location')).pathname).toBe('/email/preferencias')
  const publicContext = await browser.newContext()
  const publicPage = await publicContext.newPage()
  let posts = 0
  publicPage.on('request', request => { if (request.url().endsWith('/api/email/unsubscribe') && request.method() === 'POST') posts++ })
  await publicPage.goto(marketingLink)
  await publicPage.waitForLoadState('networkidle')
  expect(posts).toBe(0)
  for (let i = 0; i < 2; i++) {
    if (i) { await publicPage.goto(marketingLink); await publicPage.waitForLoadState('networkidle') }
    const result = publicPage.waitForResponse(r => r.url().endsWith('/api/email/unsubscribe'))
    await publicPage.getByRole('button', { name: 'Parar de receber novidades', exact: true }).click()
    expect((await result).status()).toBe(200)
    await expect(publicPage.getByRole('heading', { name: 'Tudo certo por aqui.' })).toBeVisible()
    await expect(publicPage).toHaveURL(`${origin}/email/preferencias`)
  }
  expect(posts).toBe(2)
  await publicPage.screenshot({ path: path.join(output, 'unsubscribed-desktop.png'), fullPage: true })
  await page.goto(`${origin}/conta`)
  await expect(page.locator('.marketing-form input[type="checkbox"]')).not.toBeChecked()
  await page.reload()
  await expect(page.locator('.marketing-form input[type="checkbox"]')).not.toBeChecked()
  report.checks.push({ apiGetRedirect: 302, postsBeforeClick: 0, explicitPosts: 2, postStatuses: [200, 200], accountOptInAfterReload: false, tokenRemovedFromAddress: true })
  report.status = 'PASS'
} catch {
  report.status = 'FAIL'
  report.failedStep = step
  process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
