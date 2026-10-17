import { Link, isRouteErrorResponse, useLoaderData, useRouteError, type ClientLoaderFunctionArgs, type LoaderFunctionArgs } from 'react-router'
import { productPages, products, type Product } from '../content/products'
import type { Game } from '../content/games'
import { ProductAvailability } from '../components/shop/ProductAvailability'
import { GameGrid } from '../components/shop/GameGrid'
import { ProductGallery, type GalleryImage } from '../components/shop/ProductGallery'
import { ProductFacts, ProductMoments, ProductNeeds, ProductPackage } from '../components/shop/ProductSections'
import { BackLink } from '../components/ui/BackLink'
import NotFound from './not-found'

export function loader({ params }: LoaderFunctionArgs) {
  return loadProduct(params.slug)
}

function loadProduct(slug?: string) {
  const product = productPages.find(product => product.slug === slug)
  if (!product) throw new Response('Página não encontrada', { status: 404 })
  return { product }
}

// Mesmos dados editoriais no build e na navegação SPA; slugs soon/desconhecidos dão 404.
export function clientLoader({ params }: ClientLoaderFunctionArgs) { return loadProduct(params.slug) }
clientLoader.hydrate = true

const coverImage = (src: string, srcSet: string, name: string): GalleryImage => ({ src, srcSet, alt: `Capa de ${name}.`, width: 640, height: 360 })

// Galeria: só capas oficiais. No avulso, a capa do jogo; no pacote, a capa dele e as dos jogos.
function galleryOf(product: Product, game?: Game): GalleryImage[] {
  if (game) return game.cover ? [coverImage(game.cover.src, game.cover.srcSet, game.name)] : []
  return [
    ...(product.cover ? [coverImage(product.cover.src, product.cover.srcSet, product.title)] : []),
    ...product.games.filter(item => item.cover).map(item => coverImage(item.cover!.src, item.cover!.srcSet, item.name)),
  ]
}

// Página de produto (DESIGN.md › Página de produto): ficha no topo, galeria e compra, como é jogar,
// o que vocês precisam e o pacote como alternativa. O pacote mostra os jogos com a ficha de cada um.
export default function ShopProduct() {
  const { product } = useLoaderData<typeof loader>()
  const game = product.kind === 'single' ? product.games[0] : undefined
  const bundle = game && products.find(item => item.kind === 'bundle' && item.availability === 'sale' && item.games.some(included => included.id === game.id))
  return <main id="conteudo" tabIndex={-1} className="shop-page shop-product-page content-width">
    <BackLink to="/loja">Loja</BackLink>
    <header className="shop-heading"><h1>{product.title}</h1><p>{product.shopHeadline || product.tagline}</p></header>
    {game && <ProductFacts game={game} />}
    <div className="shop-product-layout">
      <ProductGallery images={galleryOf(product, game)} accent={game?.accent} />
      <section className="shop-purchase" aria-labelledby="shop-includes-title" data-shop-product={product.code}>
        <h2 id="shop-includes-title">O que está incluído</h2>
        <ul className="shop-includes">{product.contents.map(line => <li key={line}>{line}</li>)}</ul>
        <ProductAvailability product={product} detail />
        <div className="shop-delivery">{product.delivery.map(line => <p key={line}>{line}</p>)}</div>
      </section>
    </div>
    {game && <ProductMoments game={game} />}
    {product.kind === 'bundle' && <section className="product-section shop-games" aria-labelledby="shop-games-title"><h2 id="shop-games-title">Jogos do pacote</h2><GameGrid games={product.games} variant="included" /></section>}
    <ProductNeeds games={product.games} bundle={product.kind === 'bundle'} />
    {game && bundle && <ProductPackage game={game} bundle={bundle} />}
  </main>
}

export function ErrorBoundary() {
  const error = useRouteError()
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />
  return <main id="conteudo" tabIndex={-1} className="shop-page content-width"><h1>Não foi possível abrir esta página</h1><p role="alert">Tente abrir a página novamente.</p><Link className="button button-secondary" to="/loja">Loja</Link></main>
}
