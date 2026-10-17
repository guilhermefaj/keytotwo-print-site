import { useId } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../lib/auth-context'
import { useShop } from '../../lib/shop-context'
import { guestNewsletterPreview, newsletterVisible } from '../../lib/features'
import { MarketingPreference } from '../account/MarketingPreference'

export function Newsletter() {
  const { session, ready } = useAuth()
  const { account } = useShop()
  const id = useId()
  if (!newsletterVisible || (!session && !guestNewsletterPreview)) return null
  return <section className="newsletter" aria-labelledby={`${id}-title`}>
    <div className="newsletter-intro"><h2 id={`${id}-title`}>Ideias de encontro no seu e-mail</h2><p>Um jogo, uma conversa, uma boa desculpa para ficarem juntos.</p></div>
    <div className="newsletter-form">
      {session ? account.data ? account.data.marketing.opted_in
        ? <div className="newsletter-subscribed"><p>Você já recebe nossas ideias. A próxima pode virar um encontro.</p><Link className="inline-link" to="/conta">Minha preferência de e-mail</Link></div>
        : <MarketingPreference key={session.user.id} marketing={account.data.marketing} source="signup_prompt" onSaved={account.reload} />
        : account.error ? <div className="data-error"><p role="alert">Não conseguimos abrir sua preferência agora.</p><button type="button" className="button button-secondary" onClick={account.reload}>Tentar novamente</button></div> : <p role="status">Carregando sua preferência…</p>
      : <form onSubmit={event => event.preventDefault()} aria-describedby={`${id}-notice`}>
        <label htmlFor={`${id}-email`}>Seu e-mail</label><div className="newsletter-fields"><input id={`${id}-email`} name="email" type="email" autoComplete="email" placeholder="voce@exemplo.com" disabled={!ready} /><button className="button button-primary" disabled>Receber ideias</button></div>
        {/* PENDENTE: endpoint para visitantes. Não enviar, armazenar ou simular inscrição. */}
        <p className="field-help" id={`${id}-notice`}>Inscrições em breve. Seu e-mail ainda não será enviado.</p>
      </form>}
    </div>
  </section>
}
