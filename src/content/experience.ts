// Redesign: proposed brand copy. Commercial facts remain in offer.ts.
// Replace social proof ONLY with authorized material. null = placeholder.
export const experience = {
  headline: ['A rotina pode esperar.', 'Vocês têm um encontro.'],
  description: 'Jogos para imprimir, puxar uma cadeira e descobrir o quanto vocês se divertem juntos.',
  benefits: ['Uma pausa para vocês', 'Diversão fora da tela', 'Para imprimir e jogar'],
  cta: 'Escolher nosso próximo encontro',
  steps: [
    { title: 'Escolham.', text: 'Levem a ideia para o carrinho. Entrem na conta para seguir com a compra.' },
    { title: 'Imprimam.', text: 'Depois da compra, os arquivos ficam em Meus jogos e chegam por e-mail.' },
    { title: 'Divirtam-se.', text: 'Preparem a mesa, guardem os celulares e escolham quem começa.' },
  ],
  pillars: [
    { icon: 'connection', title: 'A curiosidade é mútua.', text: 'Um convite para conversar, descobrir e se surpreender com quem está do outro lado da mesa.' },
    { icon: 'play', title: 'Vale rir de si mesmo.', text: 'Entrem na brincadeira. O talento pode faltar; a vontade de tentar já rende assunto.' },
    { icon: 'time', title: 'Um momento de vocês.', text: 'Uma ideia para dar espaço ao encontro, no ritmo e no cantinho de vocês.' },
  ],
  social: {
    heading: 'Cada dupla, uma história.',
    description: 'Este espaço está reservado para as histórias de quem jogou junto.',
    rating: null as number | null,
    reviewCount: null as number | null,
    testimonials: [
      { id: 'first', quote: null as string | null, author: null as string | null },
      { id: 'second', quote: null as string | null, author: null as string | null },
      { id: 'third', quote: null as string | null, author: null as string | null },
    ],
    placeholders: { rating: 'Nota a preencher', count: 'Total de relatos a preencher', quote: 'Um relato vem aqui.', author: 'Nome do casal a preencher', label: 'Espaço reservado' },
  },
}
