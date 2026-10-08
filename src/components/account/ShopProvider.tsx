import { useRef, useState, type ReactNode } from 'react'
import { api, type Account, type Cart, type CatalogProduct } from '../../lib/api'
import { ShopContext } from '../../lib/shop-context'
import { useApiResource } from '../../lib/use-api-resource'

export function ShopProvider({ children }: { children: ReactNode }) {
  const cart = useApiResource<Cart>('/cart')
  const account = useApiResource<Account>('/account')
  const catalog = useApiResource<{ products: CatalogProduct[] }>('/catalog', true)
  const [busy, setBusy] = useState(false)
  const mutation = useRef(false)
  async function mutate(code: string, remove: boolean) {
    if (mutation.current) throw new Error('CART_BUSY')
    mutation.current = true
    setBusy(true)
    try {
      await api<Cart>(remove ? `/cart/items/${encodeURIComponent(code)}` : '/cart/items', { method: remove ? 'DELETE' : 'POST', body: remove ? undefined : { product_code: code } })
      cart.reload()
    } finally { mutation.current = false; setBusy(false) }
  }
  return <ShopContext.Provider value={{ cart, account, catalog, busy, add: code => mutate(code, false), remove: code => mutate(code, true) }}>{children}</ShopContext.Provider>
}
