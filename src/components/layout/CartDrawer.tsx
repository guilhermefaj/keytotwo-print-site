import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { apiErrorMessage } from '../../lib/api'
import { money } from '../../lib/format'
import { canCheckout } from '../../lib/checkout'
import { useAuth } from '../../lib/auth-context'
import { useShop } from '../../lib/shop-context'
import { KitoEmpty } from '../ui/KitoEmpty'
import { ItemPrice, PurchaseThumbnail } from '../checkout/PurchaseUi'
import { itemNote } from '../checkout/purchase-names'
import { productName } from '../../content/products'
import { loginDestination } from '../../lib/supabase'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '../ui/sheet'
import { emptyCart } from '../../content/site'

export function CartDrawer() {
  const { session } = useAuth()
  const { cart, cartOpen, cartOpener, setCartOpen, remove, busy } = useShop()
  const [error, setError] = useState('')
  const navigating = useRef(false)
  const items = cart.data?.items ?? []
  async function removeItem(code: string) {
    setError('')
    try { await remove(code) } catch (cause) { setError(apiErrorMessage(cause)) }
  }
  function navigateAway() { navigating.current = true }
  return <Sheet open={cartOpen} onOpenChange={next => { setError(''); setCartOpen(next) }}>
    <SheetContent className="cart-drawer" closeLabel="Fechar sacola" onOpenAutoFocus={() => {
      navigating.current = false
    }} onCloseAutoFocus={event => {
      event.preventDefault()
      if (navigating.current) requestAnimationFrame(() => document.getElementById('conteudo')?.focus())
      else if (cartOpener.current?.isConnected) cartOpener.current.focus()
    }}>
      <SheetTitle className="sheet-title">Sua sacola</SheetTitle>
      <SheetDescription className="sheet-description">Os jogos que vocês escolheram até agora.</SheetDescription>
      <div className="drawer-body" aria-busy={cart.loading || busy}>
        {cart.loading && !cart.data ? <div className="drawer-loading" role="status"><div className="drawer-skeleton" aria-hidden="true" />Carregando sua sacola…</div>
          : cart.error ? <div className="drawer-feedback"><p role="alert">{cart.error}</p><button className="button button-secondary" onClick={cart.reload}>Tentar novamente</button></div>
          : items.length ? <ul className="drawer-items">{items.map(item => <li key={item.code}>
            <PurchaseThumbnail code={item.code} name={item.name} className="drawer-thumbnail" />
            <div><h3>{productName(item.code, item.name)}</h3><p>{item.games.length === 1 ? '1 jogo para imprimir' : `${item.games.length} jogos para imprimir`}</p><ItemPrice item={item} className="drawer-price" />
              {itemNote(item, items) && <p className="field-help">{itemNote(item, items)}</p>}
              <button className="text-button drawer-remove" disabled={busy} onClick={() => removeItem(item.code)} aria-label={`Remover ${productName(item.code, item.name)}`}>Remover</button>
            </div>
          </li>)}</ul> : <div className="drawer-empty"><KitoEmpty /><h3>{emptyCart.title}</h3><p>{emptyCart.text}</p>
            <SheetClose asChild><Link className="button button-primary" to="/loja" onClick={navigateAway}>Ver os jogos</Link></SheetClose>
            {!session && <SheetClose asChild><Link className="inline-link" to="/entrar?next=%2Fcarrinho" onClick={navigateAway}>Entrar para ver a sacola da sua conta</Link></SheetClose>}
          </div>}
        <p className="form-error" role="alert">{error}</p>
      </div>
      {items.length > 0 && !cart.error && <div className="drawer-summary">
        <p className="drawer-total">Total <strong>{cart.loading ? 'Atualizando…' : cart.data?.subtotal ? money(cart.data.subtotal.amount, cart.data.subtotal.currency) : 'Preço indisponível agora'}</strong></p>
        {canCheckout(cart.data) && !cart.loading && !busy ? <SheetClose asChild><Link className="button button-primary" to={session ? '/pagamento' : loginDestination('/pagamento')} onClick={navigateAway}>Finalizar compra</Link></SheetClose>
          : <><button className="button button-primary" disabled>Finalizar compra</button><p className="field-help">{cart.loading || busy ? 'Atualizando sua sacola…' : items.some(item => item.status === 'ok') ? 'Confira os itens na sacola para continuar.' : 'Não há nada a pagar nesta sacola.'}</p></>}
        <SheetClose asChild><Link className="text-button" to="/carrinho" onClick={navigateAway}>Ver sacola</Link></SheetClose>
      </div>}
    </SheetContent>
  </Sheet>
}
