import { useId, useState } from 'react'
import { Link } from 'react-router'
import { api, ApiError, apiMessage, useResource } from '../api'
import { formatMoment } from '../blog'
import { ReasonAction } from '../ReasonAction'
import { useSession } from '../session'
import { providersLabel, type UserList, type UserSummary } from '../users'
import { UsersHeader } from './UsersHeader'

// Equipe (2026-10-23): quem é admin, com Remover admin (menos na própria conta) e Adicionar à equipe pelo e-mail de uma
// conta que já existe. Vale no banco na hora; a pessoa vê o admin quando entrar de novo e cadastra o segundo fator.
export function TeamPage() {
  const session = useSession()
  const { data, previous, error, loading, reload } = useResource<UserList>('/admin/users?filter=admins&page=1')
  const team = data ?? (loading ? previous : undefined)
  const [notice, setNotice] = useState<string>()
  const done = (text: string) => { setNotice(text); reload() }
  return <>
    <title>Equipe — Admin KeyToTwo</title>
    <UsersHeader text="Quem é admin: vê e muda tudo aqui (contas, blog e métricas). Toda mudança na equipe fica no histórico da conta." />
    {notice && <p className="notice" role="status">{notice}</p>}
    {loading && !team && <p className="status" role="status">Carregando a equipe…</p>}
    {!loading && error !== undefined && <div className="status-error" role="alert"><p>{apiMessage(error)}</p><button className="button button-secondary" type="button" onClick={reload}>Tentar de novo</button></div>}
    {team && <ul className="plain-list" aria-label="Admins">
      {team.users.map(user => <TeamRow key={user.id} user={user} self={user.id === session.user.id} onDone={done} />)}
    </ul>}
    <section className="user-section" aria-labelledby="adicionar-titulo">
      <h2 id="adicionar-titulo">Adicionar à equipe</h2>
      <AddAdmin onDone={done} />
    </section>
  </>
}

function TeamRow({ user, self, onDone }: { user: UserSummary; self: boolean; onDone: (text: string) => void }) {
  return <li className="plain-row">
    <div className="plain-row-main">
      <Link className="user-row-title" to={`/usuarios/${user.id}`}>{user.email}</Link>
      <span className="plain-row-sub">{providersLabel(user.providers)} · último acesso {user.last_sign_in_at ? formatMoment(user.last_sign_in_at) : 'nunca'}</span>
    </div>
    {self ? <span className="badge">Você</span>
      : <ReasonAction label={`Remover ${user.email} da equipe`} short="Remover admin" confirm="Remover admin" danger
        intro="A pessoa perde o acesso ao admin na hora. A conta dela na loja continua igual."
        onConfirm={reason => api(`/admin/users/${user.id}/admin`, { method: 'POST', body: { admin: false, reason } }).then(() => onDone(`${user.email} saiu da equipe.`))} />}
  </li>
}

// Promover pelo e-mail: acha a conta (a pessoa precisa ter entrado na loja uma vez) e promove com o motivo.
function AddAdmin({ onDone }: { onDone: (text: string) => void }) {
  const [email, setEmail] = useState('')
  const field = useId()
  async function promote(reason: string) {
    const wanted = email.trim().toLowerCase()
    const found = await api<UserList>(`/admin/users?${new URLSearchParams({ q: wanted, filter: 'all', page: '1' })}`)
    const user = found.users.find(candidate => candidate.email.toLowerCase() === wanted)
    if (!user) throw new ApiError('NOT_FOUND', 'Nenhuma conta com esse e-mail. A pessoa precisa entrar na loja uma vez antes.')
    await api(`/admin/users/${user.id}/admin`, { method: 'POST', body: { admin: true, reason } })
    setEmail('')
    onDone(`${user.email} entrou na equipe. Ela vê o admin quando entrar de novo e cadastra o app autenticador no primeiro acesso.`)
  }
  return <ReasonAction label="Adicionar à equipe" confirm="Tornar admin" ready={/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())}
    intro="A pessoa passa a ver e mudar tudo no admin: contas, presentes, exclusões, blog e métricas. Só conta com e-mail confirmado vira admin."
    onConfirm={promote}>
    <div className="field">
      <label htmlFor={field}>E-mail da conta</label>
      <input id={field} type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="off" spellCheck={false} />
    </div>
  </ReasonAction>
}
