import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../../lib/auth-context'
import { useShop } from '../../lib/shop-context'
import { apiErrorMessage } from '../../lib/api'
import { authConfigured, loginDestination } from '../../lib/supabase'

export function ProductPurchaseAction({ code, compact = false }: { code: string; compact?: boolean }) {
  const { session, ready } = useAuth()
  const { catalog, add, busy } = useShop()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const listed = catalog.data?.products.find(item => item.code === code)
  async function addProduct() {
    if (!session) { await navigate(loginDestination('/carrinho', code)); return }
    setError('')
    try { await add(code) }
    catch (cause) { setError(apiErrorMessage(cause)) }
  }
  return <div className={`offer-cart-action${compact ? ' purchase-compact' : ''}`}>
    <button className="button button-primary" disabled={!authConfigured || !ready || busy || !listed || catalog.loading || Boolean(catalog.error)} onClick={addProduct}><span>{busy ? 'Adicionando…' : 'Adicionar ao carrinho'}</span>{!compact && <span aria-hidden="true">→</span>}</button>
    {!compact && <>{!authConfigured && <p>O acesso à conta estará disponível em breve.</p>}{catalog.loading && <p role="status">Consultando disponibilidade…</p>}{catalog.error && <><p role="alert">{catalog.error}</p><button className="text-button" onClick={catalog.reload}>Consultar novamente</button></>}{catalog.data && !listed && <p>Esta experiência estará disponível em breve.</p>}{!session && authConfigured && <p className="field-help">Vamos guardar sua escolha. Entre ou crie uma conta para continuar.</p>}</>}
    <p className="form-error" role="alert">{error}</p>
  </div>
}
