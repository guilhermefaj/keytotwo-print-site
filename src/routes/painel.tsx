import { useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { DataStatus } from '../components/account/AccountUi'
import { Summary } from '../components/ui/Summary'
import { money, notAdminMessage } from '../lib/api'
import { isAdmin, useAuth } from '../lib/auth-context'
import { useApiResource } from '../lib/use-api-resource'

// Painel do administrador (/painel, responsável, 2026-10-21): só métricas, lidas do banco por GET /admin/metrics.
// /admin é o CMS do blog (public/admin), por isso o painel mora em /painel.
// O link e a página aparecem para app_metadata.admin; quem decide é a API, que confere o admin no banco.
type Metrics = {
  days: number
  since: string
  until: string
  livemode: boolean
  sales: { orders: number; revenue: number; currency: string }
  accounts: number
  funnel: { cart: number; checkout: number; paid: number }
  downloads: { paid: number; free: number }
  free_unlocks: number
  newsletter: { subscribed: number }
  daily: { date: string; orders: number; revenue: number; accounts: number }[]
}

const periods = [7, 30] as const
const count = (value: number) => new Intl.NumberFormat('pt-BR').format(value)
// As datas do painel já são dias de Brasília (AAAA-MM-DD); meio-dia em UTC não muda o dia em nenhum fuso.
const day = (value: string, month: 'short' | '2-digit' = 'short') => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month, timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`))
const share = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.round(part / whole * 100)) : 0)

export default function Admin() {
  const { session } = useAuth()
  const admin = isAdmin(session)
  const [days, setDays] = useState<typeof periods[number]>(7)
  const metrics = useApiResource<Metrics>(`/admin/metrics?days=${days}`, false, !admin)
  const data = metrics.data
  const denied = !admin || metrics.error === notAdminMessage

  return <main id="conteudo" tabIndex={-1} className="admin-page">
    <div className="content-width admin-content">
      <div className="portal-heading"><h1>Painel</h1><p>Como a loja está indo: vendas, contas, funil e downloads.</p></div>
      {denied ? <div className="admin-denied"><h2>Esta área é só para a equipe</h2><p>Seus jogos e pedidos continuam no Portal.</p><Link className="button button-secondary" to="/meus-jogos">Ir para o Portal</Link></div> : <>
        <div className="admin-toolbar">
          <div className="admin-periods" role="group" aria-label="Período">{periods.map(value => <button key={value} type="button" aria-pressed={days === value} onClick={() => setDays(value)}>{value} dias</button>)}</div>
          {data && <p className="admin-range">{day(data.since)} a {day(data.until)}, contando hoje{!data.livemode && <> · <strong>vendas do modo de teste da Stripe</strong></>}</p>}
        </div>
        <DataStatus {...metrics} retry={metrics.reload} />
        {data && <Dashboard data={data} />}
      </>}
    </div>
  </main>
}

function Dashboard({ data }: { data: Metrics }) {
  const { sales, funnel } = data
  const peak = Math.max(...data.daily.map(item => item.revenue), 0)
  const steps = [
    { label: 'Puseram na sacola', value: funnel.cart },
    { label: 'Abriram o pagamento', value: funnel.checkout },
    { label: 'Pagaram', value: funnel.paid },
  ]
  return <>
    <section className="admin-section" aria-labelledby="admin-sales">
      <h2 id="admin-sales">Vendas</h2>
      <dl className="admin-cards">
        <div><dt>Receita</dt><dd>{money(sales.revenue, sales.currency)}</dd></div>
        <div><dt>Pedidos pagos</dt><dd>{count(sales.orders)}</dd></div>
        <div><dt>Ticket médio</dt><dd>{sales.orders ? money(Math.round(sales.revenue / sales.orders), sales.currency) : '—'}</dd></div>
      </dl>
      <figure className="admin-chart">
        <figcaption>Receita por dia</figcaption>
        <div className="admin-bars" aria-hidden="true">{data.daily.map(item => <span key={item.date} title={`${day(item.date)}: ${money(item.revenue, sales.currency)} em ${item.orders} ${item.orders === 1 ? 'pedido' : 'pedidos'}`} style={{ '--bar': `${share(item.revenue, peak)}%` } as CSSProperties} />)}</div>
        <div className="admin-chart-axis" aria-hidden="true"><span>{day(data.since)}</span><span>{day(data.until)}</span></div>
      </figure>
      <details className="admin-daily"><Summary>Ver dia a dia</Summary>
        <div className="admin-table-wrap"><table>
          <thead><tr><th scope="col">Dia</th><th scope="col">Pedidos</th><th scope="col">Receita</th><th scope="col">Contas novas</th></tr></thead>
          <tbody>{[...data.daily].reverse().map(item => <tr key={item.date}><th scope="row">{day(item.date, '2-digit')}</th><td>{count(item.orders)}</td><td>{money(item.revenue, sales.currency)}</td><td>{count(item.accounts)}</td></tr>)}</tbody>
        </table></div>
      </details>
    </section>
    <section className="admin-section" aria-labelledby="admin-funnel">
      <h2 id="admin-funnel">Funil de compra</h2>
      <p className="admin-note">Pessoas diferentes em cada etapa, no período.</p>
      <ol className="admin-funnel">{steps.map((step, index) => <li key={step.label} style={{ '--bar': `${index === 0 ? (step.value ? 100 : 0) : share(step.value, funnel.cart)}%` } as CSSProperties}>
        <span className="admin-funnel-label">{step.label}</span>
        <strong>{count(step.value)}</strong>
        {index > 0 && <span className="admin-funnel-share">{funnel.cart ? `${share(step.value, funnel.cart)}% da sacola` : '—'}</span>}
        <span className="admin-funnel-bar" aria-hidden="true" />
      </li>)}</ol>
    </section>
    <section className="admin-section" aria-labelledby="admin-people">
      <h2 id="admin-people">Contas e e-mails</h2>
      <dl className="admin-cards">
        <div><dt>Contas novas</dt><dd>{count(data.accounts)}</dd></div>
        <div><dt>Liberaram os gratuitos</dt><dd>{count(data.free_unlocks)}</dd></div>
        <div><dt>Inscritos em novidades</dt><dd>{count(data.newsletter.subscribed)}</dd><dd className="admin-card-note">Total de hoje, fora do período</dd></div>
      </dl>
    </section>
    <section className="admin-section" aria-labelledby="admin-downloads">
      <h2 id="admin-downloads">Downloads</h2>
      <dl className="admin-cards">
        <div><dt>Jogos comprados</dt><dd>{count(data.downloads.paid)}</dd></div>
        <div><dt>Jogos gratuitos</dt><dd>{count(data.downloads.free)}</dd></div>
      </dl>
    </section>
  </>
}
