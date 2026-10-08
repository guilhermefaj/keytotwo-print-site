import sharp from 'sharp'
import { mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { prepareWalkingAssets } from './prepare-walk-assets.mjs'

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
await writeFile(path.join(root, 'docs/hero-assets.json'), JSON.stringify(manifest, null, 2) + '\n')
const total = manifest.reduce((n, asset) => n + asset.bytes, 0)
await writeFile(path.join(root, 'docs/hero-assets.md'), [
  '# Hero: origem e preparação dos assets — caminhada revisão 2',
  '',
  'Gerado por `npm run assets:prepare`. Originais preservados em `art-source/hero`, fora de `public` e do bundle. Não é necessário acessar o vault para reproduzir. SHA-256, recortes e caixas alfa no [manifesto](hero-assets.json).',
  '',
  'Logo, nuvens e paisagem: `G:/Meu Drive/09-Second-brain/95-Anexos/KeyToTwo/Marca/Pixel Art`. Transformação: recorte especificado (quando presente), recorte útil por alfa >12, redução nearest-neighbor e WebP lossless. Os originais não são modificados. A paisagem fornece dois recortes distintos nas extremidades; não é usada como tile. Chão e silhueta distante em CSS/SVG próprios.',
  '',
  'Caminhada oficial RIGHT, **revisão 2 (2026-10-08 09:33)**: `G:/Meu Drive/05-Projetos/KeyToTwo/Images/Pixel Art`. Steps 01, 02 e 04 atualizados com o corpo do step03, que não mudou. Os quatro hashes desta revisão são conferidos pelo script. Amostragem central na grade de 20 px, alfa binário, ampliação inteira x2/x3 nearest-neighbor e folhas lossless de quatro células. Registro, hashes, cálculo da passada e recursos de revisão: [kito-walk-assets.md](kito-walk-assets.md). Nenhum LEFT é servido. `kito-static.webp` foi removido da mídia pública; a pausa usa a própria folha. `kito.png` permanece apenas como referência original de identidade, fora do bundle.',
  '',
  '| Derivado | Origem | Dimensões | Bytes | KiB |',
  '| --- | --- | --- | ---: | ---: |',
  ...manifest.map(a => `| ${a.output} | ${a.source} | ${a.width} × ${a.height} | ${a.bytes} | ${(a.bytes / 1024).toFixed(2)} |`),
  '',
  `Total em disco: **${total} bytes (${(total / 1024).toFixed(2)} KiB)**. Inclui ambas as escalas; o navegador carrega uma folha por viewport. O relatório de QA mede o peso HTTP das seis imagens e três fontes realmente transferidas.`,
  '',
].join('\n'))
console.log(JSON.stringify({ images: manifest, totalBytes: total }, null, 2))
