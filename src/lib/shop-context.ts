import { createContext, useContext } from 'react'
import type { Account, Cart, CatalogProduct } from './api'
import type { FreeGame } from './downloads'

type Resource<T> = { data?: T; error?: string; loading: boolean; reload: () => void }
type ShopState = { cart: Resource<Cart>; account: Resource<Account>; catalog: Resource<{ products: CatalogProduct[] }>; freeGame: Resource<FreeGame>; busy: boolean; add: (code: string) => Promise<void>; remove: (code: string) => Promise<void> }
export const ShopContext = createContext<ShopState | null>(null)
export function useShop() {
  const context = useContext(ShopContext)
  if (!context) throw new Error('ShopProvider missing')
  return context
}
