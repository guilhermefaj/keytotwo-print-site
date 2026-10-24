import { useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../lib/auth-context'
import { useShop } from '../../lib/shop-context'
import { apiErrorMessage } from '../../lib/api'
import { authConfigured } from '../../lib/supabase'
import { productByCode } from '../../content/products'

// `name` diferencia os botões quando há vários na mesma página (cards da Loja). A sacola funciona sem login;
// quem já tem o produto vê o atalho para o Portal no lugar do botão.
export function ProductPurchaseAction({ code, name, compact = false }: { code: string; name?: string; compact?: boolean }) {
  const { session, ready } = useAuth()
  const { cart, catalog, add, busy } = useShop()
  const [error, setError] = useState('')
  const product = productByCode(code)
  const canPurchase = product?.availability === 'sale' && product.purchaseAction === 'cart'
  const listed = catalog.data?.products.find(item => item.code === code)
  const owned = Boolean(session && cart.data?.owned_products?.includes(code))
  async function addProduct() {
    if (!canPurchase) return
    setError('')
    try { await add(code) } catch (cause) { setError(apiErrorMessage(cause)) }
  }
  if (!canPurchase) return null
  if (owned) return <div className={`offer-cart-action offer-owned${compact ? ' purchase-compact' : ''}`}>
    <Link className="button button-secondary" to="/meus-jogos" aria-label={name ? `Já está no seu Portal: ${name}` : undefined}>Já está no seu Portal</Link>
  </div>
  return <div className={`offer-cart-action${compact ? ' purchase-compact' : ''}`}>
    <button className="button button-primary" disabled={!authConfigured || !ready || busy || !listed || catalog.loading || Boolean(catalog.error)} onClick={addProduct} aria-label={name && !busy ? `Adicionar à sacola: ${name}` : undefined}><span>{busy ? 'Adicionando…' : 'Adicionar à sacola'}</span></button>
    {!compact && <>{!authConfigured && <p>O acesso à conta estará disponível em breve.</p>}{catalog.loading && <p role="status">Consultando o preço…</p>}{catalog.error && <button type="button" className="button button-secondary" onClick={catalog.reload}>Tentar novamente</button>}{catalog.data && !listed && <p>Ainda não está à venda. Volte em breve.</p>}</>}
    <p className="form-error" role="alert">{error}</p>
  </div>
}
