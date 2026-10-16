import type { ReactNode } from 'react'
import { products } from '../../content/products'
import type { Game } from '../../content/games'
import { GameCover } from '../account/GameCover'
import { ProductAvailability } from './ProductAvailability'

// Card de produto da Loja: capa, nome, resumo e, no rodapé, o que fazer com o jogo (`children`).
export function GameCard({ game, children }: { game: Game; children: ReactNode }) {
  return <li className={game.confirmed ? 'shop-game' : 'shop-game shop-game-soon'} data-shop-game={game.id}>
    <GameCover code={game.code} name={game.name} soon={!game.confirmed} />
    <div className="shop-game-body">
      <h3>{game.name}</h3>
      <p className="shop-summary">{game.summary}</p>
      {children}
    </div>
  </li>
}

// Grade de venda: preço e compra (ou "Em breve"). Jogo ainda indefinido não vira card (decisão do responsável, 2026-10-16).
export function GameGrid({ games }: { games: readonly Game[] }) {
  return <ul className="shop-game-grid">{games.filter(game => game.confirmed).map(game => {
    const single = game.code ? products.find(product => product.kind === 'single' && product.code === game.code) : undefined
    return <GameCard key={game.id} game={game}><ProductAvailability product={single} /></GameCard>
  })}</ul>
}
