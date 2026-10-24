import { type Cart, ApiError, apiErrorMessage } from './api'
import { siteConfig } from './site-config'
import { termsVersion as publishedTermsVersion } from '../content/legal'

// A versão dos termos publicados (legal.ts); o servidor precisa ter o mesmo TERMS_VERSION, senão TERMS_CHANGED.
export const termsVersion = import.meta.env.VITE_TERMS_VERSION || publishedTermsVersion
export const checkoutMock = siteConfig.stage !== 'live' && import.meta.env.VITE_CHECKOUT_MODE !== 'stripe'
export const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || ''

// Segue para o pagamento com algo a pagar e todos os preços conferidos. O item riscado (já possuído ou já no pacote
// da sacola) não impede: ele fica fora do pedido. O que deixou de ser vendável precisa sair da sacola antes.
export function canCheckout(cart?: Cart) {
  return Boolean(cart?.subtotal && cart.items.some(item => item.status === 'ok')
    && cart.items.every(item => item.status !== 'unavailable' && (item.status !== 'ok' || item.charge))
    && !cart.warnings.some(warning => ['PRICE_UNAVAILABLE', 'PRODUCT_UNAVAILABLE'].includes(warning.code)))
}

export function checkoutError(error: unknown) {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      CART_CHANGED: 'Sua sacola mudou. Confira os itens atualizados antes de continuar.',
      CART_EMPTY: 'Sua sacola está vazia. Escolha um jogo para continuar.',
      ALREADY_OWNED: 'Tudo o que está na sacola já é seu ou já está num pacote dela. Confira a sacola.',
      TERMS_CHANGED: 'Os termos foram atualizados. Recarregue esta página para ler a versão atual e aceitar novamente.',
      PAYMENT_PROVIDER_ERROR: 'Não conseguimos abrir o pagamento agora. Tente novamente em instantes.',
    }
    return messages[error.code] || apiErrorMessage(error)
  }
  return 'Não foi possível conectar ao pagamento. Confira sua conexão e tente novamente.'
}

export type OrderStatus = {
  state: 'paid' | 'processing' | 'pending_payment' | 'failed' | 'expired' | 'not_found'
  next?: 'open_library' | 'other_account'
  items?: { code: string; name: string }[]
}
