import { IconCheck, IconCopy } from '@tabler/icons-react'
import { useEffect, useState } from 'react'

// Copiar um código (pedido, cupom) com um clique (revisão de UX, 2026-10-31): o atendimento cola na Stripe e em
// mensagens. O aviso "Copiado" fica 2 segundos e é lido pelo leitor de tela.
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      // sem permissão de área de transferência: o código continua à vista para copiar à mão
    }
  }
  return <button className="copy-button" type="button" onClick={() => void copy()} aria-label={`${label} ${value}`}>
    {copied ? <IconCheck aria-hidden="true" size={16} stroke={2} /> : <IconCopy aria-hidden="true" size={16} stroke={1.75} />}
    <span aria-live="polite">{copied ? 'Copiado' : 'Copiar'}</span>
  </button>
}
