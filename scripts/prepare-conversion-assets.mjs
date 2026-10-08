import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

// A2 phase 1: reads approved real sources; writes only public/media and docs.
// Does not call prepare-walk-assets (which also writes src/kito-motion.ts).
const root = path.resolve(import.meta.dirname, '..')
const vault = process.env.KTT_VAULT_ROOT || 'G:/Meu Drive/09-Second-brain'
const walkDir = process.env.KTT_WALK_SOURCE || 'G:/Meu Drive/05-Projetos/KeyToTwo/Images/Pixel Art/Kito Walking v3'
const poppler = process.env.PDFTOPPM || 'pdftoppm'
const hash = value => createHash('sha256').update(value).digest('hex')
const options = { lossless: true, exact: true, quality: 100, effort: 6 }
const sourceFiles = {
  atlas: path.join(walkDir, 'kito_walk_right_atlas.png'),
  board: path.join(vault, '95-Anexos/KeyToTwo/Marca/Pixel Art/kito_tabuleiro.png'),
  hi: path.join(vault, '95-Anexos/KeyToTwo/Marca/Pixel Art/kito_hi.png'),
  pdf: path.join(vault, '95-Anexos/KeyToTwo/Jogos/J001 - Rabisque e adivinhe.pdf'),
}
const sources = {}
for (const [name, filename] of Object.entries(sourceFiles)) {
  const bytes = await readFile(filename)
  sources[name] = { path: filename.replaceAll('\\', '/'), bytes: bytes.length, sha256: hash(bytes) }
}
if (sources.atlas.sha256 !== 'f4ec908e31d0a4038822fe65cc28d140ed4c958b2048a7c1656136b12d3d87bc') throw new Error('Expected official Kito v3.1 RIGHT atlas; review a changed source before preparing')

await mkdir(path.join(root, 'public/media/experience'), { recursive: true })
const assets = []
async function save(pipeline, output, source, transformation) {
  // Comparing raw RGBA includes all RGB values under fully transparent pixels.
  const reference = await pipeline.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const encoded = await pipeline.webp(options).toBuffer()
  const decoded = await sharp(encoded).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (reference.info.width !== decoded.info.width || reference.info.height !== decoded.info.height || !reference.data.equals(decoded.data)) throw new Error(`RGBA changed during lossless encoding: ${output}`)
  await writeFile(path.join(root, 'public/media', output), encoded)
  const item = { source, output, width: decoded.info.width, height: decoded.info.height, bytes: encoded.length, sha256: hash(encoded), rgbaSha256: hash(decoded.data), differingRgbaBytes: 0, transformation }
  assets.push(item)
  return item
}

const atlas = await save(sharp(sourceFiles.atlas), 'hero/kito-walk-v31-right-atlas.webp', 'atlas', 'PNG to exact lossless WebP; no resize, crop, palette change or frame edit; 6x2 cells of 384x384')
if (atlas.width !== 2304 || atlas.height !== 768) throw new Error('Unexpected atlas dimensions')
for (const [source, name, widths] of [['board', 'kito-tabuleiro', [240, 480]], ['hi', 'kito-hi', [128, 256]]]) {
  for (const width of widths) await save(sharp(sourceFiles[source]).resize({ width, kernel: sharp.kernel.nearest }), `experience/${name}-${width}.webp`, source, `Full canvas, proportional nearest-neighbor resize to ${width}px; exact lossless WebP; no crop or retouch`)
}

const version = spawnSync(poppler, ['-v'], { encoding: 'utf8' })
if (version.error || version.status !== 0) throw new Error(`Install Poppler pdftoppm or set PDFTOPPM: ${version.error?.message || version.stderr}`)
const temp = await mkdtemp(path.join(os.tmpdir(), 'ktt-a2-pdf-'))
try {
  for (const page of [1, 2, 3]) {
    const prefix = path.join(temp, `j001-${page}`)
    const args = ['-f', String(page), '-l', String(page), '-singlefile', '-scale-to-x', '720', '-scale-to-y', '-1', '-png', sourceFiles.pdf, prefix]
    const result = spawnSync(poppler, args, { encoding: 'utf8' })
    if (result.error || result.status !== 0) throw new Error(`PDF render failed: ${result.error?.message || result.stderr}`)
    await save(sharp(`${prefix}.png`), `experience/j001-page-${page}-720.webp`, 'pdf', `Actual PDF page ${page}, full page; Poppler raster at 720px wide, no crop or retouch; exact lossless WebP of raster`)
    await unlink(`${prefix}.png`)
  }
} finally {
  // Remove only known intermediate files and then the empty, freshly created dir.
  for (const page of [1, 2, 3]) await unlink(path.join(temp, `j001-${page}.png`)).catch(error => { if (error.code !== 'ENOENT') throw error })
  await rmdir(temp)
}
for (const [name, filename] of Object.entries(sourceFiles)) {
  if (hash(await readFile(filename)) !== sources[name].sha256) throw new Error(`Source changed during preparation: ${filename}`)
}
const manifest = {
  task: 'A2 phase 1', sourceNote: 'Jogos/J001 - Rabisque e Adivinhe.md', sources,
  tooling: { sharp: sharp.versions.sharp, vips: sharp.versions.vips, webp: sharp.versions.webp, poppler: `${version.stdout}${version.stderr}`.split(/\r?\n/)[0] },
  webpOptions: options, assets,
  integration: 'Prepared only. CSS still references the PNG until phase 2; retain it to avoid breaking the concurrent UI work.',
}
await writeFile(path.join(root, 'docs/conversion-assets.json'), JSON.stringify(manifest, null, 2) + '\n')
await writeFile(path.join(root, 'docs/conversion-assets.md'), [
  '# A2 — assets reais para conversão', '',
  'Gerado por `node scripts/prepare-conversion-assets.mjs`. Fontes lidas, sem alterações, do vault/Drive; nenhum original novo foi copiado para o repositório nesta fase. Somente `scripts/`, `public/media/` e `docs/` são alterados. Variáveis opcionais: `KTT_VAULT_ROOT`, `KTT_WALK_SOURCE`, `PDFTOPPM`. Requer Sharp do projeto e Poppler no PATH.', '',
  '## Origem e fidelidade', '',
  ...Object.entries(sources).map(([name, source]) => `- ${name}: \`${source.path}\` (${source.bytes} bytes), SHA-256 \`${source.sha256}\`.`), '',
  `Atlas RIGHT v3.1: **2304 × 768**, 12 quadros, células 384 × 384, sem redimensionamento nem alteração de poses. WebP **${atlas.bytes} bytes**, redução de **${(100 * (1 - atlas.bytes / sources.atlas.bytes)).toFixed(1)}%** sobre o PNG. Comparação de todos os canais RGBA, inclusive RGB sob alfa zero: **0 bytes diferentes**. Hash RGBA de ambos: \`${atlas.rgbaSha256}\`.`, '',
  'WebP usa `lossless: true, exact: true, quality: 100, effort: 6`. `exact` é necessário para preservar também RGB invisível. Nenhuma quantização, IA ou composição fictícia. O atlas PNG fica disponível até a troca da URL em src na fase 2; não removê-lo antes.', '',
  'O PDF real foi localizado pela ficha do J001 em `95-Anexos/KeyToTwo/Jogos`. Páginas 1 (instruções e cartas), 2 e 3 (cartas), completas, renderizadas a 720 px de largura. São prévias do documento existente, não arquivos de impressão, novas capas nem jogos adicionais. `kito_tabuleiro` é ilustração de marca: o tabuleiro desenhado não representa um componente incluído no P001.', '',
  '## Derivados preparados', '',
  '| Arquivo em public/media | Dimensões | Bytes |', '| --- | --- | ---: |',
  ...assets.map(asset => `| ${asset.output} | ${asset.width} × ${asset.height} | ${asset.bytes} |`), '',
  'Os Kitos preservam o canvas completo e a proporção; resize nearest-neighbor, sem retoque. Cada WebP foi decodificado e comparado byte a byte ao raster de referência. Metadados completos e hashes em [conversion-assets.json](conversion-assets.json).', '',
  '## Orientação para a fase 2', '',
  '- Substituir a URL do atlas no CSS e atualizar verify-hero; só então retirar o PNG antigo servido. Ritmo, chão, escala e frames ficam idênticos.',
  '- Usar materiais reais na composição e no card da oferta; reservar width/height, alt descritivo e carregamento lazy fora da primeira dobra.',
  '- Kito tabuleiro: variantes 240/480; Kito hi: 128/256. Carregar somente a variante necessária, reutilizando a mesma URL nos pilares.',
  '- As três páginas são do J001; não apresentá-las como três jogos do pacote. Rótulo sugerido: “Uma prévia de Rabisque e Adivinhe”.',
  '- A mídia da primeira dobra deve ser medida após a integração. Somente o atlas exato já ocupa quase 500 KB; a troca de formato não garante atingir a meta total.', '',
  'Guidelines consultadas: [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md), especialmente dimensões reservadas e lazy loading abaixo da dobra. Skills de direção: frontend-design, copywriting; inspeção do PDF: pdf.', '',
].join('\n'))
console.log(JSON.stringify({ atlas: { bytes: atlas.bytes, rgbaDifferences: 0, rgbaSha256: atlas.rgbaSha256 }, assets: assets.map(({ output, width, height, bytes }) => ({ output, width, height, bytes })) }, null, 2))
