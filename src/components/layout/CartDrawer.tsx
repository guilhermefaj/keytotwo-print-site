import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { apiErrorMessage, money } from '../../lib/api'
import { canCheckout } from '../../lib/checkout'
import { useAuth } from '../../lib/auth-context'
import { useShop } from '../../lib/shop-context'
import { KitoEmpty } from '../ui/KitoEmpty'
import { PurchaseThumbnail } from '../checkout/PurchaseUi'
import { itemName } from '../checkout/purchase-names'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '../ui/sheet'

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
      <SheetDescription className="sheet-description">Uma ideia para o próximo encontro de vocês.</SheetDescription>
      <div className="drawer-body" aria-busy={cart.loading || busy}>
        {cart.loading && !cart.data ? <div className="drawer-loading" role="status"><div className="drawer-skeleton" aria-hidden="true" />Carregando sua sacola…</div>
          : cart.error ? <div className="drawer-feedback"><p role="alert">{cart.error}</p><button className="button button-secondary" onClick={cart.reload}>Tentar novamente</button></div>
          : items.length ? <ul className="drawer-items">{items.map(item => <li key={item.code}>
            <PurchaseThumbnail code={item.code} name={item.name} className="drawer-thumbnail" />
            <div><h3>{itemName(item.code, item.name)}</h3><p>{item.games.length === 1 ? '1 jogo para imprimir' : `${item.games.length} jogos para imprimir`}</p><strong>{item.price ? money(item.price.unit_amount, item.price.currency) : 'Preço em atualização'}</strong>
              {item.status !== 'ok' && <p className="field-help">{item.status === 'already_owned' ? 'Você já tem estes jogos.' : 'Este item não está à venda no momento.'}</p>}
              {item.status === 'ok' && item.owned_games.length > 0 && <p className="field-help">Inclui jogos que você já tem. O valor não muda.</p>}
              {item.status === 'ok' && item.shared_with.length > 0 && <p className="field-help">Inclui jogos que também estão em outro item da sacola.</p>}
              <button className="text-button drawer-remove" disabled={busy} onClick={() => removeItem(item.code)} aria-label={`Remover ${itemName(item.code, item.name)}`}>Remover</button>
            </div>
          </li>)}</ul> : <div className="drawer-empty"><KitoEmpty /><h3>Sua sacola está vazia</h3><p>Vamos encontrar uma ideia para vocês dois?</p>
            <SheetClose asChild><Link className="button button-primary" to="/loja" onClick={navigateAway}>Ver os jogos</Link></SheetClose>
            {!session && <SheetClose asChild><Link className="inline-link" to="/entrar?next=%2Fcarrinho" onClick={navigateAway}>Entrar para ver minha sacola</Link></SheetClose>}
          </div>}
        <p className="form-error" role="alert">{error}</p>
      </div>
      {items.length > 0 && !cart.error && <div className="drawer-summary">
        <p className="drawer-total">Total <strong>{cart.data?.subtotal ? money(cart.data.subtotal.amount, cart.data.subtotal.currency) : 'Preço em atualização'}</strong></p>
        {canCheckout(cart.data) && !cart.loading && !busy ? <SheetClose asChild><Link className="button button-primary" to="/pagamento" onClick={navigateAway}>Finalizar compra</Link></SheetClose>
          : <><button className="button button-primary" disabled>Finalizar compra</button><p className="field-help">{cart.loading || busy ? 'Atualizando sua sacola…' : 'Confira os itens na sacola para continuar.'}</p></>}
        <SheetClose asChild><Link className="text-button" to="/carrinho" onClick={navigateAway}>Ver sacola</Link></SheetClose>
      </div>}
    </SheetContent>
  </Sheet>
}
