import { Link } from 'react-router'
import type { Product } from '../../content/products'
import { money } from '../../lib/api'
import { siteConfig } from '../../lib/seo'
import { useShop } from '../../lib/shop-context'
import { ProductPurchaseAction } from '../sections/ProductPurchaseAction'

export function CatalogFeedback() {
  const { catalog } = useShop()
  if (!siteConfig.showCartAccess) return null
  if (catalog.loading) return <p className="shop-status" role="status">Consultando disponibilidade…</p>
  if (catalog.error) return <div className="shop-status"><p role="alert">{catalog.error}</p><button className="button button-secondary" onClick={catalog.reload}>Tentar novamente</button></div>
  return null
}

// Conteúdo não concede disponibilidade: o catálogo aplica a completude e publicação dos jogos.
export function ProductAvailability({ product, detail = false }: { product?: Product; detail?: boolean }) {
  const { catalog } = useShop()
  if (!product || product.availability !== 'sale' || !siteConfig.showCartAccess) {
    return <p className="shop-soon">Em breve</p>
  }
  if (catalog.loading || catalog.error) return detail ? <CatalogFeedback /> : null
  const listed = catalog.data?.products.find(item => item.code === product.code)
  if (!listed) return <p className="shop-soon">Em breve</p>
  if (!listed.price) return <p className="shop-status">Não conseguimos carregar o preço.</p>
  return <div className="shop-availability">
    <p className="shop-price">{money(listed.price.unit_amount, listed.price.currency)}</p>
    {siteConfig.stage === 'test' && <p className="shop-price-note">Valor de teste</p>}
    {detail
      ? <ProductPurchaseAction code={product.code} />
      : <><ProductPurchaseAction code={product.code} name={product.title} compact /><Link className="inline-link shop-details" to={`/loja/${product.slug}`} aria-label={`Ver detalhes: ${product.title}`}>Ver detalhes</Link></>}
  </div>
}
