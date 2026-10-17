import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { Product } from '../../content/products'
import { money } from '../../lib/api'
import { siteConfig } from '../../lib/seo'
import { useShop } from '../../lib/shop-context'
import { ProductPurchaseAction } from '../sections/ProductPurchaseAction'

// `quietLoading`: no topo da Loja, o "Consultando…" aparecia e sumia empurrando o banner (CLS). Ali ele fica só
// para leitor de tela; o erro continua visível, com a nova tentativa.
export function CatalogFeedback({ quietLoading = false }: { quietLoading?: boolean }) {
  const { catalog } = useShop()
  if (!siteConfig.showCartAccess) return null
  if (catalog.loading) return <p className={quietLoading ? 'shop-status sr-only' : 'shop-status'} role="status">Consultando disponibilidade…</p>
  if (catalog.error) return <div className="shop-status"><p role="alert">{catalog.error}</p><button className="button button-secondary" onClick={catalog.reload}>Tentar novamente</button></div>
  return null
}

// Conteúdo não concede disponibilidade: o catálogo aplica a completude e publicação dos jogos.
// `fallback` substitui o "Em breve" quando o jogo ainda se compra de outro jeito (no pacote).
export function ProductAvailability({ product, detail = false, fallback }: { product?: Product; detail?: boolean; fallback?: ReactNode }) {
  const { catalog } = useShop()
  const soon = fallback ?? <p className="shop-soon">Em breve</p>
  if (!product || product.availability !== 'sale' || !siteConfig.showCartAccess) return soon
  if (catalog.loading || catalog.error) return detail ? <CatalogFeedback /> : null
  const listed = catalog.data?.products.find(item => item.code === product.code)
  if (!listed) return soon
  if (!listed.price) return <p className="shop-status">Não conseguimos carregar o preço.</p>
  return <div className="shop-availability">
    <p className="shop-price">{money(listed.price.unit_amount, listed.price.currency)}</p>
    {siteConfig.stage === 'test' && <p className="shop-price-note">Valor de teste</p>}
    {detail
      ? <ProductPurchaseAction code={product.code} />
      : <><ProductPurchaseAction code={product.code} name={product.title} compact /><Link className="inline-link shop-details" to={`/loja/${product.slug}`} aria-label={`Ver detalhes: ${product.title}`}>Ver detalhes</Link></>}
  </div>
}
