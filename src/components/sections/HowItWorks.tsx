import type { CSSProperties } from 'react'
import { IconPlayCardStar, IconPrinter, IconShoppingBag, type TablerIcon } from '@tabler/icons-react'
import { experience } from '../../content/experience'
import { packageGames } from '../../content/games'
import { Icon } from '../ui/Icon'

const stepIcons: Record<string, TablerIcon> = { sacola: IconShoppingBag, impressora: IconPrinter, cartas: IconPlayCardStar }

// Como funciona (DESIGN.md › Como funciona): os passos são cartas soltas, com a faixa fina na cor de um jogo do pacote
// e o número do passo. A ordem vem do <ol>; o número é só desenho. No pé, só o link para o guia de impressão da Ajuda.
export function HowItWorks() {
  return <section className="page-section how-section" aria-labelledby="como-funciona"><div className="content-width">
    <div className="section-heading"><h2 id="como-funciona" tabIndex={-1}>Da sacola para a mesa.</h2></div>
    <div className="print-sheet">
      <ol className="steps-list">{experience.steps.map((step, index) => {
        const glyph = stepIcons[step.icon]
        const accent = packageGames[index % packageGames.length]?.accent
        return <li key={step.title}>
          <div className="step-card" style={accent ? { '--card-accent': accent } as CSSProperties : undefined}>
            <div className="step-top"><span className="step-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{glyph && <Icon component={glyph} size={32} className="step-icon" />}</div>
            <h3>{step.title}</h3><p>{step.text}</p>
          </div>
        </li>
      })}</ol>
      <p className="print-note"><a className="inline-link" href="/ajuda#impressao">Guia de impressão</a></p>
    </div>
  </div></section>
}
