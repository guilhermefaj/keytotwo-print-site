import { pending } from '../lib/pending.ts'

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
  materials: pending('lista completa de materiais e instruções de impressão dos jogos do pacote.'),
  legalReview: pending('texto final e validação jurídica da política de não reembolso.'),
}

// Compatibilidade dos textos institucionais atuais, ainda referentes ao P001.
// Novos produtos declaram sua própria ProductOffer e não reutilizam este alias.
export const offer = packageOffer
