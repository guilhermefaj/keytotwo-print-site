import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

// Capas oficiais dos jogos e do pacote (16:9, 1600 × 900), trocadas pelo responsável em 2026-10-23: fotos das
// folhas impressas em leque. Lê os PNGs do Drive e grava duas larguras em public/media/games. Para em 800 px
// (responsável, 2026-10-23): as capas mostram páginas dos jogos pagos, e nessa largura a folha do meio fica com uns
// 240 px, abaixo da arte dos gratuitos (até 330 px por página): dá para ver a folha, não dá para usar o jogo.
const root = path.resolve(import.meta.dirname, '..')
const sourceDir = process.env.KTT_COVERS_SOURCE || 'G:/Meu Drive/05-Projetos/KeyToTwo/Print'
// Nomes do Drive desde 2026-10-20: "[CAPA - <código>] <nome>.png".
const covers = {
  j001: '[CAPA - J001] Rabisque e Adivinhe.png', j002: '[CAPA - J002] O Sumico do Rapadura.png', j003: '[CAPA - J003] Tabuleiro da Sorte.png',
  j004: '[CAPA - J004] A Rota da Fornalha.png', j005: '[CAPA - J005] Retrospectiva a Dois.png',
  f001: '[CAPA - F001] Hora dos Artistas.png', f002: '[CAPA - F002] Pote de Planos.png', p001: '[CAPA - P001] Coleção Keytotwo - Fundadores.png',
}
const output = path.join(root, 'public/media/games')

await mkdir(output, { recursive: true })
for (const [code, filename] of Object.entries(covers)) {
  for (const width of [640, 800]) {
    const file = path.join(output, `${code}-capa-${width}.webp`)
    const info = await sharp(path.join(sourceDir, filename)).resize({ width }).webp({ quality: 82, effort: 6 }).toFile(file)
    console.log(`${path.relative(root, file)} ${info.width}x${info.height} ${Math.round(info.size / 1024)} KB`)
  }
}
