import { useEffect, useRef } from 'react'

export type PreviewDestination = 'package' | 'games'

// PENDING: replace demonstration panels with /#comprar and /#jogos on integration.
// P001 is a draft: no price, checkout, download or availability is inferred here.
export function PreviewPanel({ destination, onClose }: {
  destination: PreviewDestination | null
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (destination && dialog && !dialog.open) {
      dialog.showModal()
      dialog.querySelector('h2')?.focus()
    }
    if (!destination && dialog?.open) dialog.close()
  }, [destination])

  return (
    <dialog ref={dialogRef} className="preview-panel" aria-labelledby="panel-title"
      aria-describedby="panel-description" onClose={onClose} onCancel={onClose}>
      <div className="panel-inner">
        <p className="eyebrow">Demonstração do protótipo</p>
        <h2 id="panel-title" tabIndex={-1}>{destination === 'games' ? 'Os jogos estão tomando forma.' : 'Uma noite a dois começa por aqui.'}</h2>
        <p id="panel-description">
          {destination === 'games'
            ? 'No site completo, esta ação levará à seção “Os 5 jogos”, com a composição e as prévias reais do pacote.'
            : 'No site completo, esta ação levará à oferta do pacote com 5 jogos para imprimir. A compra ainda não está disponível.'}
        </p>
        {destination === 'games' ? (
          <ul className="game-status-list">
            <li><strong>Rabisque e Adivinhe</strong><span>Inclusão confirmada. Testes e revisão pendentes.</span></li>
            <li><strong>Hora dos Artistas</strong><span>Inclusão confirmada. Regras e arquivo pendentes.</span></li>
            <li><strong>Boardgame</strong><span>Inclusão confirmada. Nome final, regras e arquivo pendentes.</span></li>
            <li><strong>Mais dois jogos</strong><span>A definir. A composição completa está em preparação.</span></li>
          </ul>
        ) : (
          <div className="pending-note">
            <strong>O que ainda falta definir</strong>
            <p>Nome comercial, preço, composição final, arquivos e condições de acesso. Este protótipo apresenta somente a direção visual.</p>
          </div>
        )}
        <form method="dialog"><button className="button button-primary" type="submit">Voltar à hero</button></form>
      </div>
    </dialog>
  )
}
