// Imagens de compartilhamento (og:image, 1200×630) a partir das capas oficiais 16:9 em 1280 px: corte central,
// JPEG (WhatsApp, Instagram e Facebook leem sem surpresa). Uso: node scripts/prepare-og-images.mjs
import { mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const covers = 'public/media/games'
const output = 'public/media/og'
await mkdir(output, { recursive: true })
for (const file of (await readdir(covers)).filter(name => name.endsWith('-capa-1280.webp')).sort()) {
  const code = file.replace('-capa-1280.webp', '')
  const target = path.join(output, `${code}.jpg`)
  await sharp(path.join(covers, file)).resize(1200, 630, { fit: 'cover', position: 'centre' }).jpeg({ quality: 82, mozjpeg: true }).toFile(target)
  console.log(target)
}
