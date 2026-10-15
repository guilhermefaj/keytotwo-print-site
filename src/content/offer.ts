import { pending } from '../lib/pending'

// P001 + subsequent responsible-owner decisions in Plano do site P1 (2026-10-08).
export type ProductOffer = {
  code: string
  name: string
  price: string | null
  priceApproved: boolean
  /** Ação editorial; a disponibilidade efetiva continua sendo validada pelo /catalog. */
  purchaseAction: 'cart' | null
  payment: string
  access: string
  delivery: string
  updates: string
  license: string
  materials: string
  legalReview: string
}

export const packageOffer: ProductOffer = {
  code: 'P001',
  name: pending('nome comercial do pacote.'),
  price: pending('preço e moeda.'),
  priceApproved: false,
  purchaseAction: 'cart',
  payment: pending('modalidade e formas de pagamento.'),
  access: 'O acesso aos jogos não tem prazo de expiração.',
  delivery: 'É preciso criar uma conta para comprar. Os jogos ficam em Meus jogos e também são enviados por e-mail.',
  updates: pending('direito a futuras versões e condições de atualização.'),
  license: pending('licença de uso e condições de atendimento.'),
  materials: pending('lista completa de materiais e instruções de impressão dos cinco jogos.'),
  legalReview: pending('texto final e validação jurídica da política de não reembolso.'),
}

// Compatibilidade dos textos institucionais atuais, ainda referentes ao P001.
// Novos produtos declaram sua própria ProductOffer e não reutilizam este alias.
export const offer = packageOffer

export const howItWorks = [
  { title: 'Crie sua conta e escolha', description: 'É preciso ter cadastro para comprar. Adicione os itens ao carrinho e confira os preços e as condições antes de finalizar o pagamento.', note: 'Carrinho e compra ainda não estão disponíveis neste protótipo.' },
  { title: 'Acesse e prepare', description: 'Os jogos ficam em Meus jogos e também são enviados por e-mail. Imprima e prepare os materiais conforme as instruções de cada jogo.', note: offer.access },
  { title: 'Escolham e joguem', description: 'Com os materiais na mesa, sigam as instruções da experiência escolhida.', note: 'Materiais e preparação variam de jogo para jogo.' },
]
