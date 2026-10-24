import { CheckoutSteps } from '../components/checkout/CheckoutSteps'
import { EmptyCart, ItemPrice, PurchaseSkeleton, PurchaseThumbnail } from '../components/checkout/PurchaseUi'
import { productByCode, productName } from '../content/products'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { DataStatus } from '../components/account/AccountUi'
import { StripePayment } from '../components/checkout/StripePayment'
import { MockPayment } from '../components/checkout/MockPayment'
import { api, ApiError, type Cart } from '../lib/api'
import { money } from '../lib/format'
import { checkoutMock, canCheckout, checkoutError, termsVersion } from '../lib/checkout'
import { useShop } from '../lib/shop-context'
import { useAuth } from '../lib/auth-context'
import { toReais, trackBeginCheckout } from '../lib/analytics'
import { referralForOrder, useReferral } from '../lib/referral'

// Aceite expresso (Política de reembolso): termos, reembolso e entrega imediata numa caixa só. O pedido grava a
// versão (terms_version) e o momento do aceite (terms_accepted_at); a versão vem de legal.ts.
function Payment({ cart, refresh }: { cart: Cart; refresh: () => void }) {
  // Só o que entra no pedido: o riscado da sacola (já possuído ou já no pacote) fica de fora.
  const paid = cart.items.filter(item => item.status === 'ok')
  useEffect(() => {
    if (!cart.subtotal) return
    trackBeginCheckout({ currency: cart.subtotal.currency.toUpperCase(), value: toReais(cart.subtotal.amount),
      items: paid.map(item => ({ item_id: item.code, item_name: item.name, price: item.charge ? toReais(item.charge.unit_amount) : undefined, quantity: 1 })) })
    // Uma vez por versão da sacola: o componente é montado de novo quando ela muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [accepted, setAccepted] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [order, setOrder] = useState<{ secret: string; id: string }>()
  const demo = checkoutMock
  const [error, setError] = useState('')
  const [termsChanged, setTermsChanged] = useState(false)
  const referral = useReferral()
  const recorded = useRef(false)
  // O formulário abre com a página (responsável, 2026-10-24), travado até o aceite logo acima dele: o pedido nasce
  // aqui e o aceite é gravado quando a pessoa marca a caixa (POST /checkout/terms).
  useEffect(() => {
    if (demo || !canCheckout(cart)) return
    const controller = new AbortController()
    api<{ client_secret: string; order_id: string }>('/checkout', { method: 'POST', body: { cart_version: cart.version, terms_version: termsVersion, referral: referralForOrder(referral) }, signal: controller.signal }).then(
      response => setOrder({ secret: response.client_secret, id: response.order_id }),
      cause => {
        if (controller.signal.aborted) return
        setError(checkoutError(cause))
        if (cause instanceof ApiError) {
          if (cause.code === 'TERMS_CHANGED') setTermsChanged(true)
          if (['CART_CHANGED', 'CART_EMPTY', 'PRODUCT_UNAVAILABLE', 'ALREADY_OWNED'].includes(cause.code)) refresh()
        }
      })
    return () => controller.abort()
    // Uma vez por versão da sacola: o componente é montado de novo quando ela muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  async function changeAcceptance(value: boolean) {
    setError('')
    if (!value || demo || recorded.current) { setAccepted(value); return }
    if (!order) return
    setAccepting(true)
    try {
      await api('/checkout/terms', { method: 'POST', body: { order_id: order.id, terms_version: termsVersion } })
      recorded.current = true
      setAccepted(true)
    } catch (cause) {
      setError(checkoutError(cause))
      if (cause instanceof ApiError && cause.code === 'TERMS_CHANGED') setTermsChanged(true)
    } finally { setAccepting(false) }
  }
  const ready = demo || Boolean(order)
  return <div className="payment-layout"><aside className="cart-summary payment-summary" aria-labelledby="payment-summary-title"><h2 id="payment-summary-title">Resumo do pedido</h2><ul className="payment-items">{paid.map(item => { const product = productByCode(item.code); return <li key={item.code}><PurchaseThumbnail code={item.code} name={item.name} /><div className="payment-item-copy"><span>{productName(item.code, item.name)}</span>{product?.tagline && <span className="payment-item-tagline">{product.tagline}</span>}<ItemPrice item={item} className="payment-item-price" /></div></li> })}</ul>{paid.length < cart.items.length && <p className="field-help">O que você já tem ou que já está num pacote da sacola não entra no pedido.</p>}{(() => { const delivery = paid.map(item => productByCode(item.code)?.delivery).find(Boolean); return delivery ? <p className="payment-delivery">{delivery.map((line, index) => <span key={line}>{index > 0 && <br />}{line}</span>)}</p> : null })()}<p className="cart-subtotal">Subtotal <strong>{cart.subtotal ? money(cart.subtotal.amount, cart.subtotal.currency) : 'A confirmar'}</strong></p><p className="field-help">O total com seu cupom aparece antes de pagar.</p></aside>
    <section className="payment-card" aria-labelledby="payment-heading"><h2 id="payment-heading">Último passo</h2>
      {demo && <p className="checkout-demo">Demonstração: o pagamento real ainda não está conectado neste ambiente.</p>}
      <label className="checkbox-label payment-terms"><input type="checkbox" required disabled={termsChanged || accepting || !ready} checked={accepted || accepting} onChange={event => void changeAcceptance(event.target.checked)} /><span>Li e aceito os <Link className="inline-link" to="/termos" target="_blank" rel="noopener">termos de uso</Link> e a <Link className="inline-link" to="/reembolsos" target="_blank" rel="noopener">política de reembolso</Link>, e peço a entrega imediata dos jogos.</span></label>
      {ready && !accepted && !termsChanged && <p className="field-help payment-lock-hint">Marque o aceite para liberar o pagamento.</p>}
      <p role="alert" className="form-error">{error}</p>{termsChanged && <a className="inline-link" href="/pagamento">Recarregar e revisar os termos</a>}
      {!canCheckout(cart) && !demo && <p>Revise os itens e os preços <Link className="inline-link" to="/carrinho">na sacola</Link> antes de continuar.</p>}
      {!ready && !error && canCheckout(cart) && <p className="field-help" role="status">Preparando o pagamento…</p>}
      {order && <StripePayment clientSecret={order.secret} locked={!accepted} partner={referral?.code && referral.name ? { code: referral.code, name: referral.name } : undefined} />}
      {demo && <div className="payment-lock" inert={!accepted} data-locked={!accepted}><MockPayment cart={cart} /></div>}
    </section></div>
}

export default function Pagamento() {
  const { cart } = useShop()
  const { session } = useAuth()
  return <main id="conteudo" tabIndex={-1} className="account-page payment-page purchase-page content-width">{cart.data?.items.length !== 0 && <CheckoutSteps current={3} signedIn={Boolean(session)} />}<h1>Pagamento</h1><DataStatus loading={false} error={cart.error} retry={cart.reload} />
    {cart.loading && !cart.data ? <PurchaseSkeleton /> : cart.data && (cart.data.items.length ? <Payment key={`${session?.user.id}:${cart.data.version}`} cart={cart.data} refresh={cart.reload} /> : <EmptyCart />)}
  </main>
}
