import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { productName } from '../../content/products'
import { apiErrorMessage, money } from '../../lib/api'
import { canCheckout } from '../../lib/checkout'
import { useAuth } from '../../lib/auth-context'
import { useShop } from '../../lib/shop-context'
import { KitoEmpty } from '../ui/KitoEmpty'
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
    <SheetContent className="cart-drawer" closeLabel="Fechar carrinho" onOpenAutoFocus={() => {
      navigating.current = false
    }} onCloseAutoFocus={event => {
      event.preventDefault()
      if (navigating.current) requestAnimationFrame(() => document.getElementById('conteudo')?.focus())
      else if (cartOpener.current?.isConnected) cartOpener.current.focus()
    }}>
      <SheetTitle className="sheet-title">Seu carrinho</SheetTitle>
      <SheetDescription className="sheet-description">Uma ideia para o próximo encontro de vocês.</SheetDescription>
      <div className="drawer-body" aria-busy={cart.loading || busy}>
        {cart.loading && !cart.data ? <div className="drawer-loading" role="status"><div className="drawer-skeleton" aria-hidden="true" />Carregando seu carrinho…</div>
          : cart.error ? <div className="drawer-feedback"><p role="alert">{cart.error}</p><button className="button button-secondary" onClick={cart.reload}>Tentar novamente</button></div>
          : items.length ? <ul className="drawer-items">{items.map(item => <li key={item.code}>
            <img className="drawer-thumbnail" src="/media/experience/kito-tabuleiro-240.webp" width="96" height="96" alt="" />
            <div><h3>{productName(item.code, item.name)}</h3><p>{item.games.length} jogos para imprimir</p><strong>{item.price ? money(item.price.unit_amount, item.price.currency) : 'Preço em atualização'}</strong>
              {item.status !== 'ok' && <p className="field-help">{item.status === 'already_owned' ? 'Você já tem estes jogos.' : 'Este item não está à venda no momento.'}</p>}
              <button className="text-button drawer-remove" disabled={busy} onClick={() => removeItem(item.code)} aria-label={`Remover ${productName(item.code, item.name)}`}>Remover</button>
            </div>
          </li>)}</ul> : <div className="drawer-empty"><KitoEmpty /><h3>Seu carrinho está vazio</h3><p>Vamos encontrar uma ideia para vocês dois?</p>
            <SheetClose asChild><Link className="button button-primary" to="/#comprar" onClick={navigateAway}>Quero o pacote</Link></SheetClose>
            {!session && <SheetClose asChild><Link className="inline-link" to="/entrar?next=%2Fcarrinho" onClick={navigateAway}>Entrar para ver meu carrinho</Link></SheetClose>}
          </div>}
        <p className="form-error" role="alert">{error}</p>
      </div>
      {items.length > 0 && !cart.error && <div className="drawer-summary">
        <p className="drawer-total">Total <strong>{cart.data?.subtotal ? money(cart.data.subtotal.amount, cart.data.subtotal.currency) : 'Preço em atualização'}</strong></p>
        {canCheckout(cart.data) && !cart.loading && !busy ? <SheetClose asChild><Link className="button button-primary" to="/pagamento" onClick={navigateAway}>Finalizar compra</Link></SheetClose>
          : <><button className="button button-primary" disabled>Finalizar compra</button><p className="field-help">{cart.loading || busy ? 'Atualizando seu carrinho…' : 'Confira os itens no carrinho para continuar.'}</p></>}
        <SheetClose asChild><Link className="text-button" to="/carrinho" onClick={navigateAway}>Ver carrinho</Link></SheetClose>
      </div>}
    </SheetContent>
  </Sheet>
}
