import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { AccountNav, DataStatus } from '../components/account/AccountUi'
import { offer } from '../content/offer'
import { apiErrorMessage, money } from '../lib/api'
import { useShop } from '../lib/shop-context'
import { canCheckout, checkoutMock } from '../lib/checkout'

export default function Carrinho() {
  const { cart, add, remove, busy } = useShop()
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
  return <main id="conteudo" tabIndex={-1} className="cart-page content-width"><AccountNav />
    <p className="eyebrow">Sua escolha</p><h1>Carrinho</h1><p>Seu próximo encontro está tomando forma. Sua escolha fica salva aqui.</p>
    <p className="form-message" role="status">{message}</p><p className="form-error" role="alert">{error}</p>
    {error && pending && <button className="button button-secondary" disabled={busy} onClick={() => addPending(pending)}>Tentar adicionar novamente</button>}
    <div className="cart-layout"><section aria-labelledby="cart-items-title"><h2 id="cart-items-title">Itens do carrinho {items && <span className="cart-total">({items.length})</span>}</h2>
      <DataStatus {...cart} retry={cart.reload} />
      {items && (items.length === 0 ? <div className="cart-empty"><h3>Seu carrinho está vazio</h3><p>Vamos encontrar uma ideia para vocês dois?</p><a className="button button-primary" href="/#comprar">Escolher um encontro</a></div> : <ul className="cart-items">{items.map(item => <li key={item.code} data-cart-product={item.code}><h3>{item.name}</h3><p>{item.price ? money(item.price.unit_amount, item.price.currency) : 'Preço indisponível'}</p><details className="cart-composition"><summary>O que está incluído</summary><ul>{item.games.map(game => <li key={game.code}>{game.name}</li>)}</ul></details>
        {item.status === 'unavailable' && <p className="form-error">Este produto não está disponível para compra.</p>}
        {item.status === 'already_owned' && <p>Você já tem todos os jogos deste produto. <Link className="inline-link" to="/meus-jogos">Ver Meus jogos</Link></p>}
        {(item.owned_games.length > 0 || item.shared_with.length > 0) && item.status !== 'already_owned' && <p>Há jogos que você já tem ou que também estão em outro item do carrinho. Confira a composição antes de comprar; o valor não é reduzido.</p>}
        <button className="text-button" disabled={busy} onClick={() => removeItem(item.code)} aria-label={`Remover ${item.name}`}>Remover</button></li>)}</ul>)}
    </section><aside className="cart-summary" aria-labelledby="cart-summary-title"><h2 id="cart-summary-title">Resumo</h2><p className="cart-subtotal">Subtotal <strong>{cart.data?.subtotal ? money(cart.data.subtotal.amount, cart.data.subtotal.currency) : 'Indisponível'}</strong></p>
      {cart.data?.warnings.some(warning => warning.code === 'PRICE_UNAVAILABLE') && <p>Um ou mais preços estão indisponíveis. A compra não pode ser finalizada.</p>}
      <div className="refund-notice"><p><strong>{offer.refund}</strong></p></div>
      <button className="button button-primary" disabled={busy || cart.loading || Boolean(cart.error) || !canCheckout(cart.data)} onClick={() => navigate('/pagamento')} aria-describedby="checkout-help">Finalizar compra</button><p id="checkout-help" className="field-help">{checkoutMock ? 'Demonstração de pagamento. Nenhuma cobrança será feita.' : 'Pagamento protegido pela Stripe. Tem um cupom? Aplique na próxima etapa.'}</p>{checkoutMock && Boolean(items?.length) && !canCheckout(cart.data) && <Link className="inline-link" to="/pagamento">Ver demonstração do pagamento</Link>}<Link className="inline-link" to="/reembolsos">Ler a política de reembolsos</Link>
    </aside></div>
  </main>
}
