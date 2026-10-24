import { createContext, useContext, type RefObject } from 'react'
import type { Account, Cart, CatalogResponse } from './api'

export type Resource<T> = { data?: T; error?: string; loading: boolean; reload: () => void }
type ShopState = { cart: Resource<Cart>; account: Resource<Account>; catalog: Resource<CatalogResponse>; busy: boolean; cartOpen: boolean; cartOpener: RefObject<HTMLElement | null>; setCartOpen: (open: boolean) => void; add: (code: string) => Promise<void>; remove: (code: string) => Promise<void> }
export const ShopContext = createContext<ShopState | null>(null)
export function useShop() {
  const context = useContext(ShopContext)
  if (!context) throw new Error('ShopProvider missing')
  return context
}
