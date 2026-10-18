import { Link } from 'react-router'
import { DataStatus } from '../components/account/AccountUi'
import { Summary } from '../components/ui/Summary'
import { orderStatus } from '../content/account'
import { productName } from '../content/products'
import { dateLabel, money } from '../lib/api'
import { useShop } from '../lib/shop-context'

export default function Pedidos() {
  const { account } = useShop()
  return <section aria-labelledby="portal-title"><div className="portal-heading"><h1 id="portal-title" tabIndex={-1}>Pedidos</h1><p>Suas compras, com data, valor e número do pedido.</p></div>
    <DataStatus {...account} retry={account.reload} />
    {account.data && (account.data.orders.length === 0 ? <div className="portal-orders-empty"><h2>Você ainda não tem pedidos</h2><p>Quando fizer sua primeira compra, os detalhes ficam aqui.</p><Link className="button button-primary" to="/loja">Ver os jogos</Link></div>
      : <ul className="order-list portal-orders">{account.data.orders.map(order => <li key={order.ref} className="portal-order">
        <div className="order-main"><span className="order-status" data-status={order.status}>{orderStatus[order.status] || 'Situação em atualização'}</span><ul className="order-products">{order.items.map((item, index) => <li key={`${item.code}-${index}`}>{productName(item.code, item.name)}</li>)}</ul><time dateTime={order.created_at}>{dateLabel(order.created_at)}</time></div>
        <div className="order-total"><span>Total</span><strong>{money(order.amount_total, order.currency)}</strong>{order.status === 'paid' && <Link className="inline-link" to="/meus-jogos">Ver meus jogos</Link>}</div>
        <details className="order-details"><Summary>Detalhes do pedido</Summary><dl><div><dt>Número do pedido</dt><dd>{order.ref}</dd></div>{order.paid_at && <div><dt>Pagamento confirmado em</dt><dd>{dateLabel(order.paid_at)}</dd></div>}</dl></details>
      </li>)}</ul>)}
  </section>
}
