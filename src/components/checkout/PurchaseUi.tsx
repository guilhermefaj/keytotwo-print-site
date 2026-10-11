import { Link } from 'react-router'
import { KitoEmpty } from '../ui/KitoEmpty'

export function PurchaseThumbnail() {
  // Página real do J001: a pessoa vê o que está comprando, não um enfeite (DESIGN.md › Kito).
  return <img className="purchase-thumbnail" src="/media/experience/j001-page-1-720.webp" width="720" height="1019" alt="" decoding="async" />
}
export function PurchaseSkeleton() {
  return <div className="purchase-skeleton" role="status" aria-label="Carregando seu carrinho"><span className="sr-only">Carregando seu carrinho…</span><div aria-hidden="true" className="skeleton-item"><span /><div><span /><span /><span /></div></div><div aria-hidden="true" className="skeleton-summary"><span /><span /><span /></div></div>
}
export function EmptyCart() {
  return <div className="cart-empty purchase-empty"><KitoEmpty /><div><h2>Seu carrinho está vazio</h2><p>Uma ideia para a próxima noite de vocês está logo ali.</p><Link className="button button-primary" to="/#comprar">Quero o pacote</Link></div></div>
}
