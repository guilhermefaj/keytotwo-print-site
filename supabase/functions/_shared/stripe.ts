import Stripe from 'stripe'
import { ConfigError, env } from './env.ts'

// SDK fixo em npm:stripe@22.0.2 (deno.json); a API padrão dele é a 2026-03-25.dahlia.
// A API do formulário embutido está em PREVIEW (docs/api-contract.md 6.5.1): versão e SDK não mudam sem teste.
export const STRIPE_API_VERSION = '2026-03-25.dahlia; custom_checkout_payment_form_preview=v1'
// Regra da nota "Stripe Checkout Studio": 'form' com SDK >= 21.0.0; abaixo disso, 'custom'.
export const STRIPE_UI_MODE = 'form'

export const cryptoProvider = Stripe.createSubtleCryptoProvider()

type StripeConfig = NonNullable<ConstructorParameters<typeof Stripe>[1]>
export type StripeError = InstanceType<typeof Stripe.errors.StripeError>

let client: Stripe | undefined

function secretKey(): string {
  const key = env.stripeSecretKey()
  if (!key) throw new ConfigError('Variável de ambiente ausente: STRIPE_SECRET_KEY')
  return key
}

export function stripe(): Stripe {
  client ??= new Stripe(secretKey(), {
    // O tipo do SDK só aceita a versão estável; o sufixo de preview vai como está.
    apiVersion: STRIPE_API_VERSION as StripeConfig['apiVersion'],
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
    timeout: 10_000,
  })
  return client
}

// livemode vem da chave do ambiente, nunca do navegador.
export function livemode(): boolean {
  return /^(sk|rk)_live_/.test(secretKey())
}

export function isStripeError(error: unknown): error is StripeError {
  return error instanceof Stripe.errors.StripeError
}

// Para log: tipo e código da Stripe, sem mensagem (pode citar e-mail ou valores).
export function stripeErrorLabel(error: StripeError): string {
  return `${error.type}${error.code ? `/${error.code}` : ''}${error.statusCode ? ` HTTP ${error.statusCode}` : ''}`
}
