import { useEffect, useRef } from 'react'
import { leaveNewsletter } from '../../content/account'

// Antes de sair da lista de novidades (responsável, 2026-11-01): o Kito com o coração (pixel art do PixelLab, "In love",
// de frente, reduzido com suavização) e o que a pessoa deixa de receber. A saída fica a um clique, com nome claro.

/** O texto da despedida: em Minha conta, dentro da janela; no link do e-mail, na própria página. */
export function LeaveNewsletterMessage({ headingId }: { headingId: string }) {
  return <div className="leave-message">
    <span className="leave-kito" aria-hidden="true"><img src="/media/portal/kito-coracao-96.webp" srcSet="/media/portal/kito-coracao-96.webp 96w, /media/portal/kito-coracao-144.webp 144w, /media/portal/kito-coracao-192.webp 192w" sizes="72px" width="72" height="80" alt="" /></span>
    <h2 id={headingId}>{leaveNewsletter.title}</h2>
    <p id={`${headingId}-lead`}>{leaveNewsletter.lead}</p>
    <ul>{leaveNewsletter.losses.map(item => <li key={item}>{item}</li>)}</ul>
    <p className="field-help">{leaveNewsletter.keeps}</p>
  </div>
}

/** Janela modal (dialog nativo: prende o foco, Esc e o clique fora ficam em "continuar"). */
export function LeaveNewsletterDialog({ open, busy, onStay, onLeave }: { open: boolean; busy: boolean; onStay: () => void; onLeave: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current
    if (!node) return
    if (open && !node.open) node.showModal()
    else if (!open && node.open) node.close()
  }, [open])
  return <dialog ref={dialog} className="leave-dialog" aria-labelledby="leave-title" aria-describedby="leave-title-lead"
    onCancel={event => { event.preventDefault(); if (!busy) onStay() }}
    onClick={event => { if (event.target === event.currentTarget && !busy) onStay() }}>
    <div className="leave-dialog-body">
      <LeaveNewsletterMessage headingId="leave-title" />
      <div className="leave-actions">
        <button type="button" className="button button-primary" autoFocus disabled={busy} onClick={onStay}>{leaveNewsletter.stay}</button>
        <button type="button" className="button button-secondary" disabled={busy} onClick={onLeave}>{busy ? 'Saindo da lista…' : leaveNewsletter.leave}</button>
      </div>
    </div>
  </dialog>
}
