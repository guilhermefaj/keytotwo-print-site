import { useState, type CSSProperties } from 'react'
import { apiMessage, count, money, useResource } from '../api'

// Métricas (GET /admin/metrics, migração 20261021120000): vendas, funil, contas e downloads em 7 ou 30 dias.
// Veio do /painel da loja (2026-10-21) sem mudar o conteúdo.
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
// As datas já são dias de Brasília (AAAA-MM-DD); meio-dia em UTC não muda o dia em nenhum fuso.
const day = (value: string, month: 'short' | '2-digit' = 'short') => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month, timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`))
const share = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.round(part / whole * 100)) : 0)

export function MetricsPage() {
  const [days, setDays] = useState<typeof periods[number]>(7)
  const metrics = useResource<Metrics>(`/admin/metrics?days=${days}`)
  const data = metrics.data
  return <>
    <title>Métricas — Admin KeyToTwo</title>
    <header className="page-heading"><h1>Métricas</h1><p>Como a loja está indo: vendas, contas, funil e downloads.</p></header>
    <div className="toolbar">
      <div className="periods" role="group" aria-label="Período">{periods.map(value => <button key={value} type="button" aria-pressed={days === value} onClick={() => setDays(value)}>{value} dias</button>)}</div>
      {data && <p className="range">{day(data.since)} a {day(data.until)}, contando hoje{!data.livemode && <> · <strong>vendas do modo de teste da Stripe</strong></>}</p>}
    </div>
    {metrics.loading && <p className="status" role="status">Carregando…</p>}
    {Boolean(metrics.error) && <div className="status-error" role="alert"><p>{apiMessage(metrics.error)}</p><button className="button button-secondary" type="button" onClick={metrics.reload}>Tentar de novo</button></div>}
    {data && <Dashboard data={data} />}
  </>
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
    <section className="section" aria-labelledby="metricas-vendas">
      <h2 id="metricas-vendas">Vendas</h2>
      <dl className="cards">
        <div><dt>Receita</dt><dd>{money(sales.revenue, sales.currency)}</dd></div>
        <div><dt>Pedidos pagos</dt><dd>{count(sales.orders)}</dd></div>
        <div><dt>Ticket médio</dt><dd>{sales.orders ? money(Math.round(sales.revenue / sales.orders), sales.currency) : '—'}</dd></div>
      </dl>
      <figure className="chart">
        <figcaption>Receita por dia</figcaption>
        <div className="bars" aria-hidden="true">{data.daily.map(item => <span key={item.date} title={`${day(item.date)}: ${money(item.revenue, sales.currency)} em ${item.orders} ${item.orders === 1 ? 'pedido' : 'pedidos'}`} style={{ '--bar': `${share(item.revenue, peak)}%` } as CSSProperties} />)}</div>
        <div className="chart-axis" aria-hidden="true"><span>{day(data.since)}</span><span>{day(data.until)}</span></div>
      </figure>
      <details className="daily"><summary>Ver dia a dia</summary>
        <div className="table-wrap"><table>
          <thead><tr><th scope="col">Dia</th><th scope="col">Pedidos</th><th scope="col">Receita</th><th scope="col">Contas novas</th></tr></thead>
          <tbody>{[...data.daily].reverse().map(item => <tr key={item.date}><th scope="row">{day(item.date, '2-digit')}</th><td>{count(item.orders)}</td><td>{money(item.revenue, sales.currency)}</td><td>{count(item.accounts)}</td></tr>)}</tbody>
        </table></div>
      </details>
    </section>
    <section className="section" aria-labelledby="metricas-funil">
      <h2 id="metricas-funil">Funil de compra</h2>
      <p className="note">Pessoas diferentes em cada etapa, no período.</p>
      <ol className="funnel">{steps.map((step, index) => <li key={step.label} style={{ '--bar': `${index === 0 ? (step.value ? 100 : 0) : share(step.value, funnel.cart)}%` } as CSSProperties}>
        <span className="funnel-label">{step.label}</span>
        <strong>{count(step.value)}</strong>
        {index > 0 && <span className="funnel-share">{funnel.cart ? `${share(step.value, funnel.cart)}% da sacola` : '—'}</span>}
        <span className="funnel-bar" aria-hidden="true" />
      </li>)}</ol>
    </section>
    <section className="section" aria-labelledby="metricas-contas">
      <h2 id="metricas-contas">Contas e e-mails</h2>
      <dl className="cards">
        <div><dt>Contas novas</dt><dd>{count(data.accounts)}</dd></div>
        <div><dt>Liberaram os gratuitos</dt><dd>{count(data.free_unlocks)}</dd></div>
        <div><dt>Inscritos em novidades</dt><dd>{count(data.newsletter.subscribed)}</dd><dd className="card-note">Total de hoje, fora do período</dd></div>
      </dl>
    </section>
    <section className="section" aria-labelledby="metricas-downloads">
      <h2 id="metricas-downloads">Downloads</h2>
      <dl className="cards">
        <div><dt>Jogos comprados</dt><dd>{count(data.downloads.paid)}</dd></div>
        <div><dt>Jogos gratuitos</dt><dd>{count(data.downloads.free)}</dd></div>
      </dl>
    </section>
  </>
}
