import { pending } from '../lib/pending.ts'

// P001 composition; only J001 has documented mechanics. Do not infer rules from names.
// Regra de catálogo (DESIGN.md): tudo o que a carta mostra vem daqui (código, nome, resumo,
// capa, prévia aprovada, fatos). Sem capa oficial a capa é tipográfica; sem confirmação, "em breve".
// A prévia (página real do PDF) não é capa: só aparece na seção de experiência.
export type GamePreview = { src: string; alt: string; href: string; label: string }
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
/** Arte oficial 16:9 gerada por scripts/prepare-game-covers.mjs (640 e 1280 px de largura). */
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
  preview?: GamePreview
  facts?: ReadonlyArray<{ label: string; value: string }>
  /** Cor do jogo, tirada da capa oficial (DESIGN.md › Cor do jogo): só faixa e superfície, nunca texto. */
  accent?: string
  /** Páginas reais do PDF com prévia pública autorizada: entram na galeria do produto, depois da capa. */
  pages?: ReadonlyArray<{ src: string; alt: string }>
  needs?: readonly Need[]
  /** Como jogar em três passos, tirados das regras conferidas; sem revelar soluções. */
  howTo?: readonly string[]
}

// Verified J001 facts, never extrapolated to the other games.
export const cover = (code: string): GameCoverArt => ({ src: `/media/games/${code}-capa-640.webp`, srcSet: `/media/games/${code}-capa-640.webp 640w, /media/games/${code}-capa-1280.webp 1280w` })

const j001Facts = [{ label: 'Pessoas', value: '2, em equipe' }, { label: 'Partida', value: '10 rodadas de 60 segundos' }, { label: 'Arquivo', value: 'PDF de 4 páginas A4' }, { label: 'Conteúdo', value: 'Instruções e 50 cartas' }] as const

export const games: readonly Game[] = [
  {
    id: 'rabisque-e-adivinhe', code: 'J001', name: 'Rabisque e Adivinhe', confirmed: true,
    description: 'Um desenha, o outro adivinha. Vocês alternam os papéis de Artista e Adivinhador e somam os acertos da dupla.',
    pending: pending('prévia pública autorizada, testes de impressão e playtest.'),
    summary: 'Um desenha, o outro adivinha. Os acertos são da dupla.',
    cover: cover('j001'),
    preview: { src: '/media/experience/j001-page-1-720.webp', alt: 'Prévia real de Rabisque e Adivinhe.', href: '/#experiencia', label: 'Ver a prévia' },
    facts: j001Facts,
    accent: '#e06d86',
    pages: [
      { src: '/media/experience/j001-page-1-720.webp', alt: 'Página 1 do PDF: instruções e as primeiras cartas.' },
      { src: '/media/experience/j001-page-2-720.webp', alt: 'Página 2 do PDF: cartas para recortar.' },
      { src: '/media/experience/j001-page-3-720.webp', alt: 'Página 3 do PDF: mais cartas para recortar.' },
    ],
    needs: ['impressora', 'tesoura', 'folha', 'caneta', 'cronometro'],
    howTo: [
      'Imprimam e recortem as cartas. Coloquem-nas viradas para baixo e escolham quem começa desenhando.',
      'O Artista desenha a palavra ou frase da carta, sem letras nem números. A dupla tenta acertar o máximo de cartas em 60 segundos.',
      'Troquem de papéis a cada rodada. Depois de 10 rodadas, somem os pontos da dupla.',
    ],
  },
  // Códigos atribuídos nas fichas do Drive (capa e PDF por código); jogo ainda sem ficha usa apenas id interno.
  // O pacote lista só os jogos disponíveis, sem quantidade fixa nem vagas "a definir" (responsável, 2026-10-16).
  // Fatos das fichas do segundo cérebro (Jogos/J003 e J002, conferidas em 2026-10-16); duração não medida não entra.
  {
    id: 'tabuleiro-da-sorte', code: 'J003', name: 'Tabuleiro da Sorte', confirmed: true,
    description: 'Jogo de tabuleiro para duas pessoas, com perguntas sobre o relacionamento, desafios e moedas. Cada um escreve um pedido secreto no Tesouro; quem terminar com mais moedas entrega o seu ao par.',
    pending: pending('prévia pública autorizada, testes de impressão e playtest.'),
    summary: 'Perguntas, desafios e moedas no tabuleiro. Quem juntar mais faz o par cumprir um pedido secreto.',
    cover: cover('j003'),
    facts: [{ label: 'Pessoas', value: '2, um contra o outro' }, { label: 'Arquivo', value: 'PDF de 11 páginas A4' }, { label: 'Cartas', value: '54: 27 perguntas e 27 desafios' }, { label: 'Peças', value: 'Tabuleiro, 30 moedas, dado e pinos' }],
    accent: '#f2b33c',
    needs: ['impressora', 'tesoura', 'cola', 'caneta', 'cronometro', 'celular'],
    howTo: [
      'Recortem cartas, moedas, dado e pinos. Cada um escreve no Tesouro um pedido secreto para o par e guarda até o fim.',
      'Na sua vez, joguem o dado, andem as casas e façam o que a casa pede: pergunta, desafio, ganhar ou dar moedas.',
      'Quem voltar primeiro ao INÍCIO ganha 5 moedas e encerra o jogo. Quem tiver mais moedas entrega o seu pedido ao par.',
    ],
  },
  // J002 (escape room) entra no P001 por decisão do responsável (2026-10-16).
  {
    id: 'o-sumico-de-rapadura', code: 'J002', name: 'O Sumiço de Rapadura', confirmed: true,
    description: 'Escape room cooperativo para duas pessoas: ajudem o Kito a descobrir o que aconteceu com Rapadura, o cachorro dele, antes do forró da vila. São seis desafios com papel, recorte, dobra, luz e conversa.',
    pending: pending('prévia pública autorizada, testes de impressão e playtest.'),
    summary: 'Escape room em dupla: seis desafios de papel, recorte e conversa para encontrar Rapadura.',
    cover: cover('j002'),
    facts: [{ label: 'Pessoas', value: '2, em cooperação' }, { label: 'Desafios', value: '6 e um desfecho' }, { label: 'Arquivo', value: 'PDF de 21 páginas A4' }, { label: 'Dicas', value: '18 cartões, da dica leve à solução' }],
    accent: '#d9772e',
    needs: ['impressora', 'tesoura', 'estilete', 'fita', 'caneta', 'copo', 'luz'],
    howTo: [
      'Imprimam as páginas e fechem os sete envelopes com os selos, sem ler o que vai dentro.',
      'Abram o primeiro envelope e resolvam o desafio. A resposta certa no Livro do Cartório diz qual envelope abrir depois.',
      'Cada um tem folhas que o par não pode ver: descrevam, perguntem e usem as dicas quando precisarem.',
    ],
  },
  // Freebies (código F): dois no início; o segundo ainda está em desenvolvimento.
  { id: 'hora-dos-artistas', code: 'F001', name: 'Hora dos Artistas', confirmed: true, freebie: true, description: 'Jogo grátis para quem cria a conta.', pending: pending('ficha, regras, materiais e prévia do jogo.'), summary: 'Detalhes e prévia em breve.', cover: cover('f001'), accent: '#c94050' },
  { id: 'freebie-2', name: 'Jogo a definir', confirmed: false, freebie: true, description: 'Segundo jogo grátis.', pending: pending('definição do jogo e de seus materiais.'), summary: 'O segundo jogo grátis está em preparação.' },
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
