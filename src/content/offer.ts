import { needLabels, packageGames } from './games.ts'

// P001 + decisões seguintes do responsável no Plano do site P1 (2026-10-08); preços aprovados em 2026-10-16.
// O preço exibido vem sempre do /catalog (Stripe); `price` aqui é o valor aprovado, para a trava de release.
// Validação jurídica dos textos: um único item em legal.ts (legalReview).
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
}

/** Condições comuns a toda oferta (Termos de uso: pagamento, entrega, atualizações e licença). */
export const offerTerms = {
  payment: 'Pix ou cartão, processados pela Stripe.',
  access: 'Os jogos ficam em Meus jogos, sem prazo de expiração enquanto o serviço KeyToTwo estiver em funcionamento.',
  delivery: 'É preciso criar uma conta para comprar. Os jogos ficam em Meus jogos e também são enviados por e-mail.',
  updates: 'Versões corrigidas ou melhoradas, quando houver, ficam em Meus jogos sem custo. Jogos novos são vendidos à parte.',
  license: 'Licença pessoal e intransferível, para uso doméstico e não comercial. Não é permitido revender, compartilhar ou publicar os arquivos.',
} as const

// O que a dupla providencia para os jogos do pacote: a soma das listas de cada jogo, sem repetir.
const packageNeeds = [...new Set(packageGames.flatMap(game => game.needs ?? []))].map(need => needLabels[need])

export const packageOffer: ProductOffer = {
  code: 'P001',
  name: 'Coleção KeyToTwo: Fundadores',
  price: 'R$ 29,90',
  priceApproved: true,
  purchaseAction: 'cart',
  ...offerTerms,
  materials: `${packageNeeds.map((label, index) => index ? label.charAt(0).toLowerCase() + label.slice(1) : label).join(', ')}. Cada jogo mostra a sua lista na página dele.`,
}

// Compatibilidade dos textos institucionais atuais, ainda referentes ao P001.
// Novos produtos declaram sua própria ProductOffer e não reutilizam este alias.
export const offer = packageOffer
