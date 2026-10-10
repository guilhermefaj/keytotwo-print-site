import { Link } from 'react-router'
import { DataStatus } from '../components/account/AccountUi'
import { orderStatus } from '../content/account'
import { productName } from '../content/products'
import { dateLabel, money } from '../lib/api'
import { useShop } from '../lib/shop-context'

export default function Pedidos() {
  const { account } = useShop()
  return <section aria-labelledby="portal-title"><div className="portal-heading"><h1 id="portal-title" tabIndex={-1}>Pedidos</h1><p>Acompanhe suas compras e volte para a próxima rodada.</p></div>
    <DataStatus {...account} retry={account.reload} />
    {account.data && (account.data.orders.length === 0 ? <div className="portal-orders-empty"><h2>Você ainda não tem pedidos</h2><p>Quando fizer sua primeira compra, os detalhes ficam aqui.</p><Link className="button button-primary" to="/#comprar">Conhecer o pacote <span aria-hidden="true">→</span></Link></div>
      : <ul className="order-list portal-orders">{account.data.orders.map(order => <li key={order.ref} className="portal-order">
        <div className="order-main"><span className="order-status" data-status={order.status}>{orderStatus[order.status] || 'Situação em atualização'}</span><ul className="order-products">{order.items.map((item, index) => <li key={`${item.code}-${index}`}>{productName(item.code, item.name)}</li>)}</ul><time dateTime={order.created_at}>{dateLabel(order.created_at)}</time></div>
        <div className="order-total"><span>Total</span><strong>{money(order.amount_total, order.currency)}</strong>{order.status === 'paid' && <Link className="inline-link" to="/meus-jogos">Ver meus jogos <span aria-hidden="true">→</span></Link>}</div>
        <details className="order-details"><summary>Detalhes do pedido</summary><dl><div><dt>Número do pedido</dt><dd>{order.ref}</dd></div>{order.paid_at && <div><dt>Pagamento confirmado em</dt><dd>{dateLabel(order.paid_at)}</dd></div>}</dl></details>
      </li>)}</ul>)}
  </section>
}
