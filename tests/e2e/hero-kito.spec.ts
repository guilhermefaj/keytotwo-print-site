import { expect, test, type Page } from './fixtures/test'

// O Kito da hero (src/lib/kito-playground.ts): persegue o mouse, vai até onde a pessoa toca, pode ser carregado
// e cai de volta no chão; sem mouse, já começa se movendo. Com movimento reduzido fica parado de frente, sem baixar
// o motor nem o atlas.
const sprite = (page: Page) => page.locator('.kito-sprite')

async function kito(page: Page) {
  const box = (await sprite(page).boundingBox())!
  return { x: box.x + box.width / 2, bottom: box.y + box.height }
}
// Distância entre a borda de baixo da célula e a linha do chão: os pés ficam acima dela, dentro da célula.
async function aboveGround(page: Page) {
  const ground = (await page.locator('.hero-scene .ground').boundingBox())!
  return (await kito(page)).bottom - ground.y
}

test('desktop: persegue o cursor pelo chão, vai no colo e volta ao chão', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.locator('.kito-layer')).toHaveAttribute('data-live', 'true')

  // Na cena, longe do botão (com o cursor no botão ele vai apontar).
  await page.mouse.move(200, 680)
  await expect.poll(async () => (await kito(page)).x, { timeout: 10_000 }).toBeLessThan(240)

  const hitbox = (await page.locator('.kito-hitbox').boundingBox())!
  await page.mouse.move(hitbox.x + hitbox.width / 2, hitbox.y + hitbox.height / 3)
  await page.mouse.down()
  await page.mouse.move(700, 320, { steps: 12 })
  await expect(sprite(page)).toHaveAttribute('data-mode', 'carried')
  await expect(page.locator('html')).toHaveAttribute('data-kito-carrying', 'true')
  expect(await aboveGround(page)).toBeLessThan(-100)

  await page.mouse.up()
  await expect(page.locator('html')).not.toHaveAttribute('data-kito-carrying')
  await expect.poll(() => sprite(page).getAttribute('data-mode'), { timeout: 10_000 }).toMatch(/^(idle|hello|love|sleep|move)$/)
  const resting = await aboveGround(page)
  expect(resting).toBeGreaterThanOrEqual(0)
  expect(resting).toBeLessThan(32)
})

test('desktop: aponta o botão e fica em cima dele quando solto ali', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.locator('.kito-layer')).toHaveAttribute('data-live', 'true')
  const cta = (await page.locator('.hero-cta').boundingBox())!
  await page.mouse.move(cta.x + cta.width / 2, cta.y + cta.height / 2, { steps: 4 })
  await expect(sprite(page)).toHaveAttribute('data-mode', 'point', { timeout: 10_000 })

  // Segurando pela cabeça logo acima do botão, os pés ficam abaixo da borda: ele fica em cima do botão mesmo assim,
  // e não desce sozinho quando o cursor vai para longe.
  const hitbox = (await page.locator('.kito-hitbox').boundingBox())!
  await page.mouse.move(hitbox.x + hitbox.width / 2, hitbox.y + hitbox.height / 3)
  await page.mouse.down()
  await page.mouse.move(cta.x + cta.width / 2, cta.y - 120, { steps: 12 })
  await page.waitForTimeout(200)
  await page.mouse.up()
  await expect.poll(() => sprite(page).getAttribute('data-mode'), { timeout: 5_000 }).toMatch(/^(idle|hello|love|point)$/)
  await page.mouse.move(1200, 680, { steps: 4 })
  await page.waitForTimeout(2_000)
  const feetOnButton = (await kito(page)).bottom - cta.y
  expect(feetOnButton).toBeGreaterThanOrEqual(0)
  expect(feetOnButton).toBeLessThan(32)
})

test('movimento reduzido: o Kito fica parado de frente e o motor só desce sem a preferência', async ({ page }) => {
  const requested: string[] = []
  page.on('request', request => requested.push(request.url()))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const before = await kito(page)
  await page.mouse.move(200, 500)
  await page.waitForTimeout(800)
  expect(await kito(page)).toEqual(before)
  expect(await page.locator('.kito-hitbox').evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none')
  expect(requested.some(url => url.includes('kito-pixel-atlas'))).toBe(false)

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(page.locator('.kito-layer')).toHaveAttribute('data-live', 'true')
  expect(requested.some(url => url.includes('kito-pixel-atlas'))).toBe(true)
})

test.describe('celular', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

  test('começa andando sozinho; um toque chama o Kito; só o corpo dele segura a rolagem', async ({ page }) => {
    await page.goto('/')
    await page.locator('.hero-scene').scrollIntoViewIfNeeded()
    await expect(page.locator('.kito-layer')).toHaveAttribute('data-live', 'true')
    // Sem toque nenhum ele já sai do lugar: quem chega vê que ele anda.
    const start = (await kito(page)).x
    await expect.poll(async () => Math.abs((await kito(page)).x - start), { timeout: 10_000 }).toBeGreaterThan(30)
    const scene = (await page.locator('.hero-scene').boundingBox())!
    await page.touchscreen.tap(60, scene.y + 40)
    await expect.poll(async () => (await kito(page)).x, { timeout: 10_000 }).toBeLessThan(110)
    expect(await page.locator('.kito-hitbox').evaluate(el => getComputedStyle(el).touchAction)).toBe('none')
    expect(await page.locator('.hero-scene').evaluate(el => getComputedStyle(el).touchAction)).toBe('auto')
  })
})
