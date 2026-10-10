import { Link } from 'react-router'
import { KitoEmpty } from '../ui/KitoEmpty'

export function PurchaseThumbnail() {
  return <img className="purchase-thumbnail" src="/media/experience/kito-tabuleiro-240.webp" width="240" height="240" alt="" decoding="async" />
}
export function PurchaseSkeleton() {
  return <div className="purchase-skeleton" role="status" aria-label="Carregando seu carrinho"><span className="sr-only">Carregando seu carrinho…</span><div aria-hidden="true" className="skeleton-item"><span /><div><span /><span /><span /></div></div><div aria-hidden="true" className="skeleton-summary"><span /><span /><span /></div></div>
}
export function EmptyCart() {
  return <div className="cart-empty purchase-empty"><KitoEmpty /><div><h2>Seu carrinho está vazio</h2><p>Uma ideia para a próxima noite de vocês está logo ali.</p><Link className="button button-primary" to="/#comprar">Conhecer o pacote</Link></div></div>
}
