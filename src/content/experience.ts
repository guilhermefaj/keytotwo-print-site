// Redesign: proposed brand copy. Commercial facts remain in offer.ts.
// Replace social proof ONLY with authorized material. null = placeholder.
export const experience = {
  // Portão 1 (2026-10-10): etiqueta em caixa normal, marca-texto em "encontro.", sem lista de ✓,
  // CTA "Quero o pacote" (oferta) e link "Ver a prévia". A hero vende a marca, não o produto.
  tag: 'KeyToTwo · jogos para casais',
  headline: ['A rotina pode esperar.', 'Vocês têm um encontro.'],
  highlight: 'encontro.',
  description: 'Jogos para imprimir, puxar uma cadeira e descobrir o quanto vocês se divertem juntos.',
  cta: { label: 'Quero o pacote', href: '/#comprar' },
  secondary: { label: 'Ver a prévia', href: '/#experiencia' },
  steps: [
    { title: 'Escolham.', text: 'Levem a ideia para o carrinho. Entrem na conta para seguir com a compra.' },
    { title: 'Imprimam.', text: 'Depois da compra, os arquivos ficam em Meus jogos e chegam por e-mail.' },
    { title: 'Divirtam-se.', text: 'Preparem os materiais e escolham quem começa.' },
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
  // Portão 1: haverá um freebie resgatado ao criar a conta; o resgate é backend e vem depois.
  // Esta copy é PROPOSTA (vai ao Portão 2) e o bloco só aparece no stage test.
  freebie: {
    proposal: true,
    tag: 'Em preparação · copy em proposta',
    title: 'Um jogo para começar, por nossa conta.',
    text: 'Ao criar sua conta, vocês ganham um jogo para conhecer a proposta antes do pacote.',
    cta: { label: 'Criar conta', href: '/entrar' },
  },
}
