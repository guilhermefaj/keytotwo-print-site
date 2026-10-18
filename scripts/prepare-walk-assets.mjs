import sharp from 'sharp'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

// A2: validate the lossless derivative against the official atlas RGBA pixels.
export async function prepareWalkingAssets(root) {
  const source = 'G:/Meu Drive/05-Projetos/KeyToTwo/Images/Pixel Art/Kito Walking v3/kito_walk_right_atlas.png'
  const output = 'kito-walk-v31-right-atlas.webp'
  const input = await readFile(path.join(root, 'public/media/hero', output))
  const sha256 = createHash('sha256').update(input).digest('hex')
  const sourceSha256 = 'f4ec908e31d0a4038822fe65cc28d140ed4c958b2048a7c1656136b12d3d87bc'
  const supplied = JSON.parse(await readFile(path.join(root, 'docs/kito-walk-source-manifest.json'), 'utf8'))
  if (supplied.revision !== '3.1' || supplied.frames !== 12 || supplied.fps !== 10) throw new Error('Unexpected supplied animation manifest')
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const rgbaSha256 = createHash('sha256').update(data).digest('hex')
  if (rgbaSha256 !== 'a5f23cfe165944ab5fc7fc1bbfa13576c7a3ed0dbbe21a025f926f6dcc1b3e90') throw new Error('Official RGBA pixels differ')
  if (info.width !== 2304 || info.height !== 768) throw new Error('Expected six columns and two rows of 384px cells')
  const bounds = Array.from({ length: 12 }, (_, frame) => {
    let left = 384, top = 384, right = 0, bottom = 0
    for (let y = 0; y < 384; y++) for (let x = 0; x < 384; x++) {
      const offset = ((Math.floor(frame / 6) * 384 + y) * info.width + frame % 6 * 384 + x) * 4
      if (data[offset + 3] <= 12) continue
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
    }
    return { frame: frame + 1, left, top, right, bottom, visibleHeight: bottom - top + 1 }
  })
  const motion = {
    frames: 12, fps: 10, cycleSeconds: 1.2, sourceCanvas: 1254, sourceDistancePerCycle: 520, groundSourceY: 1160,
    atlasCell: 384, columns: 6, rows: 2, desktopCanvas: 192, mobileCanvas: 128,
    desktopPixelsPerSecond: 192 * 520 / 1254 * 10 / 12,
    mobilePixelsPerSecond: 128 * 520 / 1254 * 10 / 12,
  }
  const assets = [{ source, output, width: info.width, height: info.height, bytes: input.length, sourceSha256, sha256, rgbaSha256, transformation: 'WebP lossless exact; identical RGBA pixels, no resize'  }]
  const manifest = { revision: '3.1', sequence: Array.from({ length: 12 }, (_, i) => i + 1), motion, sources: assets, assets, bounds, sourceManifest: 'kito-walk-source-manifest.json' }
  await writeFile(path.join(root, 'docs/kito-walk-assets.json'), JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(path.join(root, 'docs/kito-walk-assets.md'), [
    '# Kito v3.1 — atlas oficial preservado', '',
    'Origem: `' + source + '`. Somente o atlas RIGHT usado foi convertido em WebP lossless exact, com RGBA idêntico, para `public/media/hero/' + output + '`. Sem recorte, geração, quantização, interpolação ou alteração de corpo/pés/asa. Nenhum LEFT servido. As folhas antigas de quatro poses foram removidas de public.', '',
    'WebP RGBA: **2304 × 768**, 6 colunas × 2 linhas, células **384 × 384**, **' + input.length + ' bytes**. SHA-256: `' + sha256 + '`. Parâmetros oficiais copiados em [kito-walk-source-manifest.json](kito-walk-source-manifest.json).', '',
    'O script `node scripts/prepare-walk-assets.mjs` apenas confere o hash e lê os pixels/manifesto já presentes no repositório, gera parâmetros e documentação. Não escreve imagens nem requer o Drive para reproduzir a conferência.', '',
    'Sequência 01→02→…→12→01, **10 FPS**, ciclo **1,2 s**, sem pose adicional. Duas camadas CSS: posição em steps de 100 ms; poses em 12 intervalos de 100 ms, ordem row-major. Mesmo atraso inicial em ciclos inteiros; relógios pausam/retomam juntos. Nenhum estado React por frame.', '',
    '| Tela | Canvas S | Distância/ciclo S×520/1254 | Velocidade ×10/12 | Chão S×1160/1254 |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...[192,128].map(s => `| ${s === 192 ? 'Desktop' : 'Celular'} | ${s}px | ${(s*520/1254).toFixed(6)}px | ${(s*520/1254*10/12).toFixed(6)}px/s | ${(s*1160/1254).toFixed(6)}px |`), '',
    'Escala uniforme 1/2 no desktop e 1/3 no celular, `image-rendering: pixelated`. O chão usa a âncora fornecida (1160/1254), não a borda inferior do canvas. Uma pose totalmente fora da borda precede a reentrada. Movimento reduzido inicia no quadro 01, já visível; pausa congela a pose e a posição atuais.', '',
    'A2 autoriza WebP lossless exact: 492982 bytes, zero diferenças RGBA frente ao PNG de 1124099 bytes. Prepare-conversion-assets.mjs reproduz o derivado; este script valida o hash RGBA. O QA mede a meta de 500 KB separadamente; a aprovação visual é do responsável.', '',
  ].join('\n'))
  const heroFile = path.join(root, 'docs/hero-assets.json')
  const prior = JSON.parse(await readFile(heroFile, 'utf8')).filter(asset => !asset.output.startsWith('kito-'))
  await writeHeroManifest(root, [...prior, ...assets])
  console.log(JSON.stringify({ revision: manifest.revision, motion, assets, bounds }, null, 2))
  return assets
}

export async function writeHeroManifest(root, manifest) {
  await writeFile(path.join(root, 'docs/hero-assets.json'), JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(path.join(root, 'docs/hero-assets.md'), [
    '# Hero — inventário com Kito v3.1', '',
    'Logo/nuvens/paisagem mantêm os derivados existentes: recortes e nearest-neighbor WebP lossless documentados no [manifesto](hero-assets.json), originais em `art-source/hero`, fora do bundle. Origem: `G:/Meu Drive/09-Second-brain/95-Anexos/KeyToTwo/Marca/Pixel Art`.', '',
    'A2 usa o atlas RIGHT v3.1 em WebP lossless exact, com todos os pixels RGBA preservados. [Origem, hash, sequência e cálculos](kito-walk-assets.md). Não são servidas as folhas antigas de quatro passos nem imagens LEFT. O preparo da caminhada apenas verifica os bytes existentes.', '',
    '| Recurso servido | Dimensões | Bytes |', '| --- | --- | ---: |',
    ...manifest.map(a => `| ${a.output} | ${a.width} × ${a.height} | ${a.bytes} |`), '',
    `Total de imagens: **${manifest.reduce((sum,a)=>sum+a.bytes,0)} bytes**. A meta de primeira dobra é cerca de 500 KB; o relatório do verify:hero mede imagens e fontes transferidas.`, '',
  ].join('\n'))
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) await prepareWalkingAssets(path.resolve(import.meta.dirname, '..'))