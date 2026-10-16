import { Link, isRouteErrorResponse, useLoaderData, useRouteError, type ClientLoaderFunctionArgs, type LoaderFunctionArgs } from 'react-router'
import { productPages, products } from '../content/products'
import { GameCover } from '../components/account/GameCover'
import { ProductAvailability } from '../components/shop/ProductAvailability'
import { GameGrid } from '../components/shop/GameGrid'
import NotFound from './not-found'
import '../shop.css'

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

export default function ShopProduct() {
  const { product } = useLoaderData<typeof loader>()
  const game = product.kind === 'single' ? product.games[0] : undefined
  const bundle = game && products.find(item => item.kind === 'bundle' && item.games.some(included => included.id === game.id))
  return <main id="conteudo" tabIndex={-1} className="shop-page shop-product-page content-width">
    <Link className="inline-link shop-back" to="/loja">Loja</Link>
    <header className="shop-heading"><h1>{product.title}</h1><p>{product.shopHeadline || product.tagline}</p></header>
    <div className="shop-product-layout">
      <div className="shop-product-cover"><GameCover code={game?.code} name={product.title} art={product.cover} />
        {game?.preview && <p className="shop-cover-caption"><Link className="inline-link" to={game.preview.href}>{game.preview.label}</Link></p>}
      </div>
      <section className="shop-purchase" aria-labelledby="shop-includes-title" data-shop-product={product.code}>
        <h2 id="shop-includes-title">O que está incluído</h2>
        <ul className="shop-includes">{product.contents.map(line => <li key={line}>{line}</li>)}</ul>
        <ProductAvailability product={product} detail />
        <div className="shop-delivery">{product.delivery.map(line => <p key={line}>{line}</p>)}</div>
        {bundle && <p className="shop-in-bundle">Também está no pacote{bundle.availability === 'sale' ? <>: <Link className="inline-link" to={`/loja/${bundle.slug}`}>{bundle.title}</Link></> : <>: {bundle.title}</>}.</p>}
      </section>
    </div>
    {game?.facts && <section className="shop-facts" aria-labelledby="shop-facts-title"><h2 id="shop-facts-title">{game.name}</h2><p>{game.description}</p><dl className="ficha">{game.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl></section>}
    {product.kind === 'bundle' && <section className="shop-games" aria-labelledby="shop-games-title"><h2 id="shop-games-title">Jogos do pacote</h2><GameGrid games={product.games} /></section>}
  </main>
}

export function ErrorBoundary() {
  const error = useRouteError()
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />
  return <main id="conteudo" tabIndex={-1} className="shop-page content-width"><h1>Não foi possível abrir esta página</h1><p role="alert">Tente abrir a página novamente.</p><Link className="button button-secondary" to="/loja">Loja</Link></main>
}
