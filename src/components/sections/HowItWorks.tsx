import { IconDice5, IconPrinter, IconShoppingBag, type TablerIcon } from '@tabler/icons-react'
import { experience } from '../../content/experience'
import { Icon } from '../ui/Icon'

const stepIcons: Record<string, TablerIcon> = { sacola: IconShoppingBag, impressora: IconPrinter, dado: IconDice5 }

// Três cartas lado a lado com calhas tracejadas, como uma folha de cartas (DESIGN.md › Folha).
// Os números são uma sequência real (DESIGN.md › Etapas); por isso ficam.
export function HowItWorks() {
  return <section className="page-section how-section" aria-labelledby="como-funciona"><div className="content-width">
    <div className="section-heading"><h2 id="como-funciona" tabIndex={-1}>O encontro começa assim.</h2></div>
    <ol className="steps-list">{experience.steps.map((step, index) => {
      const glyph = stepIcons[step.icon]
      return <li key={step.title}>
        <div className="step-top"><span className="step-number" aria-hidden="true">{index + 1}</span>{glyph && <Icon component={glyph} size={32} className="step-icon" />}</div>
        <h3>{step.title}</h3><p>{step.text}</p>
      </li>
    })}</ol>
  </div></section>
}
