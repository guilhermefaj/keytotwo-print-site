import { useRef, useState } from 'react'
import { HeroScene } from './components/HeroScene'
import { PreviewPanel, type PreviewDestination } from './components/PreviewPanel'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from './components/ui/sheet'

function Arrow() {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 10h13m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

export function App() {
  const [destination, setDestination] = useState<PreviewDestination | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const pendingMenuDestination = useRef<PreviewDestination | null>(null)
  const panelTrigger = useRef<HTMLElement | null>(null)
  const menuTrigger = useRef<HTMLButtonElement>(null)

  function showPanel(next: PreviewDestination) {
    panelTrigger.current = document.activeElement as HTMLElement
    setDestination(next)
  }
  function closePanel() {
    setDestination(null)
    panelTrigger.current?.focus()
  }
  function fromMenu(next: PreviewDestination) {
    pendingMenuDestination.current = next
    setMenuOpen(false)
  }

  return (
    <>
      <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
      <main className="hero" id="conteudo" tabIndex={-1}>
        <header className="site-header flex items-center justify-between gap-4">
          <a className="brand" href="/preview/hero" aria-label="KeyToTwo — início do protótipo">
            <img src="/media/hero/keytotwo-logo.webp" alt="KeyToTwo" width="420" height="97" fetchPriority="high" />
          </a>
          <nav className="desktop-nav flex items-center gap-8" aria-label="Navegação do protótipo">
            <button className="text-button" onClick={() => showPanel('games')}>Os 5 jogos</button>
          </nav>
          <div className="desktop-action"><button className="button button-primary" onClick={() => showPanel('package')}>Ver pacote <Arrow /></button></div>
          <div className="mobile-navigation">
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <button ref={menuTrigger} className="icon-button menu-trigger" aria-label="Abrir menu">
                  <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" /></svg>
                </button>
              </SheetTrigger>
              <SheetContent onCloseAutoFocus={(event) => {
                const next = pendingMenuDestination.current
                if (next) {
                  event.preventDefault()
                  pendingMenuDestination.current = null
                  panelTrigger.current = menuTrigger.current
                  setDestination(next)
                }
              }}>
                <SheetTitle className="sheet-title">Vamos conhecer?</SheetTitle>
                <SheetDescription className="sheet-description">Protótipo visual. As ações abrem demonstrações.</SheetDescription>
                <nav className="sheet-nav flex flex-col gap-4" aria-label="Navegação mobile">
                  <button className="text-button" onClick={() => fromMenu('games')}>Os 5 jogos <Arrow /></button>
                  <button className="button button-primary" onClick={() => fromMenu('package')}>Ver pacote <Arrow /></button>
                </nav>
                <p className="sheet-footnote">Jogos para imprimir.<br />Uma ideia para vocês dois.</p>
                <SheetClose asChild><button className="text-button sheet-back">Voltar à hero</button></SheetClose>
              </SheetContent>
            </Sheet>
          </div>
        </header>

        <section className="hero-copy text-center" aria-labelledby="hero-title">
          <p className="eyebrow">Jogos para casais · para imprimir</p>
          <h1 id="hero-title">A próxima fase <span>é de vocês dois.</span></h1>
          <p className="hero-description">Um pacote com 5 jogos para imprimir, preparar e jogar juntos em casa. O Kito traz a ideia. Vocês fazem a noite acontecer.</p>
          <div className="hero-actions flex items-center justify-center gap-6">
            <button className="button button-primary hero-cta" onClick={() => showPanel('package')}>Ver pacote <Arrow /></button>
            <button className="text-button secondary-action" onClick={() => showPanel('games')}>Conhecer os jogos</button>
          </div>
          <p className="hero-note">Arquivos digitais. A brincadeira acontece fora da tela.</p>
        </section>
        <div className="prototype-note"><span>Protótipo visual</span><p>As ações abrem demonstrações.</p></div>
        <HeroScene obscured={menuOpen || destination !== null} />
      </main>
      <PreviewPanel destination={destination} onClose={closePanel} />
    </>
  )
}
