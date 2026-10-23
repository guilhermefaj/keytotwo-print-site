import { useLocation } from 'react-router'
import { promo } from '../../content/site'
import { privateRoutes } from './SiteHeader'

// Barrinha do cupom acima do cabeçalho (DESIGN.md › Barrinha de cupom). Rola com a página; o cabeçalho continua
// grudado no topo. Fica fora do Portal, que não tem estímulo comercial.
export function PromoBar() {
  const { pathname } = useLocation()
  if (!promo || privateRoutes.some(route => pathname.startsWith(route))) return null
  return <aside className="promo-bar" aria-label="Cupom de primeira compra"><p>{promo.before} <strong className="promo-code">{promo.code}</strong> {promo.after}</p></aside>
}
