import { IconBrandInstagram, IconBrandTiktok } from '@tabler/icons-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { DataStatus } from '../components/account/AccountUi'
import { DownloadButton } from '../components/account/DownloadButton'
import { GameCard } from '../components/shop/GameGrid'
import { marketingConsent } from '../content/account'
import { freebies } from '../content/games'
import { gratuitos, instagram, tiktok } from '../content/gratuitos'
import { api, apiErrorMessage } from '../lib/api'
import { useAuth } from '../lib/auth-context'
import { deliveryMock, fileSize, type FreeGames } from '../lib/downloads'
import { siteConfig } from '../lib/seo'
import { useShop } from '../lib/shop-context'
import { useApiResource } from '../lib/use-api-resource'

// Os gratuitos (DESIGN.md › Gratuitos): conta + aceite de e-mails libera os PDFs para sempre; a página também
// convida para a comunidade (Instagram, TikTok e e-mails).
export default function Gratuitos() {
  const { session } = useAuth()
  const { account } = useShop()
  const list = useApiResource<FreeGames>('/free-games', true, deliveryMock)
  const unlocked = deliveryMock || Boolean(session && account.data?.free_games_unlocked)
  const files = new Map(list.data?.games.map(game => [game.code, game.file]))
  const { title, lead, community } = gratuitos
  return <main id="conteudo" tabIndex={-1} className="free-page content-width">
    <div className="free-top">
      <header className="shop-heading"><h1>{title}</h1><p>{lead}</p></header>
      <FreeAccess unlocked={unlocked} />
    </div>
    {unlocked && <DataStatus {...list} retry={list.reload} />}
    <ul className="shop-game-grid free-games">{freebies.filter(game => game.confirmed).map(game => {
      const file = game.code ? files.get(game.code) : undefined
      return <GameCard key={game.id} game={game}><div className="shop-availability">
        {!unlocked ? <p className="shop-price">Grátis</p>
          : file || deliveryMock ? <><p className="file-meta">PDF{file && fileSize(file.size_bytes) && ` · ${fileSize(file.size_bytes)}`}</p><DownloadButton fileId={file?.id} isFree onRefresh={list.reload} /></>
          : !list.loading && !list.error && <p className="field-help">O PDF entra aqui em breve.</p>}
      </div></GameCard>
    })}</ul>
    <section className="free-community" aria-labelledby="comunidade-titulo">
      <div className="free-community-copy">
        <h2 id="comunidade-titulo">{community.title}</h2>
        {community.paragraphs.map(text => <p key={text}>{text}</p>)}
        <p className="free-community-invite">{community.invite}</p>
        <div className="free-community-follow">
          <a className="button button-primary social-button" href={instagram.href} target="_blank" rel="noopener" aria-label={`${community.follow} (abre em nova aba)`}><IconBrandInstagram aria-hidden="true" size={22} stroke={1.75} />{community.follow}</a>
          <a className="button button-secondary social-button" href={tiktok.href} target="_blank" rel="noopener" aria-label={`${community.followTiktok} (abre em nova aba)`}><IconBrandTiktok aria-hidden="true" size={22} stroke={1.75} />{community.followTiktok}</a>
        </div>
        <p className="field-help">{community.followHelp}</p>
      </div>
      <img className="free-community-kito" src="/media/hero/kito-pixel-pose.webp" width="256" height="256" alt="" loading="lazy" decoding="async" />
    </section>
  </main>
}

// O passo a passo fica sempre visível (é o aviso da troca); a ação muda com a conta: entrar, aceitar ou pronto.
function FreeAccess({ unlocked }: { unlocked: boolean }) {
  const { session, ready } = useAuth()
  const { account } = useShop()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { access } = gratuitos
  // Conceder exige o texto aprovado, como em Minha conta (MarketingPreference).
  const allowed = marketingConsent.approved || siteConfig.stage === 'test'
  async function unlock() {
    setBusy(true); setError('')
    try {
      await api('/account/marketing', { method: 'PUT', body: { granted: true, source: 'free_games', text_version: marketingConsent.version } })
      account.reload()
    } catch (cause) { setError(apiErrorMessage(cause)) }
    finally { setBusy(false) }
  }
  return <section className="free-access" aria-labelledby="como-baixar">
    <h2 id="como-baixar">{access.title}</h2>
    <ol>{access.steps.map(step => <li key={step}>{step}</li>)}</ol>
    <p className="field-help">{access.note} <Link className="inline-link" to="/privacidade">Privacidade</Link></p>
    {deliveryMock && <p className="checkout-demo">Prévia da entrega (mock): o download é simulado.</p>}
    {!deliveryMock && ready && (!session
      ? <Link className="button button-primary" to={`/entrar?${new URLSearchParams({ next: '/gratuitos' })}`}>{access.signIn}</Link>
      : unlocked ? <p className="free-access-done" role="status">{access.unlocked}</p>
      : account.data ? <div className="free-access-action" aria-busy={busy}>
          <button className="button button-primary" disabled={busy || !allowed} onClick={unlock}>{busy ? 'Liberando…' : access.unlock}</button>
          <p className="form-error" role="alert">{error}</p>
        </div>
      : <DataStatus {...account} retry={account.reload} />)}
  </section>
}
