import { IconMail } from '@tabler/icons-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { api, apiMessage, useResource } from '../api'
import { count, formatMoment } from '../format'
import { suppressionLabel, type FollowUp, type FollowUpList } from '../users'
import { UsersHeader } from './UsersHeader'
import { LoadError } from '../LoadError'

// Acompanhamento (2026-10-23): quem precisa de atenção agora, em quatro listas, cada pessoa com o motivo e o que dá para
// fazer. Sai da lista sozinha quando a situação muda (pagou, baixou, confirmou, o e-mail saiu).
const sections = [
  { id: 'sacola', key: 'cart', title: 'Sacola esquecida', hint: 'Pôs jogos na sacola e não pagou há mais de 1 dia.' },
  { id: 'sem-download', key: 'no_download', title: 'Comprou e não baixou', hint: 'Pagamento confirmado (ou presente) há 2 dias ou mais, sem nenhum download.' },
  { id: 'entrega', key: 'delivery', title: 'Entrega com problema', hint: 'O e-mail de acesso falhou e nunca saiu, ou o endereço está bloqueado.' },
  { id: 'sem-confirmacao', key: 'unconfirmed', title: 'Conta sem confirmação', hint: 'Criou a conta e nunca confirmou o e-mail.' },
] as const

export function FollowUpPage() {
  const { data, previous, error, loading, reload } = useResource<FollowUp>('/admin/follow-up')
  const follow = data ?? (loading ? previous : undefined)
  return <>
    <title>Acompanhamento — Admin KeyToTwo</title>
    <UsersHeader text="Quem precisa de atenção agora, com o motivo e o que fazer. Cada pessoa sai da lista quando a situação se resolve." />
    {loading && !follow && <p className="status" role="status">Carregando o acompanhamento…</p>}
    {!loading && error !== undefined && <LoadError error={error} retry={reload} />}
    {follow && <>
      <ul className="follow-summary" aria-label="Resumo">
        {sections.map(section => <li key={section.id}><a href={`#${section.id}`}><strong>{count(follow[section.key].total)}</strong><span>{section.title}</span></a></li>)}
      </ul>
      <FollowSection {...sections[0]} list={follow.cart}>{item => <>
        <Person id={item.user_id} email={item.email} />
        <p className="follow-detail">Na sacola: {item.items.join(', ')} · desde {formatMoment(item.since)}</p>
        <p className="follow-hint">{item.reminded ? 'O lembrete automático já saiu.' : 'O lembrete automático só sai para quem aceitou as novidades. Vale escrever para a pessoa.'}</p>
        {!item.reminded && <WriteTo email={item.email} subject="Sua sacola na KeyToTwo"
          body={`Oi! Vimos que ficou na sua sacola: ${item.items.join(', ')}. Se ficou alguma dúvida sobre a impressão ou o pagamento, é só responder este e-mail.

Equipe KeyToTwo`} />}
      </>}</FollowSection>
      <FollowSection {...sections[1]} list={follow.no_download}>{item => <>
        <Person id={item.user_id} email={item.email} />
        <p className="follow-detail">{item.order_kind === 'courtesy' ? 'Presente' : 'Pedido'} {item.order_ref} · {item.order_kind === 'courtesy' ? 'dado' : 'pago'} em {formatMoment(item.paid_at)} · {item.items.join(', ')}</p>
        <p className="follow-hint">Reenvie o e-mail de acesso; os jogos também estão em Meus jogos.</p>
        <ResendButton userId={item.user_id} orderId={item.order_id} orderRef={item.order_ref} />
      </>}</FollowSection>
      <FollowSection {...sections[2]} list={follow.delivery}>{item => <>
        <Person id={item.user_id} email={item.email} />
        {item.problem === 'failed'
          ? <>
            <p className="follow-detail">O e-mail de acesso do pedido {item.order_ref} falhou ({formatMoment(item.at)}) e não saiu depois.</p>
            <ResendButton userId={item.user_id} orderId={item.order_id!} orderRef={item.order_ref!} />
          </>
          : <>
            <p className="follow-detail">Os e-mails não chegam a este endereço: {suppressionLabel(item.reason ?? '')} ({formatMoment(item.at)}).</p>
            <p className="follow-hint">Confirme o e-mail com a pessoa por outro canal. Os jogos continuam em Meus jogos.</p>
          </>}
      </>}</FollowSection>
      <FollowSection {...sections[3]} list={follow.unconfirmed}>{item => <>
        <Person id={item.user_id} email={item.email} />
        <p className="follow-detail">Conta criada em {formatMoment(item.created_at)} e nunca confirmada.</p>
        <p className="follow-hint">Ela confirma ao entrar pela primeira vez, com o código do e-mail ou o Google. Sem confirmar, não compra.</p>
        <WriteTo email={item.email} subject="Sua conta na KeyToTwo"
          body={'Oi! Sua conta na KeyToTwo ainda não foi confirmada. Para confirmar, é só entrar em keytotwo.com.br/entrar com este e-mail: chega um código de 6 números (ou use o Google).\n\nEquipe KeyToTwo'} />
      </>}</FollowSection>
    </>}
  </>
}

function FollowSection<T extends { user_id: string }>({ id, title, hint, list, children }: { id: string; title: string; hint: string; list: FollowUpList<T>; children: (item: T) => ReactNode }) {
  return <section className="detail-section follow-section" id={id} aria-labelledby={`${id}-titulo`} tabIndex={-1}>
    <h2 id={`${id}-titulo`}>{title}<span className="count"> {count(list.total)}</span></h2>
    <p className="field-help">{hint}</p>
    {list.items.length === 0 ? <p className="status">Ninguém aqui agora.</p>
      : <ul className="plain-list">{list.items.map((item, index) => <li key={`${item.user_id}-${index}`} className="plain-row follow-row"><div className="plain-row-main">{children(item)}</div></li>)}</ul>}
    {list.total > list.items.length && <p className="field-help">Mostrando {count(list.items.length)} de {count(list.total)}.</p>}
  </section>
}

// O e-mail leva à conta e tem cara de link (revisão de UX, 2026-10-31).
const Person = ({ id, email }: { id: string; email: string }) => <Link className="user-row-title person-link" to={`/usuarios/${id}`}>{email}</Link>

// Escrever para a pessoa (revisão de UX, 2026-10-31): abre o e-mail com o assunto e um começo de texto, para editar.
const WriteTo = ({ email, subject, body }: { email: string; subject: string; body: string }) =>
  <a className="button button-secondary button-small write-to" href={`mailto:${email}?${new URLSearchParams({ subject, body }).toString().replace(/\+/g, '%20')}`}>
    <IconMail aria-hidden="true" size={16} stroke={1.75} />Escrever para a pessoa<span className="sr-only"> ({email})</span>
  </a>

function ResendButton({ userId, orderId, orderRef }: { userId: string; orderId: string; orderRef: string }) {
  const [state, setState] = useState<{ busy: boolean; done?: boolean; error?: string }>({ busy: false })
  async function resend() {
    setState({ busy: true })
    try {
      await api(`/admin/users/${userId}/orders/${orderId}/resend`, { method: 'POST' })
      setState({ busy: false, done: true })
    } catch (error) {
      setState({ busy: false, error: apiMessage(error) })
    }
  }
  if (state.done) return <p className="follow-done" role="status">E-mail de acesso do pedido {orderRef} na fila de envio.</p>
  return <div className="inline-action">
    <button className="button button-secondary button-small" type="button" disabled={state.busy} onClick={() => void resend()}>
      {state.busy ? 'Reenviando…' : 'Reenviar o e-mail de acesso'}<span className="sr-only"> do pedido {orderRef}</span>
    </button>
    {state.error && <p className="field-error" role="alert">{state.error}</p>}
  </div>
}
