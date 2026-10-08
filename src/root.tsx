import type { ReactNode } from 'react'
import { isRouteErrorResponse, Link, Links, Outlet, Scripts, ScrollRestoration, useRouteError } from 'react-router'
import '@fontsource/bricolage-grotesque/latin-700.css'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-600.css'
import './styles.css'

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        {/* I0 is a prototype. Keep private shells and all public pages unindexed. */}
        <meta name="robots" content="noindex, nofollow" />
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
  return <Outlet />
}

// Temporary shared I0 shell. Individual journeys/content arrive in later increments.
export function PendingPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col items-start justify-center gap-6 px-5 py-12">
      <title>{title} — KeyToTwo, protótipo</title>
      <meta name="description" content={`${title}: página em preparação no protótipo KeyToTwo.`} />
      <p className="eyebrow">Protótipo visual</p>
      <h1 style={{ margin: 0, fontSize: 'clamp(2rem, 6vw, 3rem)', lineHeight: 1.12, letterSpacing: '-.03em' }}>{title}</h1>
      <p className="m-0 text-base leading-relaxed">{children}</p>
      <Link to="/" className="button button-primary">Voltar ao início</Link>
    </main>
  )
}

export function HydrateFallback() {
  return <PendingPage title="Carregando">Carregando o protótipo.</PendingPage>
}

export function ErrorBoundary() {
  const error = useRouteError()
  const notFound = isRouteErrorResponse(error) && error.status === 404
  return <PendingPage title={notFound ? 'Página não encontrada' : 'Não foi possível abrir esta página'}>
    {notFound ? 'O endereço solicitado não está disponível.' : 'Tente voltar ao início e abrir a página novamente.'}
  </PendingPage>
}
