import { CheckoutSteps } from '../components/checkout/CheckoutSteps'
import { EmptyCart, PurchaseSkeleton, PurchaseThumbnail } from '../components/checkout/PurchaseUi'
import { Summary } from '../components/ui/Summary'
import { gameName, itemName } from '../components/checkout/purchase-names'
import { products } from '../content/products'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { DataStatus } from '../components/account/AccountUi'
import { useAuth } from '../lib/auth-context'
import { ApiError, apiErrorMessage, money, type Cart } from '../lib/api'
import { useShop } from '../lib/shop-context'
import { canCheckout, checkoutMock } from '../lib/checkout'

type CartItem = Cart['items'][number]

// Item da sacola (DESIGN.md › Item de compra): composição sempre a partir de item.games + conteúdo.
// Sobreposição (D-16, padrão provisório): aviso por caso, sem desconto; "Remover avulso" quando o
// item já inclui um avulso que também está na sacola.
function CartItemRow({ item, items, busy, onRemove }: { item: CartItem; items: CartItem[]; busy: boolean; onRemove: (code: string) => void }) {
  const product = products.find(entry => entry.code === item.code)
  const overlapSingles = items.filter(entry => item.shared_with.includes(entry.code) && entry.kind === 'single')
  return <li data-cart-product={item.code}>
    <PurchaseThumbnail code={item.code} name={item.name} />
    <div>
      <h3>{itemName(item.code, item.name)}</h3>
      {product?.tagline && <p className="cart-item-tagline">{product.tagline}</p>}
      <p className="cart-item-price">{item.price ? money(item.price.unit_amount, item.price.currency) : 'Não conseguimos carregar o preço.'}</p>
      <details className="cart-composition"><Summary>O que está incluído</Summary><ul>{item.games.map(game => <li key={game.code}>{game.name}</li>)}{product?.contents.map(text => <li key={text}>{text}</li>)}</ul></details>
      {item.status === 'unavailable' && <p className="form-error">Este produto não está disponível para compra.</p>}
      {item.status === 'already_owned' && <p>Você já tem todos os jogos deste produto. <Link className="inline-link" to="/meus-jogos">Ver Meus jogos</Link></p>}
      {item.status === 'ok' && item.owned_games.length > 0 && <p className="cart-overlap">Você já tem {item.owned_games.map(gameName).join(', ')}. O valor não é reduzido por isso.</p>}
      {item.status === 'ok' && overlapSingles.length > 0 && <div className="cart-overlap"><p>Este item já inclui {overlapSingles.map(single => itemName(single.code, single.name)).join(' e ')}. Para não pagar duas vezes, remova o avulso da sacola.</p>{overlapSingles.map(single => <button key={single.code} className="text-button" disabled={busy} onClick={() => onRemove(single.code)} aria-label={`Remover avulso ${itemName(single.code, single.name)}`}>Remover avulso</button>)}</div>}
      <button className="text-button" disabled={busy} onClick={() => onRemove(item.code)} aria-label={`Remover ${itemName(item.code, item.name)}`}>Remover</button>
    </div>
  </li>
}

export default function Carrinho() {
  const { cart, add, remove, busy } = useShop()
  const { session } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState('')
  const [message, setMessage] = useState('')
  const attempted = useRef('')
  const pending = params.get('add')
  const items = cart.data?.items
  async function addPending(code: string) {
    setError(''); setErrorCode('')
    try {
      await add(code)
      setMessage('Item adicionado à sacola.')
      setParams(previous => { const next = new URLSearchParams(previous); next.delete('add'); return next }, { replace: true })
    } catch (cause) { setErrorCode(cause instanceof ApiError ? cause.code : ''); setError(apiErrorMessage(cause)) }
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
    setError(''); setErrorCode(''); setMessage('')
    try { await remove(code); setMessage('Item removido da sacola.') }
    catch (cause) { setErrorCode(cause instanceof ApiError ? cause.code : ''); setError(apiErrorMessage(cause)) }
  }
  return <main id="conteudo" tabIndex={-1} className="cart-page purchase-page content-width">{items?.length !== 0 && <CheckoutSteps current={1} signedIn={Boolean(session)} />}
    <h1>Sacola</h1><p>Uma boa ideia para a próxima noite de vocês.</p>
    <p className="form-message" role="status">{message}</p>
    {errorCode === 'ALREADY_OWNED'
      ? <p className="form-error" role="alert">Você já tem todos os jogos deste produto. <Link className="inline-link" to="/meus-jogos">Ver Meus jogos</Link></p>
      : <p className="form-error" role="alert">{error}</p>}
    {error && pending && <button className="button button-secondary" disabled={busy} onClick={() => addPending(pending)}>Tentar adicionar novamente</button>}
    <DataStatus loading={false} error={cart.error} retry={cart.reload} />
    {cart.loading && !cart.data ? <PurchaseSkeleton /> : items?.length === 0 ? <EmptyCart /> : Boolean(items?.length) && <div className="cart-layout"><section aria-labelledby="cart-items-title"><h2 id="cart-items-title">Sua escolha</h2>
      <ul className="cart-items">{items!.map(item => <CartItemRow key={item.code} item={item} items={items!} busy={busy} onRemove={removeItem} />)}</ul>
    </section><aside className="cart-summary" aria-labelledby="cart-summary-title"><h2 id="cart-summary-title">Resumo</h2><p className="cart-subtotal">Subtotal <strong>{cart.data?.subtotal ? money(cart.data.subtotal.amount, cart.data.subtotal.currency) : 'A confirmar'}</strong></p>
      {!canCheckout(cart.data) && <p>Não conseguimos conferir todos os preços. <button className="text-button inline-link" onClick={cart.reload}>Carregar novamente</button></p>}
      <p className="field-help">Tem cupom? Aplique no pagamento.</p>
      <button className="button button-primary" disabled={busy || Boolean(cart.error) || !canCheckout(cart.data)} onClick={() => navigate('/pagamento')} aria-describedby="checkout-help">Finalizar compra</button><p id="checkout-help" className="field-help">{checkoutMock ? 'Demonstração de pagamento. Nenhuma cobrança será feita.' : 'Depois da confirmação, os jogos ficam na sua conta.'}</p>{checkoutMock && !canCheckout(cart.data) && <Link className="inline-link" to="/pagamento">Ver demonstração do pagamento</Link>}
    </aside></div>}
  </main>
}
