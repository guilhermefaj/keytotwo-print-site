// Redesign: proposed brand copy. Commercial facts (price, pack) come from the catalog (catalog.ts).
// Replace social proof ONLY with authorized material. null = placeholder.
export const experience = {
  // Portão 1 (2026-10-10): marca-texto em "encontro.", sem lista de ✓. Sem a etiqueta "KeyToTwo · jogos para casais"
  // acima do título (responsável, 2026-10-22).
  // CTA "Ver os jogos" (Loja, decisão 2 do responsável) e link "Como funciona". A hero vende a marca, não o produto.
  // Sem "Ver a prévia": nenhuma página do PDF vai para o site (responsável, 2026-10-16).
  headline: ['A rotina pode esperar.', 'Vocês têm um encontro.'],
  highlight: 'encontro.',
  description: 'Jogos para imprimir, puxar uma cadeira e descobrir o quanto vocês se divertem juntos.',
  cta: { label: 'Ver os jogos', href: '/loja' },
  secondary: { label: 'Como funciona', href: '/#como-funciona' },
  // Hero com foto (responsável, 2026-10-24: o site estava lúdico demais para a persona). As folhas da foto não dão para
  // ler: nenhuma página do PDF vai para o site.
  photo: { alt: 'Casal à mesa com folhas impressas, lápis de cor e uma taça de vinho' },
  steps: [
    { title: 'Escolham.', text: 'Um jogo ou o pacote vai para a sacola. Para pagar, é preciso entrar na conta.', icon: 'sacola' },
    { title: 'Imprimam.', text: 'O PDF fica em Meus jogos e chega por e-mail. Papel A4 comum resolve.', icon: 'impressora' },
    { title: 'Joguem.', text: 'Recortem o que o jogo pedir e decidam quem começa. Boa sorte nessa negociação.', icon: 'cartas' },
  ],
  // Portão 1: relatos de exemplo na voz da marca, marcados placeholder: true. Aparecem só no stage test, sem selo,
  // para os amigos verem a seção pronta no teste fechado (responsável, 2026-10-22); em live só entram relatos reais
  // (placeholder: false) e, sem nenhum, a seção não renderiza. Os de exemplo não travam o lançamento.
  // Estrelas e foto do casal a pedido do responsável (2026-10-18). Num relato real, a nota é a que o casal deu,
  // nunca preenchida por nós, e a foto só entra com autorização; sem ela, a silhueta de exemplo. Sem número de
  // avaliações nem média. O responsável substitui pelos relatos autorizados.
  social: {
    heading: 'Cada dupla, uma história.',
    testimonials: [
      { id: 'exemplo-1', placeholder: true, rating: 5, quote: 'A gente demorou mais para escolher quem desenhava do que para jogar. Valeu a pena: rimos até das cartas erradas.', author: 'Marina e Léo' },
      { id: 'exemplo-2', placeholder: true, rating: 5, quote: 'Imprimi no trabalho, recortei no ônibus e, à noite, a mesa da cozinha virou arena. Fazia tempo que não ríamos tanto.', author: 'Bia e Caio' },
      { id: 'exemplo-3', placeholder: true, rating: 5, quote: 'Descobri que ele desenha um cachorro igual a uma batata. Dez rodadas depois, já queríamos outra partida.', author: 'Júlia e Renan' },
      { id: 'exemplo-4', placeholder: true, rating: 5, quote: 'Passamos a noite de abajur aceso atrás do Rapadura. Ela jura que achou a pista primeiro. Eu tenho minhas dúvidas.', author: 'Carla e Diego' },
      { id: 'exemplo-5', placeholder: true, rating: 5, quote: 'Perdi todas as moedas no Tabuleiro da Sorte e tive que cumprir o pedido secreto dela. Já estou treinando para a revanche.', author: 'Paula e Thiago' },
      { id: 'exemplo-6', placeholder: true, rating: 5, quote: 'A gente trocou a série de sexta por uma partida. Agora quem decide a sexta é o dado.', author: 'Fernanda e Rafa' },
      { id: 'exemplo-7', placeholder: true, rating: 5, quote: 'Não temos impressora. Imprimimos na papelaria da esquina e no mesmo dia já estávamos jogando.', author: 'Camila e Bruno' },
      { id: 'exemplo-8', placeholder: true, rating: 5, quote: 'Eu desenho mal e ela adivinha qualquer rabisco. Somando os dois, a dupla até que vai bem.', author: 'André e Lia' },
    ] as ReadonlyArray<{ id: string; placeholder: boolean; rating: number; quote: string; author: string; photo?: { src: string; alt: string } }>,
  },
  // Atalho para a página Gratuitos (responsável, 2026-10-20): conta + aceite dos e-mails libera os dois jogos.
  freebie: {
    title: 'Jogos para começar, por nossa conta.',
    text: 'Quem tem conta e aceita nossos e-mails leva esses jogos de graça. Dá para testar a impressora (e a dupla) antes de comprar qualquer coisa.',
    cta: { label: 'Ver os gratuitos', href: '/gratuitos' },
  },
}
