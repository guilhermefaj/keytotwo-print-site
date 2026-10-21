import type { Page } from '@playwright/test'
import { authStorageKey } from './session'

export const product = { code: 'P001', kind: 'bundle', name: 'Pacote de TESTE', games: [{ code: 'J001', name: 'Jogo de TESTE' }], price: { unit_amount: 1990, currency: 'brl' }, status: 'ok', available: true, owned_games: [], included_in: [], shared_with: [], charge: { unit_amount: 1990, currency: 'brl' } }
export const cart = { version: 3, items: [product], subtotal: { amount: 1990, currency: 'brl' }, warnings: [] }
const fakeSession = { access_token: 'synthetic-e2e-token', refresh_token: 'synthetic-e2e-refresh', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user: { id: 'qa-synthetic', email: 'synthetic@example.test', email_confirmed_at: '2026-01-01T00:00:00Z', is_anonymous: false, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} } }
const stripeStub = `window.Stripe = (key, options) => ({ initCheckoutFormSdk({appearance}) {
  if (options.betas[0] !== 'custom_checkout_payment_form_1' || appearance.variables.colorPrimary !== '#006970') throw Error('Studio settings changed');
  let discount = 0; let change = () => {}; let handlers = {}; let button;
  const session = () => ({id:'cs_test_synthetic123456', currency:'brl', livemode:false, status:{type:'open'}, total:{subtotal:{minorUnitsAmount:1990}, discount:{minorUnitsAmount:discount}, total:{minorUnitsAmount:1990-discount}}, discountAmounts: discount ? [{promotionCode:'TESTE10',displayName:'TESTE10'}] : []});
  const actions = {getSession: session, async applyPromotionCode(code) { if(code !== 'TESTE10') return {type:'error',error:{code:'invalidCode'}}; discount=199; change(session()); return {type:'success',session:session()}; }, async removePromotionCode() { discount=0; change(session()); return {type:'success',session:session()}; }, async confirm({formConfirmEvent}) { if(!formConfirmEvent) throw Error('Missing form event'); return {type:'success',session:session()}; }};
  return {on(event,handler) {change=handler}, async loadActions() {return {type:'success',actions}}, createForm(options) { if(options.layout!=='expanded') throw Error('Not expanded'); return {on(event,handler){handlers[event]=handler}, mount(host){button=document.createElement('button');button.textContent='Pagar (simulação de teste)';button.onclick=()=>handlers.confirm({source:'checkout-form-pay-button',paymentMethodType:'card'});host.append(button);handlers.ready()},destroy(){button?.remove()}}; }};
}});`

export async function fixture(page: Page) {
  await page.addInitScript(([key, session]) => localStorage.setItem(key, JSON.stringify(session)), [authStorageKey, fakeSession] as const)
  await page.route('**/auth/v1/**', route => route.fulfill({ json: fakeSession.user }))
  await page.route('**/functions/v1/api/**', route => {
    const path = new URL(route.request().url()).pathname.split('/api')[1]
    const data = path === '/cart' ? cart : path === '/catalog' ? { products: [product] } : path === '/account' ? { email: fakeSession.user.email, marketing: { opted_in: false, prompted_at: '2026-01-01', text_version: null }, orders: [] } : path === '/checkout' ? { client_secret: 'synthetic-only-no-stripe-secret' } : path === '/order-status' ? { state: 'paid', next: 'open_library', items: [{ code: 'P001', name: product.name }] } : { games: [], pending: [] }
    return route.fulfill({ json: data })
  })
  await page.route('https://js.stripe.com/dahlia/stripe.js', route => route.fulfill({ contentType: 'application/javascript', body: stripeStub }))
}
