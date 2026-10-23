// Imagens de compartilhamento (og:image, 1200×630) a partir das capas oficiais 16:9 em 800 px, a maior que vai ao
// site (as folhas dos jogos pagos não dão para usar). A capa não aumenta (ficaria borrada): vai inteira no centro de
// um fundo da cor do canto dela, o verde-água das fotos. JPEG (WhatsApp, Instagram e Facebook leem sem surpresa).
// Uso: node scripts/prepare-og-images.mjs (depois de scripts/prepare-game-covers.mjs)
import { mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const covers = 'public/media/games'
const output = 'public/media/og'
const size = { width: 1200, height: 630 }
await mkdir(output, { recursive: true })
for (const file of (await readdir(covers)).filter(name => name.endsWith('-capa-800.webp')).sort()) {
  const code = file.replace('-capa-800.webp', '')
  const source = path.join(covers, file)
  const { data } = await sharp(source).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const background = { r: data[0], g: data[1], b: data[2] }
  const cover = await sharp(source).resize({ width: size.width, height: size.height, fit: 'inside', withoutEnlargement: true }).toBuffer({ resolveWithObject: true })
  const target = path.join(output, `${code}.jpg`)
  await sharp({ create: { ...size, channels: 3, background } })
    .composite([{ input: cover.data, left: Math.round((size.width - cover.info.width) / 2), top: Math.round((size.height - cover.info.height) / 2) }])
    .jpeg({ quality: 82, mozjpeg: true }).toFile(target)
  console.log(target)
}
