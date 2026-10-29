import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import { catalogEntry } from '../../content/catalog'
import { bundleFor, products, singleFor } from '../../content/products'
import { packageGames, type Game } from '../../content/games'
import { money } from '../../lib/format'
import { siteConfig } from '../../lib/site-config'
import { useShop } from '../../lib/shop-context'
import { BundleFeature } from '../shop/BundleFeature'
import { GameCover } from '../account/GameCover'
import { SnapCarousel } from '../ui/SnapCarousel'

// Vitrine do Início (decisão 9 do responsável): o pacote em destaque e uma fileira de capas clicáveis
// que levam à página de cada jogo. Os cards completos, com compra, ficam na Loja.
const showcaseGames = packageGames.filter(game => game.confirmed)

// Preço do avulso: o do build enquanto o /catalog carrega (e no HTML, para quem lê sem JavaScript), depois o do
// /catalog; fora dele, o jogo se apresenta como parte do pacote.
function TilePrice({ code }: { code: string }) {
  const { catalog } = useShop()
  const listed = !siteConfig.showCartAccess ? undefined : catalog.loading ? catalogEntry(code) : catalog.data?.products.find(item => item.code === code)
  // Sem preço do build, a linha fica reservada e vazia enquanto carrega: nada de "No pacote" piscando antes do preço.
  return <span className="cover-tile-meta">{listed?.price ? money(listed.price.unit_amount, listed.price.currency) : catalog.loading ? ' ' : 'No pacote'}</span>
}

function CoverTile({ game, order }: { game: Game; order: number }) {
  const page = singleFor(game) ?? bundleFor(game)
  return <article className="cover-tile" data-shop-game={game.id} style={{ '--tile-order': order } as CSSProperties}>
    <Link className="cover-tile-link" to={page ? `/loja/${page.slug}` : '/loja'}>
      <GameCover code={game.code} name={game.name} sizes="(max-width: 767px) 78vw, (max-width: 1023px) 32vw, 220px" />
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
