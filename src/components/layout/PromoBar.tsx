import { useSyncExternalStore } from 'react'
import { Link, useLocation } from 'react-router'
import { promoBanner } from '../../content/catalog-snapshot'
import { privateRoutes } from '../../content/site'
import { useReferral } from '../../lib/referral'
import { openingLabel, useSalesOpening } from '../../lib/sales-opening'
import { useShop } from '../../lib/shop-context'

const percent = (value: number) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value)}%`

// Barrinha do cupom acima do cabeçalho (DESIGN.md › Barrinha de cupom). Rola com a página; o cabeçalho continua
// grudado no topo. Fica fora do Portal, que não tem estímulo comercial. Na prévia do lançamento, ela leva o cronômetro
// até a abertura das vendas. Fora dela, quem chegou pelo link de um parceiro vê o cupom dele; os outros, o cupom com
// faixa do admin (o do build até o /catalog responder; sem cupom, nada).
export function PromoBar() {
  const { pathname } = useLocation()
  const referral = useReferral()
  const { catalog } = useShop()
  const opening = useSalesOpening()
  if (privateRoutes.some(route => pathname.startsWith(route))) return null
  if (opening) {
    return <aside className="promo-bar" aria-label="Abertura da loja"><p>A loja abre em {openingLabel(opening)}. <Countdown to={opening} />{pathname !== '/gratuitos' && <> Enquanto isso, <Link className="promo-link" to="/gratuitos">baixem os gratuitos</Link>.</>}</p></aside>
  }
  const code = <strong className="promo-code">{referral?.code ?? ''}</strong>
  if (referral?.name && referral.code && referral.percent_off) {
    return <aside className="promo-bar" aria-label="Cupom de desconto"><p>Indicação de {referral.name}: {percent(referral.percent_off)} de desconto no pagamento, com o cupom {code}</p></aside>
  }
  const banner = catalog.data && 'banner' in catalog.data ? catalog.data.banner ?? null : promoBanner
  if (!banner) return null
  return <aside className="promo-bar" aria-label="Cupom de desconto"><p>{banner.text.split('{cupom}').map((part, index) => <span key={index}>{index > 0 && <strong className="promo-code">{banner.code}</strong>}{part}</span>)}</p></aside>
}

const pad = (value: number) => String(value).padStart(2, '0')

// O relógio do cronômetro: um intervalo de 1 s enquanto ele está na tela. O valor só muda no intervalo, então a leitura
// é estável entre duas renderizações.
let clock = 0
function subscribeClock(onChange: () => void) {
  clock = Date.now()
  const timer = window.setInterval(() => { clock = Date.now(); onChange() }, 1000)
  return () => window.clearInterval(timer)
}
const clockSnapshot = () => clock || (clock = Date.now())
function subscribeMotion(onChange: () => void) {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)')
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
const motionSnapshot = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// "Faltam 12d 03h 25min 10s." No pré-render e na hidratação, traços no lugar dos números, da mesma largura. Com
// movimento reduzido, sem os segundos: muda uma vez por minuto.
function Countdown({ to }: { to: number }) {
  const now = useSyncExternalStore(subscribeClock, clockSnapshot, () => null)
  const reduced = useSyncExternalStore(subscribeMotion, motionSnapshot, () => false)
  const left = now === null ? null : Math.max(0, to - now)
  const unit = (size: number, every: number) => left === null ? '--' : pad(Math.floor(left / size) % every)
  const days = left === null ? '--' : String(Math.floor(left / 86_400_000))
  return <span role="timer">Faltam <strong className="promo-code promo-countdown">{days}d {unit(3_600_000, 24)}h {unit(60_000, 60)}min{!reduced && ` ${unit(1000, 60)}s`}</strong>.</span>
}
