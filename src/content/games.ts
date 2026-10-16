import { pending } from '../lib/pending.ts'

// P001 composition; only J001 has documented mechanics. Do not infer rules from names.
// Regra de catálogo (DESIGN.md): tudo o que a carta mostra vem daqui (código, nome, resumo,
// capa, prévia aprovada, fatos). Sem capa oficial a capa é tipográfica; sem confirmação, "em breve".
// A prévia (página real do PDF) não é capa: só aparece na seção de experiência.
export type GamePreview = { src: string; alt: string; href: string; label: string }
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
}

// Verified J001 facts, never extrapolated to the other four games.
const cover = (code: string): GameCoverArt => ({ src: `/media/games/${code}-capa-640.webp`, srcSet: `/media/games/${code}-capa-640.webp 640w, /media/games/${code}-capa-1280.webp 1280w` })

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
  },
  // Códigos atribuídos nas fichas do Drive (capa e PDF por código); jogo ainda sem ficha usa apenas id interno.
  // O pacote lista só os jogos disponíveis, sem quantidade fixa nem vagas "a definir" (responsável, 2026-10-16).
  { id: 'tabuleiro-da-sorte', code: 'J003', name: 'Tabuleiro da Sorte', confirmed: true, description: 'Inclusão confirmada no pacote.', pending: pending('regras, materiais e prévia do jogo.'), summary: 'Detalhes e prévia em breve.', cover: cover('j003') },
  // J002 (escape room) entra no P001 por decisão do responsável (2026-10-16).
  { id: 'o-sumico-de-rapadura', code: 'J002', name: 'O Sumiço de Rapadura', confirmed: true, description: 'Inclusão confirmada no pacote.', pending: pending('regras, materiais e prévia do jogo.'), summary: 'Detalhes e prévia em breve.', cover: cover('j002') },
  // Freebies (código F): dois no início; o segundo ainda está em desenvolvimento.
  { id: 'hora-dos-artistas', code: 'F001', name: 'Hora dos Artistas', confirmed: true, freebie: true, description: 'Jogo grátis para quem cria a conta.', pending: pending('ficha, regras, materiais e prévia do jogo.'), summary: 'Detalhes e prévia em breve.', cover: cover('f001') },
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
