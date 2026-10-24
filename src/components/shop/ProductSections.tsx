import { Link } from 'react-router'
import { IconBallpen, IconBandage, IconBlade, IconBottle, IconBulb, IconCalendarEvent, IconCup, IconDeviceMobile, IconFile, IconHourglass, IconPencil, IconPrinter, IconScissors, type TablerIcon } from '@tabler/icons-react'
import { needLabels, type Game, type Need } from '../../content/games'
import type { Product } from '../../content/products'
import { refundNotice } from '../../content/legal'
import { GameCover } from '../account/GameCover'
import { Icon } from '../ui/Icon'

const needIcons: Record<Need, TablerIcon> = {
  impressora: IconPrinter, tesoura: IconScissors, caneta: IconBallpen, folha: IconFile, cronometro: IconHourglass,
  estilete: IconBlade, fita: IconBandage, cola: IconBottle, copo: IconCup, luz: IconBulb, celular: IconDeviceMobile,
  lapis: IconPencil, mesa: IconCalendarEvent,
}

// Ficha no topo da página do produto: os fatos conferidos do jogo, lado a lado como numa caixa de jogo.
export function ProductFacts({ game }: { game: Game }) {
  if (!game.facts?.length) return null
  return <dl className="product-facts" aria-label={`Ficha de ${game.name}`}>{game.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
}

// O que a dupla providencia além do PDF. No pacote, a lista junta o que todos os jogos pedem.
export function ProductNeeds({ games, bundle = false }: { games: readonly Game[]; bundle?: boolean }) {
  const needs = [...new Set(games.flatMap(game => game.needs ?? []))]
  if (!needs.length) return null
  return <section className="product-section product-needs" aria-labelledby="needs-title">
    <h2 id="needs-title">O que vocês precisam</h2>
    <p>{bundle ? 'Além dos PDFs, para jogar todos os jogos do pacote:' : 'Além do PDF:'}</p>
    <ul className="needs-list">{needs.map(need => <li key={need}><Icon component={needIcons[need]} size={24} /><span>{needLabels[need]}</span></li>)}</ul>
  </section>
}

// Como é jogar: a experiência do casal em três momentos, sem regras nem páginas do PDF (responsável, 2026-10-16).
export function ProductMoments({ game }: { game: Game }) {
  if (!game.moments?.length) return null
  return <section className="product-section product-moments" aria-labelledby="moments-title">
    <h2 id="moments-title">Como é jogar</h2>
    <p>{game.description}</p>
    <ul className="moments-list">{game.moments.map(moment => <li key={moment.title}><h3>{moment.title}</h3><p>{moment.text}</p></li>)}</ul>
  </section>
}

// Entrega e reembolso: regra de negócio, no fim da descrição e longe do botão de compra (responsável, 2026-10-24).
// O aceite que vale continua no pagamento.
export function ProductDelivery({ product }: { product: Product }) {
  return <section className="product-section product-delivery" aria-labelledby="delivery-title">
    <h2 id="delivery-title">Entrega e reembolso</h2>
    {product.delivery.map(line => <p key={line}>{line}</p>)}
    <p>{refundNotice} <Link className="inline-link" to="/reembolsos">Política de reembolso</Link></p>
  </section>
}

// O pacote como alternativa ao avulso: os jogos dele e o argumento real, todos num só pedido. Sem comparar preços.
export function ProductPackage({ game, bundle }: { game: Game; bundle: Product }) {
  const others = bundle.games.filter(item => item.id !== game.id).map(item => item.name)
  const list = others.length > 1 ? `${others.slice(0, -1).join(', ')} e ${others.at(-1)}` : others[0]
  return <section className="product-section product-package" aria-labelledby="package-title">
    <div className="product-package-copy">
      <h2 id="package-title">Também está no pacote</h2>
      <p>A {bundle.title} traz {game.name}{list ? <> junto com {list}</> : null}, todos num só pedido.</p>
      <Link className="inline-link" to={`/loja/${bundle.slug}`} aria-label={`Ver o pacote: ${bundle.title}`}>Ver o pacote</Link>
    </div>
    <ul className="product-package-covers" aria-label={`Jogos do pacote ${bundle.title}`}>{bundle.games.map(item => <li key={item.id}><GameCover code={item.code} name={item.name} sizes="88px" /><span>{item.name}</span></li>)}</ul>
  </section>
}
