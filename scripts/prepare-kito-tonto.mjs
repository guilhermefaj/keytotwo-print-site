// Kito tonto, com estrelinhas na cabeça, para as páginas de erro (responsável, 2026-10-22). Fonte: o zip exportado do
// editor de pixel art (Kito.zip, pasta real-pixel do Drive), animação
// Idle/animations/The_character_wobbles_unsteadily_head_swaying_with/south (9 quadros de 256 px, fundo transparente).
// Corta todos os quadros pela mesma caixa (a união das partes visíveis, para o Kito não pular) e grava uma tira
// horizontal em WebP sem perda; o CSS passa os quadros com steps().
// Uso: node scripts/prepare-kito-tonto.mjs <pasta com frame_000.png … frame_008.png>
import sharp from 'sharp'
import { mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'

const folder = process.argv[2]
if (!folder) throw new Error('Informe a pasta south da animação wobbles extraída de Kito.zip')
const files = (await readdir(folder)).filter(name => /^frame_\d+\.png$/.test(name)).sort()
if (files.length !== 9) throw new Error(`Esperava 9 quadros, achei ${files.length}`)

// Caixa visível de cada quadro (alfa > 0), unida.
const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
for (const name of files) {
  const { data, info } = await sharp(path.join(folder, name)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] === 0) continue
      box.left = Math.min(box.left, x); box.right = Math.max(box.right, x)
      box.top = Math.min(box.top, y); box.bottom = Math.max(box.bottom, y)
    }
  }
}
const width = box.right - box.left + 1
const height = box.bottom - box.top + 1
const frames = await Promise.all(files.map(name => sharp(path.join(folder, name))
  .extract({ left: box.left, top: box.top, width, height }).png().toBuffer()))

const output = 'public/media/experience'
await mkdir(output, { recursive: true })
const file = `${output}/kito-tonto-${width}x${height}.webp`
const result = await sharp({ create: { width: width * frames.length, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(frames.map((input, index) => ({ input, left: index * width, top: 0 })))
  .webp({ lossless: true }).toFile(file)
console.log(`${file}: ${frames.length} quadros de ${width}×${height}, ${result.size} bytes`)
