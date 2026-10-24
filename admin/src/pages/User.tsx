import { IconArrowLeft, IconDownload, IconExternalLink } from '@tabler/icons-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { api, ApiError, apiMessage, useResource } from '../api'
import { count, formatMoment, money } from '../format'
import {
  actionLabel, consentLabel, emailKindLabel, emailStatusLabel, orderStatusLabel, providersLabel, revokeReasonLabel, stripeCustomerUrl,
  suppressionLabel, type LibraryEntry, type UserDetail, type UserOrder,
} from '../users'
import { ReasonAction } from '../ReasonAction'
import { LoadError } from '../LoadError'
import { Fact, Section } from '../Detail'
import { saveJson } from '../../../src/lib/save-json'

// Ficha de uma conta (2026-10-23, Fase 4): conta, jogos, pedidos, novidades, e-mails e o histórico do admin, com as
// ações. Cada ação pede o motivo (vai para o histórico) e, no fim, a ficha é buscada de novo. Bloquear, excluir e
// retirar jogo não aparecem na própria conta nem na de outro admin (a API recusa do mesmo jeito).
export function UserRoute() {
  const { id } = useParams()
  return <UserPage key={id} id={id!} />
}

function UserPage({ id }: { id: string }) {
  const { data, previous, error, loading, reload } = useResource<UserDetail>(`/admin/users/${id}`)
  const user = data ?? (loading ? previous : undefined)
  const [notice, setNotice] = useState<string>()
  const noticeRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (notice) noticeRef.current?.focus() }, [notice])
  const done = (text: string) => { setNotice(text); reload() }

  if (!user) {
    return <>
      <title>Usuários — Admin KeyToTwo</title>
      <BackToList />
      {loading ? <p className="status" role="status">Abrindo a conta…</p>
        : <LoadError error={error} retry={reload} missing="Esta conta não existe mais. Ela pode ter sido excluída." />}
    </>
  }

  const { account } = user
  const guarded = account.self || account.admin
  const livemode = user.orders[0]?.livemode ?? true
  return <>
    <title>{`${account.email} — Admin KeyToTwo`}</title>
    <BackToList />
    <header className="page-heading user-heading">
      <div>
        <p className="user-badges">
          {account.self && <span className="badge">Sua conta</span>}
          {account.admin && <span className="badge badge-published">Admin</span>}
          {account.blocked && <span className="badge badge-danger">Login bloqueado</span>}
          {!account.confirmed_at && <span className="badge">E-mail sem confirmação</span>}
        </p>
        <h1 className="user-email">{account.email}</h1>
        <p>{[account.name, `conta de ${formatMoment(account.created_at)}`, `entra com ${providersLabel(account.providers).replace('Código', 'código')}`].filter(Boolean).join(' · ')}</p>
      </div>
    </header>
    {notice && <p className="notice" role="status" ref={noticeRef} tabIndex={-1}>{notice}</p>}
    {guarded && <p className="note">{account.self ? 'Esta é a sua conta' : 'Esta é uma conta de admin'}: bloquear, excluir e retirar jogos não valem aqui.</p>}

    <Section id="conta" title="Conta">
      <dl className="facts">
        <Fact label="E-mail confirmado">{account.confirmed_at ? formatMoment(account.confirmed_at) : 'Ainda não'}</Fact>
        <Fact label="Último acesso">{account.last_sign_in_at ? formatMoment(account.last_sign_in_at) : 'Nunca entrou'}</Fact>
        <Fact label="Downloads">{user.downloads.count ? `${count(user.downloads.count)}, o último em ${formatMoment(user.downloads.last_at!)}` : 'Nenhum'}</Fact>
        <Fact label="Cliente na Stripe">{account.stripe_customer_id
          ? <a className="text-link" href={stripeCustomerUrl(account.stripe_customer_id, livemode)} target="_blank" rel="noopener">{account.stripe_customer_id}<IconExternalLink aria-hidden="true" size={14} stroke={1.75} /><span className="sr-only"> (abre a Stripe em nova aba)</span></a>
          : 'Ainda não pagou nada'}</Fact>
      </dl>
    </Section>

    <Section id="jogos" title="Jogos" count={user.library.filter(entry => entry.status === 'active').length}>
      {user.library.length === 0 ? <p className="status">Nenhum jogo ainda.</p>
        : <ul className="plain-list">{user.library.map(entry => <LibraryRow key={entry.entitlement_id} entry={entry} userId={account.id} guarded={guarded} onDone={done} />)}</ul>}
      <GiftForm user={user} onDone={done} />
    </Section>

    <Section id="pedidos" title="Pedidos" count={user.orders.length}>
      {user.orders.length === 0 ? <p className="status">Nenhum pedido.</p>
        : <ul className="plain-list">{user.orders.map(order => <OrderRow key={order.id} order={order} userId={account.id} onDone={done} />)}</ul>}
    </Section>

    <Section id="novidades" title="Novidades">
      <p>{user.newsletter.opted_in ? `Recebe as novidades${user.newsletter.opted_in_at ? ` desde ${formatMoment(user.newsletter.opted_in_at)}` : ''}.` : 'Não recebe as novidades.'}</p>
      {user.newsletter.history.length > 0 && <ul className="timeline">{user.newsletter.history.map((entry, index) => <li key={index}><time dateTime={entry.occurred_at}>{formatMoment(entry.occurred_at)}</time> {consentLabel(entry)}</li>)}</ul>}
      {user.newsletter.opted_in && <ReasonAction label="Tirar das novidades" confirm="Tirar das novidades" intro="A pessoa para de receber as novidades na hora, como se tivesse descadastrado."
        onConfirm={reason => api(`/admin/users/${account.id}/newsletter/off`, { method: 'POST', body: { reason } }).then(() => done('A conta saiu das novidades.'))} />}
    </Section>

    <Section id="emails" title="E-mails">
      {user.suppressions.map(entry => <p key={entry.reason} className="status-warning">A Brevo não entrega para este endereço: {suppressionLabel(entry.reason)} ({formatMoment(entry.occurred_at)}).</p>)}
      {user.emails.length === 0 ? <p className="status">Nenhum e-mail ainda.</p>
        : <div className="table-scroll" tabIndex={0} role="region" aria-label="Últimos e-mails">
          <table className="data-table">
            <thead><tr><th scope="col">E-mail</th><th scope="col">Situação</th><th scope="col">Criado</th><th scope="col">Enviado</th></tr></thead>
            <tbody>{user.emails.map((email, index) => <tr key={index}>
              <td>{emailKindLabel(email.kind)}{email.order_ref ? ` · ${email.order_ref}` : ''}</td>
              <td>{emailStatusLabel(email.status, email.skip_reason)}</td>
              <td>{formatMoment(email.created_at)}</td>
              <td>{email.sent_at ? formatMoment(email.sent_at) : '—'}</td>
            </tr>)}</tbody>
          </table>
        </div>}
    </Section>

    <Section id="historico" title="Histórico do admin">
      {user.history.length === 0 ? <p className="status">Ninguém da equipe mexeu nesta conta ainda.</p>
        : <ul className="timeline">{user.history.map((entry, index) => <li key={index}>
          <time dateTime={entry.created_at}>{formatMoment(entry.created_at)}</time> <strong>{actionLabel(entry.action)}</strong>
          {historyDetail(entry.details)}{entry.by && <span className="timeline-by"> · {entry.by}</span>}
        </li>)}</ul>}
    </Section>

    <section className="danger-zone" aria-labelledby="acoes-conta">
      <h2 id="acoes-conta">Dados e acesso</h2>
      <ExportButton userId={account.id} confirmed={Boolean(account.confirmed_at)} onDone={() => setNotice('Os dados foram baixados. A exportação fica no histórico.')} />
      {!guarded && (account.blocked
        ? <ReasonAction label="Desbloquear o login" confirm="Desbloquear" intro="A pessoa volta a poder entrar na conta."
          onConfirm={reason => api(`/admin/users/${account.id}/unblock`, { method: 'POST', body: { reason } }).then(() => done('O login foi desbloqueado.'))} />
        : <ReasonAction label="Bloquear o login" confirm="Bloquear" danger intro="A pessoa não consegue mais entrar nem baixar os jogos. Uma sessão já aberta cai em até 1 hora."
          onConfirm={reason => api(`/admin/users/${account.id}/block`, { method: 'POST', body: { reason } }).then(() => done('O login foi bloqueado.'))} />)}
      {!account.self && <AdminRole account={account} onDone={done} />}
      {!guarded && <DeleteAccount account={account} />}
    </section>
  </>
}

const BackToList = () => {
  const back = (useLocation().state as { back?: string } | null)?.back
  return <Link className="back-link" to={back ? `/usuarios?${back}` : '/usuarios'}><IconArrowLeft aria-hidden="true" size={18} stroke={1.75} />Todos os usuários</Link>
}

function historyDetail(details: Record<string, unknown> | null) {
  if (!details) return null
  const order = typeof details.order_ref === 'string' ? `pedido ${details.order_ref}` : undefined
  const parts = [details.product, order, details.reason].filter((value): value is string => typeof value === 'string')
  return parts.length ? <span>: {parts.join(' · ')}</span> : null
}

function LibraryRow({ entry, userId, guarded, onDone }: { entry: LibraryEntry; userId: string; guarded: boolean; onDone: (text: string) => void }) {
  const active = entry.status === 'active'
  const name = entry.product.name ?? entry.product.code
  return <li className="plain-row">
    <div className="plain-row-main">
      <strong>{name}</strong>
      <span className="plain-row-sub">
        {entry.order.kind === 'courtesy' ? 'Presente' : `Pedido ${entry.order.ref}`} · {formatMoment(entry.granted_at)}
        {entry.product.kind === 'bundle' && ` · ${entry.games.map(game => game.name ?? game.code).join(', ')}`}
      </span>
    </div>
    {active ? <span className="badge badge-published">Com acesso</span>
      : <span className="badge">Retirado: {revokeReasonLabel(entry.revoke_reason)}{entry.revoked_at ? `, ${formatMoment(entry.revoked_at)}` : ''}</span>}
    {active && !guarded && <ReasonAction label={`Retirar ${name}`} short="Retirar" confirm="Retirar o jogo" danger
      intro="O jogo sai da biblioteca da pessoa e os links de baixar param. O pedido não muda: para devolver o dinheiro, faça o reembolso."
      onConfirm={reason => api(`/admin/users/${userId}/entitlements/${entry.entitlement_id}/revoke`, { method: 'POST', body: { reason } }).then(() => onDone(`${name} foi retirado da conta.`))} />}
  </li>
}

function OrderRow({ order, userId, onDone }: { order: UserOrder; userId: string; onDone: (text: string) => void }) {
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false })
  const courtesy = order.kind === 'courtesy'
  async function resend() {
    setState({ busy: true })
    try {
      await api(`/admin/users/${userId}/orders/${order.id}/resend`, { method: 'POST' })
      setState({ busy: false })
      onDone(`O e-mail ${courtesy ? 'do presente' : 'de acesso'} do pedido ${order.ref} foi para a fila de envio.`)
    } catch (error) {
      setState({ busy: false, error: apiMessage(error) })
    }
  }
  return <li className="plain-row">
    <div className="plain-row-main">
      <strong>{order.items.map(item => item.name ?? item.code).join(', ') || 'Sem itens'}</strong>
      <span className="plain-row-sub">
        <Link className="text-link" to={`/pedidos/${order.id}`}>Pedido {order.ref}</Link> · {formatMoment(order.created_at)}
        {order.promotion_code && ` · cupom ${order.promotion_code}`}
        {!order.livemode && ' · teste'}
      </span>
      {state.error && <p className="field-error" role="alert">{state.error}</p>}
    </div>
    <span className={`badge${order.status === 'paid' ? ' badge-published' : ''}`}>{orderStatusLabel(order)}</span>
    <span className="plain-row-amount">{courtesy ? 'R$ 0' : order.amount_total !== null && order.currency ? money(order.amount_total, order.currency) : '—'}</span>
    {order.deliverable && <button className="text-button" type="button" disabled={state.busy} onClick={() => void resend()}>
      {state.busy ? 'Reenviando…' : 'Reenviar o e-mail'}<span className="sr-only"> de acesso do pedido {order.ref}</span>
    </button>}
  </li>
}

// "A", "A e B", "A, B e C"
const listNames = (names: string[]) => (names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`)

// Presente: um ou mais produtos à venda que a pessoa ainda não tem por inteiro, num pedido de R$ 0 e num e-mail só.
// Um pacote e um jogo que já vem nele não vão juntos (a API recusa e diz quais; aqui os nomes trocam os códigos).
function GiftForm({ user, onDone }: { user: UserDetail; onDone: (text: string) => void }) {
  const options = user.giftable.filter(product => !product.owned)
  const [chosen, setChosen] = useState<string[]>([])
  const [notify, setNotify] = useState(true)
  const legend = useId()
  const nameOf = (code: string) => user.giftable.find(product => product.code === code)?.name ?? code
  if (!options.length) return <p className="field-help">A conta já tem todos os jogos à venda.</p>
  const toggle = (code: string, on: boolean) => setChosen(current => (on ? [...current, code] : current.filter(item => item !== code)))
  async function give(reason: string) {
    try {
      const result = await api<{ email_queued: boolean }>(`/admin/users/${user.account.id}/gifts`, { method: 'POST', body: { product_codes: chosen, reason, notify } })
      const names = listNames(chosen.map(nameOf))
      onDone(`${names} ${chosen.length > 1 ? 'foram dados' : 'foi dado'} de presente${result.email_queued ? ' e o e-mail está saindo' : ''}.`)
      setChosen([])
    } catch (error) {
      const products = error instanceof ApiError && Array.isArray(error.details?.products) ? error.details.products as string[] : []
      if (!products.length) throw error
      const names = listNames(products.map(nameOf))
      const text = error instanceof ApiError && error.code === 'GIFT_OVERLAP' ? `${names} têm jogo em comum (um pacote e um jogo que já vem nele). Escolha só um.`
        : error instanceof ApiError && error.code === 'ALREADY_OWNED' ? `A pessoa já tem todos os jogos de ${names}.`
          : `Fora da venda agora: ${names}.`
      throw new ApiError((error as ApiError).code, text)
    }
  }
  return <ReasonAction label="Dar um jogo de presente" confirm={chosen.length > 1 ? `Dar os ${chosen.length} presentes` : 'Dar o presente'} ready={chosen.length > 0}
    intro="Os jogos entram na biblioteca da pessoa na hora, num pedido de R$ 0 marcado como presente. Não contam nas vendas."
    onConfirm={give}>
    <fieldset className="check-group" aria-describedby={legend}>
      <legend>Jogos</legend>
      <p className="field-help" id={legend}>Marque um ou mais. Um pacote já traz os jogos dele.</p>
      {options.map(option => <label key={option.code} className="check-field">
        <input type="checkbox" checked={chosen.includes(option.code)} onChange={event => toggle(option.code, event.target.checked)} />
        <span>{option.name ?? option.code}{option.kind === 'bundle' ? ' (pacote)' : ''}</span>
      </label>)}
    </fieldset>
    <label className="check-field">
      <input type="checkbox" checked={notify} onChange={event => setNotify(event.target.checked)} />
      <span>Enviar o e-mail do presente, com os links de baixar, para {user.account.email}</span>
    </label>
  </ReasonAction>
}

// Equipe: tornar admin ou tirar o admin (não aparece na própria conta). Vale no banco na hora; a pessoa vê o admin
// quando entrar de novo e cadastra o segundo fator no primeiro acesso.
function AdminRole({ account, onDone }: { account: UserDetail['account']; onDone: (text: string) => void }) {
  if (account.admin) {
    return <ReasonAction label="Remover admin" confirm="Remover admin" danger intro="A pessoa perde o acesso ao admin na hora. A conta dela na loja continua igual."
      onConfirm={reason => api(`/admin/users/${account.id}/admin`, { method: 'POST', body: { admin: false, reason } }).then(() => onDone('A conta saiu da equipe.'))} />
  }
  return <ReasonAction label="Tornar admin" confirm="Tornar admin" ready={Boolean(account.confirmed_at) && !account.blocked}
    intro={account.confirmed_at && !account.blocked
      ? 'A pessoa passa a ver e mudar tudo no admin: contas, presentes, exclusões, blog e métricas. Ela cadastra o app autenticador no primeiro acesso.'
      : 'Só vira admin uma conta com o e-mail confirmado e sem bloqueio.'}
    onConfirm={reason => api(`/admin/users/${account.id}/admin`, { method: 'POST', body: { admin: true, reason } }).then(() => onDone('A conta entrou na equipe. A pessoa vê o admin quando entrar de novo.'))} />
}

// Exportar (LGPD): a mesma cópia que a pessoa baixa em Minha conta, num arquivo JSON.
function ExportButton({ userId, confirmed, onDone }: { userId: string; confirmed: boolean; onDone: () => void }) {
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false })
  async function download() {
    setState({ busy: true })
    try {
      const data = await api<unknown>(`/admin/users/${userId}/export`)
      saveJson(data, `keytotwo-dados-${userId.slice(0, 8)}.json`)
      setState({ busy: false })
      onDone()
    } catch (error) {
      setState({ busy: false, error: apiMessage(error) })
    }
  }
  if (!confirmed) return <p className="field-help">Exportar os dados vale só para contas com o e-mail confirmado.</p>
  return <div className="inline-action">
    <button className="text-button" type="button" disabled={state.busy} onClick={() => void download()}>
      <IconDownload aria-hidden="true" size={16} stroke={1.75} />{state.busy ? 'Preparando…' : 'Exportar os dados (LGPD)'}
    </button>
    {state.error && <p className="field-error" role="alert">{state.error}</p>}
  </div>
}

// Excluir a pedido (LGPD): o motivo e o e-mail da conta digitado. Depois, de volta à lista.
function DeleteAccount({ account }: { account: UserDetail['account'] }) {
  const navigate = useNavigate()
  const [typed, setTyped] = useState('')
  const field = useId()
  const matches = typed.trim().toLowerCase() === account.email.toLowerCase()
  return <ReasonAction label="Excluir a conta" confirm="Excluir de vez" danger ready={matches}
    intro="A conta sai do Auth e os dados pessoais são apagados; os pedidos ficam anonimizados, como a lei fiscal pede. É o mesmo da exclusão pela própria pessoa. Não dá para desfazer."
    onConfirm={reason => api<{ orders_anonymized: number }>(`/admin/users/${account.id}/delete`, { method: 'POST', body: { reason, confirm_email: typed.trim() } })
      .then(result => navigate('/usuarios', { state: { notice: `A conta ${account.email} foi excluída${result.orders_anonymized ? ` e ${result.orders_anonymized} ${result.orders_anonymized === 1 ? 'pedido ficou anonimizado' : 'pedidos ficaram anonimizados'}` : ''}.` } }))}>
    <div className="field">
      <label htmlFor={field}>Digite o e-mail da conta para confirmar</label>
      <input id={field} type="email" value={typed} onChange={event => setTyped(event.target.value)} autoComplete="off" spellCheck={false} />
    </div>
  </ReasonAction>
}
