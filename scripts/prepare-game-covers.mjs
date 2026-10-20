import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

// Capas oficiais dos jogos e do pacote (16:9), aprovadas pelo responsável em 2026-10-16. Lê os PNGs do Drive
// e grava três larguras em public/media/games (960 para o celular com tela densa, desempenho 2026-10-16);
// a prévia do PDF não é mais usada como capa.
const root = path.resolve(import.meta.dirname, '..')
const sourceDir = process.env.KTT_COVERS_SOURCE || 'G:/Meu Drive/05-Projetos/KeyToTwo/Print'
// Nomes do Drive desde 2026-10-20: "[CAPA - <código>] <nome>.png".
const covers = { j001: '[CAPA - J001] Rabisque e Adivinhe.png', j002: '[CAPA - J002] O Sumico do Rapadura.png', j003: '[CAPA - J003] Tabuleiro da Sorte.png', f001: '[CAPA - F001] Hora dos Artistas.png', f002: '[CAPA - F002] Pote de Planos.png', p001: '[CAPA - P001] Coleção Keytotwo - Fundadores.png' }
const output = path.join(root, 'public/media/games')

await mkdir(output, { recursive: true })
for (const [code, filename] of Object.entries(covers)) {
  for (const width of [640, 960, 1280]) {
    const file = path.join(output, `${code}-capa-${width}.webp`)
    const info = await sharp(path.join(sourceDir, filename)).resize({ width }).webp({ quality: 82, effort: 6 }).toFile(file)
    console.log(`${path.relative(root, file)} ${info.width}x${info.height} ${Math.round(info.size / 1024)} KB`)
  }
}
