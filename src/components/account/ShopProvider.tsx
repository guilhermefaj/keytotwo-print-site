import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { api, ApiError, apiErrorMessage, type Account, type Cart, type CatalogProduct } from '../../lib/api'
import { useAuth } from '../../lib/auth-context'
import { guestCartLimit, useGuestCartCodes, writeGuestCart } from '../../lib/guest-cart'
import { ShopContext } from '../../lib/shop-context'
import { authConfigured } from '../../lib/supabase'
import { useApiResource } from '../../lib/use-api-resource'

const emptyCart: Cart = { version: 0, items: [], subtotal: null, warnings: [] }

// Sacola de quem ainda não entrou: os códigos guardados no navegador, cotados pela API com as mesmas regras da conta.
function useGuestCart(active: boolean) {
  const codes = useGuestCartCodes()
  const [revision, setRevision] = useState(0)
  const key = `${codes.join(',')}:${revision}`
  const [result, setResult] = useState<{ key: string; data?: Cart; error?: string }>({ key: '' })
  const reload = useCallback(() => setRevision(value => value + 1), [])
  const quoting = active && authConfigured && codes.length > 0
  useEffect(() => {
    if (!quoting) return
    const controller = new AbortController()
    api<Cart>('/cart/quote', { method: 'POST', body: { product_codes: codes }, public: true, signal: controller.signal }).then(
      data => {
        if (controller.signal.aborted) return
        // Produto que deixou de existir sai da sacola guardada.
        if (data.unknown?.length) writeGuestCart(codes.filter(code => !data.unknown!.includes(code)))
        setResult({ key, data })
      },
      error => { if (!controller.signal.aborted) setResult({ key, error: apiErrorMessage(error) }) },
    )
    return () => controller.abort()
  }, [quoting, key, codes])
  const current = result.key === key
  const resource = !active ? { loading: false, reload }
    : !quoting ? { data: emptyCart, loading: false, reload }
      : { data: result.data, error: current ? result.error : undefined, loading: !current, reload }
  return { codes, resource }
}

export function ShopProvider({ children }: { children: ReactNode }) {
  const { session, ready } = useAuth()
  const server = useApiResource<Cart>('/cart')
  const guest = useGuestCart(ready && !session)
  const cart = session ? server : ready ? guest.resource : { loading: authConfigured, reload: server.reload }
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

  // Ao entrar, a sacola do navegador se junta à da conta (na mesma ordem) e sai daqui. Falhou: tenta na próxima vez.
  const userId = session?.user.id
  const merging = useRef(false)
  const reloadServer = server.reload
  useEffect(() => {
    if (!userId || !guest.codes.length || merging.current) return
    merging.current = true
    api<Cart>('/cart/merge', { method: 'POST', body: { product_codes: guest.codes } })
      .then(() => { writeGuestCart([]); reloadServer() }, () => {})
      .finally(() => { merging.current = false })
  }, [userId, guest.codes, reloadServer])

  const mutation = useRef(false)
  async function mutate(code: string, remove: boolean) {
    if (mutation.current) throw new Error('CART_BUSY')
    if (!remove) rememberOpener()
    if (!session) {
      const next = remove ? guest.codes.filter(item => item !== code) : guest.codes.includes(code) ? guest.codes : [...guest.codes, code]
      if (next.length > guestCartLimit) throw new ApiError('CART_FULL')
      writeGuestCart(next)
      if (!remove && !onCartRoute) setOpen(true)
      return
    }
    mutation.current = true
    setBusy(true)
    try {
      await api<Cart>(remove ? `/cart/items/${encodeURIComponent(code)}` : '/cart/items', { method: remove ? 'DELETE' : 'POST', body: remove ? undefined : { product_code: code } })
      server.reload()
      if (!remove && !onCartRoute) setOpen(true)
    } finally { mutation.current = false; setBusy(false) }
  }
  return <ShopContext.Provider value={{ cart, account, catalog, busy, cartOpen, cartOpener, setCartOpen, add: code => mutate(code, false), remove: code => mutate(code, true) }}>{children}</ShopContext.Provider>
}
