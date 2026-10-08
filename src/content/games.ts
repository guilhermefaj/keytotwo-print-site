import { pending } from '../lib/pending'

// P001 composition; only J001 has documented mechanics. Do not infer rules from names.
export const games = [
  {
    id: 'rabisque-e-adivinhe', name: 'Rabisque e Adivinhe', confirmed: true,
    description: 'Um desenha, o outro adivinha. Vocês alternam os papéis de Artista e Adivinhador e somam os acertos da dupla.',
    pending: pending('prévia pública autorizada, testes de impressão e playtest.'),
  },
  { id: 'hora-dos-artistas', name: 'Hora dos Artistas', confirmed: true, description: 'Inclusão confirmada no pacote.', pending: pending('ficha, regras, materiais e prévia do jogo.') },
  { id: 'boardgame', name: 'Boardgame', confirmed: true, description: 'Inclusão confirmada com este nome provisório.', pending: pending('nome final, ficha, regras, materiais e prévia do jogo.') },
  { id: 'jogo-4', name: 'Jogo a definir', confirmed: false, description: 'Quarta vaga do pacote.', pending: pending('definição do jogo e de seus materiais.') },
  { id: 'jogo-5', name: 'Jogo a definir', confirmed: false, description: 'Quinta vaga do pacote.', pending: pending('definição do jogo e de seus materiais.') },
] as const

// Verified J001 facts, never extrapolated to the other four games.
export const j001 = {
  facts: [{ label: 'Pessoas', value: '2, em equipe' }, { label: 'Partida', value: '10 rodadas de 60 segundos' }, { label: 'Arquivo', value: 'PDF de 4 páginas A4' }, { label: 'Conteúdo', value: 'Instruções e 50 cartas' }],
  materials: 'Impressão, tesoura, uma folha grande para desenhar, uma caneta por pessoa e temporizador.',
  preparation: 'Imprimam e recortem as cartas. Coloquem-nas viradas para baixo e escolham quem começa desenhando.',
  rules: 'O Artista desenha a palavra ou frase da carta sem usar letras ou números. A dupla tenta acertar o máximo de cartas em 60 segundos e troca de papéis a cada rodada. Ao final das 10 rodadas, soma os pontos.',
  duration: 'São 10 minutos de cronômetro. Preparação, trocas e soma dos pontos acrescentam tempo; a duração total ainda não foi medida.',
}
