import type { CSSProperties } from 'react'
import { IconPlayCardStar, IconPrinter, IconScissors, IconShoppingBag, type TablerIcon } from '@tabler/icons-react'
import { experience } from '../../content/experience'
import { packageGames } from '../../content/games'
import { Icon } from '../ui/Icon'

const stepIcons: Record<string, TablerIcon> = { sacola: IconShoppingBag, impressora: IconPrinter, cartas: IconPlayCardStar }
// Faces de dado: posições acesas na grade 3 × 3, lidas da esquerda para a direita e de cima para baixo.
const pips: Record<number, readonly number[]> = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] }

function DieFace({ value }: { value: number }) {
  return <span className="step-die" aria-hidden="true">{Array.from({ length: 9 }, (_, cell) => <i key={cell} data-on={pips[value]?.includes(cell + 1) || undefined} />)}</span>
}

// Folha de recortar (DESIGN.md › Como funciona): os passos são cartas de uma folha impressa, com
// a faixa na cor de um jogo do pacote, o número em face de dado e a tesoura nas linhas tracejadas. A ordem
// vem do <ol>; o dado é só desenho. No pé, só o link para o guia de impressão da Ajuda.
export function HowItWorks() {
  return <section className="page-section how-section" aria-labelledby="como-funciona"><div className="content-width">
    <div className="section-heading"><h2 id="como-funciona" tabIndex={-1}>Da sacola para a mesa.</h2></div>
    <div className="print-sheet">
      <ol className="steps-list">{experience.steps.map((step, index) => {
        const glyph = stepIcons[step.icon]
        const accent = packageGames[index % packageGames.length]?.accent
        return <li key={step.title}>
          {index > 0 && <span className="step-cut" aria-hidden="true"><Icon component={IconScissors} size={20} /></span>}
          <div className="step-card" style={accent ? { '--card-accent': accent } as CSSProperties : undefined}>
            <div className="step-top"><DieFace value={index + 1} />{glyph && <Icon component={glyph} size={32} className="step-icon" />}</div>
            <h3>{step.title}</h3><p>{step.text}</p>
          </div>
        </li>
      })}</ol>
      <p className="print-note"><a className="inline-link" href="/ajuda#impressao">Guia de impressão</a></p>
    </div>
  </div></section>
}
