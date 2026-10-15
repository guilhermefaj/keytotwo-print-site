import { products } from '../../content/products'
import type { Game } from '../../content/games'
import { GameCover } from '../account/GameCover'
import { ProductAvailability } from './ProductAvailability'

export function GameGrid({ games }: { games: readonly Game[] }) {
  return <ul className="shop-game-grid">{games.map(game => {
    const single = game.code ? products.find(product => product.kind === 'single' && product.code === game.code) : undefined
    return <li className="shop-game" key={game.id} data-shop-game={game.id}>
      <GameCover code={game.code} name={game.confirmed ? game.name : 'Em breve'} soon={!game.confirmed} />
      <h3>{game.name}</h3>
      <p className="shop-summary">{game.summary}</p>
      <ProductAvailability product={single} />
    </li>
  })}</ul>
}
