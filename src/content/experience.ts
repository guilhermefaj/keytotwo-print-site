// Redesign: proposed brand copy. Commercial facts remain in offer.ts.
// Replace social proof ONLY with authorized material. null = placeholder.
export const experience = {
  // Portão 1 (2026-10-10): etiqueta em caixa normal, marca-texto em "encontro.", sem lista de ✓.
  // CTA "Ver os jogos" (Loja, decisão 2 do responsável) e link "Como funciona". A hero vende a marca, não o produto.
  // Sem "Ver a prévia": nenhuma página do PDF vai para o site (responsável, 2026-10-16).
  tag: 'KeyToTwo · jogos para casais',
  headline: ['A rotina pode esperar.', 'Vocês têm um encontro.'],
  highlight: 'encontro.',
  description: 'Jogos para imprimir, puxar uma cadeira e descobrir o quanto vocês se divertem juntos.',
  cta: { label: 'Ver os jogos', href: '/loja' },
  secondary: { label: 'Como funciona', href: '/#como-funciona' },
  steps: [
    { title: 'Escolham.', text: 'Um jogo ou o pacote vai para a sacola. Para pagar, é preciso entrar na conta.', icon: 'sacola' },
    { title: 'Imprimam.', text: 'O PDF fica em Meus jogos e chega por e-mail. Papel A4 comum resolve.', icon: 'impressora' },
    { title: 'Joguem.', text: 'Recortem o que o jogo pedir e decidam quem começa. Boa sorte nessa negociação.', icon: 'dado' },
  ],
  // Portão 1: relatos de exemplo na voz da marca, marcados placeholder: true. Aparecem só no stage
  // test; em live só entram relatos reais (placeholder: false) e, sem nenhum, a seção não renderiza.
  // Sem nota, número de avaliações ou estrelas. O responsável substitui pelos relatos autorizados.
  social: {
    heading: 'Cada dupla, uma história.',
    placeholderLabel: 'Relato de exemplo',
    testimonials: [
      { id: 'exemplo-1', placeholder: true, quote: 'A gente demorou mais para escolher quem desenhava do que para jogar. Valeu a pena: rimos até das cartas erradas.', author: 'Marina e Léo' },
      { id: 'exemplo-2', placeholder: true, quote: 'Imprimi no trabalho, recortei no ônibus e, à noite, a mesa da cozinha virou arena. Fazia tempo que não ríamos tanto.', author: 'Bia e Caio' },
      { id: 'exemplo-3', placeholder: true, quote: 'Descobri que ele desenha um cachorro igual a uma batata. Dez rodadas depois, já queríamos outra partida.', author: 'Júlia e Renan' },
    ] as ReadonlyArray<{ id: string; placeholder: boolean; quote: string; author: string }>,
  },
  // Freebies resgatados ao criar a conta (Portão 2, 2026-10-14; dois jogos desde 2026-10-16). O resgate é
  // backend e vem depois; até lá a seção só aparece no stage test.
  freebie: {
    tag: 'Grátis',
    title: 'Jogos para começar, por nossa conta.',
    text: 'Quem cria a conta leva esses jogos de graça. Dá para testar a impressora (e a dupla) antes de comprar qualquer coisa.',
    cta: { label: 'Criar conta', href: '/entrar' },
  },
}
