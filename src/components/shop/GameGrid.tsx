import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { bundleFor, productPages, singleFor, type Product } from '../../content/products'
import { playStyle, type Game } from '../../content/games'
import { GameCover } from '../account/GameCover'
import { ProductAvailability } from './ProductAvailability'

// Card de produto da Loja: capa, o jeito de jogar (da ficha), nome, resumo e, no rodapé, o que fazer com o jogo
// (`children`). Na página do pacote (`kind` falso) a ficha inteira vem embaixo, então o rótulo não se repete.
// Cabeça e corpo separados: no celular a capa fica ao lado da cabeça e o corpo ocupa a largura toda (2026-10-24).
export function GameCard({ game, kind = true, children }: { game: Game; kind?: boolean; children: ReactNode }) {
  const style = kind ? playStyle(game) : undefined
  return <li className="shop-game" data-shop-game={game.id}>
    <GameCover code={game.code} name={game.name} />
    <div className="shop-game-head">
      {style && <p className="shop-game-kind">{style}</p>}
      <h3>{game.name}</h3>
    </div>
    <div className="shop-game-body">
      <p className="shop-summary">{game.summary}</p>
      {children}
    </div>
  </li>
}

// O pacote como último card da grade da Loja (2026-10-24): fecha a linha que os 5 jogos deixavam com um buraco.
export function PackCard({ bundle }: { bundle: Product }) {
  return <li className="shop-game shop-pack-card" data-pack-card={bundle.code}>
    {bundle.cover && <GameCover name={bundle.title} art={bundle.cover} />}
    <div className="shop-game-head"><p className="shop-game-kind">Pacote de jogos</p><h3>{bundle.title}</h3></div>
    <div className="shop-game-body"><p className="shop-summary">{bundle.tagline}</p><ProductAvailability product={bundle} /></div>
  </li>
}

// Estado "no pacote" (DESIGN.md › Card de produto): o jogo já se compra dentro de um pacote à venda,
// mesmo sem avulso. "Em breve" fica só para o que ainda não se compra de jeito nenhum.
function InPackage({ bundle }: { bundle: Product }) {
  return <div className="shop-in-package"><span className="tag-solid">No pacote</span><Link className="inline-link shop-details" to={`/loja/${bundle.slug}`} aria-label={`Ver o pacote: ${bundle.title}`}>Ver o pacote</Link></div>
}

// Grade da Loja e da vitrine: avulso à venda (preço e compra), "no pacote" ou "Em breve".
// Na página do pacote (`included`), os cards só apresentam o jogo, com a ficha: sem preço nem compra avulsa.
// Jogo ainda indefinido não vira card (decisão do responsável, 2026-10-16).
export function GameGrid({ games, variant = 'shop', extra }: { games: readonly Game[]; variant?: 'shop' | 'included'; extra?: ReactNode }) {
  return <ul className="shop-game-grid" data-variant={variant}>{games.filter(game => game.confirmed).map(game => {
    const single = singleFor(game)
    if (variant === 'included') {
      const page = single && productPages.includes(single) ? single : undefined
      return <GameCard key={game.id} game={game} kind={false}>
        {game.facts && <dl className="shop-game-facts">{game.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}
        {page && <Link className="inline-link shop-details" to={`/loja/${page.slug}`} aria-label={`Ver detalhes: ${page.title}`}>Ver detalhes</Link>}
      </GameCard>
    }
    const bundle = bundleFor(game)
    const inPackage = bundle ? <InPackage bundle={bundle} /> : undefined
    return <GameCard key={game.id} game={game}>{single ? <ProductAvailability product={single} fallback={inPackage} /> : inPackage ?? <p className="shop-soon">Em breve</p>}</GameCard>
  })}{extra}</ul>
}
