import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Kito acenando (kito-hi) da celebração do pagamento e da saudação do Portal, a partir da arte oficial no Drive.
// Nearest-neighbor no canvas inteiro e WebP lossless exato; nenhum retoque. Páginas de PDF nunca vão para public/.
const root = path.resolve(import.meta.dirname, '..')
const vault = process.env.KTT_VAULT_ROOT || 'G:/Meu Drive/09-Second-brain'
const source = path.join(vault, '95-Anexos/KeyToTwo/Marca/Pixel Art/kito_hi.png')
await mkdir(path.join(root, 'public/media/experience'), { recursive: true })
for (const width of [128, 256]) {
  const output = `experience/kito-hi-${width}.webp`
  const encoded = await sharp(source).resize({ width, kernel: sharp.kernel.nearest }).webp({ lossless: true, exact: true, quality: 100, effort: 6 }).toBuffer()
  await writeFile(path.join(root, 'public/media', output), encoded)
  console.log(output, encoded.length)
}
