import { Link } from 'react-router'
import { useResource } from '../api'
import { productState, type CatalogList, type CatalogProduct } from '../catalog'
import { Section } from '../Detail'
import { count, formatMoment, money } from '../format'
import { LoadError } from '../LoadError'
import { SiteStatus } from '../SiteStatus'

// Catálogo (2026-10-24): cada produto com a situação, o preço da Stripe (e o riscado), os jogos e as vendas, e os jogos
// com a versão do PDF. A ficha do produto muda o preço, a situação e o pacote. A troca de PDF é feita por script.
export function CatalogPage() {
  const { data, error, reload } = useResource<CatalogList>('/admin/catalog')
  return <>
    <title>Catálogo — Admin KeyToTwo</title>
    <header className="page-heading"><h1>Catálogo</h1><p>O que está à venda, por quanto e o que vem em cada pacote.</p></header>
    {!data ? (error ? <LoadError error={error} retry={reload} /> : <p className="status" role="status">Carregando o catálogo…</p>) : <>
      <SiteStatus version={data.version} path="/catalogo/versao.json" synced="A loja está em dia com o catálogo." />
      <Section id="produtos" title="Produtos" count={data.products.length}>
        <ul className="plain-list" aria-label="Produtos">{data.products.map(product => <ProductRow key={product.code} product={product} />)}</ul>
      </Section>
      <Section id="jogos" title="Jogos" count={data.games.length}>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Jogos e PDFs">
          <table className="data-table">
            <thead><tr><th scope="col">Jogo</th><th scope="col">PDF</th><th scope="col">Avulso</th><th scope="col">Nos pacotes</th></tr></thead>
            <tbody>{data.games.map(game => <tr key={game.code}>
              <td><strong>{game.name}</strong> <span className="plain-row-sub">{game.code}{game.access === 'free' ? ' · gratuito' : ''}{game.status === 'draft' ? ' · rascunho' : ''}</span></td>
              <td>{game.file ? `Versão ${game.file.version}${game.file.published_at ? `, ${formatMoment(game.file.published_at)}` : ''}` : 'Sem PDF publicado'}</td>
              <td>{game.single ? <Link className="text-link" to={`/catalogo/${game.single}`}>{game.single}</Link> : '—'}</td>
              <td>{game.packs.length ? game.packs.map(code => <Link key={code} className="text-link" to={`/catalogo/${code}`}>{code}</Link>) : '—'}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="field-help">Trocar o PDF de um jogo é com a equipe técnica, por script: o Catálogo mostra a versão em uso.</p>
      </Section>
    </>}
  </>
}

function ProductRow({ product }: { product: CatalogProduct }) {
  const state = productState(product)
  return <li className="plain-row">
    <div className="plain-row-main">
      <Link className="user-row-title" to={`/catalogo/${product.code}`}>{product.name ?? product.code}</Link>
      <span className="plain-row-sub">{product.code} · {product.kind === 'bundle' ? `Pacote com ${product.games.length} jogos` : 'Jogo avulso'}</span>
      <span className="plain-row-sub">{count(product.paid_orders)} {product.paid_orders === 1 ? 'pedido pago' : 'pedidos pagos'} · {count(product.owners)} {product.owners === 1 ? 'pessoa tem' : 'pessoas têm'}</span>
    </div>
    <span className={`badge${state.tone ? ` badge-${state.tone}` : ''}`}>{state.label}</span>
    <span className="plain-row-amount">{product.price ? <>
      {product.list_price && product.list_price.amount > product.price.unit_amount && <s className="catalog-list-price"><span className="sr-only">De </span>{money(product.list_price.amount, product.price.currency)}<span className="sr-only"> por</span></s>} {money(product.price.unit_amount, product.price.currency)}
    </> : 'Sem preço'}</span>
  </li>
}
