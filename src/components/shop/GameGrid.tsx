import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { productPages, products, type Product } from '../../content/products'
import type { Game } from '../../content/games'
import { GameCover } from '../account/GameCover'
import { ProductAvailability } from './ProductAvailability'

// Card de produto da Loja: capa, o jeito de jogar (da ficha), nome, resumo e, no rodapé, o que fazer com o jogo
// (`children`). Na página do pacote (`kind` falso) a ficha inteira vem embaixo, então o rótulo não se repete.
export function GameCard({ game, kind = true, children }: { game: Game; kind?: boolean; children: ReactNode }) {
  const playStyle = kind ? game.facts?.find(fact => fact.label === 'Jeito de jogar')?.value : undefined
  return <li className={game.confirmed ? 'shop-game' : 'shop-game shop-game-soon'} data-shop-game={game.id}>
    <GameCover code={game.code} name={game.name} soon={!game.confirmed} />
    <div className="shop-game-body">
      {playStyle && <p className="shop-game-kind">{playStyle}</p>}
      <h3>{game.name}</h3>
      <p className="shop-summary">{game.summary}</p>
      {children}
    </div>
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
export function GameGrid({ games, variant = 'shop' }: { games: readonly Game[]; variant?: 'shop' | 'included' }) {
  return <ul className="shop-game-grid" data-variant={variant}>{games.filter(game => game.confirmed).map(game => {
    const single = game.code ? products.find(product => product.kind === 'single' && product.code === game.code) : undefined
    if (variant === 'included') {
      const page = single && productPages.includes(single) ? single : undefined
      return <GameCard key={game.id} game={game} kind={false}>
        {game.facts && <dl className="ficha shop-game-facts">{game.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}
        {page && <Link className="inline-link shop-details" to={`/loja/${page.slug}`} aria-label={`Ver detalhes: ${page.title}`}>Ver detalhes</Link>}
      </GameCard>
    }
    const bundle = products.find(product => product.kind === 'bundle' && product.availability === 'sale' && product.games.some(item => item.id === game.id))
    const inPackage = bundle ? <InPackage bundle={bundle} /> : undefined
    return <GameCard key={game.id} game={game}>{single ? <ProductAvailability product={single} fallback={inPackage} /> : inPackage ?? <p className="shop-soon">Em breve</p>}</GameCard>
  })}</ul>
}
