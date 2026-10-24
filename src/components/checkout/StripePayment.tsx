import { useEffect, useRef, useState } from 'react'
import { IconLock } from '@tabler/icons-react'
import { money } from '../../lib/format'
import { stripePublishableKey } from '../../lib/checkout'
import { siteConfig } from '../../lib/site-config'
import { loadStripe, studioAppearance, studioFonts, type CheckoutActions, type CheckoutForm, type CheckoutSession } from '../../lib/stripe'
import { Icon } from '../ui/Icon'

// partner: quem chegou pelo link de um parceiro (lib/referral.ts). O código dele entra sozinho quando o formulário
// abre; um código digitado depois toma o lugar dele. locked: o aceite ainda não foi marcado (2026-10-24): o cupom e o
// formulário aparecem apagados e travados; os avisos e o Recarregar continuam livres.
export function StripePayment({ clientSecret, partner, locked: frozen = false }: { clientSecret: string; partner?: { code: string; name: string }; locked?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const actions = useRef<CheckoutActions | null>(null)
  const locked = useRef(false)
  const [session, setSession] = useState<CheckoutSession>()
  const [ready, setReady] = useState(false)
  const [fatal, setFatal] = useState(false)
  const [error, setError] = useState('')
  const [coupon, setCoupon] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    let failed = false
    let form: CheckoutForm | undefined
    const timer = window.setTimeout(() => fail(), 30000)
    function fail() {
      if (!active) return
      failed = true
      clearTimeout(timer); form?.destroy(); form = undefined; actions.current = null
      setFatal(true); setError('O formulário não carregou. Tente novamente ou volte à sacola.')
    }
    async function mount() {
      try {
        if (!stripePublishableKey || (siteConfig.stage !== 'live' && !stripePublishableKey.startsWith('pk_test_'))) throw new Error('STRIPE_NOT_CONFIGURED')
        const Stripe = await loadStripe()
        if (!active || failed || !host.current) return
        const sdk = Stripe(stripePublishableKey, { betas: ['custom_checkout_payment_form_1'] }).initCheckoutFormSdk({ clientSecret, appearance: studioAppearance, fonts: studioFonts })
        sdk.on('change', next => { if (active && !failed) setSession(next) })
        const result = await sdk.loadActions()
        if (!active || failed) return
        if (result.type !== 'success') throw new Error('STRIPE_UNAVAILABLE')
        const checkout = result.actions
        const initial = checkout.getSession()
        if (siteConfig.stage !== 'live' && initial.livemode) throw new Error('TEST_ONLY')
        actions.current = checkout; setSession(initial)
        if (partner && !initial.discountAmounts?.some(discount => discount.promotionCode)) {
          const applied = await checkout.applyPromotionCode(partner.code).catch(() => null)
          if (!active || failed) return
          if (applied?.type === 'success') setSession(applied.session)
        }
        form = sdk.createForm({ layout: 'expanded', features: { promotionCodeCollection: 'never' } })
        form.on('ready', () => { if (active) { clearTimeout(timer); setReady(true) } })
        form.on('loaderror', fail)
        form.on('confirm', async event => {
          if (!active || locked.current) return
          locked.current = true; setBusy(true); setError(''); setMessage('Confirmando seu pagamento…')
          try {
            const confirmation = await checkout.confirm({ formConfirmEvent: event })
            if (!active) return
            if (confirmation.type === 'error') {
              setMessage(''); setError('O pagamento não foi concluído. Confira os dados no formulário ou tente outro meio de pagamento.')
            } else {
              window.location.assign(`/pedido/confirmacao?session_id=${encodeURIComponent(confirmation.session.id)}`)
            }
          } catch { if (active) { setMessage(''); setError('Não conseguimos confirmar o pagamento. Confira sua conexão e tente novamente.') } }
          finally { locked.current = false; if (active) setBusy(false) }
        })
        form.mount(host.current!)
      } catch { fail() }
    }
    void mount()
    return () => { active = false; clearTimeout(timer); actions.current = null; form?.destroy() }
    // partner é lido só quando o formulário abre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientSecret, attempt])

  async function updateCoupon(remove: boolean) {
    if (!actions.current || locked.current) return
    locked.current = true; setBusy(true); setError(''); setMessage('')
    try {
      const result = await (remove ? actions.current.removePromotionCode() : actions.current.applyPromotionCode(coupon.trim()))
      if (result.type === 'error') setError(remove ? 'Não conseguimos remover o cupom. Tente novamente.' : 'Esse cupom não pôde ser aplicado. Confira o código e as condições.')
      else { setSession(result.session); setMessage(remove ? 'Cupom removido.' : 'Cupom aplicado. Confira o novo total.'); setCoupon('') }
    } catch { setError('Não conseguimos atualizar o cupom. Tente novamente.') }
    finally { locked.current = false; setBusy(false) }
  }
  const applied = session?.discountAmounts?.find(discount => discount.promotionCode)
  return <div className="stripe-payment" data-ready={ready}>
    {!ready && !fatal && <p role="status">Preparando o formulário…</p>}
    <div className="payment-lock" inert={frozen} data-locked={frozen}>
    {session && !fatal && <>
      <section className="coupon" aria-label="Tenho um cupom"><h3>Tenho um cupom</h3><form className="account-form coupon-form" onSubmit={event => { event.preventDefault(); void updateCoupon(false) }}><label htmlFor="promotion-code">Código do cupom</label><div><input id="promotion-code" autoComplete="off" maxLength={100} value={coupon} onChange={event => setCoupon(event.target.value)} disabled={busy} /><button className="button button-secondary" disabled={busy || !coupon.trim()}>Aplicar cupom</button></div></form></section>
      <dl className="payment-totals" aria-live="polite" aria-label="Total do pagamento"><div><dt>Subtotal</dt><dd>{money(session.total.subtotal.minorUnitsAmount, session.currency)}</dd></div>{session.total.discount.minorUnitsAmount > 0 && <div><dt>Desconto {applied?.promotionCode}</dt><dd>−{money(session.total.discount.minorUnitsAmount, session.currency)}</dd></div>}<div className="payment-total"><dt>Total a pagar</dt><dd>{money(session.total.total.minorUnitsAmount, session.currency)}</dd></div></dl>
      {partner && applied?.promotionCode?.toUpperCase() === partner.code && <p className="field-help">Cupom {partner.code} aplicado (indicação de {partner.name}).</p>}
      {applied && <button className="text-button" disabled={busy} onClick={() => updateCoupon(true)}>Remover cupom</button>}
    </>}
    <div id="checkout-form" ref={host} inert={busy || !ready} aria-busy={!ready} aria-label="Formulário de pagamento" />
    </div>
    <p role="status" className="form-message">{message}</p><p role="alert" className="form-error">{error}</p>
    {fatal && <button className="button button-secondary" onClick={() => { setFatal(false); setReady(false); setError(''); setAttempt(value => value + 1) }}>Recarregar formulário</button>}
    {ready && !fatal && <p className="payment-trust"><Icon component={IconLock} size={16} />Pagamento seguro</p>}
  </div>
}
