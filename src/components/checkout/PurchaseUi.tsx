import { Link } from 'react-router'
import { products } from '../../content/products'
import { money, type CartItem } from '../../lib/api'
import { itemName } from './purchase-names'
import { KitoEmpty } from '../ui/KitoEmpty'

// Miniatura do produto: imagem real de products.ts quando existe; sem ela, capa tipográfica com o título
// (DESIGN.md › The Catalog Rule). Nunca um enfeite com o Kito.
export function PurchaseThumbnail({ code, name = '', className = 'purchase-thumbnail' }: { code: string; name?: string; className?: string }) {
  const thumbnail = products.find(product => product.code === code)?.thumbnail
  if (thumbnail) return <img className={className} src={thumbnail.src} width="640" height="360" alt={thumbnail.alt} decoding="async" />
  return <span className={`${className} purchase-thumbnail-type`} aria-hidden="true"><span>{itemName(code, name)}</span></span>
}

export function PurchaseSkeleton() {
  return <div className="purchase-skeleton" role="status" aria-label="Carregando sua sacola"><span className="sr-only">Carregando sua sacola…</span><div aria-hidden="true" className="skeleton-item"><span /><div><span /><span /><span /></div></div><div aria-hidden="true" className="skeleton-summary"><span /><span /><span /></div></div>
}
export function EmptyCart() {
  return <div className="cart-empty purchase-empty"><KitoEmpty /><div><h2>Sua sacola está vazia</h2><p>Por enquanto só tem o Kito aqui dentro. Ele aceita companhia.</p><Link className="button button-primary" to="/loja">Ver os jogos</Link></div></div>
}

// Preço do item na sacola (DESIGN.md › Item de compra): riscado quando não é cobrado (já está no Portal ou já está
// num pacote da sacola) e quando o pacote cobra só o que falta ("completar a coleção").
export function ItemPrice({ item, className }: { item: CartItem; className?: string }) {
  if (!item.price) return <p className={className}>Não conseguimos carregar o preço.</p>
  const list = money(item.price.unit_amount, item.price.currency)
  if (item.status === 'included' || item.status === 'already_owned') {
    return <p className={className}><span className="sr-only">Preço de tabela: </span><s>{list}</s> <span className="price-waived">não é cobrado</span></p>
  }
  if (item.charge && item.charge.unit_amount < item.price.unit_amount) {
    return <p className={className}><span className="sr-only">Preço de tabela: </span><s>{list}</s> <span className="sr-only">Você paga: </span>{money(item.charge.unit_amount, item.charge.currency)}</p>
  }
  return <p className={className}>{list}</p>
}
