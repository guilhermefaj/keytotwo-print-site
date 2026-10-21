// Kito comendo um cookie, para o aviso de cookies (responsável, 2026-10-22). Fonte: o zip exportado do editor de
// pixel art (Kito-eating_a_cookie.zip, pasta real-pixel do Drive), vista de frente (rotations/south.png, 256 px,
// fundo transparente). Corta a margem transparente e grava em WebP sem perda (3,4 KB), no tamanho do sprite; o aviso
// mostra na metade, nítido em tela de alta densidade. Reduzir antes deixa o arquivo maior (as bordas ganham cores).
// Uso: node scripts/prepare-kito-cookie.mjs <caminho do south.png extraído do zip>
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'

const source = process.argv[2]
if (!source) throw new Error('Informe o caminho do rotations/south.png extraído de Kito-eating_a_cookie.zip')
const output = 'public/media/experience'
await mkdir(output, { recursive: true })
const trimmed = await sharp(source).ensureAlpha().trim({ threshold: 0 }).toBuffer({ resolveWithObject: true })
const { width, height } = trimmed.info
const file = `${output}/kito-cookie-${width}.webp`
const result = await sharp(trimmed.data).webp({ lossless: true }).toFile(file)
console.log(`${file}: ${width}×${height}, ${result.size} bytes`)
