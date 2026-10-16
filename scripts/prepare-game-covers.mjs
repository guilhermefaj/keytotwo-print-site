import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

// Capas oficiais dos jogos e do pacote (16:9), aprovadas pelo responsável em 2026-10-16. Lê os PNGs do Drive
// e grava duas larguras em public/media/games; a prévia do PDF não é mais usada como capa.
const root = path.resolve(import.meta.dirname, '..')
const sourceDir = process.env.KTT_COVERS_SOURCE || 'G:/Meu Drive/05-Projetos/KeyToTwo/Print'
const covers = { j001: '[J001 - CAPA] Rabisque e Adivinhe.png', j002: '[J002 - CAPA] O Sumico do Rapadura.png', j003: '[J003 - CAPA] Tabuleiro da Sorte.png', f001: '[F001 - CAPA] Hora dos Artistas.png', p001: '[P001] Coleção Keytotwo - Fundadores.png' }
const output = path.join(root, 'public/media/games')

await mkdir(output, { recursive: true })
for (const [code, filename] of Object.entries(covers)) {
  for (const width of [640, 1280]) {
    const file = path.join(output, `${code}-capa-${width}.webp`)
    const info = await sharp(path.join(sourceDir, filename)).resize({ width }).webp({ quality: 82, effort: 6 }).toFile(file)
    console.log(`${path.relative(root, file)} ${info.width}x${info.height} ${Math.round(info.size / 1024)} KB`)
  }
}
