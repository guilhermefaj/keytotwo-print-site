import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Favicon do Kito em pixel art, enviado pelo responsável em 2026-10-17. Lê o PNG do Drive, recorta a borda
// transparente para o Kito ocupar o ícone inteiro e grava:
// - public/favicon.ico (16, 32 e 48 px, PNG dentro do ICO), no endereço que navegadores e buscadores procuram;
// - public/media/icons/kito-192.png, para Android e Chrome;
// - public/media/icons/apple-touch-icon.png (180 px, fundo Céu opaco: o iOS pinta a transparência de preto).
// A arte tem antisserrilhado (não segue uma grade limpa), por isso a redução usa filtro e não vizinho mais próximo.
const root = path.resolve(import.meta.dirname, '..')
const source = process.env.KTT_FAVICON_SOURCE || 'G:/Meu Drive/05-Projetos/KeyToTwo/Images/Pixel Art/kito_favicon.png'
const sky = '#ECFAF7'

const { data: trimmed, info } = await sharp(source).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true })
const side = Math.max(info.width, info.height)
const square = await sharp(trimmed)
  .extend({
    top: Math.floor((side - info.height) / 2), bottom: Math.ceil((side - info.height) / 2),
    left: Math.floor((side - info.width) / 2), right: Math.ceil((side - info.width) / 2),
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer()
// Paleta indexada: a pixel art tem poucas cores, e o PNG cai a um terço sem diferença visível.
const png = size => sharp(square).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9, palette: true, quality: 100, effort: 10 }).toBuffer()

// ICO com imagens PNG: cabeçalho de 6 bytes, uma entrada de 16 bytes por tamanho e os PNGs em sequência.
async function ico(sizes) {
  const images = await Promise.all(sizes.map(png))
  const header = Buffer.alloc(6 + 16 * sizes.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  sizes.forEach((size, i) => {
    const entry = 6 + 16 * i
    header.writeUInt8(size >= 256 ? 0 : size, entry)
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(images[i].length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += images[i].length
  })
  return Buffer.concat([header, ...images])
}

const appleSize = 180, appleArt = 144
const apple = await sharp({ create: { width: appleSize, height: appleSize, channels: 4, background: sky } })
  .composite([{ input: await png(appleArt), gravity: 'centre' }])
  .flatten({ background: sky })
  .png({ compressionLevel: 9, palette: true, quality: 100, effort: 10 })
  .toBuffer()

await mkdir(path.join(root, 'public/media/icons'), { recursive: true })
const files = {
  'public/favicon.ico': await ico([16, 32, 48]),
  'public/media/icons/kito-192.png': await png(192),
  'public/media/icons/apple-touch-icon.png': apple,
}
for (const [file, buffer] of Object.entries(files)) {
  await writeFile(path.join(root, file), buffer)
  console.log(`${file} ${(buffer.length / 1024).toFixed(1)} KB`)
}
