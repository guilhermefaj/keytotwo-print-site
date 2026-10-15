import { pending } from '../lib/pending'

// P001 composition; only J001 has documented mechanics. Do not infer rules from names.
// Regra de catálogo (DESIGN.md): tudo o que a carta mostra vem daqui (código, nome, resumo,
// prévia aprovada, fatos). Sem prévia aprovada a capa é tipográfica; sem confirmação, "em breve".
export type GamePreview = { src: string; alt: string; href: string; label: string }
export type Game = {
  id: string
  /** Atribuído na criação da ficha, nunca pela posição no pacote; também identifica o avulso. */
  code?: string
  name: string
  confirmed: boolean
  description: string
  pending: string
  summary: string
  preview?: GamePreview
  facts?: ReadonlyArray<{ label: string; value: string }>
}

// Verified J001 facts, never extrapolated to the other four games.
const j001Facts = [{ label: 'Pessoas', value: '2, em equipe' }, { label: 'Partida', value: '10 rodadas de 60 segundos' }, { label: 'Arquivo', value: 'PDF de 4 páginas A4' }, { label: 'Conteúdo', value: 'Instruções e 50 cartas' }] as const

export const games: readonly Game[] = [
  {
    id: 'rabisque-e-adivinhe', code: 'J001', name: 'Rabisque e Adivinhe', confirmed: true,
    description: 'Um desenha, o outro adivinha. Vocês alternam os papéis de Artista e Adivinhador e somam os acertos da dupla.',
    pending: pending('prévia pública autorizada, testes de impressão e playtest.'),
    summary: 'Um desenha, o outro adivinha. Os acertos são da dupla.',
    preview: { src: '/media/experience/j001-page-1-720.webp', alt: 'Prévia real de Rabisque e Adivinhe.', href: '/#experiencia', label: 'Ver a prévia' },
    facts: j001Facts,
  },
  // J002 pertence à ficha de O Sumiço do Rapadura, sem inclusão confirmada no P001.
  // Os jogos sem ficha usam apenas id interno até receberem o próximo código livre.
  { id: 'hora-dos-artistas', name: 'Hora dos Artistas', confirmed: true, description: 'Inclusão confirmada no pacote.', pending: pending('código, ficha, regras, materiais e prévia do jogo.'), summary: 'Detalhes e prévia em breve.' },
  { id: 'tabuleiro-da-sorte', name: 'Tabuleiro da Sorte', confirmed: true, description: 'Inclusão confirmada no pacote.', pending: pending('código, ficha, regras, materiais e prévia do jogo.'), summary: 'Detalhes e prévia em breve.' },
  { id: 'jogo-4', name: 'Jogo a definir', confirmed: false, description: 'Quarta vaga do pacote.', pending: pending('definição do jogo e de seus materiais.'), summary: 'Estamos preparando este jogo para o pacote.' },
  { id: 'jogo-5', name: 'Jogo a definir', confirmed: false, description: 'Quinta vaga do pacote.', pending: pending('definição do jogo e de seus materiais.'), summary: 'Estamos preparando este jogo para o pacote.' },
]

export const j001 = {
  facts: j001Facts,
  materials: 'Impressão, tesoura, uma folha grande para desenhar, uma caneta por pessoa e temporizador.',
  preparation: 'Imprimam e recortem as cartas. Coloquem-nas viradas para baixo e escolham quem começa desenhando.',
  rules: 'O Artista desenha a palavra ou frase da carta sem usar letras ou números. A dupla tenta acertar o máximo de cartas em 60 segundos e troca de papéis a cada rodada. Ao final das 10 rodadas, soma os pontos.',
  duration: 'São 10 minutos de cronômetro. Preparação, trocas e soma dos pontos acrescentam tempo; a duração total ainda não foi medida.',
}
