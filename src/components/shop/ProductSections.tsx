import { Link } from 'react-router'
import { IconBallpen, IconBandage, IconBlade, IconBottle, IconBulb, IconCup, IconDeviceMobile, IconFile, IconHourglass, IconPrinter, IconScissors, type TablerIcon } from '@tabler/icons-react'
import { needLabels, type Game, type Need } from '../../content/games'
import type { Product } from '../../content/products'
import { GameCover } from '../account/GameCover'
import { Icon } from '../ui/Icon'
import { accentStyle } from './GameGrid'

const needIcons: Record<Need, TablerIcon> = {
  impressora: IconPrinter, tesoura: IconScissors, caneta: IconBallpen, folha: IconFile, cronometro: IconHourglass,
  estilete: IconBlade, fita: IconBandage, cola: IconBottle, copo: IconCup, luz: IconBulb, celular: IconDeviceMobile,
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

// Como jogar em três passos, numerados porque a ordem importa.
export function ProductHowTo({ game }: { game: Game }) {
  if (!game.howTo?.length) return null
  return <section className="product-section product-howto" aria-labelledby="howto-title">
    <h2 id="howto-title">Como jogar</h2>
    <p className="product-howto-intro">{game.description}</p>
    <ol className="howto-steps">{game.howTo.map((step, index) => <li key={step}><span className="step-number" aria-hidden="true">{index + 1}</span><p>{step}</p></li>)}</ol>
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
    <ul className="product-package-covers" aria-label={`Jogos do pacote ${bundle.title}`}>{bundle.games.map(item => <li key={item.id} style={accentStyle(item.accent)}><GameCover code={item.code} name={item.name} /><span>{item.name}</span></li>)}</ul>
  </section>
}
