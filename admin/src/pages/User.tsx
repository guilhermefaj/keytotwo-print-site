import { IconArrowLeft, IconDownload, IconExternalLink } from '@tabler/icons-react'
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { api, ApiError, apiMessage, count, money, useResource } from '../api'
import { formatMoment } from '../blog'
import {
  actionLabel, consentLabel, emailKindLabel, emailStatusLabel, orderStatusLabel, providersLabel, revokeReasonLabel, stripeCustomerUrl,
  suppressionLabel, type LibraryEntry, type UserDetail, type UserOrder,
} from '../users'

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
    const missing = error instanceof ApiError && error.code === 'NOT_FOUND'
    return <>
      <title>Usuários — Admin KeyToTwo</title>
      <BackToList />
      {loading ? <p className="status" role="status">Abrindo a conta…</p>
        : <div className="status-error" role="alert">
          <p>{missing ? 'Esta conta não existe mais. Ela pode ter sido excluída.' : apiMessage(error)}</p>
          {!missing && <button className="button button-secondary" type="button" onClick={reload}>Tentar de novo</button>}
        </div>}
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
      {!guarded && <DeleteAccount account={account} />}
    </section>
  </>
}

const BackToList = () => {
  const back = (useLocation().state as { back?: string } | null)?.back
  return <Link className="back-link" to={back ? `/usuarios?${back}` : '/usuarios'}><IconArrowLeft aria-hidden="true" size={18} stroke={1.75} />Todos os usuários</Link>
}

function Section({ id, title, count: total, children }: { id: string; title: string; count?: number; children: ReactNode }) {
  return <section className="user-section" aria-labelledby={`secao-${id}`}>
    <h2 id={`secao-${id}`}>{title}{total !== undefined && <span className="count"> {total}</span>}</h2>
    {children}
  </section>
}

const Fact = ({ label, children }: { label: string; children: ReactNode }) => <div><dt>{label}</dt><dd>{children}</dd></div>

function historyDetail(details: Record<string, unknown> | null) {
  if (!details) return null
  const parts = [details.product, details.reason].filter((value): value is string => typeof value === 'string')
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
        Pedido {order.ref} · {formatMoment(order.created_at)}
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

// Botão que abre, no lugar, o pedido do motivo e a confirmação. children: campos a mais (a exclusão pede o e-mail).
function ReasonAction({ label, short, confirm, intro, danger = false, onConfirm, children, ready = true }: {
  label: string; short?: string; confirm: string; intro: string; danger?: boolean; ready?: boolean
  onConfirm: (reason: string) => Promise<unknown>; children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false })
  const opener = useRef<HTMLButtonElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const returnFocus = useRef(false)
  const field = useId()
  // Aberto, o foco vai para o primeiro campo (o jogo do presente, o e-mail da exclusão ou o motivo); fechado sem
  // concluir, volta para o botão que abriu.
  useEffect(() => {
    if (open) {
      form.current?.querySelector<HTMLElement>('select, input, textarea')?.focus()
      return
    }
    if (!returnFocus.current) return
    returnFocus.current = false
    opener.current?.focus()
  }, [open])
  const close = () => { returnFocus.current = true; setOpen(false); setReason(''); setState({ busy: false }) }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (reason.trim().length < 3) {
      setState({ busy: false, error: 'Escreva o motivo, de 3 a 300 caracteres. Ele fica no histórico.' })
      return
    }
    setState({ busy: true })
    try {
      await onConfirm(reason.trim())
      setOpen(false)
      setReason('')
      setState({ busy: false })
    } catch (error) {
      setState({ busy: false, error: apiMessage(error) })
    }
  }

  if (!open) return <button ref={opener} className={`text-button${danger ? ' text-button-danger' : ''}`} type="button" onClick={() => setOpen(true)} aria-label={short ? label : undefined}>{short ?? label}</button>
  return <form ref={form} className={`reason-form${danger ? ' reason-form-danger' : ''}`} onSubmit={event => void submit(event)} aria-label={label} noValidate>
    <p>{intro}</p>
    {children}
    <div className="field">
      <label htmlFor={field}>Motivo</label>
      <textarea id={field} value={reason} onChange={event => setReason(event.target.value)} rows={2} maxLength={300}
        aria-invalid={state.error ? true : undefined} aria-describedby={`${field}-ajuda`} />
      <p className="field-help" id={`${field}-ajuda`}>Fica no histórico do admin, com o seu e-mail e a data.</p>
    </div>
    {state.error && <p className="field-error" role="alert">{state.error}</p>}
    <div className="reason-actions">
      <button className={`button ${danger ? 'button-danger' : 'button-primary'}`} type="submit" disabled={state.busy || !ready}>{state.busy ? 'Salvando…' : confirm}</button>
      <button className="button button-secondary" type="button" disabled={state.busy} onClick={close}>Cancelar</button>
    </div>
  </form>
}

// Presente: um produto à venda que a pessoa ainda não tem por inteiro, com o motivo e o e-mail do presente (marcado).
function GiftForm({ user, onDone }: { user: UserDetail; onDone: (text: string) => void }) {
  const options = user.giftable.filter(product => !product.owned)
  const [product, setProduct] = useState('')
  const [notify, setNotify] = useState(true)
  const select = useId()
  const chosen = options.find(option => option.code === product)
  if (!options.length) return <p className="field-help">A conta já tem todos os jogos à venda.</p>
  return <ReasonAction label="Dar um jogo de presente" confirm="Dar o presente" ready={Boolean(chosen)}
    intro="O jogo entra na biblioteca da pessoa na hora, como um pedido de R$ 0 marcado como presente. Não conta nas vendas."
    onConfirm={reason => api<{ email_queued: boolean }>(`/admin/users/${user.account.id}/gifts`, { method: 'POST', body: { product_code: product, reason, notify } })
      .then(result => {
        onDone(`${chosen?.name ?? product} foi dado de presente${result.email_queued ? ' e o e-mail está saindo' : ''}.`)
        setProduct('')
      })}>
    <div className="field">
      <label htmlFor={select}>Jogo</label>
      <select id={select} value={product} onChange={event => setProduct(event.target.value)}>
        <option value="">Escolha um jogo</option>
        {options.map(option => <option key={option.code} value={option.code}>{option.name ?? option.code}{option.kind === 'bundle' ? ' (pacote)' : ''}</option>)}
      </select>
    </div>
    <label className="check-field">
      <input type="checkbox" checked={notify} onChange={event => setNotify(event.target.checked)} />
      <span>Enviar o e-mail do presente, com os links de baixar, para {user.account.email}</span>
    </label>
  </ReasonAction>
}

// Exportar (LGPD): a mesma cópia que a pessoa baixa em Minha conta, num arquivo JSON.
function ExportButton({ userId, confirmed, onDone }: { userId: string; confirmed: boolean; onDone: () => void }) {
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false })
  async function download() {
    setState({ busy: true })
    try {
      const data = await api<unknown>(`/admin/users/${userId}/export`)
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const anchor = Object.assign(document.createElement('a'), { href: url, download: `keytotwo-dados-${userId.slice(0, 8)}.json` })
      anchor.click()
      URL.revokeObjectURL(url)
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
