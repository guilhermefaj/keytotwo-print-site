import sharp from 'sharp'
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

export async function prepareWalkingAssets(root) {
  const sourceDir = path.join(root, 'art-source/hero')
  const outputDir = path.join(root, 'public/media/hero')
  const reviewDir = path.join(root, 'art-source/hero/walk-review')
  const revision = '2 (2026-10-08 09:33)'
  const expectedHashPrefixes = ['8f4ff15f23801c1c', '7523cc2f7b8bc453', 'aaf48ef989d61133', '70e7462ab067d6a3']
  const fps = 8
  await mkdir(reviewDir, { recursive: true })
  await mkdir(outputDir, { recursive: true })
  const frames = [], sources = [], measurements = []
  for (let step = 1; step <= 4; step++) {
    const source = `kito_walking_right_step0${step}.png`
    const input = await readFile(path.join(sourceDir, source))
    const sourceSha256 = createHash('sha256').update(input).digest('hex')
    if (!sourceSha256.startsWith(expectedHashPrefixes[step - 1])) throw new Error(`${source}: expected official revision 2`)
    const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (info.width !== 1254 || info.height !== 1254) throw new Error(`Unexpected official canvas: ${source}`)
    const native = Buffer.alloc(64 * 64 * 4)
    let sourceTop = 1254, sourceBottom = 0, eyeX = 0, eyeY = 0, eyeCount = 0
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * 4
      if (data[offset + 3] < 128) continue
      sourceTop = Math.min(sourceTop, y); sourceBottom = Math.max(sourceBottom, y)
      if (x >= 710 && x <= 850 && y >= 350 && y <= 520 && data[offset] < 45 && data[offset + 1] < 45 && data[offset + 2] < 45) {
        eyeX += x; eyeY += y; eyeCount++
      }
    }
    // One native pixel per 20×20 source cell, sampled at its center. The
    // original coordinate grid is shared by all frames; no per-frame recrop.
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const sx = x * 20 + 10, sy = y * 20 + 10
      if (sx >= info.width || sy >= info.height) continue
      const src = (sy * info.width + sx) * 4, dst = (y * 64 + x) * 4
      if (data[src + 3] < 128) continue
      native[dst] = data[src]; native[dst + 1] = data[src + 1]; native[dst + 2] = data[src + 2]; native[dst + 3] = 255
    }
    let top = 64, bottom = 0
    const feet = []
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4
      if (!native[i + 3]) continue
      top = Math.min(top, y); bottom = Math.max(bottom, y)
      if (y >= 48 && native[i] > 140 && native[i + 1] > 45 && native[i + 1] < 245 && native[i + 2] < 160) feet.push({ x, y })
    }
    const nearGround = feet.filter(p => p.y >= bottom - 1)
    const leftFoot = feet.filter(p => p.x < 33), rightFoot = feet.filter(p => p.x >= 33)
    const centroid = points => points.reduce((sum, p) => sum + p.x, 0) / points.length
    const support = step % 2 ? leftFoot : rightFoot
    const soleY = Math.max(...support.map(p => p.y))
    const sole = support.filter(p => p.y === soleY)
    measurements.push({ step, sourceTop, sourceBottom, eye: { x: eyeX / eyeCount, y: eyeY / eyeCount }, nativeTop: top, nativeBottom: bottom, nearGroundX: centroid(nearGround), leftFootX: centroid(leftFoot), rightFootX: centroid(rightFoot), flatSole: { x: centroid(sole), y: soleY }, nativeTranslation: [0, 0] })
    sources.push({ source, width: info.width, height: info.height, sourceBytes: input.length, sourceSha256 })
    frames.push(native)
    await sharp(native, { raw: { width: 64, height: 64, channels: 4 } }).resize(192, 192, { kernel: 'nearest' }).png().toFile(path.join(reviewDir, `step0${step}-3x.png`))
  }
  const sheet = Buffer.alloc(256 * 64 * 4)
  frames.forEach((frame, index) => {
    for (let y = 0; y < 64; y++) frame.copy(sheet, (y * 256 + index * 64) * 4, y * 64 * 4, (y + 1) * 64 * 4)
  })
  const assets = []
  for (const scale of [2, 3]) {
    const output = `kito-walk-${scale}x.webp`
    await sharp(sheet, { raw: { width: 256, height: 64, channels: 4 } }).resize(256 * scale, 64 * scale, { kernel: 'nearest' }).webp({ lossless: true, effort: 6 }).toFile(path.join(outputDir, output))
    assets.push({ source: 'kito_walking_right_step01.png … step04.png', output, width: 256 * scale, height: 64 * scale, bytes: (await stat(path.join(outputDir, output))).size, scale, sources })
  }
  const previewFrames = await Promise.all(frames.map(frame => sharp(frame, { raw: { width: 64, height: 64, channels: 4 } }).resize(192, 192, { kernel: 'nearest' }).png().toBuffer()))
  await sharp(previewFrames, { join: { animated: true } }).webp({ lossless: true, loop: 0, delay: Array(4).fill(1000 / fps) }).toFile(path.join(reviewDir, 'official-walk-preview.webp'))
  const board = Buffer.from('<svg width="768" height="224"><rect width="768" height="224" fill="#ECFAF7"/><path d="M0 174H768" stroke="#006970"/>' + [1, 2, 3, 4].map((n, i) => `<text x="${i * 192 + 64}" y="212" font-family="Arial" font-size="16" fill="#123A3D">step 0${n}</text>`).join('') + '</svg>')
  await sharp(board).composite(previewFrames.map((input, i) => ({ input, left: i * 192, top: 0 }))).png().toFile(path.join(reviewDir, 'official-contact-sheet.png'))
  const stanceDeltas = [measurements[0].flatSole.x - measurements[2].flatSole.x, measurements[1].flatSole.x - measurements[3].flatSole.x]
  const meanStanceDelta = (stanceDeltas[0] + stanceDeltas[1]) / 2
  const rounded = value => Number(value.toFixed(6))
  const motion = { fps, cycleSeconds: 4 / fps, stanceIntervalSeconds: 2 / fps, meanStanceDelta, nativePixelsPerSecond: rounded(meanStanceDelta / (2 / fps)), desktopPixelsPerSecond: rounded(meanStanceDelta * 3 / (2 / fps)), mobilePixelsPerSecond: rounded(meanStanceDelta * 2 / (2 / fps)) }
  const reviews = []
  for (const output of [...[1, 2, 3, 4].map(n => `step0${n}-3x.png`), 'official-walk-preview.webp', 'official-contact-sheet.png']) {
    const file = path.join(reviewDir, output)
    const metadata = await sharp(file, { animated: true }).metadata()
    reviews.push({ output, width: metadata.width, height: metadata.pageHeight ?? metadata.height, pages: metadata.pages ?? 1, bytes: (await stat(file)).size })
  }
  const manifest = { revision, method: 'center of 20px cells; shared original origin; binary alpha threshold 128; nearest integer upscale; lossless WebP', sequence: [1, 2, 3, 4], motion, stanceDeltas, measurements, sources, assets, reviews }
  if (measurements.some(m => m.nativeTop !== 6 || m.nativeBottom !== 57)) throw new Error('Official frames no longer share the registered head/floor rows')
  const eyeSpread = Math.hypot(Math.max(...measurements.map(m => m.eye.x)) - Math.min(...measurements.map(m => m.eye.x)), Math.max(...measurements.map(m => m.eye.y)) - Math.min(...measurements.map(m => m.eye.y))) / 20
  if (eyeSpread > 1) throw new Error('Body registration must be reviewed before exporting')
  manifest.eyeSpreadNativePixels = eyeSpread
  await writeFile(path.join(root, 'docs/kito-walk-assets.json'), JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(path.join(root, 'src/kito-motion.ts'), '// Generated by scripts/prepare-walk-assets.mjs from official revision 2.\nexport const kitoMotion = ' + JSON.stringify(motion, null, 2) + ' as const\n')
  const documentLines = [
    '# Quadros oficiais RIGHT: preparação reproduzível — revisão 2',
    '',
    'Revisão oficial ' + revision + '. Tarefa 3C: corpo do step03 aplicado a 01, 02 e 04; step03 preservado. Gerado por `npm run assets:prepare` (ou `node scripts/prepare-walk-assets.mjs`).',
    '',
    'Origem: `G:/Meu Drive/05-Projetos/KeyToTwo/Images/Pixel Art`. Quatro RIGHT preservados em `art-source/hero`; nenhum LEFT copiado ou servido. O script recusa hashes diferentes dos prefixos informados para a revisão 2. Valores completos no [manifesto](kito-walk-assets.json).',
    '',
    '| Original | Dimensões | Bytes | SHA-256 (16 hex) |',
    '| --- | --- | ---: | --- |',
    ...sources.map(s => '| ' + s.source + ' | 1254×1254 | ' + s.sourceBytes + ' | ' + s.sourceSha256.slice(0, 16) + ' |'),
    '',
    'Amostragem no centro das células de 20×20 pixels, na mesma origem de canvas, para 64×64 pixels. Alfa <128 é transparente; o restante fica opaco. Sem recorte individual, mudança de pose, interpolação ou quadros inventados. Ampliação inteira nearest-neighbor e WebP lossless.',
    '',
    'Âncora: centro dos pixels escuros do olho na região x710–850/y350–520. Variação máxima: **' + eyeSpread.toFixed(4) + ' pixel nativo**. Nenhuma translação necessária. Topo nativo y6 e linha inferior dos pés y57 nos quatro quadros; borda do chão y58. Altura visível 52 pixels: **156 px desktop (x3)** e **104 px mobile (x2)**, próxima aos 152/116 px do fallback anterior. Inclinação e elevação das solas preservadas da arte oficial.',
    '',
    '| Folha | Dimensões | Células | Bytes |',
    '| --- | --- | --- | ---: |',
    ...assets.map(a => '| ' + a.output + ' | ' + a.width + '×' + a.height + ' | 4 de ' + 64 * a.scale + '×' + 64 * a.scale + ' | ' + a.bytes + ' |'),
    '',
    'Sequência **01→02→03→04**, **' + fps + ' fps**, ciclo **' + motion.cycleSeconds + ' s**. Desvio autorizado: quatro quadros oficiais em perfil, no lugar dos 6–8 em três quartos previstos no briefing inicial. Oito fps mantém cada pose por 125 ms, sem intermediários. A prévia animada usa o mesmo ritmo.',
    '',
    'Sola por quadro: centro x da última linha de pixels quentes do pé plano; região y≥48; lados separados em x33. Coordenadas nativas: ' + measurements.map(m => '0' + m.step + ': x=' + rounded(m.flatSole.x) + ', y=' + m.flatSole.y).join('; ') + '.',
    '',
    'Recuos 01→03 = **' + rounded(stanceDeltas[0]) + ' px**, 02→04 = **' + rounded(stanceDeltas[1]) + ' px**. Média **' + rounded(meanStanceDelta) + ' px** em **2/' + fps + ' = ' + motion.stanceIntervalSeconds + ' s**. Velocidade = recuo × escala / duração: desktop **' + rounded(meanStanceDelta) + ' × 3 / ' + motion.stanceIntervalSeconds + ' = ' + motion.desktopPixelsPerSecond + ' px/s**; mobile **' + rounded(meanStanceDelta) + ' × 2 / ' + motion.stanceIntervalSeconds + ' = ' + motion.mobilePixelsPerSecond + ' px/s**.',
    '',
    'A revisão 2 mudou a medida da sola. A velocidade foi reduzida para acompanhar essa passada, abaixo das faixas desejadas de 40–56/24–32 px/s, conforme a prioridade autorizada. Não se conserva a calibração da revisão 1. Os parâmetros usados pela aplicação são gerados em `src/kito-motion.ts`.',
    '',
    'Limite da calibração: ajuste médio das solas de quatro poses discretas, que também mudam de forma. Os dois recuos são diferentes; a velocidade uniforme não produz contato fisicamente imóvel em ambos. Resíduo entre as duas amostras de apoio: ±' + rounded(Math.abs(stanceDeltas[0] - meanStanceDelta) * 3) + ' px desktop / ±' + rounded(Math.abs(stanceDeltas[0] - meanStanceDelta) * 2) + ' px mobile. Não se afirma deslizamento zero. Não foram alterados os pés oficiais para compensar.',
    '',
    'Recursos de revisão em `art-source/hero/walk-review`, não servidos:',
    '',
    '| Arquivo | Dimensões por quadro | Quadros | Bytes |',
    '| --- | --- | ---: | ---: |',
    ...reviews.map(a => '| ' + a.output + ' | ' + a.width + '×' + a.height + ' | ' + a.pages + ' | ' + a.bytes + ' |'),
    '',
  ]
  await writeFile(path.join(root, 'docs/kito-walk-assets.md'), documentLines.join('\n'))
  console.log(JSON.stringify({ motion, eyeSpreadNativePixels: eyeSpread, assets: assets.map(({ output, width, height, bytes }) => ({ output, width, height, bytes })) }, null, 2))
  return assets
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) await prepareWalkingAssets(path.resolve(import.meta.dirname, '..'))
