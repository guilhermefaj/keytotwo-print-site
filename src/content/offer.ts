// P001 + decisões seguintes do responsável no Plano do site P1 (2026-10-08); preços aprovados em 2026-10-16.
// O preço exibido vem sempre do /catalog (Stripe); `price` aqui é o valor aprovado, para a trava de release.
export type ProductOffer = {
  code: string
  price: string | null
  priceApproved: boolean
  /** Ação editorial; a disponibilidade efetiva continua sendo validada pelo /catalog. */
  purchaseAction: 'cart' | null
  /** Preço de tabela riscado ao lado do cobrado (em centavos), com o rótulo da promoção. Só aparece se for maior. */
  listPrice?: { amount: number; label: string }
}

export const packageOffer: ProductOffer = {
  code: 'P001',
  price: 'R$ 29,90',
  priceApproved: true,
  purchaseAction: 'cart',
  // Promoção de lançamento (responsável, 2026-10-23): o pacote passa a 5 jogos e o preço de tabela a R$ 39,90; fica
  // por R$ 29,90 enquanto durar o lançamento. Acabou a promoção: o preço vai a R$ 39,90 na Stripe e isto sai.
  listPrice: { amount: 3990, label: 'Preço de lançamento' },
}
