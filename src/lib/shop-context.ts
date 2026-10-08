import { createContext, useContext } from 'react'
import type { Account, Cart, CatalogProduct } from './api'

type Resource<T> = { data?: T; error?: string; loading: boolean; reload: () => void }
type ShopState = { cart: Resource<Cart>; account: Resource<Account>; catalog: Resource<{ products: CatalogProduct[] }>; busy: boolean; add: (code: string) => Promise<void>; remove: (code: string) => Promise<void> }
export const ShopContext = createContext<ShopState | null>(null)
export function useShop() {
  const context = useContext(ShopContext)
  if (!context) throw new Error('ShopProvider missing')
  return context
}
