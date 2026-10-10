import { CheckoutSteps } from '../components/checkout/CheckoutSteps'
import { EmptyCart, PurchaseSkeleton, PurchaseThumbnail } from '../components/checkout/PurchaseUi'
import { productName, packageContents } from '../content/products'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { DataStatus } from '../components/account/AccountUi'
import { useAuth } from '../lib/auth-context'
import { apiErrorMessage, money } from '../lib/api'
import { useShop } from '../lib/shop-context'
import { canCheckout, checkoutMock } from '../lib/checkout'

export default function Carrinho() {
  const { cart, add, remove, busy } = useShop()
  const { session } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const attempted = useRef('')
  const pending = params.get('add')
  const items = cart.data?.items
  async function addPending(code: string) {
    setError('')
    try {
      await add(code)
      setMessage('Produto adicionado ao carrinho.')
      setParams(previous => { const next = new URLSearchParams(previous); next.delete('add'); return next }, { replace: true })
    } catch (cause) { setError(apiErrorMessage(cause)) }
  }
  useEffect(() => {
    if (pending && /^[A-Z0-9_-]{1,40}$/.test(pending) && attempted.current !== pending) {
      attempted.current = pending
      void addPending(pending)
    }
    // The URL is an intent consumed once. Mutations are idempotent on the server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])
  async function removeItem(code: string) {
    setError(''); setMessage('')
    try { await remove(code); setMessage('Produto removido do carrinho.') }
    catch (cause) { setError(apiErrorMessage(cause)) }
  }
  return <main id="conteudo" tabIndex={-1} className="cart-page purchase-page content-width"><CheckoutSteps current={1} signedIn={Boolean(session)} />
    <h1>Carrinho</h1><p>Uma boa ideia para a próxima noite de vocês.</p>
    <p className="form-message" role="status">{message}</p><p className="form-error" role="alert">{error}</p>
    {error && pending && <button className="button button-secondary" disabled={busy} onClick={() => addPending(pending)}>Tentar adicionar novamente</button>}
    <DataStatus loading={false} error={cart.error} retry={cart.reload} />
    {cart.loading && !cart.data ? <PurchaseSkeleton /> : items?.length === 0 ? <EmptyCart /> : Boolean(items?.length) && <div className="cart-layout"><section aria-labelledby="cart-items-title"><h2 id="cart-items-title">Sua escolha</h2>
      <ul className="cart-items">{items!.map(item => <li key={item.code} data-cart-product={item.code}><PurchaseThumbnail /><div><h3>{productName(item.code, item.name)}</h3><p className="cart-item-price">{item.price ? money(item.price.unit_amount, item.price.currency) : 'Não conseguimos carregar o preço.'}</p><details className="cart-composition"><summary>O que está incluído</summary><ul>{item.code === 'P001' ? packageContents.map(text => <li key={text}>{text}</li>) : item.games.map(game => <li key={game.code}>{game.name}</li>)}</ul></details>
        {item.status === 'unavailable' && <p className="form-error">Este produto não está disponível para compra.</p>}
        {item.status === 'already_owned' && <p>Você já tem todos os jogos deste produto. <Link className="inline-link" to="/meus-jogos">Ver Meus jogos</Link></p>}
        {(item.owned_games.length > 0 || item.shared_with.length > 0) && item.status !== 'already_owned' && <p>Há jogos que você já tem ou que também estão em outro item do carrinho. Confira a composição antes de comprar; o valor não é reduzido.</p>}
        <button className="text-button" disabled={busy} onClick={() => removeItem(item.code)} aria-label={`Remover ${productName(item.code, item.name)}`}>Remover</button></div></li>)}</ul>
    </section><aside className="cart-summary" aria-labelledby="cart-summary-title"><h2 id="cart-summary-title">Resumo</h2><p className="cart-subtotal">Subtotal <strong>{cart.data?.subtotal ? money(cart.data.subtotal.amount, cart.data.subtotal.currency) : 'A confirmar'}</strong></p>
      {!canCheckout(cart.data) && <p>Não conseguimos conferir todos os preços. <button className="text-button inline-link" onClick={cart.reload}>Carregar novamente</button></p>}
      <p className="field-help">Tem cupom? Aplique no pagamento.</p>
      <button className="button button-primary" disabled={busy || Boolean(cart.error) || !canCheckout(cart.data)} onClick={() => navigate('/pagamento')} aria-describedby="checkout-help">Finalizar compra</button><p id="checkout-help" className="field-help">{checkoutMock ? 'Demonstração de pagamento. Nenhuma cobrança será feita.' : 'Depois da confirmação, os jogos ficam na sua conta.'}</p>{checkoutMock && !canCheckout(cart.data) && <Link className="inline-link" to="/pagamento">Ver demonstração do pagamento</Link>}
    </aside></div>}
  </main>
}
