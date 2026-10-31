import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { apiMessage } from './api'

// Ação com motivo (usuários, 2026-10-23): o botão abre no lugar um formulário com o aviso do que acontece, os campos a
// mais (children), o motivo, que vai para o histórico do admin, e Confirmar/Cancelar.
export function ReasonAction({ label, short, confirm, intro, danger = false, primary = false, onConfirm, children, ready = true }: {
  label: string; short?: string; confirm: string; intro: string; danger?: boolean; primary?: boolean; ready?: boolean
  onConfirm: (reason: string) => Promise<unknown>; children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false })
  const opener = useRef<HTMLButtonElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const returnFocus = useRef(false)
  const field = useId()
  // Aberto, o foco vai para o primeiro campo (o jogo do presente, o e-mail da exclusão ou o motivo); fechado sem
  // concluir, volta para o botão que abriu.
  useEffect(() => {
    if (open) {
      form.current?.querySelector<HTMLElement>('select, input, textarea')?.focus()
      return
    }
    if (!returnFocus.current) return
    returnFocus.current = false
    opener.current?.focus()
  }, [open])
  const close = () => { returnFocus.current = true; setOpen(false); setReason(''); setState({ busy: false }) }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (reason.trim().length < 3) {
      setState({ busy: false, error: 'Escreva o motivo, de 3 a 300 caracteres. Ele fica no histórico.' })
      return
    }
    setState({ busy: true })
    try {
      await onConfirm(reason.trim())
      setOpen(false)
      setReason('')
      setState({ busy: false })
    } catch (error) {
      setState({ busy: false, error: apiMessage(error) })
    }
  }

  // Fechado, é um botão (revisão de UX, 2026-10-31): o principal da página, cheio; os outros, compactos de contorno; o
  // perigoso, com o contorno em Erro.
  if (!open) return <button ref={opener} className={primary ? 'button button-primary' : `button button-small ${danger ? 'button-danger-outline' : 'button-secondary'}`} type="button" onClick={() => setOpen(true)} aria-label={short ? label : undefined}>{short ?? label}</button>
  return <form ref={form} className={`reason-form${danger ? ' reason-form-danger' : ''}`} onSubmit={event => void submit(event)} aria-label={label} noValidate>
    <p>{intro}</p>
    {children}
    <div className="field">
      <label htmlFor={field}>Motivo</label>
      <textarea id={field} value={reason} onChange={event => setReason(event.target.value)} rows={2} maxLength={300}
        aria-invalid={state.error ? true : undefined} aria-describedby={`${field}-ajuda`} />
      <p className="field-help" id={`${field}-ajuda`}>Fica no histórico do admin, com o seu e-mail e a data.</p>
    </div>
    {state.error && <p className="field-error" role="alert">{state.error}</p>}
    <div className="reason-actions">
      <button className={`button ${danger ? 'button-danger' : 'button-primary'}`} type="submit" disabled={state.busy || !ready}>{state.busy ? 'Salvando…' : confirm}</button>
      <button className="button button-secondary" type="button" disabled={state.busy} onClick={close}>Cancelar</button>
    </div>
  </form>
}
