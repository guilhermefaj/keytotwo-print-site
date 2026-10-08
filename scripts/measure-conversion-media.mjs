import { chromium } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

// Actual uncached first-fold media after integration. No response substitutions.
const url = process.env.HERO_URL || 'http://127.0.0.1:5178/'
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Use a local preview URL')
const root = path.resolve(import.meta.dirname, '..')
const browser = await chromium.launch()
const results = []
try {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' })
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    await page.goto(url)
    await page.evaluate(() => document.fonts.ready)
    await page.waitForLoadState('networkidle')
    const resources = await page.evaluate(() => performance.getEntriesByType('resource')
      .filter(entry => /\.(png|webp|woff2?)(\?|$)/.test(entry.name))
      .map(entry => ({ path: new URL(entry.name).pathname, bodyBytes: entry.encodedBodySize, transferBytes: entry.transferSize })))
    const atlas = resources.filter(resource => resource.path.includes('kito-walk-v31-right-atlas'))
    if (atlas.length !== 1 || !atlas[0].path.endsWith('.webp')) throw new Error('Expected exactly one lossless WebP atlas')
    const bodyBytes = resources.reduce((sum, resource) => sum + resource.bodyBytes, 0)
    const transferBytes = resources.reduce((sum, resource) => sum + resource.transferBytes, 0)
    results.push({ mode: 'integrated A2 application', width, height, resources, bodyBytes, transferBytes, targetBytes: 500000, targetMet: transferBytes <= 500000 })
    await context.close()
  }
} finally { await browser.close() }
const report = { url, measuredAt: new Date().toISOString(), scope: 'Uncached images and fonts loaded before any scroll, integrated A2 home. Includes below-fold images prefetched by native lazy loading. HTTP transfer sizes include resource headers.', results }
await writeFile(path.join(root, 'docs/conversion-media.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(results.map(({ mode, width, bodyBytes, transferBytes, targetMet }) => ({ mode, width, bodyBytes, transferBytes, targetMet })), null, 2))
