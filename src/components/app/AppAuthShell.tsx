import { useEffect, useRef, type ReactNode } from 'react'
import { siteConfig } from '../../lib/site-config'

// Moldura das páginas de conta do app (/auth/*, 2026-11-18): tela para quem usa o app, não para quem compra. Sem o
// cabeçalho, a barra do cupom, o aviso de cookies (que é quem liga o GA), a sacola nem o rodapé da loja, e sem o
// AuthProvider da loja: nenhum script de terceiros roda aqui e o Supabase da loja nem é criado.
export function AppAuthShell({ children }: { children: ReactNode }) {
  // Os e2e esperam por este marcador (tests/e2e/fixtures/test.ts); na loja, quem liga é o root.tsx.
  useEffect(() => { document.documentElement.dataset.interactive = 'true' }, [])
  return <>
    {siteConfig.stage === 'test' && <aside aria-label="Aviso de ambiente"><p className="stage-banner">Ambiente de teste — sem cobranças reais.</p></aside>}
    <header className="app-auth-header"><span className="wordmark">KeyToTwo</span></header>
    {children}
  </>
}

const kitos = {
  happy: { src: '/media/hero/kito-pixel-arms-up.webp', width: 202, height: 211 },
  calm: { src: '/media/hero/kito-pixel-pose.webp', width: 256, height: 256 },
}

// O cartão de cada estado: Kito, título e texto curto. `actions` fica pronto para o botão "Abrir o app", quando o app
// tiver link direto. O título recebe o foco quando o estado muda depois da primeira tela, para o leitor de tela anunciar.
export function AppAuthCard({ kito, title, text, actions, children }: { kito: keyof typeof kitos; title: string; text?: string; actions?: ReactNode; children?: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    heading.current?.focus()
  }, [title])
  const image = kitos[kito]
  return <main id="conteudo" className="app-auth">
    <img className={`app-auth-kito app-auth-kito-${kito}`} src={image.src} width={image.width} height={image.height} alt="" decoding="async" />
    <h1 ref={heading} tabIndex={-1}>{title}</h1>
    {text && <p className="app-auth-text">{text}</p>}
    {children}
    {actions && <div className="app-auth-actions">{actions}</div>}
  </main>
}
