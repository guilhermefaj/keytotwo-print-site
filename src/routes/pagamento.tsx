import { TrustLine } from '../components/checkout/TrustLine'
import { productName } from '../content/products'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { DataStatus } from '../components/account/AccountUi'
import { StripePayment } from '../components/checkout/StripePayment'
import { MockPayment } from '../components/checkout/MockPayment'
import { api, ApiError, money, type Cart } from '../lib/api'
import { checkoutMock, canCheckout, checkoutError, termsVersion } from '../lib/checkout'
import { useShop } from '../lib/shop-context'
import { useAuth } from '../lib/auth-context'

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
  return <div className="payment-layout"><aside className="cart-summary payment-summary" aria-labelledby="payment-summary-title"><h2 id="payment-summary-title">Seu próximo encontro</h2><ul className="payment-items">{cart.items.map(item => <li key={item.code}><span>{productName(item.code, item.name)}</span><strong>{item.price ? money(item.price.unit_amount, item.price.currency) : 'Preço indisponível'}</strong></li>)}</ul><p className="cart-subtotal">Subtotal <strong>{cart.subtotal ? money(cart.subtotal.amount, cart.subtotal.currency) : 'Indisponível'}</strong></p><p className="field-help">O total com eventuais descontos aparece antes de pagar.</p><Link className="inline-link" to="/carrinho">Editar carrinho</Link></aside>
    <section className="payment-card" aria-labelledby="payment-heading"><h2 id="payment-heading">Falta pouco para o encontro</h2>
      {checkoutMock && <p className="checkout-demo">Demonstração: o pagamento real ainda não está conectado neste ambiente.</p>}
      <div><label className="checkbox-label payment-terms"><input type="checkbox" required disabled={termsChanged || (!checkoutMock && !canCheckout(cart))} checked={accepted} onChange={event => changeAcceptance(event.target.checked)} /><span>Aceito os <Link className="inline-link" to="/termos" target="_blank" rel="noopener">termos de uso (nova aba)</Link> e entendo que não há reembolso após a liberação do download. <Link className="inline-link" to="/reembolsos" target="_blank" rel="noopener">Ler a política (nova aba)</Link>.</span></label>
        {!secret && !demo && <p className="field-help" role="status">{busy ? 'Preparando pagamento…' : 'Ao aceitar os termos, o formulário de pagamento aparece aqui.'}</p>}
      </div>
      <TrustLine />
      <p role="alert" className="form-error">{error}</p>{termsChanged && <a className="inline-link" href="/pagamento">Recarregar e revisar os termos</a>}
      {!canCheckout(cart) && !checkoutMock && <p>Revise os itens e os preços no <Link className="inline-link" to="/carrinho">carrinho</Link> antes de continuar.</p>}
      {accepted && secret && <StripePayment clientSecret={secret} />}
      {accepted && demo && <MockPayment cart={cart} />}
    </section></div>
}

export default function Pagamento() {
  const { cart } = useShop()
  const { session } = useAuth()
  return <main id="conteudo" tabIndex={-1} className="account-page payment-page content-width"><Link className="inline-link" to="/carrinho">← Voltar ao carrinho</Link><p className="eyebrow">Seu encontro, quase pronto</p><h1>Pagamento</h1><DataStatus {...cart} retry={cart.reload} />
    {cart.data && (cart.data.items.length ? <Payment key={`${session?.user.id}:${cart.data.version}`} cart={cart.data} refresh={cart.reload} /> : <div className="cart-empty"><h2>Seu carrinho está vazio</h2><a className="button button-primary" href="/#comprar">Escolher nosso encontro</a></div>)}
  </main>
}
