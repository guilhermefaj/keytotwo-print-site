import { pending } from '../lib/pending.ts'

// P001 composition; only J001 has documented mechanics. Do not infer rules from names.
// Regra de catálogo (DESIGN.md): tudo o que a carta mostra vem daqui (código, nome, resumo,
// capa, fatos, experiência). Sem capa oficial a capa é tipográfica; sem confirmação, "em breve".
// Nenhuma página do PDF vai para o site (responsável, 2026-10-16): quem abrisse a imagem baixaria o jogo.
// Os detalhes falam da experiência do casal, não das regras nem do conteúdo de cada página.
/** O que a dupla providencia além do PDF (DESIGN.md › O que vocês precisam). Rótulos em `needLabels`. */
export type Need = 'impressora' | 'tesoura' | 'caneta' | 'folha' | 'cronometro' | 'estilete' | 'fita' | 'cola' | 'copo' | 'luz' | 'celular'
export const needLabels: Record<Need, string> = {
  impressora: 'Impressora e papel A4',
  tesoura: 'Tesoura',
  caneta: 'Uma caneta por pessoa',
  folha: 'Uma folha grande para desenhar',
  cronometro: 'Cronômetro',
  estilete: 'Estilete e base de corte',
  fita: 'Fita adesiva',
  cola: 'Cola',
  copo: 'Um copo para as dicas',
  luz: 'Luz do dia ou um abajur',
  celular: 'Celular, para os desafios de foto',
}
/** Arte oficial 16:9 gerada por scripts/prepare-game-covers.mjs (640, 960 e 1280 px de largura). */
export type GameCoverArt = { src: string; srcSet: string }
export type Game = {
  id: string
  /** Atribuído na criação da ficha, nunca pela posição no pacote; também identifica o avulso. */
  code?: string
  name: string
  confirmed: boolean
  description: string
  pending: string
  summary: string
  cover?: GameCoverArt
  /** Grátis ao criar a conta: fica fora do pacote e da venda (decisão do responsável, 2026-10-16). */
  freebie?: boolean
  /** Ficha genérica: pessoas, jeito de jogar e formato; sem contar páginas, cartas ou peças. */
  facts?: ReadonlyArray<{ label: string; value: string }>
  /** Cor do jogo, tirada da capa oficial (DESIGN.md › Cor do jogo): só faixa e superfície, nunca texto. */
  accent?: string
  needs?: readonly Need[]
  /** Como é jogar: três momentos da experiência do casal, sem regras, soluções ou páginas do PDF. */
  moments?: ReadonlyArray<{ title: string; text: string }>
}

// Verified J001 facts, never extrapolated to the other games.
export const cover = (code: string): GameCoverArt => ({ src: `/media/games/${code}-capa-640.webp`, srcSet: `/media/games/${code}-capa-640.webp 640w, /media/games/${code}-capa-960.webp 960w, /media/games/${code}-capa-1280.webp 1280w` })

const j001Facts = [{ label: 'Pessoas', value: '2, em equipe' }, { label: 'Jeito de jogar', value: 'Desenho e adivinhação' }, { label: 'Rodadas', value: 'Um minuto cada' }, { label: 'Formato', value: 'PDF para imprimir em casa' }] as const

export const games: readonly Game[] = [
  {
    id: 'rabisque-e-adivinhe', code: 'J001', name: 'Rabisque e Adivinhe', confirmed: true,
    description: 'Uma caneta, uma folha em branco e a certeza de que algum desenho vai sair parecendo uma batata.',
    pending: pending('testes de impressão e playtest.'),
    summary: 'Um desenha, o outro adivinha. Os acertos são da dupla.',
    cover: cover('j001'),
    facts: j001Facts,
    accent: '#e06d86',
    needs: ['impressora', 'tesoura', 'folha', 'caneta', 'cronometro'],
    moments: [
      { title: 'Desenho torto vale.', text: 'Ninguém precisa saber desenhar. A graça é ver o outro tentando entender o que saiu no papel.' },
      { title: 'Rodadas rápidas.', text: 'Um minuto por rodada. É pouco tempo, e é aí que o traço desanda.' },
      { title: 'O time é a dupla.', text: 'Ninguém perde para ninguém. Se a rodada for um desastre, o vexame é dos dois.' },
    ],
  },
  // Códigos atribuídos nas fichas do Drive (capa e PDF por código); jogo ainda sem ficha usa apenas id interno.
  // O pacote lista só os jogos disponíveis, sem quantidade fixa nem vagas "a definir" (responsável, 2026-10-16).
  // Fatos das fichas do segundo cérebro (Jogos/J003 e J002, conferidas em 2026-10-16); duração não medida não entra.
  {
    id: 'tabuleiro-da-sorte', code: 'J003', name: 'Tabuleiro da Sorte', confirmed: true,
    description: 'Um dado, um tabuleiro e uma disputa de moedas. Cada casa pode render uma pergunta, um desafio ou um prejuízo.',
    pending: pending('testes de impressão e playtest.'),
    summary: 'Perguntas, desafios e moedas no tabuleiro. Quem juntar mais faz o par cumprir um pedido secreto.',
    cover: cover('j003'),
    facts: [{ label: 'Pessoas', value: '2, um contra o outro' }, { label: 'Jeito de jogar', value: 'Tabuleiro, perguntas e desafios' }, { label: 'Em jogo', value: 'Moedas e um pedido secreto' }, { label: 'Formato', value: 'PDF para imprimir e montar' }],
    accent: '#f2b33c',
    needs: ['impressora', 'tesoura', 'cola', 'caneta', 'cronometro', 'celular'],
    moments: [
      { title: 'Perguntas que puxam conversa.', text: 'Entre um lance e outro vem uma pergunta, e às vezes a resposta surpreende quem jurava que já sabia.' },
      { title: 'Desafios para rir juntos.', text: 'Alguns pedem criatividade, outros um pouco de coragem. Deixem o celular por perto.' },
      { title: 'Um pedido em jogo.', text: 'Cada um guarda um pedido secreto. Quem juntar mais moedas no fim faz o outro cumprir o seu.' },
    ],
  },
  // J002 (escape room) entra no P001 por decisão do responsável (2026-10-16).
  {
    id: 'o-sumico-de-rapadura', code: 'J002', name: 'O Sumiço de Rapadura', confirmed: true,
    description: 'Rapadura, o vira-lata caramelo do Kito, sumiu antes do forró da vila. Vocês investigam juntos, desafio por desafio, com tesoura, dobra, luz e muita conversa.',
    pending: pending('testes de impressão e playtest.'),
    summary: 'Escape room em dupla, de papel e recorte, para descobrir onde foi parar Rapadura.',
    cover: cover('j002'),
    facts: [{ label: 'Pessoas', value: '2, em cooperação' }, { label: 'Jeito de jogar', value: 'Escape room de papel' }, { label: 'Dicas', value: 'Para quando a dupla travar' }, { label: 'Formato', value: 'PDF para imprimir em casa' }],
    accent: '#d9772e',
    needs: ['impressora', 'tesoura', 'estilete', 'fita', 'caneta', 'copo', 'luz'],
    moments: [
      { title: 'Um mistério para dois.', text: 'Ninguém aqui é detetive. O Kito também não, por isso chamou vocês.' },
      { title: 'Conversa é a melhor pista.', text: 'Cada um vê coisas que o outro não vê. Só descrevendo e perguntando a dupla avança.' },
      { title: 'Mãos no papel.', text: 'Recortar, dobrar e olhar contra a luz fazem parte da investigação.' },
    ],
  },
  // Gratuitos (código F, fichas do segundo cérebro de 2026-10-20): liberados para quem tem conta e aceita os e-mails.
  {
    id: 'hora-dos-artistas', code: 'F001', name: 'Hora dos Artistas', confirmed: true, freebie: true,
    description: 'Os dois desenham o mesmo personagem de memória, contra o relógio, e decidem juntos quem chegou mais perto. No fim, cada um faz o retrato do outro.',
    pending: pending('playtest e duração medida.'),
    summary: 'Desenho de memória contra o relógio. Quem chegou mais perto, a dupla decide junto.',
    cover: cover('f001'), accent: '#c94050', needs: ['impressora', 'tesoura', 'caneta', 'cronometro'],
  },
  {
    id: 'pote-de-planos', code: 'F002', name: 'Pote de Planos', confirmed: true, freebie: true,
    description: 'Vocês recortam os planos, dobram, jogam num pote e sorteiam um quando bate o "o que a gente faz hoje?". Tem date fora, date em casa, gentileza secreta, papo sem celular e desafio valendo prenda.',
    pending: pending('playtest e teste de impressão.'),
    summary: 'Um pote de planos para sortear quando bate o "o que a gente faz hoje?". O que sair, vale.',
    cover: cover('f002'), accent: '#e39a2d', needs: ['impressora', 'tesoura', 'caneta'],
  },
]

export const packageGames = games.filter(game => !game.freebie)
export const freebies = games.filter(game => game.freebie)

export const j001 = {
  facts: j001Facts,
  materials: 'Impressão, tesoura, uma folha grande para desenhar, uma caneta por pessoa e temporizador.',
  preparation: 'Imprimam e recortem as cartas. Coloquem-nas viradas para baixo e escolham quem começa desenhando.',
  rules: 'O Artista desenha a palavra ou frase da carta sem usar letras ou números. A dupla tenta acertar o máximo de cartas em 60 segundos e troca de papéis a cada rodada. Ao final das 10 rodadas, soma os pontos.',
  duration: 'São 10 minutos de cronômetro. Preparação, trocas e soma dos pontos acrescentam tempo; a duração total ainda não foi medida.',
}
