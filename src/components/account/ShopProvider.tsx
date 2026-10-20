import { useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { api, type Account, type Cart, type CatalogProduct } from '../../lib/api'
import { ShopContext } from '../../lib/shop-context'
import { useApiResource } from '../../lib/use-api-resource'

export function ShopProvider({ children }: { children: ReactNode }) {
  const cart = useApiResource<Cart>('/cart')
  const account = useApiResource<Account>('/account')
  const catalog = useApiResource<{ products: CatalogProduct[] }>('/catalog', true)
  const [busy, setBusy] = useState(false)
  const [cartOpen, setOpen] = useState(false)
  // The drawer is a shortcut for pages that are not the cart; on /carrinho and /pagamento the page itself shows the cart.
  const pathname = useLocation().pathname.replace(/\/+$/, '') || '/'
  const onCartRoute = /^\/(carrinho|pagamento)(\/|$)/.test(pathname)
  const cartOpener = useRef<HTMLElement | null>(null)
  function rememberOpener() { cartOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }
  function setCartOpen(open: boolean) { if (open) rememberOpener(); setOpen(open) }
  const mutation = useRef(false)
  async function mutate(code: string, remove: boolean) {
    if (mutation.current) throw new Error('CART_BUSY')
    if (!remove) rememberOpener()
    mutation.current = true
    setBusy(true)
    try {
      await api<Cart>(remove ? `/cart/items/${encodeURIComponent(code)}` : '/cart/items', { method: remove ? 'DELETE' : 'POST', body: remove ? undefined : { product_code: code } })
      cart.reload()
      if (!remove && !onCartRoute) setOpen(true)
    } finally { mutation.current = false; setBusy(false) }
  }
  return <ShopContext.Provider value={{ cart, account, catalog, busy, cartOpen, cartOpener, setCartOpen, add: code => mutate(code, false), remove: code => mutate(code, true) }}>{children}</ShopContext.Provider>
}
