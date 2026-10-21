import sharp from 'sharp'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Arte de "A próxima rodada sai da impressora" (responsável, 2026-10-20): três páginas dos jogos gratuitos, uma na
// cúpula do arco e duas na frente, lado a lado e um pouco abertas, como folhas recém-saídas da impressora (2026-10-21: o
// leque escondia demais as páginas). Só os gratuitos, e numa imagem só: as páginas se cobrem em parte e cada uma tem
// 330 px de largura na maior versão (780 px), então a arte não serve para imprimir o jogo sem a conta. O arco amarelo é do CSS (.experience-pages::before); aqui o fundo é transparente.
// Precisa do pdftoppm (Poppler) no PATH. Grava public/media/experience/gratuitos-paginas-{560,780}.webp.
const root = path.resolve(import.meta.dirname, '..')
const sourceDir = process.env.KTT_PRINT_SOURCE || 'G:/Meu Drive/05-Projetos/KeyToTwo/Print'
const pdfs = { f001: '[F001] Hora dos Artistas.pdf', f002: '[F002] Pote de Planos.pdf' }
// Tela de 780 × 910; centro e giro de cada página, de trás para a frente. O arco do CSS vai de x 75 a 705 e de y 20 a
// 830, com o topo em meia-volta (raio 315): a de trás fica sob a cúpula, com folga, e as duas da frente passam um pouco
// das laterais e do pé. Mudou a tela ou o arco aqui, muda o calc() do CSS junto.
const WIDTH = 780, HEIGHT = 910, PAGE = 330
const pages = [
  { game: 'f001', page: 14, x: 390, y: 355, angle: -3 }, // Superpoderes
  { game: 'f001', page: 12, x: 560, y: 625, angle: 5 }, // Grande final
  { game: 'f002', page: 1, x: 220, y: 625, angle: -4 }, // Pote de Planos: como jogar, com o Kito, na frente
]
const SHADOW = { pad: 48, offset: 12, blur: 14, alpha: 0.26 }
const MARGIN = 120

const work = await mkdtemp(path.join(tmpdir(), 'ktt-gratuitos-'))
try {
  const layers = []
  for (const item of pages) {
    const prefix = path.join(work, `${item.game}-${item.page}`)
    // Renderiza com folga (100 dpi) e reduz no sharp, para o texto miúdo ficar liso.
    execFileSync('pdftoppm', ['-png', '-r', '100', '-singlefile', '-f', String(item.page), '-l', String(item.page), path.join(sourceDir, pdfs[item.game]), prefix])
    const page = await sharp(await readFile(`${prefix}.png`)).resize({ width: PAGE }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const { width, height } = page.info
    const { pad, offset, blur, alpha } = SHADOW
    const edge = Buffer.from(`<svg width="${width}" height="${height}"><rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" fill="none" stroke="rgb(18,58,61)" stroke-opacity=".14"/></svg>`)
    const shadow = await sharp({ create: { width: width + pad * 2, height: height + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: { create: { width, height, channels: 4, background: { r: 18, g: 58, b: 61, alpha } } }, left: pad, top: pad + offset }])
      .png().toBuffer()
    const tile = await sharp(await sharp(shadow).blur(blur).toBuffer())
      .composite([{ input: page.data, raw: page.info, left: pad, top: pad }, { input: edge, left: pad, top: pad }])
      .png().toBuffer()
    const turned = await sharp(tile).rotate(item.angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer({ resolveWithObject: true })
    // A folha girada (sem a sombra) precisa caber na tela; a sombra pode passar e é cortada na margem.
    const radians = Math.abs(item.angle) * Math.PI / 180
    const halfWidth = (width * Math.cos(radians) + height * Math.sin(radians)) / 2, halfHeight = (height * Math.cos(radians) + width * Math.sin(radians)) / 2
    if (item.x - halfWidth < 0 || item.y - halfHeight < 0 || item.x + halfWidth > WIDTH || item.y + halfHeight > HEIGHT) throw new Error(`${item.game} p. ${item.page} sai da tela`)
    layers.push({ input: turned.data, left: Math.round(MARGIN + item.x - turned.info.width / 2), top: Math.round(MARGIN + item.y - turned.info.height / 2) })
  }
  const canvas = await sharp({ create: { width: WIDTH + MARGIN * 2, height: HEIGHT + MARGIN * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(layers).png().toBuffer()
  const art = await sharp(canvas).extract({ left: MARGIN, top: MARGIN, width: WIDTH, height: HEIGHT }).png().toBuffer()
  const output = path.join(root, 'public/media/experience')
  await mkdir(output, { recursive: true })
  for (const width of [560, WIDTH]) {
    const file = path.join(output, `gratuitos-paginas-${width}.webp`)
    const info = await sharp(art).resize({ width }).webp({ quality: 80, alphaQuality: 90, effort: 6 }).toFile(file)
    console.log(`${path.relative(root, file)} ${info.width}x${info.height} ${Math.round(info.size / 1024)} KB`)
  }
} finally {
  await rm(work, { recursive: true, force: true })
}
