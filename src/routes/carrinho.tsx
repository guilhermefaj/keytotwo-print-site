import { CheckoutSteps } from '../components/checkout/CheckoutSteps'
import { EmptyCart, ItemPrice, PurchaseSkeleton, PurchaseThumbnail } from '../components/checkout/PurchaseUi'
import { Summary } from '../components/ui/Summary'
import { itemName, itemNote } from '../components/checkout/purchase-names'
import { products } from '../content/products'
import { refundNotice } from '../content/legal'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { DataStatus } from '../components/account/AccountUi'
import { useAuth } from '../lib/auth-context'
import { apiErrorMessage, money, type Cart } from '../lib/api'
import { useShop } from '../lib/shop-context'
import { canCheckout, checkoutMock } from '../lib/checkout'
import { loginDestination } from '../lib/supabase'

type CartItem = Cart['items'][number]

// Item da sacola (DESIGN.md › Item de compra): composição sempre a partir de item.games + conteúdo. Ninguém paga duas
// vezes pelo mesmo jogo: o que já está no Portal e o avulso que já está num pacote da sacola aparecem riscados e
// ficam fora do pedido; o pacote com jogos que a pessoa já tem cobra só o que falta.
function CartItemRow({ item, items, busy, onRemove }: { item: CartItem; items: CartItem[]; busy: boolean; onRemove: (code: string) => void }) {
  const product = products.find(entry => entry.code === item.code)
  const note = itemNote(item, items)
  return <li data-cart-product={item.code} data-cart-status={item.status}>
    <PurchaseThumbnail code={item.code} name={item.name} />
    <div>
      <h3>{itemName(item.code, item.name)}</h3>
      {product?.tagline && <p className="cart-item-tagline">{product.tagline}</p>}
      <ItemPrice item={item} className="cart-item-price" />
      <details className="cart-composition"><Summary>O que está incluído</Summary><ul>{item.games.map(game => <li key={game.code}>{game.name}</li>)}{product?.contents.map(text => <li key={text}>{text}</li>)}</ul></details>
      {note && <p className={item.status === 'unavailable' ? 'form-error' : 'cart-overlap'}>{note}{item.status === 'already_owned' && <> <Link className="inline-link" to="/meus-jogos">Ver no Portal</Link></>}</p>}
      <button className="text-button" disabled={busy} onClick={() => onRemove(item.code)} aria-label={`Remover ${itemName(item.code, item.name)}`}>Remover</button>
    </div>
  </li>
}

export default function Carrinho() {
  const { cart, add, remove, busy } = useShop()
  const { session, ready } = useAuth()
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
      setMessage('Item adicionado à sacola.')
      setParams(previous => { const next = new URLSearchParams(previous); next.delete('add'); return next }, { replace: true })
    } catch (cause) { setError(apiErrorMessage(cause)) }
  }
  useEffect(() => {
    // Espera a sessão ser lida: com ela o item vai para a sacola da conta; sem ela, para a do navegador.
    if (ready && pending && /^[A-Z0-9_-]{1,40}$/.test(pending) && attempted.current !== pending) {
      attempted.current = pending
      void addPending(pending)
    }
    // The URL is an intent consumed once. Mutations are idempotent on the server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, ready])
  async function removeItem(code: string) {
    setError(''); setMessage('')
    try { await remove(code); setMessage('Item removido da sacola.') }
    catch (cause) { setError(apiErrorMessage(cause)) }
  }
  // Quem não entrou faz login (ou cria a conta) na próxima etapa; a sacola fica guardada e segue junto.
  const checkoutPath = session ? '/pagamento' : loginDestination('/pagamento')
  return <main id="conteudo" tabIndex={-1} className="cart-page purchase-page content-width">{items?.length !== 0 && <CheckoutSteps current={1} signedIn={Boolean(session)} />}
    <h1>Sacola</h1>
    <p className="form-message" role="status">{message}</p>
    <p className="form-error" role="alert">{error}</p>
    {error && pending && <button className="button button-secondary" disabled={busy} onClick={() => addPending(pending)}>Tentar adicionar novamente</button>}
    <DataStatus loading={false} error={cart.error} retry={cart.reload} />
    {cart.loading && !cart.data ? <PurchaseSkeleton /> : items?.length === 0 ? <EmptyCart /> : Boolean(items?.length) && <div className="cart-layout"><section aria-labelledby="cart-items-title"><h2 id="cart-items-title">Sua escolha</h2>
      <ul className="cart-items">{items!.map(item => <CartItemRow key={item.code} item={item} items={items!} busy={busy} onRemove={removeItem} />)}</ul>
    </section><aside className="cart-summary" aria-labelledby="cart-summary-title"><h2 id="cart-summary-title">Resumo</h2><p className="cart-subtotal">Subtotal <strong>{cart.loading ? 'Atualizando…' : cart.data?.subtotal ? money(cart.data.subtotal.amount, cart.data.subtotal.currency) : 'A confirmar'}</strong></p>
      {!cart.loading && !canCheckout(cart.data) && <p>{items!.some(item => item.status === 'ok') ? <>Não conseguimos conferir todos os preços. <button className="text-button inline-link" onClick={cart.reload}>Carregar novamente</button></> : 'Não há nada a pagar nesta sacola.'}</p>}
      <p className="field-help">Tem cupom? Aplique no pagamento.</p>
      <button className="button button-primary" disabled={busy || Boolean(cart.error) || !canCheckout(cart.data)} onClick={() => navigate(checkoutPath)} aria-describedby="checkout-help">Finalizar compra</button><p id="checkout-help" className="field-help">{checkoutMock ? 'Demonstração de pagamento. Nenhuma cobrança será feita.' : session ? 'Assim que o pagamento for confirmado, os jogos aparecem em Meus jogos.' : 'Para pagar, você entra ou cria sua conta com um código enviado ao seu e-mail. A sacola continua aqui.'}</p><p className="field-help">{refundNotice} <Link className="inline-link" to="/reembolsos">Política de reembolso</Link></p>{checkoutMock && !canCheckout(cart.data) && <Link className="inline-link" to="/pagamento">Ver demonstração do pagamento</Link>}
    </aside></div>}
  </main>
}
