import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import { products } from '../../content/products'
import { packageGames, type Game } from '../../content/games'
import { money } from '../../lib/api'
import { siteConfig } from '../../lib/seo'
import { useShop } from '../../lib/shop-context'
import { BundleFeature } from '../shop/BundleFeature'
import { accentStyle } from '../shop/GameGrid'
import { GameCover } from '../account/GameCover'
import { SnapCarousel } from '../ui/SnapCarousel'

// Vitrine do Início (decisão 9 do responsável): o pacote em destaque e uma fileira de capas clicáveis
// que levam à página de cada jogo. Os cards completos, com compra, ficam na Loja.
const showcaseGames = packageGames.filter(game => game.confirmed).slice(0, 3)

// Preço do avulso só quando o /catalog confirma; sem ele, o jogo se apresenta como parte do pacote.
function TilePrice({ code }: { code: string }) {
  const { catalog } = useShop()
  const listed = siteConfig.showCartAccess ? catalog.data?.products.find(item => item.code === code) : undefined
  // Enquanto o catálogo carrega, a linha fica reservada e vazia: nada de "No pacote" piscando antes do preço.
  return <span className="cover-tile-meta">{catalog.loading ? ' ' : listed?.price ? money(listed.price.unit_amount, listed.price.currency) : 'No pacote'}</span>
}

function CoverTile({ game, order }: { game: Game; order: number }) {
  const single = products.find(product => product.kind === 'single' && product.code === game.code)
  const bundle = products.find(product => product.kind === 'bundle' && product.games.some(item => item.id === game.id))
  const page = single ?? bundle
  return <article className="cover-tile" data-shop-game={game.id} style={{ ...accentStyle(game.accent), '--tile-order': order } as CSSProperties}>
    <Link className="cover-tile-link" to={page ? `/loja/${page.slug}` : '/loja'}>
      <GameCover code={game.code} name={game.name} sizes="(max-width: 767px) 78vw, 360px" />
      <span className="cover-tile-name">{game.name}</span>
      <span className="cover-tile-summary">{game.summary}</span>
      {game.code && <TilePrice code={game.code} />}
    </Link>
  </article>
}

export function ShopShowcase() {
  const bundle = products.find(product => product.kind === 'bundle')
  return <section className="page-section shop-showcase" aria-labelledby="showcase-title">
    <div className="content-width">
      <div className="from-blog-heading"><h2 id="showcase-title">Jogos para imprimir</h2><Link className="inline-link" to="/loja">Ver os jogos</Link></div>
      {bundle && <BundleFeature product={bundle} />}
      <SnapCarousel label="Jogos do pacote" className="cover-carousel">{showcaseGames.map((game, order) => <CoverTile key={game.id} game={game} order={order} />)}</SnapCarousel>
    </div>
  </section>
}
