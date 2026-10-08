// Minimal boundary types: official stripe/stripe-js checkout.d.ts and payment-form.d.ts.
// Stripe.js itself is loaded only from Stripe; no SDK runtime is bundled.
type Amount = { minorUnitsAmount: number; amount: string }
export type CheckoutSession = {
  id: string
  currency: string
  livemode: boolean
  total: { subtotal: Amount; discount: Amount; total: Amount }
  discountAmounts: { promotionCode: string | null; displayName: string }[] | null
  status: { type: 'open' | 'complete' | 'expired' }
}
type Result = { type: 'success'; session: CheckoutSession } | { type: 'error'; error: { message: string; code?: string | null } }
export type CheckoutActions = {
  getSession(): CheckoutSession
  applyPromotionCode(code: string): Promise<Result>
  removePromotionCode(): Promise<Result>
  confirm(options: { formConfirmEvent: unknown }): Promise<Result>
}
export type CheckoutForm = {
  mount(element: HTMLElement): void
  destroy(): void
  on(event: 'ready' | 'loaderror' | 'confirm', callback: (event: unknown) => void): void
}
type CheckoutSdk = {
  createForm(options: { layout: 'expanded'; features?: { promotionCodeCollection?: 'auto' | 'never' } }): CheckoutForm
  on(event: 'change', callback: (session: CheckoutSession) => void): void
  loadActions(): Promise<{ type: 'success'; actions: CheckoutActions } | { type: 'error' }>
}
type Stripe = { initCheckoutFormSdk(options: { clientSecret: string; appearance: typeof studioAppearance; fonts?: typeof studioFonts }): CheckoutSdk }
type StripeFactory = (key: string, options: { betas: string[] }) => Stripe
declare global { interface Window { Stripe?: StripeFactory } }

// Exact settings approved in the Stripe Checkout Studio note.
// The font is the site's DM Sans, loaded through the SDK so the form always has it;
// everything else (colors, spacing, borders) stays as configured in Studio.
export const studioAppearance = {
  theme: 'stripe', labels: 'auto', inputs: 'spaced',
  variables: { borderRadius: '4px', colorBackground: '#ffffff', colorDanger: '#df1b41', colorPrimary: '#006970', colorSuccess: '#00c853', colorText: '#30313d', fontFamily: "'DM Sans', system-ui, 'Segoe UI', Roboto, sans-serif", fontSizeBase: '16px', spacingUnit: '4px' },
} as const

// Custom fonts for the embedded form: top-level SDK option (not part of appearance).
export const studioFonts = [{ cssSrc: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600&display=swap', family: 'DM Sans' }] as const

let loading: Promise<StripeFactory> | undefined
export function loadStripe(): Promise<StripeFactory> {
  if (window.Stripe) return Promise.resolve(window.Stripe)
  if (loading) return loading
  loading = new Promise<StripeFactory>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://js.stripe.com/dahlia/stripe.js'
    script.async = true
    const timer = window.setTimeout(fail, 20000)
    function fail() { clearTimeout(timer); script.remove(); reject(new Error('STRIPE_UNAVAILABLE')) }
    script.onload = () => { clearTimeout(timer); if (window.Stripe) resolve(window.Stripe); else fail() }
    script.onerror = fail
    document.head.append(script)
  }).catch(error => { loading = undefined; throw error })
  return loading
}
