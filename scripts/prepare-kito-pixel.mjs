import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

// O Kito da hero em pixel art real, enviado pelo responsável em 2026-10-18 (Kito.zip em art-source/kito-pixel/, 256 px).
// O dado que ficava ao lado dele saiu em 2026-10-20, a pedido do responsável. Grava:
// - public/media/hero/kito-pixel-atlas.webp: os quadros numa grade de células, WebP sem perda;
// - public/media/hero/kito-pixel-pose.webp: a pose parada que o servidor entrega antes do atlas;
// - src/kito-sprites.ts: posição de cada animação no atlas, linha do chão e pontos de pega.
// Animações com lado só entram viradas para a direita: as da esquerda são o espelho exato delas (0 pixel de diferença)
// e a hero espelha no CSS.
// O balanço de quando o Kito é carregado sai do quadro mais alto do "erguido no ar" (pés pendurados), girado com
// RotSprite (Scale2x três vezes, giro por vizinho mais próximo, volta ao tamanho original), para o pixel continuar limpo.
const root = path.resolve(import.meta.dirname, '..')
const KITO = 256

const frame = (folder, direction, i) => `${folder}/${direction}/frame_${String(i).padStart(3, '0')}.png`
const anim = (folder, direction, count) => Array.from({ length: count }, (_, i) => frame(`Idle/animations/${folder}`, direction, i))
const kitoAnimations = {
  front: ['Idle/rotations/south.png'],
  frontSide: ['Idle/rotations/south-east.png'],
  side: ['Idle/rotations/east.png'],
  walk: anim('Walking', 'east', 8),
  run: anim('Running', 'east', 8),
  sprint: anim('Full_Sprint', 'east', 8),
  jump: anim('Two-Footed_Jump', 'south', 7),
  fall: anim('penguin_falling_in_a_cute_and_funny_way', 'east', 9),
  push: anim('Push_Object', 'east', 6),
  sit: ['sitting_down_the_ch/rotations/south.png'],
  love: Array.from({ length: 9 }, (_, i) => frame('In_love_holding_a_bi/animations/The_character_rhythmically_hops_with_both_feet_whi', 'south', i)),
  wave: anim('The_character_lifts_its_right_hand_to_shoulder_hei', 'south', 9),
  hoist: anim('The_character_is_suddenly_hoisted_into_the_air_by', 'south', 9),
  sleep: Array.from({ length: 9 }, (_, i) => frame('sleeping/animations/The_character_rhythmically_inhales_and_exhales_cau', 'south', i)),
  dizzy: anim('The_character_wobbles_unsteadily_head_swaying_with', 'east', 9),
  point: anim('The_penguin_raises_its_right_arm_in_a_sharp_enthus', 'south', 9),
}
// Ângulos em graus, sentido horário positivo (o mesmo do CSS). ±18° ainda cabe na célula.
const carryAngles = [-18, -9, 0, 9, 18]
const carryBase = kitoAnimations.hoist[4]

async function readFrame(source, file, cell) {
  const { data, info } = await sharp(path.join(root, source, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (info.width !== cell || info.height !== cell) throw new Error(`${file}: esperado ${cell}×${cell}`)
  return new Uint32Array(data.buffer, data.byteOffset, cell * cell).slice()
}

function bounds(pixels, size) {
  let left = size, top = size, right = -1, bottom = -1
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!(pixels[y * size + x] >>> 24)) continue
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
  }
  return { left, top, right, bottom }
}

function scale2x(pixels, size) {
  const out = new Uint32Array(size * size * 4)
  const at = (x, y) => pixels[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))]
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = at(x, y), a = at(x, y - 1), b = at(x + 1, y), c = at(x - 1, y), d = at(x, y + 1)
    const row = y * 2 * size * 2, next = row + size * 2
    out[row + x * 2] = c === a && c !== d && a !== b ? a : p
    out[row + x * 2 + 1] = a === b && a !== c && b !== d ? b : p
    out[next + x * 2] = d === c && d !== b && c !== a ? c : p
    out[next + x * 2 + 1] = b === d && b !== a && d !== c ? d : p
  }
  return out
}

// Gira em torno do centro do contorno e devolve a célula com o desenho centrado e o ponto de pega (topo da cabeça).
function rotSprite(pixels, degrees, grab) {
  const cell = KITO
  const big = scale2x(scale2x(scale2x(pixels, cell), cell * 2), cell * 4)
  const size = cell * 8
  const box = bounds(pixels, cell)
  const cx = (box.left + box.right + 1) / 2 * 8, cy = (box.top + box.bottom + 1) / 2 * 8
  const cos = Math.cos(degrees * Math.PI / 180), sin = Math.sin(degrees * Math.PI / 180)
  const rotated = new Uint32Array(cell * cell)
  for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
    // Amostra o centro do bloco 8×8 de destino e procura a origem pelo giro inverso.
    const dx = x * 8 + 4 - size / 2, dy = y * 8 + 4 - size / 2
    const sx = Math.round(cx + dx * cos + dy * sin), sy = Math.round(cy - dx * sin + dy * cos)
    if (sx >= 0 && sy >= 0 && sx < size && sy < size) rotated[y * cell + x] = big[sy * size + sx]
  }
  const turned = bounds(rotated, cell)
  if (turned.left === 0 || turned.top === 0 || turned.right === cell - 1 || turned.bottom === cell - 1) throw new Error(`O giro de ${degrees}° não cabe na célula`)
  const gx = grab[0] * 8 - cx, gy = grab[1] * 8 - cy
  return { pixels: rotated, grab: [Math.round((gx * cos - gy * sin) / 8 + cell / 2), Math.round((gx * sin + gy * cos) / 8 + cell / 2)] }
}

async function pack(frames, cell, columns) {
  const rows = Math.ceil(frames.length / columns)
  const atlas = Buffer.alloc(columns * cell * rows * cell * 4)
  frames.forEach((pixels, index) => {
    const bytes = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength)
    const ox = index % columns * cell, oy = Math.floor(index / columns) * cell
    for (let y = 0; y < cell; y++) bytes.copy(atlas, ((oy + y) * columns * cell + ox) * 4, y * cell * 4, (y + 1) * cell * 4)
  })
  return { rows, webp: await webp(atlas, columns * cell, rows * cell) }
}
const webp = (buffer, width, height) => sharp(buffer, { raw: { width, height, channels: 4 } }).webp({ lossless: true, exact: true, effort: 6 }).toBuffer()

// Kito: o chão de uma animação é a mediana da linha dos pés; o pé mais baixo de todos deixaria a maior parte dos
// quadros flutuando (na corrida, 4 a 8 px). Quadros com o pé abaixo dela afundam um pouco na grama.
const kitoFrames = []
const animations = {}
for (const [name, files] of Object.entries(kitoAnimations)) {
  const start = kitoFrames.length
  const feet = []
  for (const file of files) {
    const pixels = await readFrame('art-source/kito-pixel', file, KITO)
    feet.push(bounds(pixels, KITO).bottom + 1)
    kitoFrames.push(pixels)
  }
  feet.sort((a, b) => a - b)
  animations[name] = { start, count: files.length, ground: feet[Math.floor(feet.length / 2)] }
}
const base = await readFrame('art-source/kito-pixel', carryBase, KITO)
const baseBox = bounds(base, KITO)
// Ponto de pega do carregado: na coluna do centro, 24 px abaixo do topo da cabeça.
const centerX = Math.round((baseBox.left + baseBox.right + 1) / 2)
let headTop = 0
while (!(base[headTop * KITO + centerX] >>> 24)) headTop++
const carry = carryAngles.map(angle => rotSprite(base, angle, [centerX, headTop + 24]))
// Cada quadro girado tem a própria pega e a própria linha dos pés (feet), usada para não atravessar o chão.
animations.carry = { start: kitoFrames.length, count: carry.length, ground: 0, angles: carryAngles, grab: carry.map(frame => frame.grab), feet: carry.map(frame => bounds(frame.pixels, KITO).bottom + 1) }
kitoFrames.push(...carry.map(frame => frame.pixels))


// Kito sentado do rodapé (Kito-sitting_down_the_ch.zip, 2026-10-20): de frente, balançando os pés; o quadro 0 é a pose
// parada. Os nove quadros numa fileira, recortados no contorno comum com 2 px de folga, para o vizinho não vazar na escala.
const sitFrames = []
for (let i = 0; i < 9; i++) sitFrames.push(await readFrame('art-source/kito-pixel', frame('sitting_down_the_ch/animations/The_character_sits_firmly_rhythmically_swinging_bo', 'south', i), KITO))
const sitBounds = sitFrames.map(pixels => bounds(pixels, KITO))
const sitLeft = Math.min(...sitBounds.map(box => box.left)) - 2, sitTop = Math.min(...sitBounds.map(box => box.top)) - 2
const sitWidth = Math.max(...sitBounds.map(box => box.right)) + 3 - sitLeft, sitHeight = Math.max(...sitBounds.map(box => box.bottom)) + 3 - sitTop
const sitStrip = Buffer.alloc(sitWidth * sitFrames.length * sitHeight * 4)
sitFrames.forEach((pixels, index) => {
  const bytes = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength)
  for (let y = 0; y < sitHeight; y++) bytes.copy(sitStrip, (y * sitFrames.length + index) * sitWidth * 4, ((sitTop + y) * KITO + sitLeft) * 4, ((sitTop + y) * KITO + sitLeft + sitWidth) * 4)
})
// O chão é a mediana da base, como nas animações da hero: o corpo assenta nela e os pés esticados afundam na grama.
const sitGround = sitBounds.map(box => box.bottom + 1).sort((a, b) => a - b)[4] - sitTop

const kitoAtlas = await pack(kitoFrames, KITO, 12)
const files = {
  'public/media/hero/kito-pixel-atlas.webp': kitoAtlas.webp,
  'public/media/hero/kito-pixel-pose.webp': await webp(Buffer.from(kitoFrames[animations.front.start].buffer), KITO, KITO),
  'public/media/hero/kito-pixel-sit.webp': await webp(sitStrip, sitWidth * sitFrames.length, sitHeight),
}
await mkdir(path.join(root, 'public/media/hero'), { recursive: true })
for (const [file, buffer] of Object.entries(files)) {
  await writeFile(path.join(root, file), buffer)
  console.log(`${file} ${(buffer.length / 1024).toFixed(1)} KB`)
}
const sprites = { atlas: '/media/hero/kito-pixel-atlas.webp', cell: KITO, columns: 12, rows: kitoAtlas.rows, animations }
await writeFile(path.join(root, 'src/kito-sprites.ts'), `// Gerado por scripts/prepare-kito-pixel.mjs a partir de art-source/kito-pixel/. Não editar à mão.\nexport const kitoSprites = ${JSON.stringify(sprites, null, 2)} as const\n`)
console.log(`src/kito-sprites.ts: Kito ${kitoFrames.length} quadros (12×${kitoAtlas.rows})`)
// O rodapé (SiteFooter e .footer-kito) usa estes números à mão; se mudarem, atualizar lá.
console.log(`Kito sentado: ${sitFrames.length} quadros de ${sitWidth}×${sitHeight}, chão a ${sitHeight - sitGround} px da base`)
