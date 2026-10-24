import { IconArrowLeft, IconExternalLink } from '@tabler/icons-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { api, apiMessage, useResource } from '../api'
import { count, formatMoment, money } from '../format'
import { eventLabel, stripePaymentUrl, type OrderDetail } from '../orders'
import { actionLabel, emailKindLabel, emailStatusLabel, orderStatusLabel, revokeReasonLabel, stripeCustomerUrl } from '../users'
import { ReasonAction } from '../ReasonAction'
import { LoadError } from '../LoadError'
import { Fact, Section } from '../Detail'

// Ficha de um pedido (2026-10-24, Fase 3): valores, pessoa, itens, jogos, linha do tempo, e-mails e o histórico do
// admin, com as ações: reenviar o acesso, conferir com a Stripe (pedido aberto aqui) e reembolsar o pedido inteiro.
// Cada ação que muda algo pede o motivo; no fim, a ficha é buscada de novo.
export function OrderRoute() {
  const { id } = useParams()
  return <OrderPage key={id} id={id!} />
}

function OrderPage({ id }: { id: string }) {
  const { data, previous, error, loading, reload } = useResource<OrderDetail>(`/admin/orders/${id}`)
  const detail = data ?? (loading ? previous : undefined)
  const [notice, setNotice] = useState<string>()
  const noticeRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (notice) noticeRef.current?.focus() }, [notice])
  const done = (text: string) => { setNotice(text); reload() }

  if (!detail) {
    return <>
      <title>Pedidos — Admin KeyToTwo</title>
      <BackToList />
      {loading ? <p className="status" role="status">Abrindo o pedido…</p>
        : <LoadError error={error} retry={reload} missing="Este pedido não existe." />}
    </>
  }

  const { order, person } = detail
  const courtesy = order.kind === 'courtesy'
  const amount = (value: number | null) => (value !== null && order.currency ? money(value, order.currency) : '—')
  return <>
    <title>{`Pedido ${order.ref} — Admin KeyToTwo`}</title>
    <BackToList />
    <header className="page-heading user-heading">
      <div>
        <p className="user-badges">
          <span className={`badge${order.status === 'paid' ? ' badge-published' : order.status === 'refunded' || order.status.startsWith('dispute') ? ' badge-danger' : ''}`}>{orderStatusLabel(order)}</span>
          {!order.livemode && <span className="badge">Teste</span>}
        </p>
        <h1>Pedido {order.ref}</h1>
        <p>
          {formatMoment(order.created_at)} · {person.exists && person.id
            ? <Link className="text-link" to={`/usuarios/${person.id}`}>{person.email}</Link>
            : `conta excluída${person.order_email ? ` (${person.order_email})` : ''}`}
        </p>
      </div>
    </header>
    {notice && <p className="notice" role="status" ref={noticeRef} tabIndex={-1}>{notice}</p>}

    <Section id="valores" title="Valores">
      <dl className="facts">
        {courtesy ? <Fact label="Total">Presente da KeyToTwo, sem cobrança</Fact> : <>
          <Fact label="Subtotal">{amount(order.amount_subtotal)}</Fact>
          <Fact label="Desconto">{order.amount_discount ? `${amount(order.amount_discount)}${order.promotion_code ? `, cupom ${order.promotion_code}` : ''}` : 'Nenhum'}</Fact>
          <Fact label="Total cobrado">{amount(order.amount_total)}</Fact>
        </>}
        <Fact label="Pago em">{order.paid_at ? formatMoment(order.paid_at) : 'Ainda não'}</Fact>
        {order.refunded_at && <Fact label="Reembolsado em">{formatMoment(order.refunded_at)}</Fact>}
        {order.terms_version && <Fact label="Termos aceitos">{`${order.terms_version}${order.terms_accepted_at ? `, ${formatMoment(order.terms_accepted_at)}` : ''}`}</Fact>}
        {order.stripe_payment_intent_id && <Fact label="Pagamento na Stripe">
          <a className="text-link" href={stripePaymentUrl(order.stripe_payment_intent_id, order.livemode)} target="_blank" rel="noopener">{order.stripe_payment_intent_id}<IconExternalLink aria-hidden="true" size={14} stroke={1.75} /><span className="sr-only"> (abre a Stripe em nova aba)</span></a>
        </Fact>}
        {person.stripe_customer_id && <Fact label="Cliente na Stripe">
          <a className="text-link" href={stripeCustomerUrl(person.stripe_customer_id, order.livemode)} target="_blank" rel="noopener">{person.stripe_customer_id}<IconExternalLink aria-hidden="true" size={14} stroke={1.75} /><span className="sr-only"> (abre a Stripe em nova aba)</span></a>
        </Fact>}
      </dl>
    </Section>

    <Section id="itens" title="Itens" count={detail.items.length}>
      <ul className="plain-list">{detail.items.map(item => <li key={item.code} className="plain-row">
        <div className="plain-row-main"><strong>{item.name ?? item.code}</strong><span className="plain-row-sub">{item.kind === 'bundle' ? 'Pacote' : 'Jogo'} · {item.code}</span></div>
        <span className="plain-row-amount">{courtesy ? 'R$ 0' : item.unit_amount !== null && item.currency ? money(item.unit_amount, item.currency) : '—'}</span>
      </li>)}</ul>
    </Section>

    <Section id="jogos" title="Jogos liberados" count={detail.entitlements.filter(entry => entry.status === 'active').length}>
      {detail.entitlements.length === 0 ? <p className="status">Nenhum jogo liberado por este pedido.</p>
        : <ul className="plain-list">{detail.entitlements.map(entry => <li key={entry.id} className="plain-row">
          <div className="plain-row-main">
            <strong>{entry.product.name ?? entry.product.code}</strong>
            <span className="plain-row-sub">{formatMoment(entry.granted_at)}{entry.product.kind === 'bundle' && ` · ${entry.games.map(game => game.name ?? game.code).join(', ')}`}</span>
          </div>
          {entry.status === 'active' ? <span className="badge badge-published">Com acesso</span>
            : <span className="badge">Retirado: {revokeReasonLabel(entry.revoke_reason)}{entry.revoked_at ? `, ${formatMoment(entry.revoked_at)}` : ''}</span>}
        </li>)}</ul>}
      <p className="field-help">{detail.downloads.count ? `${count(detail.downloads.count)} ${detail.downloads.count === 1 ? 'download' : 'downloads'} depois do pagamento, o último em ${formatMoment(detail.downloads.last_at!)}.` : 'Nenhum download depois do pagamento.'}</p>
    </Section>

    <Section id="linha-do-tempo" title="Linha do tempo">
      <ul className="timeline">
        <li><time dateTime={order.created_at}>{formatMoment(order.created_at)}</time> Pedido criado</li>
        {detail.events.map((event, index) => <li key={index}>
          <time dateTime={event.created_at}>{formatMoment(event.created_at)}</time> {eventLabel(event)}
        </li>)}
      </ul>
    </Section>

    <Section id="emails" title="E-mails">
      {detail.emails.length === 0 ? <p className="status">Nenhum e-mail deste pedido.</p>
        : <div className="table-scroll" tabIndex={0} role="region" aria-label="E-mails do pedido">
          <table className="data-table">
            <thead><tr><th scope="col">E-mail</th><th scope="col">Situação</th><th scope="col">Criado</th><th scope="col">Enviado</th></tr></thead>
            <tbody>{detail.emails.map((email, index) => <tr key={index}>
              <td>{emailKindLabel(email.kind)}</td>
              <td>{emailStatusLabel(email.status, email.skip_reason)}</td>
              <td>{formatMoment(email.created_at)}</td>
              <td>{email.sent_at ? formatMoment(email.sent_at) : '—'}</td>
            </tr>)}</tbody>
          </table>
        </div>}
    </Section>

    <Section id="historico" title="Histórico do admin">
      {detail.history.length === 0 ? <p className="status">Ninguém da equipe mexeu neste pedido ainda.</p>
        : <ul className="timeline">{detail.history.map((entry, index) => <li key={index}>
          <time dateTime={entry.created_at}>{formatMoment(entry.created_at)}</time> <strong>{actionLabel(entry.action)}</strong>
          {typeof entry.details?.reason === 'string' && <span>: {entry.details.reason}</span>}{entry.by && <span className="timeline-by"> · {entry.by}</span>}
        </li>)}</ul>}
    </Section>

    {(order.deliverable || order.reconcilable || order.refundable) && <section className="danger-zone" aria-labelledby="acoes-pedido">
      <h2 id="acoes-pedido">Ações</h2>
      {order.deliverable && person.exists && person.id && <Resend order={order} userId={person.id} onDone={done} />}
      {order.reconcilable && <ReasonAction label="Conferir com a Stripe" confirm="Conferir agora"
        intro="Busca a sessão de pagamento na Stripe e aplica o que ela diz, como o aviso da Stripe faria: paga libera os jogos e manda o acesso; sem pagamento, nada muda."
        onConfirm={reason => api<{ status: string }>(`/admin/orders/${order.id}/reconcile`, { method: 'POST', body: { reason } })
          .then(result => done(`Conferido com a Stripe: o pedido está ${orderStatusLabel({ kind: order.kind, status: result.status }).toLowerCase()}.`))} />}
      {order.refundable && <Refund order={order} onDone={done} />}
    </section>}
  </>
}

const BackToList = () => {
  const back = (useLocation().state as { back?: string } | null)?.back
  return <Link className="back-link" to={back ? `/pedidos?${back}` : '/pedidos'}><IconArrowLeft aria-hidden="true" size={18} stroke={1.75} />Todos os pedidos</Link>
}

// Reenviar o acesso: o mesmo da ficha da conta (a rota é da conta dona do pedido).
function Resend({ order, userId, onDone }: { order: OrderDetail['order']; userId: string; onDone: (text: string) => void }) {
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
  return <>
    <button className="text-button" type="button" disabled={state.busy} onClick={() => void resend()}>{state.busy ? 'Reenviando…' : `Reenviar o e-mail ${courtesy ? 'do presente' : 'de acesso'}`}</button>
    {state.error && <p className="field-error" role="alert">{state.error}</p>}
  </>
}

// Reembolso do pedido inteiro (decisão do responsável, 2026-10-24): confirma digitando o código do pedido.
function Refund({ order, onDone }: { order: OrderDetail['order']; onDone: (text: string) => void }) {
  const [typed, setTyped] = useState('')
  const field = useId()
  const value = order.amount_total !== null && order.currency ? money(order.amount_total, order.currency) : ''
  const matches = typed.trim().replace(/^#/, '').toUpperCase() === order.ref
  return <ReasonAction label={`Reembolsar ${value}`} confirm="Reembolsar de vez" danger ready={matches}
    intro={`A Stripe devolve ${value} pelo mesmo meio de pagamento, os jogos saem de Meus jogos e a pessoa recebe o aviso por e-mail. Não dá para desfazer.`}
    onConfirm={reason => api<{ email_queued: boolean }>(`/admin/orders/${order.id}/refund`, { method: 'POST', body: { reason, confirm_ref: typed.trim() } })
      .then(result => onDone(`O pedido ${order.ref} foi reembolsado${result.email_queued ? ' e o aviso está saindo' : ''}.`))}>
    <div className="field">
      <label htmlFor={field}>Digite o código do pedido ({order.ref}) para confirmar</label>
      <input id={field} value={typed} onChange={event => setTyped(event.target.value)} autoComplete="off" spellCheck={false} />
    </div>
  </ReasonAction>
}
