import { IconDownload, IconSearch } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { api, apiMessage, useResource } from '../api'
import { csvMoney, saveCsv } from '../csv'
import { count, formatMoment, money, relativeMoment } from '../format'
import type { OrderFilter, OrderList, OrderSummary } from '../orders'
import { orderStatusLabel } from '../users'
import { LoadError } from '../LoadError'

const filters: { value: OrderFilter; label: string }[] = [
  { value: 'all', label: 'Todos' }, { value: 'paid', label: 'Pagos' }, { value: 'pending', label: 'Em andamento' },
  { value: 'abandoned', label: 'Abandonados' }, { value: 'refunded', label: 'Reembolsados' }, { value: 'disputed', label: 'Contestados' },
  { value: 'courtesy', label: 'Presentes' },
]
const isFilter = (value: string | null): value is OrderFilter => filters.some(filter => filter.value === value)

// Pedidos (2026-10-24, Fase 3): os do modo da Stripe deste ambiente, do mais novo ao mais antigo, 50 por página. Busca
// pelo código do pedido ou pelo e-mail; busca, filtro e página ficam no endereço (voltar da ficha cai na mesma lista).
export function OrdersPage() {
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const filter = isFilter(params.get('filter')) ? params.get('filter') as OrderFilter : 'all'
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const [draft, setDraft] = useState(query)
  // A busca pode chegar de fora (a busca rápida da barra lateral): o campo acompanha.
  const [seenQuery, setSeenQuery] = useState(query)
  if (seenQuery !== query) {
    setSeenQuery(query)
    setDraft(query)
  }
  const search = new URLSearchParams({ ...(query ? { q: query } : {}), filter, page: String(page) })
  const { data, previous, error, loading, reload } = useResource<OrderList>(`/admin/orders?${search}`)
  const list = data ?? (loading ? previous : undefined)

  // A busca vai para o endereço meio segundo depois da última tecla, e a lista volta à primeira página.
  useEffect(() => {
    if (draft.trim() === query) return
    const timer = setTimeout(() => update({ q: draft.trim(), page: '1' }), 500)
    return () => clearTimeout(timer)
  })
  function update(next: Record<string, string>) {
    const merged = new URLSearchParams(params)
    for (const [key, value] of Object.entries(next)) {
      if (value && !(key === 'filter' && value === 'all') && !(key === 'page' && value === '1')) merged.set(key, value)
      else merged.delete(key)
    }
    setParams(merged, { replace: true })
  }

  const pages = list ? Math.max(1, Math.ceil(list.total / list.limit)) : 1
  const first = list && list.orders.length ? list.offset + 1 : 0
  const last = list ? list.offset + list.orders.length : 0
  return <>
    <title>Pedidos — Admin KeyToTwo</title>
    <header className="page-heading">
      <h1>Pedidos e reembolsos</h1>
      <p>Os pedidos da loja e o que aconteceu com cada um. Abra um pedido para reembolsar, reenviar o acesso ou conferir com a Stripe.</p>
    </header>
    <div className="toolbar users-toolbar">
      <form role="search" className="search-field" onSubmit={event => { event.preventDefault(); update({ q: draft.trim(), page: '1' }) }}>
        <IconSearch aria-hidden="true" size={18} stroke={1.75} />
        <label className="sr-only" htmlFor="busca-pedidos">Buscar pelo código do pedido ou pelo e-mail</label>
        <input id="busca-pedidos" type="search" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Código do pedido ou e-mail" autoComplete="off" spellCheck={false} />
      </form>
      <div className="periods" role="group" aria-label="Mostrar">
        {filters.map(({ value, label }) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => update({ filter: value, page: '1' })}>{label}</button>)}
      </div>
      <ExportOrders query={query} filter={filter} disabled={!list?.total} />
    </div>
    {loading && !list && <p className="status" role="status">Carregando os pedidos…</p>}
    {!loading && error !== undefined && <LoadError error={error} retry={reload} />}
    {list && (list.orders.length === 0
      ? <p className="status" role="status">{query ? 'Nenhum pedido com esse código ou e-mail.' : 'Nenhum pedido neste filtro.'}</p>
      : <>
        <p className="range" role="status">{loading ? 'Atualizando…' : `${count(first)}–${count(last)} de ${count(list.total)} ${list.total === 1 ? 'pedido' : 'pedidos'}`}</p>
        <ul className="user-list" aria-label="Pedidos" aria-busy={loading}>
          {list.orders.map(order => <OrderRow key={order.id} order={order} back={search.toString()} />)}
        </ul>
        {pages > 1 && <nav className="pager" aria-label="Páginas">
          <button className="button button-secondary" type="button" disabled={page <= 1 || loading} onClick={() => update({ page: String(page - 1) })}>Anterior</button>
          <span>Página {page} de {pages}</span>
          <button className="button button-secondary" type="button" disabled={page >= pages || loading} onClick={() => update({ page: String(page + 1) })}>Próxima</button>
        </nav>}
      </>)}
  </>
}

function OrderRow({ order, back }: { order: OrderSummary; back: string }) {
  const courtesy = order.kind === 'courtesy'
  return <li className="plain-row order-row">
    <div className="plain-row-main">
      <Link className="user-row-title" to={`/pedidos/${order.id}`} state={{ back }}>Pedido {order.ref}</Link>
      <span className="plain-row-sub">{order.email ?? 'Conta excluída'} · {relativeMoment(order.created_at)}</span>
      <span className="plain-row-sub">{order.items.join(', ') || 'Sem itens'}{order.promotion_code ? ` · cupom ${order.promotion_code}` : ''}</span>
    </div>
    <span className={`badge${order.status === 'paid' ? ' badge-published' : order.status === 'refunded' || order.status.startsWith('dispute') ? ' badge-danger' : ''}`}>{orderStatusLabel(order)}</span>
    <span className="plain-row-amount">{courtesy ? 'R$ 0' : order.amount_total !== null && order.currency ? money(order.amount_total, order.currency) : '—'}</span>
  </li>
}

// Baixar CSV (revisão de UX, 2026-10-31): todos os pedidos da busca e do filtro de agora, página por página (até 2 mil),
// numa planilha para a contabilidade.
function ExportOrders({ query, filter, disabled }: { query: string; filter: OrderFilter; disabled: boolean }) {
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false })
  async function download() {
    setState({ busy: true })
    try {
      const orders: OrderSummary[] = []
      for (let page = 1; page <= 40; page++) {
        const list = await api<OrderList>(`/admin/orders?${new URLSearchParams({ ...(query ? { q: query } : {}), filter, page: String(page) })}`)
        orders.push(...list.orders)
        if (!list.orders.length || orders.length >= list.total) break
      }
      saveCsv(`pedidos-${filter}-${new Date().toISOString().slice(0, 10)}.csv`, [
        ['Pedido', 'Data', 'E-mail', 'Situação', 'Itens', 'Cupom', 'Valor (R$)'],
        ...orders.map(order => [order.ref, formatMoment(order.created_at), order.email ?? 'Conta excluída', orderStatusLabel(order), order.items.join(', '),
          order.promotion_code ?? '', order.kind === 'courtesy' ? '0,00' : csvMoney(order.amount_total)]),
      ])
      setState({ busy: false })
    } catch (error) {
      setState({ busy: false, error: apiMessage(error) })
    }
  }
  return <div className="toolbar-end">
    <button className="button button-secondary button-small" type="button" disabled={disabled || state.busy} onClick={() => void download()}>
      <IconDownload aria-hidden="true" size={16} stroke={1.75} />{state.busy ? 'Preparando…' : 'Baixar CSV'}
    </button>
    {state.error && <p className="field-error" role="alert">{state.error}</p>}
  </div>
}

