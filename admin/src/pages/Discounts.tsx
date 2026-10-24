import { useEffect, useId, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router'
import { api, useResource } from '../api'
import { parseReais } from '../catalog'
import { Section } from '../Detail'
import { commissionLabel, discountState, discountWindow, endOfDay, partnerLink, percent, startOfDay, type Discount, type DiscountList, type PartnerFields, type PartnerRow } from '../discounts'
import { count, money } from '../format'
import { LoadError } from '../LoadError'
import { ReasonAction } from '../ReasonAction'
import { siteUrl } from '../supabase'

// Cupons e parceiros (2026-10-24, decisões do responsável). Cupons: cada um é um código promocional da Stripe, com o
// percentual, para o que vale, o prazo, o limite, a campanha e, se quiser, a faixa do topo da loja. Parceiros: o link de
// indicação (?p=apelido), a comissão e os números. Cada aba é um endereço, como em Usuários.
const tabs = [{ to: '/cupons', label: 'Cupons', end: true }, { to: '/cupons/parceiros', label: 'Parceiros', end: false }]

function Header({ text }: { text: string }) {
  return <>
    <header className="page-heading users-heading"><h1>Cupons e parceiros</h1><p>{text}</p></header>
    <nav className="section-tabs" aria-label="Cupons e parceiros">{tabs.map(tab => <NavLink key={tab.to} to={tab.to} end={tab.end}>{tab.label}</NavLink>)}</nav>
  </>
}

function useNotice() {
  const [notice, setNotice] = useState<string>()
  const ref = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (notice) ref.current?.focus() }, [notice])
  return { notice, setNotice, element: notice && <p className="notice" role="status" ref={ref} tabIndex={-1}>{notice}</p> }
}

export function DiscountsPage() {
  const { data, previous, error, loading, reload } = useResource<DiscountList>('/admin/discounts')
  const list = data ?? (loading ? previous : undefined)
  const { setNotice, element } = useNotice()
  const done = (text: string) => { setNotice(text); reload() }
  const live = list?.discounts.filter(item => item.state !== 'ended') ?? []
  const ended = list?.discounts.filter(item => item.state === 'ended') ?? []
  return <>
    <title>Cupons — Admin KeyToTwo</title>
    <Header text="Os cupons de desconto: quanto, para o quê, por quanto tempo e quantas vendas cada um trouxe." />
    {element}
    {!list ? (error ? <LoadError error={error} retry={reload} /> : <p className="status" role="status">Carregando os cupons…</p>) : <>
      <div className="action-row"><NewDiscount list={list} onDone={done} /></div>
      <Section id="cupons" title="Cupons" count={live.length}>
        {live.length === 0 ? <p className="status">Nenhum cupom valendo ou agendado.</p>
          : <ul className="plain-list" aria-label="Cupons">{live.map(item => <DiscountRow key={item.id} discount={item} onDone={done} />)}</ul>}
      </Section>
      {ended.length > 0 && <Section id="encerrados" title="Encerrados" count={ended.length}>
        <ul className="plain-list" aria-label="Cupons encerrados">{ended.map(item => <DiscountRow key={item.id} discount={item} onDone={done} />)}</ul>
      </Section>}
    </>}
  </>
}

function discountRules(discount: Discount) {
  return [
    `${percent(discount.percent_off)} ${discount.product_codes ? `em ${discount.product_codes.join(', ')}` : 'em tudo'}`,
    discountWindow(discount),
    discount.first_time_only && 'só na primeira compra',
    discount.minimum_amount && `a partir de ${money(discount.minimum_amount, 'brl')}`,
    discount.max_redemptions && `até ${count(discount.max_redemptions)} usos`,
  ].filter(Boolean).join(' · ')
}

export function DiscountRow({ discount, onDone }: { discount: Discount; onDone?: (text: string) => void }) {
  const state = discountState(discount)
  const setState = (next: 'active' | 'paused' | 'ended', reason: string, text: string) =>
    api(`/admin/discounts/${discount.id}/state`, { method: 'POST', body: { state: next, reason } }).then(() => onDone?.(text))
  return <li className="plain-row">
    <div className="plain-row-main">
      <strong>{discount.code}</strong>
      <span className="plain-row-sub">{discountRules(discount)}</span>
      <span className="plain-row-sub">
        {count(discount.stats.orders)} {discount.stats.orders === 1 ? 'venda' : 'vendas'} · {money(discount.stats.revenue, 'brl')} cobrados · {money(discount.stats.discount, 'brl')} de desconto
        {discount.campaign && ` · ${discount.campaign}`}
        {discount.partner && <> · parceiro <Link className="text-link" to={`/cupons/parceiros/${discount.partner.id}`}>{discount.partner.name}</Link></>}
      </span>
      {discount.banner && <span className="plain-row-sub">Faixa do topo: “{discount.banner.replaceAll('{cupom}', discount.code)}”</span>}
    </div>
    <span className={`badge${state.tone ? ` badge-${state.tone}` : ''}`}>{state.label}</span>
    {onDone && discount.state !== 'ended' && <div className="action-row">
      {discount.state === 'paused'
        ? <ReasonAction label={`Voltar a valer ${discount.code}`} short="Voltar a valer" confirm="Voltar a valer"
            intro="O código volta a valer no pagamento na hora (ou no início, se ainda não chegou)."
            onConfirm={reason => setState('active', reason, `${discount.code} voltou a valer.`)} />
        : <ReasonAction label={`Pausar ${discount.code}`} short="Pausar" confirm="Pausar"
            intro="O código para de valer no pagamento até você voltar com ele. As vendas que ele já trouxe continuam contando."
            onConfirm={reason => setState('paused', reason, `${discount.code} foi pausado.`)} />}
      <ReasonAction label={`Encerrar ${discount.code}`} short="Encerrar" confirm="Encerrar" danger
        intro="Encerrado não volta: o código para de valer e não pode ser usado de novo em outro cupom. As vendas continuam no histórico."
        onConfirm={reason => setState('ended', reason, `${discount.code} foi encerrado.`)} />
    </div>}
  </li>
}

function NewDiscount({ list, onDone }: { list: DiscountList; onDone: (text: string) => void }) {
  const id = useId()
  const [code, setCode] = useState('')
  const [percentText, setPercentText] = useState('')
  const [products, setProducts] = useState<string[]>([])
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [limit, setLimit] = useState('')
  const [minimum, setMinimum] = useState('')
  const [firstTime, setFirstTime] = useState(false)
  const [campaign, setCampaign] = useState('')
  const [partner, setPartner] = useState('')
  const [banner, setBanner] = useState('')
  const cleanCode = code.trim().toUpperCase()
  const percentValue = Number(percentText.replace(',', '.'))
  const minimumValue = minimum.trim() ? parseReais(minimum) : null
  const valid = /^[A-Z0-9]{3,30}$/.test(cleanCode) && percentValue > 0 && percentValue <= 100
    && (!minimum.trim() || minimumValue !== null) && (!limit.trim() || Number.isInteger(Number(limit)))
    && (!endsOn || !startsOn || endsOn >= startsOn) && (!banner.trim() || banner.includes('{cupom}'))
  const sellable = list.products.filter(item => item.stripe_product)
  const toggle = (value: string, on: boolean) => setProducts(current => on ? [...current, value] : current.filter(item => item !== value))
  return <ReasonAction label="Novo cupom" confirm="Criar o cupom" ready={valid}
    intro="Cria o cupom na Stripe. Ele vale no pagamento a partir do início (ou na hora, sem início)."
    onConfirm={reason => api<{ state: string }>('/admin/discounts', { method: 'POST', body: {
      code: cleanCode, percent_off: percentValue, product_codes: products.length ? products : null,
      starts_at: startsOn ? startOfDay(startsOn) : null, ends_at: endsOn ? endOfDay(endsOn) : null,
      max_redemptions: limit.trim() ? Number(limit) : null, minimum_amount: minimumValue, first_time_only: firstTime,
      campaign: campaign.trim() || null, partner: partner || null, banner: partner ? null : banner.trim() || null, reason,
    } }).then(result => onDone(result.state === 'scheduled' ? `${cleanCode} foi criado e começa a valer no dia do início.` : `${cleanCode} foi criado e já vale no pagamento.`))}>
    <div className="field"><label htmlFor={`${id}-code`}>Código</label>
      <input id={`${id}-code`} value={code} onChange={event => setCode(event.target.value.toUpperCase())} maxLength={30} autoComplete="off" placeholder="BLACK26" aria-describedby={`${id}-code-ajuda`} />
      <p className="field-help" id={`${id}-code-ajuda`}>De 3 a 30 letras e números, sem espaço. O código não volta a ser usado depois.</p></div>
    <div className="field"><label htmlFor={`${id}-percent`}>Desconto, em %</label>
      <input id={`${id}-percent`} inputMode="decimal" value={percentText} onChange={event => setPercentText(event.target.value)} placeholder="10" autoComplete="off" /></div>
    <fieldset className="check-group"><legend>Vale para <span className="field-optional">(nenhum marcado: tudo)</span></legend>
      {sellable.map(item => <label key={item.code} className="check-field"><input type="checkbox" checked={products.includes(item.code)} onChange={event => toggle(item.code, event.target.checked)} /><span>{item.name ?? item.code} ({item.code})</span></label>)}
    </fieldset>
    <div className="field"><label htmlFor={`${id}-start`}>Começa em <span className="field-optional">(opcional)</span></label>
      <input id={`${id}-start`} type="date" value={startsOn} onChange={event => setStartsOn(event.target.value)} /></div>
    <div className="field"><label htmlFor={`${id}-end`}>Termina em <span className="field-optional">(opcional, vale até as 23h59)</span></label>
      <input id={`${id}-end`} type="date" value={endsOn} min={startsOn || undefined} onChange={event => setEndsOn(event.target.value)} /></div>
    <div className="field"><label htmlFor={`${id}-limit`}>Limite de usos <span className="field-optional">(opcional)</span></label>
      <input id={`${id}-limit`} inputMode="numeric" value={limit} onChange={event => setLimit(event.target.value.replace(/\D/g, ''))} autoComplete="off" /></div>
    <div className="field"><label htmlFor={`${id}-minimum`}>Compra mínima, em reais <span className="field-optional">(opcional)</span></label>
      <input id={`${id}-minimum`} inputMode="decimal" value={minimum} onChange={event => setMinimum(event.target.value)} placeholder="20,00" autoComplete="off" /></div>
    <label className="check-field"><input type="checkbox" checked={firstTime} onChange={event => setFirstTime(event.target.checked)} /><span>Só para quem nunca comprou</span></label>
    <div className="field"><label htmlFor={`${id}-campaign`}>Campanha <span className="field-optional">(opcional, para as métricas)</span></label>
      <input id={`${id}-campaign`} value={campaign} onChange={event => setCampaign(event.target.value)} maxLength={60} placeholder="Black Friday 2026" autoComplete="off" /></div>
    <div className="field"><label htmlFor={`${id}-partner`}>Parceiro <span className="field-optional">(opcional)</span></label>
      <select id={`${id}-partner`} value={partner} onChange={event => setPartner(event.target.value)} aria-describedby={`${id}-partner-ajuda`}>
        <option value="">Nenhum</option>
        {list.partners.filter(item => item.status === 'active').map(item => <option key={item.id} value={item.slug}>{item.name}</option>)}
      </select>
      <p className="field-help" id={`${id}-partner-ajuda`}>Quem chega pelo link do parceiro recebe este código sozinho no pagamento.</p></div>
    {!partner && <div className="field"><label htmlFor={`${id}-banner`}>Faixa do topo da loja <span className="field-optional">(opcional)</span></label>
      <input id={`${id}-banner`} value={banner} onChange={event => setBanner(event.target.value)} maxLength={140} placeholder="Black Friday: 30% em tudo com o cupom {cupom}." autoComplete="off" aria-describedby={`${id}-banner-ajuda`} aria-invalid={banner.trim() && !banner.includes('{cupom}') ? true : undefined} />
      <p className="field-help" id={`${id}-banner-ajuda`}>Escreva {'{cupom}'} onde o código aparece. Só uma faixa aparece por vez: a do cupom que começou por último.</p></div>}
  </ReasonAction>
}

export function PartnersPage() {
  const { data, previous, error, loading, reload } = useResource<{ partners: PartnerRow[] }>('/admin/partners')
  const list = data ?? (loading ? previous : undefined)
  const { setNotice, element } = useNotice()
  return <>
    <title>Parceiros — Admin KeyToTwo</title>
    <Header text="Quem divulga a loja: o link de cada um, a comissão e o que ele trouxe." />
    {element}
    {!list ? (error ? <LoadError error={error} retry={reload} /> : <p className="status" role="status">Carregando os parceiros…</p>) : <>
      <div className="action-row"><PartnerForm onDone={text => { setNotice(text); reload() }} /></div>
      <Section id="parceiros" title="Parceiros" count={list.partners.length}>
        {list.partners.length === 0 ? <p className="status">Nenhum parceiro cadastrado.</p>
          : <ul className="plain-list" aria-label="Parceiros">{list.partners.map(partner => <li key={partner.id} className="plain-row">
            <div className="plain-row-main">
              <Link className="user-row-title" to={`/cupons/parceiros/${partner.id}`}>{partner.name}</Link>
              <span className="plain-row-sub">{[partner.handle, commissionLabel(partner.commission_percent), partner.codes.length ? `cupom ${partner.codes.join(', ')}` : 'sem cupom'].filter(Boolean).join(' · ')}</span>
              <span className="plain-row-sub">{count(partner.visits_30d)} {partner.visits_30d === 1 ? 'visita' : 'visitas'} em 30 dias · {count(partner.orders)} {partner.orders === 1 ? 'venda' : 'vendas'} · {money(partner.revenue, 'brl')}</span>
            </div>
            <span className={`badge${partner.status === 'active' ? ' badge-published' : ''}`}>{partner.status === 'active' ? 'Ativo' : 'Pausado'}</span>
          </li>)}</ul>}
      </Section>
    </>}
  </>
}

// Criar ou editar um parceiro. O apelido do link não muda depois de criado: o link já pode estar divulgado.
export function PartnerForm({ partner, onDone }: { partner?: PartnerFields & { id: string }; onDone: (text: string) => void }) {
  const id = useId()
  const [name, setName] = useState(partner?.name ?? '')
  const [slug, setSlug] = useState(partner?.slug ?? '')
  const [handle, setHandle] = useState(partner?.handle ?? '')
  const [contact, setContact] = useState(partner?.contact ?? '')
  const [commission, setCommission] = useState(partner ? String(Number(partner.commission_percent)).replace('.', ',') : '0')
  const [status, setStatus] = useState(partner?.status ?? 'active')
  const [notes, setNotes] = useState(partner?.notes ?? '')
  const commissionValue = Number(commission.replace(',', '.'))
  const valid = name.trim().length >= 2 && (partner || /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) && commission.trim() !== '' && commissionValue >= 0 && commissionValue <= 100
  return <ReasonAction label={partner ? 'Editar o parceiro' : 'Novo parceiro'} confirm={partner ? 'Salvar' : 'Cadastrar'} ready={valid}
    intro={partner ? 'Muda o cadastro. A comissão nova vale para os meses ainda não pagos.' : 'Cadastra o parceiro e o link dele. O cupom com desconto se cria em Cupons, escolhendo o parceiro.'}
    onConfirm={reason => api(partner ? `/admin/partners/${partner.id}` : '/admin/partners', { method: 'POST', body: {
      slug, name: name.trim(), handle: handle.trim() || null, contact: contact.trim() || null, commission_percent: commissionValue,
      status, notes: notes.trim() || null, reason,
    } }).then(() => onDone(partner ? 'O parceiro foi atualizado.' : `${name.trim()} foi cadastrado. O link é ${partnerLink(siteUrl, slug)}.`))}>
    <div className="field"><label htmlFor={`${id}-name`}>Nome</label>
      <input id={`${id}-name`} value={name} onChange={event => setName(event.target.value)} maxLength={80} autoComplete="off" /></div>
    {!partner && <div className="field"><label htmlFor={`${id}-slug`}>Apelido do link</label>
      <input id={`${id}-slug`} value={slug} onChange={event => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} maxLength={30} autoComplete="off" placeholder="ana-souza" aria-describedby={`${id}-slug-ajuda`} />
      <p className="field-help" id={`${id}-slug-ajuda`}>{slug ? `O link fica ${partnerLink(siteUrl, slug)}` : 'Letras minúsculas, números e hífens.'} Não muda depois.</p></div>}
    <div className="field"><label htmlFor={`${id}-handle`}>Rede <span className="field-optional">(opcional)</span></label>
      <input id={`${id}-handle`} value={handle} onChange={event => setHandle(event.target.value)} maxLength={80} placeholder="@perfil no Instagram" autoComplete="off" /></div>
    <div className="field"><label htmlFor={`${id}-contact`}>Contato <span className="field-optional">(opcional)</span></label>
      <input id={`${id}-contact`} value={contact} onChange={event => setContact(event.target.value)} maxLength={120} autoComplete="off" /></div>
    <div className="field"><label htmlFor={`${id}-commission`}>Comissão, em %</label>
      <input id={`${id}-commission`} inputMode="decimal" value={commission} onChange={event => setCommission(event.target.value)} autoComplete="off" aria-describedby={`${id}-commission-ajuda`} />
      <p className="field-help" id={`${id}-commission-ajuda`}>Sobre o valor cobrado. 0%: amigo ou pago por fora; as vendas contam, sem comissão a pagar.</p></div>
    {partner && <div className="field"><label htmlFor={`${id}-status`}>Situação</label>
      <select id={`${id}-status`} value={status} onChange={event => setStatus(event.target.value as 'active' | 'paused')} aria-describedby={`${id}-status-ajuda`}>
        <option value="active">Ativo</option><option value="paused">Pausado</option>
      </select>
      <p className="field-help" id={`${id}-status-ajuda`}>Pausado, o link para de contar visitas, de aplicar o cupom e de trazer vendas para o parceiro. O cupom dele continua valendo para quem digitar; para parar, pause o cupom.</p></div>}
    <div className="field"><label htmlFor={`${id}-notes`}>Observações <span className="field-optional">(opcional)</span></label>
      <textarea id={`${id}-notes`} value={notes} onChange={event => setNotes(event.target.value)} rows={2} maxLength={500} /></div>
  </ReasonAction>
}
