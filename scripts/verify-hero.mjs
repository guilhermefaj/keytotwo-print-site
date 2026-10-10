import { chromium, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { verifyTabVisibility } from './verify-tab-visibility.mjs'

// Artifacts default outside the repository. Point HERO_URL at dev or production preview.
const url = process.env.HERO_URL ?? 'http://127.0.0.1:4174/'
const output = path.resolve(process.env.HERO_QA_DIR ?? path.join(os.tmpdir(), 'keytotwo-hero-qa'))
const walkAssets = JSON.parse(await readFile(new URL('../docs/kito-walk-assets.json', import.meta.url), 'utf8'))
const walkSource = JSON.parse(await readFile(new URL('../docs/kito-walk-source-manifest.json', import.meta.url), 'utf8'))
await mkdir(output, { recursive: true })
const browser = await chromium.launch()
const report = { url, output, browser: browser.version(), viewports: [], accessibility: [], keyboard: [], contrast: [], motion: [], media: [], runtimeErrors: [], consoleErrors: [] }
report.routes = []
report.artRevision = { revision: walkAssets.revision, sources: walkAssets.sources, motion: walkAssets.motion }

async function layoutCheck(page) {
  const result = await page.evaluate(() => {
    const root = document.documentElement
    const scene = document.querySelector('.hero-scene').getBoundingClientRect()
    const sprite = document.querySelector('.kito-track').getBoundingClientRect()
    const floor = document.querySelector('.ground').getBoundingClientRect()
    const pixelScale = sprite.width / 384
    const note = document.querySelector('.hero-copy').getBoundingClientRect()
    const clipped = [...document.querySelectorAll('h1,h2,p,button,a,li')].filter(el => {
      if (!el.checkVisibility() || el.classList.contains('skip-link')) return false
      const track = el.closest('.snap-track')
      if (track && getComputedStyle(track).overflowX === 'auto') return el.scrollWidth > el.clientWidth + 2
      const r = el.getBoundingClientRect()
      const clipsY = ['hidden', 'clip'].includes(getComputedStyle(el).overflowY)
      return r.left < -1 || r.right > innerWidth + 1 || el.scrollWidth > el.clientWidth + 2 || (clipsY && el.scrollHeight > el.clientHeight + 2)
    }).map(el => ({ tag: el.tagName, text: el.textContent, width: el.clientWidth, scroll: el.scrollWidth }))
    return { viewportWidth: innerWidth, documentWidth: root.scrollWidth, documentHeight: root.scrollHeight, sceneClearance: scene.top - note.bottom, spriteTopClearance: sprite.top + 30 * pixelScale - scene.top, footGroundDelta: sprite.top + sprite.width * 1160 / 1254 - floor.top, clipped }
  })
  expect(result.documentWidth).toBeLessThanOrEqual(result.viewportWidth)
  expect(result.clipped).toEqual([])
  expect(result.sceneClearance).toBeGreaterThanOrEqual(20)
  expect(result.spriteTopClearance).toBeGreaterThanOrEqual(0)
  expect(Math.abs(result.footGroundDelta)).toBeLessThanOrEqual(0.1)
  return result
}

async function axe(page, label) {
  // Measure settled UI (staggered sheet links); leave the ambient walk loop alone.
  await page.waitForLoadState('load')
  await page.evaluate(() => Promise.allSettled(document.getAnimations()
    .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map(animation => animation.finished)))
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  report.accessibility.push({ label, violations: result.violations })
  expect(result.violations).toEqual([])
}

async function doubleText(page) {
  await page.evaluate(() => {
    const sizes = [...document.querySelectorAll('body *')].map(el => [el, parseFloat(getComputedStyle(el).fontSize)])
    for (const [el, size] of sizes) el.style.fontSize = `${size * 2}px`
  })
}

try {
  // Framework foundation: HTML exists before JS; direct route loads hydrate cleanly.
  const staticRoutes = [
    ['/', 'A rotina pode esperar. Vocês têm um encontro.'],
    ['/preview/hero', 'A rotina pode esperar. Vocês têm um encontro.'],
    ['/entrar', 'Entrar'], ['/carrinho', 'Carrinho'], ['/meus-jogos', 'Meus jogos'], ['/conta', 'Conta'],
    ['/pedido/confirmacao', 'Confirmação do pedido'], ['/ajuda', 'Ajuda'],
    ['/termos', 'Termos de uso'], ['/privacidade', 'Privacidade'],
    ['/404', 'Página não encontrada'],
  ]
  const protectedRoutes = ['/carrinho', '/meus-jogos', '/conta', '/pedido/confirmacao']
  const redirectPage = await browser.newPage()
  await redirectPage.goto(new URL('/reembolsos', url).href)
  await expect(redirectPage).toHaveURL(/\/termos#reembolso$/)
  await expect(redirectPage.locator('#reembolso')).toBeVisible()
  await redirectPage.close()
  for (const [routePath, title] of staticRoutes) {
    const file = new URL(`../build/client${routePath === '/' ? '' : routePath}/index.html`, import.meta.url)
    const html = await readFile(file, 'utf8')
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/)
    expect(html).toContain('<h1')
    if (routePath === '/') expect(html).toContain('A rotina pode esperar.')
    for (const width of [320, 390, 1440]) {
      const routePage = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      routePage.on('pageerror', error => report.runtimeErrors.push(`${routePath}: ${error.message}`))
      routePage.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(`${routePath}: ${message.text()}`) })
      const response = await routePage.goto(new URL(routePath, url).href)
      expect(response.status()).toBe(200)
      const servedHtml = await response.text()
      const servedHeading = servedHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1].replace(/<[^>]+>/g, '')
      expect(servedHeading).toBe(protectedRoutes.includes(routePath) ? 'Verificando acesso' : title)
      await expect(routePage.locator('h1')).toHaveText(protectedRoutes.includes(routePath) ? 'Entrar' : title)
      await routePage.waitForLoadState('load')
      await routePage.evaluate(() => document.fonts.ready)
      await expect(routePage.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
      expect(await routePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      if (routePath !== '/' && routePath !== '/preview/hero') {
        // Link navigation proves that the pre-rendered shell hydrated.
        await routePage.locator('.site-header .brand').click()
        await expect(routePage.locator('h1')).toHaveText('A rotina pode esperar. Vocês têm um encontro.')
        await expect(routePage.locator('.hero-scene-region')).toHaveAttribute('data-user-paused', 'true')
      } else {
        await expect(routePage.locator('.hero-scene-region')).toHaveAttribute('data-in-view', 'true')
      }
      expect(report.runtimeErrors).toEqual([])
      expect(report.consoleErrors).toEqual([])
      report.routes.push({ routePath, width, html: 'pre-rendered', noindex: true, overflow: false })
      await routePage.close()
    }
  }
  for (const [width, height] of [[320, 800], [390, 844], [768, 1024], [1280, 720], [1440, 900]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.on('pageerror', error => report.runtimeErrors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()) })
    await page.goto(url)
    await page.evaluate(() => document.fonts.ready)
    await expect(page.locator('h1')).toHaveText('A rotina pode esperar. Vocês têm um encontro.')
    await expect(page.locator('a[href="#"]')).toHaveCount(0)
    await page.screenshot({ path: path.join(output, `hero-${width}x${height}.png`), fullPage: true })
    report.viewports.push({ width, height, textZoom: '100%', ...await layoutCheck(page) })
    await axe(page, `${width}x${height}`)
    await doubleText(page)
    await page.screenshot({ path: path.join(output, `hero-${width}x${height}-text200.png`), fullPage: true })
    report.viewports.push({ width, height, textZoom: '200% computed font scaling (text only)', ...await layoutCheck(page) })
    await context.close()
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  await page.goto(url)
  // Header controls stay disabled until the auth provider is ready; wait before tabbing.
  await expect(page.getByRole('button', { name: 'Abrir menu' })).toBeEnabled()
  await page.keyboard.press('Tab')
  await expect(page.getByText('Pular para o conteúdo')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.locator('.site-header .brand')).toBeFocused()
  await page.keyboard.press('Tab')
  const menu = page.getByRole('button', { name: 'Abrir menu' })
  // D1 header: logo, (cart trigger when enabled), menu. The sign-in link lives inside the sheet.
  if (await page.locator('.mobile-navigation .cart-trigger').isVisible()) await page.keyboard.press('Tab')
  await expect(menu).toBeFocused()
  const ring = await menu.evaluate(el => ({ width: getComputedStyle(el).outlineWidth, color: getComputedStyle(el).outlineColor }))
  expect(ring.width).toBe('3px')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Entre e fique à vontade.' })).toBeVisible()
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => Boolean(document.activeElement.closest('[role="dialog"]')))).toBe(true)
  }
  await axe(page, 'mobile menu open')
  await page.screenshot({ path: path.join(output, 'menu-mobile.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await expect(menu).toBeFocused()
  report.keyboard.push('Tab through skip link, logo, cart, mobile menu; Enter opens; focus trapped; Escape closes and restores trigger; focus outline 3px.')

  for (const [name, target] of [['Como funciona', 'como-funciona'], ['Quero o pacote', 'comprar']]) {
    await menu.focus()
    await page.keyboard.press('Enter')
    // Focus the item via actual Tab traversal, then activate via Enter.
    for (let i = 0; i < 8; i++) {
      if (await page.getByRole('dialog').getByRole('link', { name, exact: true }).evaluate(el => el === document.activeElement)) break
      await page.keyboard.press('Tab')
    }
    await expect(page.getByRole('dialog').getByRole('link', { name, exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator(`#${target}`)).toBeFocused()
    expect(new URL(page.url()).hash).toBe(`#${target}`)
    await axe(page, `section ${name}`)
    await page.screenshot({ path: path.join(output, `section-${target}-mobile.png`), fullPage: true })
  }
  report.keyboard.push('Mobile menu links close the sheet and focus the real experience/offer heading at the matching URL fragment.')

  const primary = page.locator('.hero-cta')
  await primary.focus()
  await page.keyboard.press('Enter')
  expect(new URL(page.url()).hash).toBe('#comprar')
  await expect(page.locator('#comprar')).toBeInViewport()
  const secondary = page.locator('.hero-secondary')
  await secondary.focus()
  await page.keyboard.press('Enter')
  expect(new URL(page.url()).hash).toBe('#experiencia')
  await expect(page.locator('#experiencia')).toBeInViewport()
  await expect(page.locator('dialog')).toHaveCount(0)
  report.keyboard.push('Hero CTA reaches the offer and the secondary link reaches the preview with Enter; no demonstration panels remain.')

  // Measure computed colors for each button family across actual normal/hover/active/focus states.
  function contrast(foreground, background) {
    const luminance = color => {
      const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
    }
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
    return (values[0] + .05) / (values[1] + .05)
  }
  async function sample(locator, family, state) {
    const colors = await locator.evaluate(el => {
      const css = getComputedStyle(el)
      const parse = value => { const m = value.match(/[\d.]+/g) || ['0', '0', '0', '0']; return { r: +m[0], g: +m[1], b: +m[2], a: m.length > 3 ? +m[3] : 1 } }
      // Composite translucent backgrounds (hover wash) over the first opaque ancestor.
      const layers = []
      for (let current = el; current; current = current.parentElement) {
        const layer = parse(getComputedStyle(current).backgroundColor)
        if (layer.a > 0) layers.unshift(layer)
        if (layer.a >= 1) break
      }
      let base = { r: 255, g: 255, b: 255 }
      for (const layer of layers) base = { r: layer.r * layer.a + base.r * (1 - layer.a), g: layer.g * layer.a + base.g * (1 - layer.a), b: layer.b * layer.a + base.b * (1 - layer.a) }
      const background = `rgb(${Math.round(base.r)}, ${Math.round(base.g)}, ${Math.round(base.b)})`
      return { foreground: css.color, background, outline: css.outlineColor, outlineWidth: css.outlineWidth }
    })
    const ratio = contrast(colors.foreground, colors.background)
    report.contrast.push({ family, state, ...colors, ratio: Number(ratio.toFixed(2)) })
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  }
  for (const [family, locator] of [['primary', primary], ['secondary', secondary], ['icon', menu], ['motion', page.locator('.motion-button')], ['text-on-white', page.locator('.desktop-nav .nav-link').first()]]) {
    if (family === 'text-on-white') await page.setViewportSize({ width: 1280, height: 720 })
    await page.mouse.move(0, 0)
    await locator.evaluate(el => el.blur())
    await sample(locator, family, 'normal')
    await locator.hover()
    await sample(locator, family, 'hover')
    await page.mouse.down()
    await sample(locator, family, 'active')
    await page.mouse.move(0, 0)
    await page.mouse.up()
    await page.keyboard.press('Tab')
    await locator.focus()
    await sample(locator, family, 'focus')
  }
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    for (const surface of ['menu']) {
      await page.goto(url)
      await menu.click()
      await doubleText(page)
      const modal = page.getByRole('dialog')
      expect(await modal.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const lastLink = modal.getByRole('link').last()
      await lastLink.focus()
      await lastLink.scrollIntoViewIfNeeded()
      const finalControl = await lastLink.evaluate(el => {
        const box = el.getBoundingClientRect()
        return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, viewportHeight: innerHeight, viewportWidth: innerWidth }
      })
      expect(finalControl.top, JSON.stringify({ width, surface, finalControl })).toBeGreaterThanOrEqual(-1)
      expect(finalControl.bottom, JSON.stringify({ width, surface, finalControl })).toBeLessThanOrEqual(finalControl.viewportHeight + 1)
      expect(finalControl.left).toBeGreaterThanOrEqual(-1)
      expect(finalControl.right).toBeLessThanOrEqual(finalControl.viewportWidth + 1)
      await modal.evaluate(el => el.scrollTop = 0)
      await page.screenshot({ path: path.join(output, `${surface}-${width}-text200.png`), fullPage: true })
      report.keyboard.push(`${surface} at ${width}px / text 200%: no horizontal overflow; final control reachable and fully visible after scrolling.`)
    }
  }
  await page.close()

  const snapshot = page => page.evaluate(() => [...document.querySelectorAll('.kito-track,.kito-frames')].map(el => ({
    time: el.getAnimations()[0].currentTime, state: el.getAnimations()[0].playState,
    transform: getComputedStyle(el).transform, frame: getComputedStyle(el).backgroundPositionX, row: getComputedStyle(el).backgroundPositionY,
  })))
  async function assertStill(page) {
    await page.waitForTimeout(100)
    const before = await snapshot(page)
    await page.waitForTimeout(400)
    expect(await snapshot(page)).toEqual(before)
    expect(before.map(a => a.state)).toEqual(['paused', 'paused'])
    return before
  }
  for (const [width, height, speed, cell] of [[1440, 900, walkAssets.motion.desktopPixelsPerSecond, 192], [390, 844, walkAssets.motion.mobilePixelsPerSecond, 128]]) {
    const motionPage = await browser.newPage({ viewport: { width, height }, reducedMotion: 'no-preference' })
    await motionPage.goto(url)
    const region = motionPage.locator('.hero-scene-region')
    const button = motionPage.locator('.motion-button')
    await expect(region).toHaveAttribute('data-running', 'true')
    expect(await motionPage.locator('.kito-frames').evaluate(el => el.getAnimations()[0].effect.getTiming().duration)).toBe(walkAssets.motion.cycleSeconds * 1000)
    const initial = await motionPage.locator('.kito-track').boundingBox()
    expect(initial.x).toBeGreaterThan(0)
    expect(initial.x + initial.width).toBeLessThan(width)
    expect(await button.evaluate(el => !!el.closest('[aria-hidden="true"]'))).toBe(false)
    // Reach pause through the keyboard from the last hero CTA.
    // The secondary hero link is the last control before the motion button.
    await motionPage.locator('.hero-secondary').focus()
    await motionPage.keyboard.press('Tab')
    await expect(button).toBeFocused()
    expect(await button.evaluate(el => getComputedStyle(el).outlineWidth)).toBe('3px')
    await motionPage.keyboard.press('Enter')
    await expect(button).toHaveText('Retomar animação')
    await assertStill(motionPage)
    await motionPage.keyboard.press('Space')
    await expect(button).toHaveText('Pausar animação')
    await expect(region).toHaveAttribute('data-running', 'true')
    const before = await snapshot(motionPage)
    await motionPage.waitForTimeout(350)
    expect((await snapshot(motionPage))[0].time).toBeGreaterThan(before[0].time + 200)
    report.keyboard.push(`${width}px: Tab reaches pause, 3px focus ring, Enter pauses both CSS animations, Space resumes both.`)
    // Observe a complete real-time travel period, with no clock fast-forward.
    const loop = await motionPage.evaluate(async ({ cell, phases }) => {
      const track = document.querySelector('.kito-track')
      const frames = document.querySelector('.kito-frames')
      const duration = track.getAnimations()[0].effect.getTiming().duration
      const samples = [], seenFrames = new Set()
      const start = performance.now()
      await new Promise(resolve => {
        const sample = () => {
          const rect = track.getBoundingClientRect()
          const time = performance.now() - start
          const css = getComputedStyle(frames)
          const column = Math.round(-parseFloat(css.backgroundPositionX) / cell)
          const row = Math.round(-parseFloat(css.backgroundPositionY) / cell)
          const index = row * 6 + column
          const support = phases[index].near.planted ? 'near' : 'far'
          samples.push({ time, x: rect.x, right: rect.right, index, support,
            supportX: rect.x + phases[index][support].ankleX * cell / 1254,
            clockDelta: Math.abs(track.getAnimations()[0].currentTime - frames.getAnimations()[0].currentTime) })
          seenFrames.add(index)
          if (time >= duration + 200) resolve()
          else requestAnimationFrame(sample)
        }
        sample()
      })
      const wraps = samples.slice(1).flatMap((point, i) => point.x < samples[i].x - 10 ? [{ before: samples[i], after: point }] : [])
      const forward = samples.slice(1).map((point, i) => ({ dx: point.x - samples[i].x, dt: point.time - samples[i].time })).filter(p => p.dx >= 0)
      const pairs = samples.slice(1).map((point, i) => ({ before: samples[i], after: point })).filter(pair => pair.after.x >= pair.before.x)
      const transitions = pairs.filter(pair => pair.before.index !== pair.after.index)
      const supportPairs = pairs.filter(pair => pair.before.support === pair.after.support)
      const heldPairs = pairs.filter(pair => pair.before.index === pair.after.index)
      return { duration, elapsed: samples.at(-1).time, sampleCount: samples.length, wraps, frames: [...seenFrames],
        measuredSpeed: forward.reduce((n, p) => n + p.dx, 0) / forward.reduce((n, p) => n + p.dt, 0) * 1000,
        maxClockDelta: Math.max(...samples.map(sample => sample.clockDelta)),
        maxHeldPoseTravel: Math.max(...heldPairs.map(pair => Math.abs(pair.after.x - pair.before.x))),
        heldPoseTravelPairs: heldPairs.filter(pair => Math.abs(pair.after.x - pair.before.x) > 0.02).slice(0, 4),
        maxSupportDrift: Math.max(...supportPairs.map(pair => Math.abs(pair.after.supportX - pair.before.supportX))),
        sequence: transitions.slice(0, 24).map(pair => [pair.before.index + 1, pair.after.index + 1]),
        closes12to1: transitions.some(pair => pair.before.index === 11 && pair.after.index === 0),
        skippedPoses: transitions.filter(pair => (pair.before.index + 1) % 12 !== pair.after.index).length,
      }
    }, { cell, phases: walkSource.framesData })
    // Record the measurement before asserting so a failure still leaves evidence in the report.
    report.motion.push({ width, speed, ...loop })
    expect(loop.elapsed).toBeGreaterThanOrEqual(loop.duration)
    expect(loop.wraps.length).toBeGreaterThanOrEqual(1)
    for (const wrap of loop.wraps) {
      expect(wrap.before.x).toBeGreaterThanOrEqual(width)
      expect(wrap.after.right).toBeLessThanOrEqual(0.1)
    }
    expect(loop.measuredSpeed).toBeCloseTo(speed, 0)
    expect(loop.frames.sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i))
    expect(loop.maxClockDelta).toBeLessThan(0.1)
    expect(loop.maxHeldPoseTravel).toBeLessThan(0.02)
    expect(loop.maxSupportDrift).toBeLessThan(0.02)
    expect(loop.closes12to1).toBe(true)
    expect(loop.skippedPoses).toBe(0)
    // Real scrolling hides the stage; no IntersectionObserver mocking.
    await motionPage.locator('#comprar').scrollIntoViewIfNeeded()
    await expect(region).toHaveAttribute('data-in-view', 'false')
    await assertStill(motionPage)
    await motionPage.locator('.hero-scene').scrollIntoViewIfNeeded()
    await expect(region).toHaveAttribute('data-running', 'true')
    await button.click()
    await motionPage.locator('#comprar').scrollIntoViewIfNeeded()
    await expect(region).toHaveAttribute('data-in-view', 'false')
    await motionPage.locator('.hero-scene').scrollIntoViewIfNeeded()
    await expect(region).toHaveAttribute('data-in-view', 'true')
    await expect(region).toHaveAttribute('data-user-paused', 'true')
    await assertStill(motionPage)
    report.motion.push({ width, initial, expectedSpeed: speed, loop, offscreen: 'pause/resume verified; manual pause preserved' })
    await motionPage.close()
  }
  const reduced = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
  await reduced.goto(url)
  await expect(reduced.locator('.hero-scene-region')).toHaveAttribute('data-visible', 'true')
  await expect(reduced.locator('.hero-scene-region')).toHaveAttribute('data-user-paused', 'true')
  const reducedBefore = await assertStill(reduced)
  const reducedImage = await reduced.locator('.kito-frames').evaluate(el => getComputedStyle(el).backgroundImage)
  expect(reducedImage).toContain('kito-walk-v31-right-atlas.webp')
  expect(reducedBefore[1].frame).toBe('0px')
  expect(reducedBefore[1].row).toBe('0px')
  await reduced.locator('.motion-button').focus()
  await reduced.keyboard.press('Enter')
  await expect(reduced.locator('.hero-scene-region')).toHaveAttribute('data-running', 'true')
  await reduced.waitForTimeout(300)
  expect((await snapshot(reduced))[0].time).toBeGreaterThan(150)
  await reduced.emulateMedia({ reducedMotion: 'no-preference' })
  // MediaQueryList changes are delivered asynchronously; do not coalesce two
  // opposite OS preference changes into a single animation frame.
  await reduced.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await reduced.emulateMedia({ reducedMotion: 'reduce' })
  await expect(reduced.locator('.hero-scene-region')).toHaveAttribute('data-user-paused', 'true')
  await assertStill(reduced)
  report.motion.push({ reducedMotion: 'starts paused on sheet frame 01; explicit Enter enables; re-entering reduce pauses again', image: reducedImage })
  await reduced.close()
  report.nativeTabVisibility = await verifyTabVisibility(url)

  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const mediaPage = await browser.newPage({ viewport: { width, height } })
    await mediaPage.goto(url)
    await mediaPage.evaluate(() => document.fonts.ready)
    await mediaPage.waitForLoadState('networkidle')
    const resources = await mediaPage.evaluate(() => performance.getEntriesByType('resource')
      .filter(entry => /\.(png|webp|woff2?)(\?|$)/.test(entry.name))
      .map(entry => ({ name: new URL(entry.name).pathname, encodedBytes: entry.encodedBodySize, transferBytes: entry.transferSize })))
    const bodyBytes = resources.reduce((sum, entry) => sum + entry.encodedBytes, 0)
    const transferBytes = resources.reduce((sum, entry) => sum + entry.transferBytes, 0)
    // A2 preserves all atlas pixels in lossless WebP. Report the actual total,
    // with a separate regression ceiling for the newly added real product media.
    const atlasBytes = walkAssets.assets[0].bytes
    expect(transferBytes - atlasBytes).toBeLessThan(750_000)
    expect(resources.filter(r => r.name.includes('kito-walk-'))).toHaveLength(1)
    expect(resources.some(r => /kito-static|walking_left|kito-walk-[23]x/.test(r.name))).toBe(false)
    const atlasResponse = await mediaPage.request.get(new URL('/media/hero/kito-walk-v31-right-atlas.webp', url).href)
    expect(createHash('sha256').update(await atlasResponse.body()).digest('hex')).toBe(walkAssets.assets[0].sha256)
    report.media.push({ width, bodyBytes, transferBytes, resources, originalTarget: 500_000, targetMet: transferBytes < 500_000, note: 'A2: lossless WebP; actual media target reported independently of functional PASS' })
    await mediaPage.close()
  }
  expect(report.runtimeErrors).toEqual([])
  expect(report.consoleErrors).toEqual([])
  report.status = 'PASS'
} catch (error) {
  report.status = 'FAIL'
  report.error = error.stack
  process.exitCode = 1
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
}
