import { IconSearch } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { apiMessage, count, useResource } from '../api'
import { formatMoment, formatShortDate } from '../blog'
import { providersLabel, type UserFilter, type UserList, type UserSummary } from '../users'
import { UsersHeader } from './UsersHeader'

const filters: { value: UserFilter; label: string }[] = [
  { value: 'all', label: 'Todas' }, { value: 'buyers', label: 'Com compra' }, { value: 'newsletter', label: 'Nas novidades' }, { value: 'blocked', label: 'Bloqueadas' },
]
const isFilter = (value: string | null): value is UserFilter => filters.some(filter => filter.value === value)

// Contas (2026-10-23): a primeira aba de Usuários. A equipe tem a aba dela (Equipe).

// Usuários (2026-10-23, Fase 4): as contas da loja, da mais nova à mais antiga, 50 por página. Busca, filtro e página
// ficam no endereço (?q=&filter=&page=): voltar da ficha de uma pessoa cai na mesma lista.
export function UsersPage() {
  const [params, setParams] = useSearchParams()
  const notice = (useLocation().state as { notice?: string } | null)?.notice
  const query = params.get('q') ?? ''
  const filter = isFilter(params.get('filter')) ? params.get('filter') as UserFilter : 'all'
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const [draft, setDraft] = useState(query)
  const search = new URLSearchParams({ ...(query ? { q: query } : {}), filter, page: String(page) })
  const { data, previous, error, loading, reload } = useResource<UserList>(`/admin/users?${search}`)
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
  const first = list && list.users.length ? list.offset + 1 : 0
  const last = list ? list.offset + list.users.length : 0
  return <>
    <title>Usuários — Admin KeyToTwo</title>
    <UsersHeader text="As contas da loja: como entram, o que compraram e o que têm. Abra uma conta para ver tudo e agir." />
    <div className="toolbar users-toolbar">
      <form role="search" className="search-field" onSubmit={event => { event.preventDefault(); update({ q: draft.trim(), page: '1' }) }}>
        <IconSearch aria-hidden="true" size={18} stroke={1.75} />
        <label className="sr-only" htmlFor="busca-usuarios">Buscar pelo e-mail</label>
        <input id="busca-usuarios" type="search" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Buscar pelo e-mail" autoComplete="off" spellCheck={false} />
      </form>
      <div className="periods" role="group" aria-label="Mostrar">
        {filters.map(({ value, label }) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => update({ filter: value, page: '1' })}>{label}</button>)}
      </div>
    </div>
    {notice && <p className="notice" role="status">{notice}</p>}
    {loading && !list && <p className="status" role="status">Carregando as contas…</p>}
    {!loading && error !== undefined && <div className="status-error" role="alert"><p>{apiMessage(error)}</p><button className="button button-secondary" type="button" onClick={reload}>Tentar de novo</button></div>}
    {list && (list.users.length === 0
      ? <p className="status" role="status">{query ? 'Nenhuma conta com esse e-mail.' : 'Nenhuma conta neste filtro.'}</p>
      : <>
        <p className="range" role="status">{loading ? 'Atualizando…' : `${count(first)}–${count(last)} de ${count(list.total)} ${list.total === 1 ? 'conta' : 'contas'}`}</p>
        <ul className="user-list" aria-label="Contas" aria-busy={loading}>
          {list.users.map(user => <UserRow key={user.id} user={user} back={search.toString()} />)}
        </ul>
        {pages > 1 && <nav className="pager" aria-label="Páginas">
          <button className="button button-secondary" type="button" disabled={page <= 1 || loading} onClick={() => update({ page: String(page - 1) })}>Anterior</button>
          <span>Página {page} de {pages}</span>
          <button className="button button-secondary" type="button" disabled={page >= pages || loading} onClick={() => update({ page: String(page + 1) })}>Próxima</button>
        </nav>}
      </>)}
  </>
}

function UserRow({ user, back }: { user: UserSummary; back: string }) {
  return <li className="user-row">
    <div className="user-row-main">
      <Link className="user-row-title" to={`/usuarios/${user.id}`} state={{ back }}>{user.email}</Link>
      <span className="user-row-sub">{providersLabel(user.providers)} · conta de {formatShortDate(user.created_at.slice(0, 10))}</span>
    </div>
    <span className="user-badges">
      {user.admin && <span className="badge badge-published">Admin</span>}
      {user.blocked && <span className="badge badge-danger">Bloqueada</span>}
      {!user.confirmed && <span className="badge">Sem confirmação</span>}
    </span>
    <dl className="user-row-meta">
      <div><dt>Último acesso</dt><dd>{user.last_sign_in_at ? <time dateTime={user.last_sign_in_at}>{formatMoment(user.last_sign_in_at)}</time> : '—'}</dd></div>
      <div><dt>Compras</dt><dd>{count(user.purchases)}</dd></div>
      <div><dt>Jogos</dt><dd>{count(user.games)}</dd></div>
      <div><dt>Novidades</dt><dd>{user.newsletter ? 'Sim' : 'Não'}</dd></div>
    </dl>
  </li>
}
