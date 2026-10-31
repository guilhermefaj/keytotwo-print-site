import { IconArrowLeft } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, apiDownload, apiMessage, ApiError, useResource } from '../api'
import { Fact, Section } from '../Detail'
import { commissionLabel, monthLabel, partnerLink, type PartnerDetail, type PartnerMonth } from '../discounts'
import { count, formatMoment, money } from '../format'
import { LoadError } from '../LoadError'
import { ReasonAction } from '../ReasonAction'
import { siteUrl } from '../supabase'
import { DiscountRow, PartnerForm } from './Discounts'

// Ficha do parceiro (2026-10-24): o link, a comissão, os números por mês (com o repasse de cada mês fechado e a
// planilha sem dado de cliente), os cupons dele e as últimas vendas, com o pedido e se veio pelo cupom ou pelo link.
export function PartnerRoute() {
  const { id } = useParams()
  return <PartnerPage key={id} id={id!} />
}

function PartnerPage({ id }: { id: string }) {
  const { data, previous, error, loading, reload } = useResource<PartnerDetail>(`/admin/partners/${id}`)
  const detail = data ?? (loading ? previous : undefined)
  const [notice, setNotice] = useState<string>()
  const noticeRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (notice) noticeRef.current?.focus() }, [notice])
  const done = (text: string) => { setNotice(text); reload() }

  if (!detail) {
    return <>
      <title>Parceiro — Admin KeyToTwo</title>
      <BackToList />
      {!error ? <p className="status" role="status">Abrindo o parceiro…</p>
        : <LoadError error={error ?? new ApiError('NOT_FOUND')} retry={reload} missing="Este parceiro não existe." />}
    </>
  }
  const { partner } = detail
  const link = partnerLink(siteUrl, partner.slug)
  const owed = Number(partner.commission_percent) > 0
  return <>
    <title>{`${partner.name} — Admin KeyToTwo`}</title>
    <BackToList />
    <header className="page-heading user-heading">
      <div>
        <p className="user-badges"><span className={`badge${partner.status === 'active' ? ' badge-published' : ''}`}>{partner.status === 'active' ? 'Ativo' : 'Pausado'}</span></p>
        <h1>{partner.name}</h1>
        <p>{[partner.handle, commissionLabel(partner.commission_percent)].filter(Boolean).join(' · ')}</p>
      </div>
    </header>
    {notice && <p className="notice" role="status" ref={noticeRef} tabIndex={-1}>{notice}</p>}

    <Section id="cadastro" title="Cadastro">
      <dl className="facts">
        <Fact label="Link de indicação"><CopyLink link={link} /></Fact>
        <Fact label="Comissão">{owed ? commissionLabel(partner.commission_percent) : 'Sem comissão (amigo ou pago por fora): as vendas contam, sem valor a pagar'}</Fact>
        <Fact label="Visitas pelo link">{count(detail.visits.last_30_days)} em 30 dias · {count(detail.visits.total)} no total</Fact>
        {partner.contact && <Fact label="Contato">{partner.contact}</Fact>}
        {partner.notes && <Fact label="Observações">{partner.notes}</Fact>}
        <Fact label="Desde">{formatMoment(partner.created_at)}</Fact>
      </dl>
      <p className="field-help">Vale o último link aberto nos 30 dias antes da compra. Um cupom de outro parceiro digitado no pagamento leva a venda para ele.</p>
      <div className="action-row"><PartnerForm partner={partner} onDone={done} /></div>
    </Section>

    <Section id="meses" title="Por mês" count={detail.months.length}>
      {detail.months.length === 0 ? <p className="status">Nenhuma venda ainda.</p> : <div className="table-scroll" tabIndex={0} role="region" aria-label="Vendas e comissão por mês">
        <table className="data-table">
          <thead><tr><th scope="col">Mês</th><th scope="col">Vendas</th><th scope="col">Cobrado</th>{owed && <th scope="col">Comissão</th>}<th scope="col">{owed ? 'Repasse' : 'Planilha'}</th></tr></thead>
          <tbody>{detail.months.map(month => <tr key={month.month}>
            <th scope="row">{monthLabel(month.month)}{!month.closed && <span className="plain-row-sub"> · em andamento</span>}</th>
            <td>{count(month.orders)}</td>
            <td>{money(month.revenue, 'brl')}</td>
            {owed && <td>{money(month.commission, 'brl')}</td>}
            <td><MonthActions partnerId={partner.id} slug={partner.slug} month={month} owed={owed} onDone={done} /></td>
          </tr>)}</tbody>
        </table>
      </div>}
    </Section>

    <Section id="cupons" title="Cupons" count={detail.discounts.length}>
      {detail.discounts.length === 0 ? <p className="status">Sem cupom: o link conta as visitas e as vendas, sem desconto. Crie o cupom em <Link className="text-link" to="/cupons">Cupons</Link>, escolhendo o parceiro.</p>
        : <ul className="plain-list" aria-label="Cupons do parceiro">{detail.discounts.map(item => <DiscountRow key={item.id} discount={item} />)}</ul>}
    </Section>

    <Section id="vendas" title="Últimas vendas" count={detail.orders.length}>
      {detail.orders.length === 0 ? <p className="status">Nenhuma venda ainda.</p>
        : <ul className="plain-list" aria-label="Vendas do parceiro">{detail.orders.map(order => <li key={order.id} className="plain-row">
          <div className="plain-row-main">
            <Link className="user-row-title" to={`/pedidos/${order.id}`}>Pedido {order.ref}</Link>
            <span className="plain-row-sub">{formatMoment(order.paid_at)} · {order.source === 'code' ? `pelo cupom ${order.promotion_code}` : `pelo link${order.promotion_code ? `, com o cupom ${order.promotion_code}` : ''}`}</span>
          </div>
          <span className="plain-row-amount">{money(order.amount_total, 'brl')}</span>
        </li>)}</ul>}
    </Section>
  </>
}

const BackToList = () => <Link className="back-link" to="/cupons/parceiros"><IconArrowLeft aria-hidden="true" size={18} stroke={1.75} />Todos os parceiros</Link>

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false)
  return <span className="copy-link"><span>{link}</span>
    <button className="button button-secondary button-small" type="button" onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true), () => setCopied(false))}>{copied ? 'Copiado' : 'Copiar'}</button>
  </span>
}

// O repasse de um mês fechado (com comissão) e a planilha do mês, sem e-mail nem nome de cliente.
function MonthActions({ partnerId, slug, month, owed, onDone }: { partnerId: string; slug: string; month: PartnerMonth; owed: boolean; onDone: (text: string) => void }) {
  const [error, setError] = useState('')
  const key = month.month.slice(0, 7)
  const download = () => { setError(''); apiDownload(`/admin/partners/${partnerId}/export?month=${key}`, `parceiro-${slug}-${key}.csv`).catch(cause => setError(apiMessage(cause))) }
  return <div className="action-row">
    {owed && (month.payout ? <span>Pago {formatMoment(month.payout.paid_at)}{month.payout.note ? ` (${month.payout.note})` : ''}</span>
      : month.closed && month.commission > 0 ? <ReasonAction label={`Marcar ${monthLabel(month.month)} como pago`} short="Marcar como pago" confirm="Marcar como pago"
        intro={`Registra o repasse de ${money(month.commission, 'brl')} de ${monthLabel(month.month)}. O pagamento em si é por fora (Pix ou transferência).`}
        onConfirm={reason => api(`/admin/partners/${partnerId}/payouts`, { method: 'POST', body: { month: key, reason } }).then(() => onDone(`${monthLabel(month.month)} ficou como pago.`))} />
        : <span className="plain-row-sub">{month.closed ? 'Nada a pagar' : 'O mês ainda não fechou'}</span>)}
    {month.orders > 0 && <button className="button button-secondary button-small" type="button" onClick={download}>Baixar planilha</button>}
    {error && <span className="field-error" role="alert">{error}</span>}
  </div>
}
