import { useState, type ReactNode } from 'react'
import { isRouteErrorResponse, Link, Links, Outlet, Scripts, ScrollRestoration, useLocation, useMatches, useRouteError } from 'react-router'
import { SiteHeader } from './components/layout/SiteHeader'
import { SiteFooter } from './components/layout/SiteFooter'
import { blogPostingJsonLd, pageSeo, serializeJsonLd, siteConfig } from './lib/seo'
import type { BlogPostSummary } from './lib/blog'
import { AuthProvider } from './components/auth/AuthProvider'
import { ShopProvider } from './components/account/ShopProvider'
import { ConsentInvite } from './components/account/ConsentInvite'
import '@fontsource/bricolage-grotesque/latin-700.css'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-600.css'
import './styles.css'
import './navigation.css'

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const post = (useMatches().find(match => match.id === 'routes/blog.post')?.loaderData as { post?: BlogPostSummary } | undefined)?.post
  const seo = pageSeo(pathname, post)
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{seo.title}</title>
        <meta name="description" content={seo.description} />
        <link rel="canonical" href={seo.canonical} />
        <meta name="robots" content={seo.robots} />
        {pathname === '/email/preferencias' && <meta name="referrer" content="no-referrer" />}
        <meta property="og:title" content={seo.title} />
        <meta property="og:description" content={seo.description} />
        <meta property="og:url" content={seo.canonical} />
        <meta property="og:type" content={post ? 'article' : 'website'} />
        {post?.cover && <><meta property="og:image" content={new URL(post.cover, siteConfig.origin).href} /><meta property="og:image:alt" content={post.coverAlt} /></>}
        {post && <><meta property="article:published_time" content={post.date} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(blogPostingJsonLd(post)) }} /></>}
        {pathname.startsWith('/blog') && <link rel="alternate" type="application/rss+xml" title="Blog KeyToTwo" href="/blog/rss.xml" />}
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
  const { pathname } = useLocation()
  return <AuthProvider><ShopProvider>
    <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
    {siteConfig.stage === 'test' && <aside aria-label="Aviso de ambiente"><p className="stage-banner">Ambiente de teste — sem cobranças reais.</p></aside>}
    <SiteHeader onMenuOpenChange={setMenuOpen} />
    <Outlet context={{ menuOpen }} />
    {pathname !== '/email/preferencias' && <ConsentInvite />}
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
