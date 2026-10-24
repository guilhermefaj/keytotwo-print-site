// P001 composition; only J001 has documented mechanics. Do not infer rules from names.
// Regra de catálogo (DESIGN.md): tudo o que a carta mostra vem daqui (código, nome, resumo,
// capa, fatos, experiência). Sem capa oficial a capa é tipográfica; sem confirmação, "em breve".
// Nenhuma página do PDF vai para o site (responsável, 2026-10-16): quem abrisse a imagem baixaria o jogo.
// Os detalhes falam da experiência do casal, não das regras nem do conteúdo de cada página.
/** O que a dupla providencia além do PDF (DESIGN.md › O que vocês precisam). Rótulos em `needLabels`. */
export type Need = 'impressora' | 'tesoura' | 'caneta' | 'folha' | 'cronometro' | 'estilete' | 'fita' | 'cola' | 'copo' | 'luz' | 'celular' | 'lapis' | 'mesa'
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
  lapis: 'Um lápis apontado',
  mesa: 'Uma mesa com espaço para enfileirar os meses',
}
/** Arte oficial 16:9 gerada por scripts/prepare-game-covers.mjs (640 e 800 px de largura; as folhas não dão para usar). */
export type GameCoverArt = { src: string; srcSet: string }
export type Game = {
  id: string
  /** Atribuído na criação da ficha, nunca pela posição no pacote; também identifica o avulso. */
  code?: string
  name: string
  confirmed: boolean
  description: string
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
export const cover = (code: string): GameCoverArt => ({ src: `/media/games/${code}-capa-640.webp`, srcSet: `/media/games/${code}-capa-640.webp 640w, /media/games/${code}-capa-800.webp 800w` })

const j001Facts = [{ label: 'Pessoas', value: '2, em equipe' }, { label: 'Jeito de jogar', value: 'Desenho e adivinhação' }, { label: 'Rodadas', value: 'Um minuto cada' }, { label: 'Formato', value: 'PDF para imprimir em casa' }] as const

export const games: readonly Game[] = [
  {
    id: 'rabisque-e-adivinhe', code: 'J001', name: 'Rabisque e Adivinhe', confirmed: true,
    description: 'Uma caneta, uma folha em branco e a certeza de que algum desenho vai sair parecendo uma batata.',
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
  // J004 e J005 entram no P001 e também se vendem sozinhos (responsável, 2026-10-23). Fatos das fichas do segundo
  // cérebro (Jogos/J004 e J005, 2026-10-23), sem spoilers; duração não medida não entra.
  {
    id: 'a-rota-da-fornalha', code: 'J004', name: 'A Rota da Fornalha', confirmed: true,
    description: 'O piloto automático da nave do Kito mudou a rota de madrugada, e quem sabe a senha da porta é um comandante que não acorda. Vocês resolvem os desafios juntos para chegar à cabine e pôr a nave de volta no caminho.',
    summary: 'Escape room espacial em dupla, para pôr a nave do Kito de volta na rota certa.',
    cover: cover('j004'),
    facts: [{ label: 'Pessoas', value: '2, em cooperação' }, { label: 'Jeito de jogar', value: 'Escape room de papel' }, { label: 'Dicas', value: 'Para quando a dupla travar' }, { label: 'Formato', value: 'PDF para imprimir em casa' }],
    accent: '#d4600f',
    needs: ['impressora', 'tesoura', 'estilete', 'fita', 'caneta', 'copo', 'lapis'],
    moments: [
      { title: 'Cada um vê uma parte.', text: 'Muitas pistas só uma pessoa enxerga. A outra escuta, pergunta e confia na descrição.' },
      { title: 'Humor de bordo.', text: 'Atualização automática de madrugada, alguém que ronca, manual que ninguém leu. O Kito conta tudo com a cara mais séria.' },
      { title: 'A nave pede os dois.', text: 'Ninguém pousa sozinho. As últimas decisões só saem com as duas mãos juntas.' },
    ],
  },
  {
    id: 'retrospectiva-a-dois', code: 'J005', name: 'Retrospectiva a Dois', confirmed: true,
    description: 'Uma noite de premiação para a temporada de vocês: o último ano, ou o tempo desde o último aniversário de namoro. Vocês remontam a linha do tempo com momentos que só vocês viveram, apontam quem fez o quê, votam os prêmios e fecham uma cápsula para a próxima temporada.',
    summary: 'Uma premiação da temporada de vocês, com linha do tempo, prêmios e uma cápsula para a próxima.',
    cover: cover('j005'),
    facts: [{ label: 'Pessoas', value: '2, em cooperação' }, { label: 'Jeito de jogar', value: 'Memória e votação' }, { label: 'Temporada', value: 'Até 12 meses de vocês' }, { label: 'Formato', value: 'PDF para imprimir em casa' }],
    accent: '#b5562b',
    needs: ['impressora', 'tesoura', 'caneta', 'fita', 'mesa'],
    moments: [
      { title: 'Cada um lembra de um jeito.', text: 'Um escreve um momento da temporada, o outro tenta acertar o mês. As versões nem sempre batem.' },
      { title: 'Três, dois, um, aponta.', text: 'Uma frase, uma contagem e os dois apontam ao mesmo tempo para quem fez aquilo. Às vezes cada um aponta para o outro.' },
      { title: 'Fica para guardar.', text: 'No fim sai um pôster com os premiados e uma cápsula fechada, para abrir na próxima temporada.' },
    ],
  },
  // Gratuitos (código F, fichas do segundo cérebro de 2026-10-20): liberados para quem tem conta e aceita os e-mails.
  {
    id: 'hora-dos-artistas', code: 'F001', name: 'Hora dos Artistas', confirmed: true, freebie: true,
    description: 'Os dois desenham o mesmo personagem de memória, contra o relógio, e decidem juntos quem chegou mais perto. No fim, cada um faz o retrato do outro.',
    summary: 'Desenho de memória contra o relógio. Quem chegou mais perto, a dupla decide junto.',
    cover: cover('f001'), accent: '#c94050', needs: ['impressora', 'tesoura', 'caneta', 'cronometro'],
  },
  {
    id: 'pote-de-planos', code: 'F002', name: 'Pote de Planos', confirmed: true, freebie: true,
    description: 'Vocês recortam os planos, dobram, jogam num pote e sorteiam um quando bate o "o que a gente faz hoje?". Tem date fora, date em casa, gentileza secreta, papo sem celular e desafio valendo prenda.',
    summary: 'Um pote de planos para sortear quando bate o "o que a gente faz hoje?". O que sair, vale.',
    cover: cover('f002'), accent: '#e39a2d', needs: ['impressora', 'tesoura', 'caneta'],
  },
]

export const packageGames = games.filter(game => !game.freebie)
// O jeito de jogar da ficha: o rótulo curto que apresenta o jogo nos cards e nas listas do pacote.
export const playStyle = (game: Game) => game.facts?.find(fact => fact.label === 'Jeito de jogar')?.value
export const freebies = games.filter(game => game.freebie)
// No stage test, a fixture TESTE-J01 do seed responde pelo J001 (capa e nome); fora dele, o código é o próprio.
export const contentCode = (code: string, stage: string) => (stage === 'test' && code === 'TESTE-J01' ? 'J001' : code)
