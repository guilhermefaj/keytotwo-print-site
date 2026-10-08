import { useState, type ReactNode } from 'react'
import { isRouteErrorResponse, Link, Links, Outlet, Scripts, ScrollRestoration, useLocation, useRouteError } from 'react-router'
import { SiteHeader } from './components/layout/SiteHeader'
import { SiteFooter } from './components/layout/SiteFooter'
import { pageSeo, siteConfig } from './lib/seo'
import { AuthProvider } from './components/auth/AuthProvider'
import { ShopProvider } from './components/account/ShopProvider'
import { ConsentInvite } from './components/account/ConsentInvite'
import '@fontsource/bricolage-grotesque/latin-700.css'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-600.css'
import './styles.css'

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const seo = pageSeo(pathname)
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{seo.title}</title>
        <meta name="description" content={seo.description} />
        <link rel="canonical" href={seo.canonical} />
        <meta name="robots" content={seo.robots} />
        <meta property="og:title" content={seo.title} />
        <meta property="og:description" content={seo.description} />
        <meta property="og:url" content={seo.canonical} />
        <meta property="og:type" content="website" />
        <meta property="og:locale" content="pt_BR" />
        <meta property="og:site_name" content="KeyToTwo" />
        <meta name="theme-color" content="#ECFAF7" />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function Root() {
  const [menuOpen, setMenuOpen] = useState(false)
  return <AuthProvider><ShopProvider>
    <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
    {siteConfig.stage === 'test' && <p className="stage-banner">Ambiente de teste — compras desativadas.</p>}
    <SiteHeader onMenuOpenChange={setMenuOpen} />
    <Outlet context={{ menuOpen }} />
    <ConsentInvite />
    <SiteFooter />
  </ShopProvider></AuthProvider>
}

// Temporary shared I0 shell. Individual journeys/content arrive in later increments.
export function PendingPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main id="conteudo" tabIndex={-1} className="mx-auto flex min-h-svh w-full max-w-3xl flex-col items-start justify-center gap-6 px-5 py-12">
      <p className="eyebrow">KeyToTwo</p>
      <h1 style={{ margin: 0, fontSize: 'clamp(2rem, 6vw, 3rem)', lineHeight: 1.12, letterSpacing: '-.03em' }}>{title}</h1>
      <p className="m-0 text-base leading-relaxed">{children}</p>
      <Link to="/" className="button button-primary">Voltar ao início</Link>
    </main>
  )
}

export function HydrateFallback() {
  return <PendingPage title="Carregando">Preparando seu próximo encontro.</PendingPage>
}

export function ErrorBoundary() {
  const error = useRouteError()
  const notFound = isRouteErrorResponse(error) && error.status === 404
  return <PendingPage title={notFound ? 'Página não encontrada' : 'Não foi possível abrir esta página'}>
    {notFound ? 'O endereço solicitado não está disponível.' : 'Tente voltar ao início e abrir a página novamente.'}
  </PendingPage>
}
