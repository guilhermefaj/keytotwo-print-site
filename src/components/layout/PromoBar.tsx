import { useLocation } from 'react-router'
import { promoBanner } from '../../content/catalog-snapshot'
import { privateRoutes } from '../../content/site'
import { useReferral } from '../../lib/referral'
import { useShop } from '../../lib/shop-context'

const percent = (value: number) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value)}%`

// Barrinha do cupom acima do cabeçalho (DESIGN.md › Barrinha de cupom). Rola com a página; o cabeçalho continua
// grudado no topo. Fica fora do Portal, que não tem estímulo comercial. Quem chegou pelo link de um parceiro vê o
// cupom dele; os outros, o cupom com faixa do admin (o do build até o /catalog responder; sem cupom, nada).
export function PromoBar() {
  const { pathname } = useLocation()
  const referral = useReferral()
  const { catalog } = useShop()
  if (privateRoutes.some(route => pathname.startsWith(route))) return null
  const code = <strong className="promo-code">{referral?.code ?? ''}</strong>
  if (referral?.name && referral.code && referral.percent_off) {
    return <aside className="promo-bar" aria-label="Cupom de desconto"><p>Indicação de {referral.name}: {percent(referral.percent_off)} de desconto no pagamento, com o cupom {code}</p></aside>
  }
  const banner = catalog.data && 'banner' in catalog.data ? catalog.data.banner ?? null : promoBanner
  if (!banner) return null
  return <aside className="promo-bar" aria-label="Cupom de desconto"><p>{banner.text.split('{cupom}').map((part, index) => <span key={index}>{index > 0 && <strong className="promo-code">{banner.code}</strong>}{part}</span>)}</p></aside>
}
