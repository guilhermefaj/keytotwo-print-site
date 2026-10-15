import { Link } from 'react-router'
import { products } from '../../content/products'
import { itemName } from './purchase-names'
import { KitoEmpty } from '../ui/KitoEmpty'

// Miniatura do produto: imagem real de products.ts quando existe; sem ela, capa tipográfica com o título
// (DESIGN.md › The Catalog Rule). Nunca um enfeite com o Kito.
export function PurchaseThumbnail({ code, name = '', className = 'purchase-thumbnail' }: { code: string; name?: string; className?: string }) {
  const thumbnail = products.find(product => product.code === code)?.thumbnail
  if (thumbnail) return <img className={className} src={thumbnail.src} width="720" height="1019" alt={thumbnail.alt} decoding="async" />
  return <span className={`${className} purchase-thumbnail-type`} aria-hidden="true"><span>{itemName(code, name)}</span></span>
}

export function PurchaseSkeleton() {
  return <div className="purchase-skeleton" role="status" aria-label="Carregando sua sacola"><span className="sr-only">Carregando sua sacola…</span><div aria-hidden="true" className="skeleton-item"><span /><div><span /><span /><span /></div></div><div aria-hidden="true" className="skeleton-summary"><span /><span /><span /></div></div>
}
export function EmptyCart() {
  return <div className="cart-empty purchase-empty"><KitoEmpty /><div><h2>Sua sacola está vazia</h2><p>Uma ideia para a próxima noite de vocês está logo ali.</p><Link className="button button-primary" to="/#comprar">Quero o pacote</Link></div></div>
}
