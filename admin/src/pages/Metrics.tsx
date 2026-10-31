import { useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { useAlertsContext } from '../alerts'
import { useResource } from '../api'
import { count, money } from '../format'
import { LoadError } from '../LoadError'

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
  marketing: {
    codes: { code: string; orders: number; revenue: number; discount: number }[]
    partners: { name: string; slug: string; orders: number; revenue: number }[]
    campaigns: { source: string | null; campaign: string | null; orders: number; revenue: number }[]
  }
  // Uso da infraestrutura (2026-10-25); a API antiga não manda.
  usage?: Usage
}

type UsageArea = 'public' | 'account' | 'admin' | 'webhooks' | 'schedule'
type Usage = {
  month_start: string
  calls_month: number
  by_area: Record<UsageArea, number>
  daily: { date: string; calls: number }[]
  peak_hour: { hour: string; calls: number } | null
  database_bytes: number
  active_accounts_month: number
}

// Limites do plano grátis do Supabase (2026-10): mudar aqui se o plano mudar.
const FREE_PLAN = { calls: 500_000, databaseBytes: 500 * 1024 * 1024, activeAccounts: 50_000 }
const AREAS: [UsageArea, string][] = [
  ['public', 'Loja, sem login'],
  ['account', 'Contas, com login'],
  ['admin', 'Admin'],
  ['webhooks', 'Avisos da Stripe e dos e-mails'],
  ['schedule', 'Agenda do banco'],
]
const megabytes = (bytes: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)
const thousands = (value: number) => `${count(value / 1000)} mil`
const hourOf = (value: string) => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(value))

const periods = [7, 30] as const
// As datas já são dias de Brasília (AAAA-MM-DD); meio-dia em UTC não muda o dia em nenhum fuso.
const day = (value: string, month: 'short' | '2-digit' = 'short') => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month, timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`))
const share = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.round(part / whole * 100)) : 0)

export function MetricsPage() {
  const [days, setDays] = useState<typeof periods[number]>(7)
  const metrics = useResource<Metrics>(`/admin/metrics?days=${days}`)
  const data = metrics.data
  const alerts = useAlertsContext()
  const open = (alerts.data ?? alerts.previous)?.open?.length ?? 0
  return <>
    <title>Métricas — Admin KeyToTwo</title>
    <header className="page-heading"><h1>Métricas</h1><p>Como a loja está indo: vendas, contas, funil e downloads.</p></header>
    {open > 0 && <p className="notice"><Link className="text-link" to="/atencao">{open > 1 ? `${open} alertas precisam` : '1 alerta precisa'} de atenção</Link></p>}
    <div className="toolbar">
      <div className="periods" role="group" aria-label="Período">{periods.map(value => <button key={value} type="button" aria-pressed={days === value} onClick={() => setDays(value)}>{value} dias</button>)}</div>
      {data && <p className="range">{day(data.since)} a {day(data.until)}, contando hoje{!data.livemode && <> · <strong>vendas do modo de teste da Stripe</strong></>}</p>}
    </div>
    {metrics.loading && <p className="status" role="status">Carregando…</p>}
    {Boolean(metrics.error) && <LoadError error={metrics.error} retry={metrics.reload} />}
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
    <Marketing data={data} />
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
    {data.usage && <UsageSection usage={data.usage} />}
  </>
}

// Uso da infraestrutura (2026-10-25): o que a loja usa do plano grátis do Supabase no mês, contado pelas próprias
// funções (private.api_usage); o tamanho do banco e as contas que entraram vêm do banco na hora.
function UsageSection({ usage }: { usage: Usage }) {
  const meters = [
    { label: 'Chamadas às funções', value: `${count(usage.calls_month)} de ${thousands(FREE_PLAN.calls)}`, part: usage.calls_month, whole: FREE_PLAN.calls },
    { label: 'Tamanho do banco', value: `${megabytes(usage.database_bytes)} MB de ${megabytes(FREE_PLAN.databaseBytes)} MB`, part: usage.database_bytes, whole: FREE_PLAN.databaseBytes },
    { label: 'Contas que entraram no mês', value: `${count(usage.active_accounts_month)} de ${thousands(FREE_PLAN.activeAccounts)}`, part: usage.active_accounts_month, whole: FREE_PLAN.activeAccounts },
  ]
  const peak = Math.max(...usage.daily.map(item => item.calls), 0)
  const first = usage.daily[0]?.date
  const last = usage.daily.at(-1)?.date
  return <section className="section" aria-labelledby="metricas-uso">
    <h2 id="metricas-uso">Uso da infraestrutura</h2>
    <p className="note">O que a loja usa do plano grátis do Supabase neste mês, desde o dia 1º. As chamadas são contadas pela própria loja; o painel do Supabase pode mostrar números um pouco diferentes.</p>
    <ul className="meters">{meters.map(meter => {
      const percent = share(meter.part, meter.whole)
      return <li key={meter.label} style={{ '--bar': `${meter.part > 0 ? Math.max(percent, 1) : 0}%` } as CSSProperties}>
        <span>{meter.label}</span>
        <strong>{meter.value}</strong>
        <span className="meter-share">{percent >= 80 ? `${percent}% do limite: perto de acabar` : `${percent}% do limite`}</span>
        <span className="meter-bar" aria-hidden="true" />
      </li>
    })}</ul>
    {first && last && <figure className="chart">
      <figcaption>Chamadas por dia</figcaption>
      <div className="bars" aria-hidden="true">{usage.daily.map(item => <span key={item.date} title={`${day(item.date)}: ${count(item.calls)} ${item.calls === 1 ? 'chamada' : 'chamadas'}`} style={{ '--bar': `${share(item.calls, peak)}%` } as CSSProperties} />)}</div>
      <div className="chart-axis" aria-hidden="true"><span>{day(first)}</span><span>{day(last)}</span></div>
    </figure>}
    <div className="table-wrap"><table className="data-table" aria-label="Chamadas neste mês, por tipo">
      <thead><tr><th scope="col">Tipo</th><th scope="col">Chamadas</th></tr></thead>
      <tbody>{AREAS.map(([area, label]) => <tr key={area}><th scope="row">{label}</th><td>{count(usage.by_area[area] ?? 0)}</td></tr>)}</tbody>
    </table></div>
    <p className="note">{usage.peak_hour
      ? `Hora mais movimentada nas últimas 24 horas: ${count(usage.peak_hour.calls)} ${usage.peak_hour.calls === 1 ? 'chamada' : 'chamadas'}, às ${hourOf(usage.peak_hour.hour)}h.`
      : 'Nenhuma chamada nas últimas 24 horas.'}</p>
  </section>
}

// Cupons, parceiros e campanhas (2026-10-24): as vendas pagas do período que usaram um cupom, vieram de um parceiro
// (pelo link ou pelo cupom) ou chegaram com marcas de campanha (utm_source, utm_campaign).
function Marketing({ data }: { data: Metrics }) {
  const { codes, partners, campaigns } = data.marketing
  const currency = data.sales.currency
  const table = (label: string, head: string, rows: { key: string; name: string; orders: number; revenue: number; extra?: string }[], extra?: string) => rows.length > 0 && <div className="table-wrap"><table className="data-table" aria-label={label}>
    <thead><tr><th scope="col">{head}</th><th scope="col">Pedidos</th><th scope="col">Receita</th>{extra && <th scope="col">{extra}</th>}</tr></thead>
    <tbody>{rows.map(row => <tr key={row.key}><th scope="row">{row.name}</th><td>{count(row.orders)}</td><td>{money(row.revenue, currency)}</td>{extra && <td>{row.extra}</td>}</tr>)}</tbody>
  </table></div>
  return <section className="section" aria-labelledby="metricas-cupons">
    <h2 id="metricas-cupons">Cupons e parceiros</h2>
    {!codes.length && !partners.length && !campaigns.length ? <p className="note">Nenhuma venda com cupom, parceiro ou campanha no período.</p> : <>
      {table('Vendas por cupom', 'Cupom', codes.map(row => ({ key: row.code, name: row.code, orders: row.orders, revenue: row.revenue, extra: money(row.discount, currency) })), 'Desconto')}
      {table('Vendas por parceiro', 'Parceiro', partners.map(row => ({ key: row.slug, name: row.name, orders: row.orders, revenue: row.revenue })))}
      {table('Vendas por campanha', 'Origem e campanha', campaigns.map(row => ({ key: `${row.source}:${row.campaign}`, name: [row.source, row.campaign].filter(Boolean).join(' · '), orders: row.orders, revenue: row.revenue })))}
    </>}
    <p className="note"><Link className="text-link" to="/cupons">Ver os cupons e os parceiros</Link></p>
  </section>
}
