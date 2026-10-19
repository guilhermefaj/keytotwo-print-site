import { type Cart, ApiError, apiErrorMessage } from './api'
import { siteConfig } from './seo'

// Pending D11: replace together with the legally reviewed text and server TERMS_VERSION.
export const termsVersion = import.meta.env.VITE_TERMS_VERSION || 'rascunho-2026-10-08'
export const checkoutMock = siteConfig.stage !== 'live' && import.meta.env.VITE_CHECKOUT_MODE !== 'stripe'
export const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || ''

export function canCheckout(cart?: Cart) {
  return Boolean(cart?.items.length && cart.subtotal && cart.items.every(item => item.status === 'ok' && item.price)
    && !cart.warnings.some(warning => ['PRICE_UNAVAILABLE', 'PRODUCT_UNAVAILABLE', 'ALREADY_OWNED'].includes(warning.code)))
}

export function checkoutError(error: unknown) {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      CART_CHANGED: 'Sua sacola mudou. Confira os itens atualizados antes de continuar.',
      CART_EMPTY: 'Sua sacola está vazia. Escolha um jogo para continuar.',
      TERMS_CHANGED: 'Os termos foram atualizados. Recarregue esta página para ler a versão atual e aceitar novamente.',
      TERMS_NOT_ACCEPTED: 'Leia e aceite os termos para continuar.',
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
