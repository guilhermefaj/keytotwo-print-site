import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../../lib/auth-context'
import { useShop } from '../../lib/shop-context'
import { ApiError, apiErrorMessage } from '../../lib/api'
import { authConfigured, loginDestination } from '../../lib/supabase'
import { products } from '../../content/products'

// `name` diferencia os botões quando há vários na mesma página (cards da Loja).
export function ProductPurchaseAction({ code, name, compact = false }: { code: string; name?: string; compact?: boolean }) {
  const { session, ready } = useAuth()
  const { catalog, add, busy } = useShop()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState('')
  const product = products.find(item => item.code === code)
  const canPurchase = product?.availability === 'sale' && product.offer.purchaseAction === 'cart'
  const listed = catalog.data?.products.find(item => item.code === code)
  async function addProduct() {
    if (!canPurchase) return
    if (!session) { await navigate(loginDestination('/carrinho', code)); return }
    setError(''); setErrorCode('')
    try { await add(code) }
    catch (cause) { setErrorCode(cause instanceof ApiError ? cause.code : ''); setError(apiErrorMessage(cause)) }
  }
  if (!canPurchase) return null
  return <div className={`offer-cart-action${compact ? ' purchase-compact' : ''}`}>
    <button className="button button-primary" disabled={!authConfigured || !ready || busy || !listed || catalog.loading || Boolean(catalog.error)} onClick={addProduct} aria-label={name && !busy ? `Adicionar à sacola: ${name}` : undefined}><span>{busy ? 'Adicionando…' : 'Adicionar à sacola'}</span></button>
    {!compact && <>{!authConfigured && <p>O acesso à conta estará disponível em breve.</p>}{catalog.loading && <p role="status">Consultando disponibilidade…</p>}{catalog.error && <button type="button" className="button button-secondary" onClick={catalog.reload}>Tentar novamente</button>}{catalog.data && !listed && <p>Esta experiência estará disponível em breve.</p>}{!session && authConfigured && <p className="field-help">Vamos guardar sua escolha. Entre ou crie uma conta para continuar.</p>}</>}
    {errorCode === 'ALREADY_OWNED'
      ? <p className="form-error" role="alert">Você já tem todos os jogos deste produto. <Link className="inline-link" to="/meus-jogos">Ver Meus jogos</Link></p>
      : <p className="form-error" role="alert">{error}</p>}
  </div>
}
