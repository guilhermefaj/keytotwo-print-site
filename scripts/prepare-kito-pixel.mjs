import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Kito em pixel art real (256 px nativos), enviado pelo responsável em 2026-10-18 (Kito.zip, em art-source/kito-pixel/).
// Grava:
// - public/media/hero/kito-pixel-atlas.webp: todos os quadros da hero numa grade de células de 256 px, WebP sem perda;
// - public/media/hero/kito-pixel-pose.webp: o Kito de frente, parado, que o servidor entrega antes do atlas;
// - src/kito-sprites.ts: posição de cada animação no atlas, linha do chão e ponto de pega.
// Só os quadros "east" entram: os "west" do zip são o espelho exato deles (0 pixel de diferença) e a hero espelha no CSS.
// O zip não tem pose de "sendo carregado"; ela sai do quadro de braços para cima do pulo, girado com RotSprite
// (Scale2x três vezes, giro por vizinho mais próximo, volta ao tamanho original), para o pixel continuar limpo.
const root = path.resolve(import.meta.dirname, '..')
const source = path.join(root, 'art-source/kito-pixel')
const cell = 256
const columns = 8

const anim = (folder, direction, count) => Array.from({ length: count }, (_, i) => `Idle/animations/${folder}/${direction}/frame_${String(i).padStart(3, '0')}.png`)
const animations = {
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
  // De lado: de frente a mesa apoia no chão, mas o Kito, atrás dela, parece flutuar.
  play: ['playing_a_boadgame/rotations/east.png'],
  love: ['In_love_holding_a_bi/rotations/south.png'],
}
// Ângulos em graus, sentido horário positivo (o mesmo do CSS). ±16° é o maior giro que ainda cabe na célula.
const carryAngles = [-16, -8, 0, 8, 16]
const carryBase = animations.jump[4]

async function readFrame(file) {
  const { data, info } = await sharp(path.join(source, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (info.width !== cell || info.height !== cell) throw new Error(`${file}: esperado ${cell}×${cell}`)
  return new Uint32Array(data.buffer, data.byteOffset, cell * cell).slice()
}

function bounds(pixels, size = cell) {
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
  const big = scale2x(scale2x(scale2x(pixels, cell), cell * 2), cell * 4)
  const size = cell * 8
  const box = bounds(pixels)
  const cx = (box.left + box.right + 1) / 2 * 8, cy = (box.top + box.bottom + 1) / 2 * 8
  const cos = Math.cos(degrees * Math.PI / 180), sin = Math.sin(degrees * Math.PI / 180)
  const rotated = new Uint32Array(cell * cell)
  for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
    // Amostra o centro do bloco 8×8 de destino e procura a origem pelo giro inverso.
    const dx = x * 8 + 4 - size / 2, dy = y * 8 + 4 - size / 2
    const sx = Math.round(cx + dx * cos + dy * sin), sy = Math.round(cy - dx * sin + dy * cos)
    if (sx >= 0 && sy >= 0 && sx < size && sy < size) rotated[y * cell + x] = big[sy * size + sx]
  }
  const turned = bounds(rotated)
  if (turned.left === 0 || turned.top === 0 || turned.right === cell - 1 || turned.bottom === cell - 1) throw new Error(`O giro de ${degrees}° não cabe na célula`)
  const gx = grab[0] * 8 - cx, gy = grab[1] * 8 - cy
  return { pixels: rotated, grab: [Math.round((gx * cos - gy * sin) / 8 + cell / 2), Math.round((gx * sin + gy * cos) / 8 + cell / 2)] }
}

const frames = []
const manifest = {}
for (const [name, files] of Object.entries(animations)) {
  const start = frames.length
  const feet = []
  for (const file of files) {
    const pixels = await readFrame(file)
    feet.push(bounds(pixels).bottom + 1)
    frames.push(pixels)
  }
  // O chão de uma animação é a mediana da linha dos pés: o pé mais baixo de todos deixaria a maior parte dos
  // quadros flutuando (na corrida, 4 a 8 px). Quadros com o pé abaixo dela afundam um pouco na grama.
  feet.sort((a, b) => a - b)
  manifest[name] = { start, count: files.length, ground: feet[Math.floor(feet.length / 2)] }
}
const base = await readFrame(carryBase)
const baseBox = bounds(base)
// Ponto de pega: na coluna do centro, 24 px abaixo do topo da cabeça.
const centerX = Math.round((baseBox.left + baseBox.right + 1) / 2)
let headTop = 0
while (!(base[headTop * cell + centerX] >>> 24)) headTop++
const carry = carryAngles.map(angle => rotSprite(base, angle, [centerX, headTop + 24]))
// Cada quadro girado tem a própria pega e a própria linha dos pés (feet), usada para não atravessar o chão.
manifest.carry = { start: frames.length, count: carry.length, ground: 0, angles: carryAngles, grab: carry.map(frame => frame.grab), feet: carry.map(frame => bounds(frame.pixels).bottom + 1) }
frames.push(...carry.map(frame => frame.pixels))

const rows = Math.ceil(frames.length / columns)
const atlas = Buffer.alloc(columns * cell * rows * cell * 4)
frames.forEach((pixels, index) => {
  const bytes = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength)
  const ox = index % columns * cell, oy = Math.floor(index / columns) * cell
  for (let y = 0; y < cell; y++) bytes.copy(atlas, ((oy + y) * columns * cell + ox) * 4, y * cell * 4, (y + 1) * cell * 4)
})
const raw = (buffer, width, height) => sharp(buffer, { raw: { width, height, channels: 4 } }).webp({ lossless: true, exact: true, effort: 6 }).toBuffer()
const files = {
  'public/media/hero/kito-pixel-atlas.webp': await raw(atlas, columns * cell, rows * cell),
  'public/media/hero/kito-pixel-pose.webp': await raw(Buffer.from(frames[manifest.front.start].buffer), cell, cell),
}
await mkdir(path.join(root, 'public/media/hero'), { recursive: true })
for (const [file, buffer] of Object.entries(files)) {
  await writeFile(path.join(root, file), buffer)
  console.log(`${file} ${(buffer.length / 1024).toFixed(1)} KB`)
}
const sprites = { atlas: '/media/hero/kito-pixel-atlas.webp', pose: '/media/hero/kito-pixel-pose.webp', cell, columns, rows, animations: manifest }
await writeFile(path.join(root, 'src/kito-sprites.ts'), `// Gerado por scripts/prepare-kito-pixel.mjs a partir de art-source/kito-pixel/. Não editar à mão.\nexport const kitoSprites = ${JSON.stringify(sprites, null, 2)} as const\n`)
console.log(`src/kito-sprites.ts ${frames.length} quadros, ${columns}×${rows}`)
