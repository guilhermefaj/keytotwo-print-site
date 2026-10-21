import { useEffect, useState, type ReactNode } from 'react'
import { isRouteErrorResponse, Link, Links, Outlet, Scripts, ScrollRestoration, useLocation, useMatches, useRouteError } from 'react-router'
import { SiteHeader } from './components/layout/SiteHeader'
import { SiteFooter } from './components/layout/SiteFooter'
import { blogPostingJsonLd, homeJsonLd, pageSeo, productForPath, productJsonLd, serializeJsonLd, shareImage, shareImageSize, siteConfig } from './lib/seo'
import type { BlogPostSummary } from './lib/blog'
import { readBlogPosts } from './lib/blog.server'
import { buildSiteConfig } from './lib/site-build.server'
import { AuthProvider } from './components/auth/AuthProvider'
import { CookieNotice } from './components/layout/CookieNotice'
import { ShopProvider } from './components/account/ShopProvider'
import { useAuth } from './lib/auth-context'
// Fase 4 (desempenho): o título da hero é o LCP e espera a Bricolage; o preload a busca junto com o CSS.
// As URLs são os mesmos arquivos (com hash) que o CSS do @fontsource referencia.
import bricolage700 from '@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff2?url'
import dmSans400 from '@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff2?url'

const supabaseOrigin = (() => { try { return new URL(import.meta.env.VITE_SUPABASE_URL).origin } catch { return '' } })()
// Um só CSS para o site inteiro (app.css), com `precedence` para vir antes dos scripts no <head>.
import appCss from './app.css?url'

// eslint-disable-next-line react-refresh/only-export-components -- React Router removes this prerender-only loader from the client.
export async function loader() {
  return { hasBlogPosts: (await readBlogPosts({ stage: buildSiteConfig().stage })).length > 0 }
}

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const post = (useMatches().find(match => match.id === 'routes/blog.post')?.loaderData as { post?: BlogPostSummary } | undefined)?.post
  const seo = pageSeo(pathname, post)
  const image = shareImage(pathname)
  const product = productForPath(pathname)
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
        {post?.cover ? <><meta property="og:image" content={new URL(post.cover, siteConfig.origin).href} /><meta property="og:image:alt" content={post.coverAlt} /></>
          : <><meta property="og:image" content={image.url} /><meta property="og:image:width" content={String(shareImageSize.width)} /><meta property="og:image:height" content={String(shareImageSize.height)} /><meta property="og:image:alt" content={image.alt} /></>}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={seo.title} />
        <meta name="twitter:description" content={seo.description} />
        <meta name="twitter:image" content={post?.cover ? new URL(post.cover, siteConfig.origin).href : image.url} />
        {pathname === '/' && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(homeJsonLd()) }} />}
        {product && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(productJsonLd(product)) }} />}
        {post && <><meta property="article:published_time" content={post.date} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(blogPostingJsonLd(post)) }} /></>}
        {pathname.startsWith('/blog') && <link rel="alternate" type="application/rss+xml" title="Blog KeyToTwo" href="/blog/rss.xml" />}
        <meta property="og:locale" content="pt_BR" />
        <meta property="og:site_name" content="KeyToTwo" />
        <meta name="theme-color" content="#ECFAF7" />
        <link rel="stylesheet" href={appCss} precedence="default" />
        {/* A sessão e o catálogo vêm do Supabase em toda página: a conexão já começa aberta. */}
        {supabaseOrigin && <link rel="preconnect" href={supabaseOrigin} crossOrigin="anonymous" />}
        <link rel="preload" href={bricolage700} as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href={dmSans400} as="font" type="font/woff2" crossOrigin="anonymous" />
        <Links />
        {/* Kito em pixel art, gerado por scripts/prepare-favicon.mjs. */}
        <link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
        <link rel="icon" href="/media/icons/kito-192.png" type="image/png" sizes="192x192" />
        <link rel="apple-touch-icon" href="/media/icons/apple-touch-icon.png" />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

// O JS só começa depois da primeira pintura (scripts/html-priorities.mjs). Este marcador diz que a página já
// responde: hidratada e com a sessão lida. Os e2e esperam por ele (tests/e2e/fixtures/test.ts).
function InteractiveMarker() {
  const { ready } = useAuth()
  useEffect(() => { if (ready) document.documentElement.dataset.interactive = 'true' }, [ready])
  return null
}

export default function Root() {
  const [menuOpen, setMenuOpen] = useState(false)
  return <AuthProvider><ShopProvider><InteractiveMarker />
    <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
    {siteConfig.stage === 'test' && <aside aria-label="Aviso de ambiente"><p className="stage-banner">Ambiente de teste — sem cobranças reais.</p></aside>}
    <CookieNotice />
    <SiteHeader onMenuOpenChange={setMenuOpen} />
    <Outlet context={{ menuOpen }} />
    <SiteFooter />
  </ShopProvider></AuthProvider>
}

// Temporary shared I0 shell. Individual journeys/content arrive in later increments.
// Apresentação (DESIGN.md › Estados): título com token, sem rótulo; no erro, Kito em pose neutra,
// mensagem anunciada e "Tentar novamente" como botão secundário ao lado do caminho de volta.
export function PendingPage({ title, children, error = false, retry = false }: { title: string; children: ReactNode; error?: boolean; retry?: boolean }) {
  return (
    <main id="conteudo" tabIndex={-1} className="pending-page">
      {error && <span className="kito-still" aria-hidden="true" />}
      <h1>{title}</h1>
      <p role={error ? 'alert' : undefined}>{children}</p>
      <div className="form-actions"><Link to="/" className="button button-primary">Voltar ao início</Link>{retry && <button type="button" className="button button-secondary" onClick={() => window.location.reload()}>Tentar novamente</button>}</div>
    </main>
  )
}

export function HydrateFallback() {
  return <PendingPage title="Carregando">Embaralhando as cartas…</PendingPage>
}

export function ErrorBoundary() {
  const error = useRouteError()
  const notFound = isRouteErrorResponse(error) && error.status === 404
  return <PendingPage title={notFound ? 'Página não encontrada' : 'Não foi possível abrir esta página'} error retry={!notFound}>
    {notFound ? 'O Kito procurou por todo canto e não achou nada neste endereço.' : 'Tente voltar ao início e abrir a página novamente.'}
  </PendingPage>
}
