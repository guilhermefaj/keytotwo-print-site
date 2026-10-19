import { CheckoutSteps } from '../components/checkout/CheckoutSteps'
import { EmptyCart, PurchaseSkeleton, PurchaseThumbnail } from '../components/checkout/PurchaseUi'
import { productName, products } from '../content/products'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { DataStatus } from '../components/account/AccountUi'
import { StripePayment } from '../components/checkout/StripePayment'
import { MockPayment } from '../components/checkout/MockPayment'
import { api, ApiError, money, type Cart } from '../lib/api'
import { checkoutMock, canCheckout, checkoutError, termsVersion } from '../lib/checkout'
import { useShop } from '../lib/shop-context'
import { useAuth } from '../lib/auth-context'

// Aceite expresso (Política de reembolso): termos, reembolso e entrega imediata numa caixa só. O pedido grava a
// versão (terms_version) e o momento do aceite (terms_accepted_at); a versão vem de legal.ts.
function Payment({ cart, refresh }: { cart: Cart; refresh: () => void }) {
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [secret, setSecret] = useState('')
  const [demo, setDemo] = useState(false)
  const [error, setError] = useState('')
  const [termsChanged, setTermsChanged] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  async function start() {
    if (request.current || termsChanged) return
    if (checkoutMock) { setDemo(true); return }
    if (!canCheckout(cart)) return
    const controller = new AbortController(); request.current = controller
    setBusy(true); setError('')
    try {
      const response = await api<{ client_secret: string }>('/checkout', { method: 'POST', body: { cart_version: cart.version, terms_accepted: true, terms_version: termsVersion }, signal: controller.signal })
      if (!controller.signal.aborted) setSecret(response.client_secret)
    } catch (cause) {
      if (controller.signal.aborted) return
      setError(checkoutError(cause)); setAccepted(false)
      if (cause instanceof ApiError) {
        if (cause.code === 'TERMS_CHANGED') setTermsChanged(true)
        if (['CART_CHANGED', 'CART_EMPTY', 'PRODUCT_UNAVAILABLE', 'ALREADY_OWNED'].includes(cause.code)) refresh()
      }
    } finally { if (request.current === controller) { request.current = null; setBusy(false) } }
  }
  function changeAcceptance(value: boolean) {
    request.current?.abort(); request.current = null; setBusy(false); setAccepted(value); setSecret(''); setDemo(false); setError('')
    if (value) void start()
  }
  return <div className="payment-layout"><aside className="cart-summary payment-summary" aria-labelledby="payment-summary-title"><h2 id="payment-summary-title">Resumo do pedido</h2><ul className="payment-items">{cart.items.map(item => { const product = products.find(entry => entry.code === item.code); return <li key={item.code}><PurchaseThumbnail code={item.code} name={item.name} /><div className="payment-item-copy"><span>{productName(item.code, item.name)}</span>{product?.tagline && <span className="payment-item-tagline">{product.tagline}</span>}<strong>{item.price ? money(item.price.unit_amount, item.price.currency) : 'Preço a confirmar'}</strong></div></li> })}</ul>{(() => { const delivery = cart.items.map(item => products.find(entry => entry.code === item.code)?.delivery).find(Boolean); return delivery ? <p className="payment-delivery">{delivery.map((line, index) => <span key={line}>{index > 0 && <br />}{line}</span>)}</p> : null })()}<p className="cart-subtotal">Subtotal <strong>{cart.subtotal ? money(cart.subtotal.amount, cart.subtotal.currency) : 'A confirmar'}</strong></p><p className="field-help">O total com seu cupom aparece antes de pagar.</p></aside>
    <section className="payment-card" aria-labelledby="payment-heading"><h2 id="payment-heading">Último passo</h2>
      {checkoutMock && <p className="checkout-demo">Demonstração: o pagamento real ainda não está conectado neste ambiente.</p>}
      <div><label className="checkbox-label payment-terms"><input type="checkbox" required disabled={termsChanged || (!checkoutMock && !canCheckout(cart))} checked={accepted} onChange={event => changeAcceptance(event.target.checked)} /><span>Li e aceito os <Link className="inline-link" to="/termos" target="_blank" rel="noopener">termos de uso</Link> e a <Link className="inline-link" to="/reembolsos" target="_blank" rel="noopener">política de reembolso</Link>. Estou ciente de que os jogos são conteúdo digital, liberado para download assim que o pagamento é confirmado, e de que, por isso, não há reembolso depois da liberação.</span></label>
        <p className="field-help">Arquivo com defeito, jogo não entregue ou cobrança indevida continuam com solução: corrigimos, reenviamos ou devolvemos o valor.</p>
        {!secret && !demo && <p className="field-help" role="status">{busy ? 'Preparando pagamento…' : 'Ao aceitar os termos, o formulário de pagamento aparece aqui.'}</p>}
      </div>
      <p role="alert" className="form-error">{error}</p>{termsChanged && <a className="inline-link" href="/pagamento">Recarregar e revisar os termos</a>}
      {!canCheckout(cart) && !checkoutMock && <p>Revise os itens e os preços <Link className="inline-link" to="/carrinho">na sacola</Link> antes de continuar.</p>}
      {accepted && secret && <div className="payment-reveal"><StripePayment clientSecret={secret} /></div>}
      {accepted && demo && <div className="payment-reveal"><MockPayment cart={cart} /></div>}
    </section></div>
}

export default function Pagamento() {
  const { cart } = useShop()
  const { session } = useAuth()
  return <main id="conteudo" tabIndex={-1} className="account-page payment-page purchase-page content-width">{cart.data?.items.length !== 0 && <CheckoutSteps current={3} signedIn={Boolean(session)} />}<h1>Pagamento</h1><DataStatus loading={false} error={cart.error} retry={cart.reload} />
    {cart.loading && !cart.data ? <PurchaseSkeleton /> : cart.data && (cart.data.items.length ? <Payment key={`${session?.user.id}:${cart.data.version}`} cart={cart.data} refresh={cart.reload} /> : <EmptyCart />)}
  </main>
}
