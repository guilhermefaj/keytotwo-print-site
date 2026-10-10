// D1 source supplied in the connected note "Sprint de design", section 8.
// Only border-connected near-black background is removed. Interior eyes/ink stay opaque.
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'

const source = process.argv[2] || 'G:/Meu Drive/05-Projetos/KeyToTwo/Images/Pixel Art/kito_chorando_na_ caixa.png'
const output = 'public/media/experience'
const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const { width, height, channels } = info
const seen = new Uint8Array(width * height)
const queue = new Int32Array(width * height)
let head = 0, tail = 0
function visit(x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return
  const pixel = y * width + x, offset = pixel * channels
  if (seen[pixel]) return
  seen[pixel] = 1
  if (Math.max(data[offset], data[offset + 1], data[offset + 2]) > 18) return
  data[offset + 3] = 0
  queue[tail++] = pixel
}
for (let x = 0; x < width; x++) { visit(x, 0); visit(x, height - 1) }
for (let y = 0; y < height; y++) { visit(0, y); visit(width - 1, y) }
while (head < tail) {
  const pixel = queue[head++], x = pixel % width, y = Math.floor(pixel / width)
  visit(x - 1, y); visit(x + 1, y); visit(x, y - 1); visit(x, y + 1)
}
await mkdir(output, { recursive: true })
for (const size of [240, 480]) {
  const result = await sharp(data, { raw: info }).resize(size, size, { kernel: 'nearest' }).webp({ lossless: true }).toFile(`${output}/kito-caixa-${size}.webp`)
  console.log(`${size}px lossless WebP: ${result.size} bytes`)
}
console.log(`Removed ${tail} border-connected background pixels; interior pixels preserved.`)
