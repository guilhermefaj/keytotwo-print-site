import { IconExternalLink } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { alertDeadline, byUrgency, describeAlert, stripeAlertUrl, useAlertsContext, type Alert } from '../alerts'
import { api } from '../api'
import { Section } from '../Detail'
import { formatMoment } from '../format'
import { LoadError } from '../LoadError'
import { ReasonAction } from '../ReasonAction'

// Atenção (2026-10-24): o que a varredura do banco e o webhook abriram. Cada alerta avisa os admins uma vez por e-mail
// e fecha sozinho quando o problema passa; o que não fecha sozinho se resolve aqui, com motivo.
export function AlertsPage() {
  const alerts = useAlertsContext()
  const list = alerts.data ?? alerts.previous
  const [notice, setNotice] = useState<string>()
  const noticeRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (notice) noticeRef.current?.focus() }, [notice])
  const resolved = (alert: Alert) => { setNotice(`${describeAlert(alert).title}: resolvido.`); alerts.reload() }

  return <>
    <title>Atenção — Admin KeyToTwo</title>
    <header className="page-heading"><h1>Atenção</h1><p>O que a loja detectou e precisa de alguém da equipe. Cada alerta avisa os admins uma vez por e-mail.</p></header>
    {notice && <p className="notice" role="status" ref={noticeRef} tabIndex={-1}>{notice}</p>}
    {!list ? (alerts.error ? <LoadError error={alerts.error} retry={alerts.reload} /> : <p className="status" role="status">Carregando…</p>) : <>
      <Section id="abertos" title="Abertos" count={list.open.length}>
        {list.open.length === 0
          ? <div className="empty"><p><strong>Nada precisa de atenção agora.</strong></p><p>Quando algo aparecer, os admins recebem um e-mail e o alerta fica aqui.</p></div>
          : <ul className="plain-list">{byUrgency(list.open).map(alert => <AlertRow key={alert.id} alert={alert} onResolved={resolved} />)}</ul>}
      </Section>
      <Section id="resolvidos" title="Resolvidos nos últimos 30 dias" count={list.resolved.length}>
        {list.resolved.length === 0 ? <p className="status">Nenhum alerta resolvido nos últimos 30 dias.</p>
          : <ul className="plain-list">{list.resolved.map(alert => <AlertRow key={alert.id} alert={alert} />)}</ul>}
      </Section>
    </>}
  </>
}

function AlertRow({ alert, onResolved }: { alert: Alert; onResolved?: (alert: Alert) => void }) {
  const { title, hint } = describeAlert(alert)
  const stripe = stripeAlertUrl(alert)
  const deadline = alertDeadline(alert)
  return <li className="plain-row">
    <div className="plain-row-main">
      <span className="alert-title"><strong>{title}</strong>{deadline && <span className={`badge${deadline.urgent ? ' badge-danger' : ''}`}>{deadline.label}</span>}</span>
      {!alert.resolved_at && <span>{hint}</span>}
      <span className="plain-row-sub">{alert.resolved_at
        ? `Resolvido em ${formatMoment(alert.resolved_at)}: ${alert.resolved_by ? `${alert.resolution} · ${alert.resolved_by}` : 'fechou sozinho'}`
        : `Aberto em ${formatMoment(alert.opened_at)}`}</span>
      <span className="alert-links">
        {alert.order_id && <Link className="text-link" to={`/pedidos/${alert.order_id}`}>Ver o pedido</Link>}
        {alert.user_id && <Link className="text-link" to={`/usuarios/${alert.user_id}`}>Ver a conta</Link>}
        {stripe && <a className="text-link" href={stripe} target="_blank" rel="noopener">Abrir na Stripe<IconExternalLink aria-hidden="true" size={14} stroke={1.75} /><span className="sr-only"> (abre a Stripe em nova aba)</span></a>}
      </span>
    </div>
    {onResolved && (alert.manual
      ? <ReasonAction label={`Marcar como resolvido: ${title}`} short="Marcar como resolvido" confirm="Resolver"
          intro="O alerta sai dos abertos e vai para o histórico do admin com o motivo. Use quando já tiver cuidado disso."
          onConfirm={reason => api(`/admin/alerts/${alert.id}/resolve`, { method: 'POST', body: { reason } }).then(() => onResolved(alert))} />
      : <span className="badge">Fecha sozinho</span>)}
  </li>
}
