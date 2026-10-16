import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { IconArchive, IconFile, IconFiles, IconMail, IconPrinter, IconRuler2, IconScissors, IconShoppingBag, IconUserCircle, type TablerIcon } from '@tabler/icons-react'
import { BackLink } from '../components/ui/BackLink'
import { Icon } from '../components/ui/Icon'
import { GameCover } from '../components/account/GameCover'
import { accentStyle } from '../components/shop/GameGrid'
import { help, printGuide, supportEmail, type HelpIcon } from '../content/help'
import { needLabels, packageGames } from '../content/games'

const icons: Record<HelpIcon, TablerIcon> = {
  compra: IconShoppingBag, conta: IconUserCircle, impressao: IconPrinter, contato: IconMail,
  papel: IconFiles, escala: IconRuler2, face: IconFile, recorte: IconScissors, guardar: IconArchive,
}

// Guia de impressão (DESIGN.md › Ajuda): dicas gerais e, por jogo, o que a dupla providencia. Sem páginas do PDF.
function PrintGuide() {
  const gamesWithNeeds = packageGames.filter(game => game.confirmed && game.needs?.length)
  return <>
    <ul className="print-guide">{printGuide.map(tip => <li key={tip.title}><Icon component={icons[tip.icon]} size={24} /><div><h3>{tip.title}</h3><p>{tip.text}</p></div></li>)}</ul>
    <h3 className="help-subtitle">O que cada jogo pede</h3>
    <ul className="help-game-needs">{gamesWithNeeds.map(game => <li key={game.id} style={accentStyle(game.accent)}>
      <GameCover code={game.code} name={game.name} />
      <div><h4>{game.name}</h4><p>{game.needs!.map(need => needLabels[need]).join(' · ')}</p></div>
    </li>)}</ul>
  </>
}

// Atendimento: o e-mail visível e selecionável, com cópia em um clique (o mailto pode não abrir em todo aparelho).
function SupportContact() {
  const [copied, setCopied] = useState(false)
  const address = useRef<HTMLAnchorElement>(null)
  async function copy() {
    try {
      await navigator.clipboard.writeText(supportEmail)
      setCopied(true)
    } catch {
      const selection = window.getSelection()
      if (address.current && selection) { const range = document.createRange(); range.selectNodeContents(address.current); selection.removeAllRanges(); selection.addRange(range) }
    }
  }
  return <div className="support-card">
    <Icon component={IconMail} size={24} />
    <div className="support-copy"><p>Escrevam para</p><a ref={address} className="support-email" href={`mailto:${supportEmail}`}>{supportEmail}</a></div>
    <button type="button" className="button button-secondary" onClick={copy}>{copied ? 'E-mail copiado' : 'Copiar e-mail'}</button>
    <span className="sr-only" role="status">{copied ? 'E-mail copiado.' : ''}</span>
  </div>
}

// Central de ajuda (DESIGN.md › Ajuda): cards de tema que levam às seções, guia de impressão e atendimento.
export default function Ajuda() {
  return <main id="conteudo" tabIndex={-1} className="reading-page help-page content-width">
    <BackLink to="/">Voltar ao início</BackLink><h1>Ajuda</h1><p className="reading-intro">Vamos preparar o próximo encontro? Encontre aqui orientações sobre sua conta, compra e impressão.</p>
    <nav className="help-topics" aria-label="Temas da ajuda"><ul>{help.map(section => <li key={section.id}><a href={`#${section.id}`}>
      <Icon component={icons[section.icon]} size={24} /><span className="help-topic-title">{section.title}</span><span className="help-topic-summary">{section.summary}</span>
    </a></li>)}</ul></nav>
    {help.map(section => <section key={section.id}>
      <h2 id={section.id} tabIndex={-1}>{section.title}</h2>
      {section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
      {section.id === 'compra' && <p><Link className="inline-link" to="/reembolsos">Política de reembolso</Link></p>}
      {section.id === 'impressao' && <PrintGuide />}
      {section.id === 'contato' && <SupportContact />}
    </section>)}
  </main>
}
