import sharp from 'sharp'
import { mkdir, readFile, stat, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { prepareWalkingAssets, writeHeroManifest } from './prepare-walk-assets.mjs'

const root = path.resolve(import.meta.dirname, '..')
const sourceDir = path.join(root, 'art-source/hero')
const outputDir = path.join(root, 'public/media/hero')
await mkdir(outputDir, { recursive: true })
await mkdir(path.join(root, 'docs'), { recursive: true })

// Explicitly discard nearly invisible alpha residue when finding the useful box.
// Original RGBA pixels are preserved inside the box. No original is overwritten.
async function alphaBounds(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let left = info.width, top = info.height, right = 0, bottom = 0
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] > 12) {
      left = Math.min(left, x); right = Math.max(right, x)
      top = Math.min(top, y); bottom = Math.max(bottom, y)
    }
  }
  return { left, top, width: right - left + 1, height: bottom - top + 1 }
}

const jobs = [
  { source: 'keytotwo_logo.png', output: 'keytotwo-logo.webp', width: 420 },
  { source: 'nuvens_2.png', output: 'cloud-a.webp', crop: { left: 0, top: 0, width: 850, height: 400 }, width: 280 },
  { source: 'nuvens_2.png', output: 'cloud-b.webp', crop: { left: 850, top: 270, width: 540, height: 235 }, width: 208 },
  { source: 'paisagem_direita.png', output: 'foliage-right.webp', width: 720 },
  { source: 'paisagem_direita.png', output: 'foliage-left.webp', crop: { left: 0, top: 590, width: 900, height: 324 }, width: 360, flop: true },
]
const manifest = []
for (const job of jobs) {
  const original = await readFile(path.join(sourceDir, job.source))
  const input = job.crop ? await sharp(original).extract(job.crop).png().toBuffer() : original
  const bounds = await alphaBounds(input)
  const output = path.join(outputDir, job.output)
  await sharp(input).extract(bounds).flop(job.flop ?? false).resize({ width: job.width, kernel: sharp.kernel.nearest }).webp({ lossless: true, effort: 6 }).toFile(output)
  const meta = await sharp(output).metadata()
  manifest.push({ source: job.source, sourceBytes: original.length, sourceSha256: createHash('sha256').update(original).digest('hex'), crop: job.crop ?? null, alphaBounds: bounds, horizontalFlip: job.flop ?? false, output: job.output, width: meta.width, height: meta.height, bytes: (await stat(output)).size })
}
// Obsolete served fallback: reduced-motion and pause use the official sheet.
await rm(path.join(outputDir, 'kito-static.webp'), { force: true })
manifest.push(...await prepareWalkingAssets(root))
await writeHeroManifest(root, manifest)
console.log(JSON.stringify({ images: manifest, totalBytes: manifest.reduce((sum, asset) => sum + asset.bytes, 0) }, null, 2))
