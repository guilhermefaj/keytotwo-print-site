import { useEffect } from 'react'
import { useOutletContext } from 'react-router'
import { useResource } from './api'
import { formatMoment, money } from './format'

// Alertas do admin (2026-10-24): o formato de GET /admin/alerts e o que a tela diz de cada um.
export interface Alert {
  id: number
  kind: 'dispute' | 'delivery_failed' | 'order_stuck' | 'stripe_unmatched' | 'email_queue_stuck' | 'backup_late' | 'terms_missing' | 'site_down'
    | 'marketing_sync_stuck' | 'plunk_backup_late'
  details: Record<string, unknown>
  opened_at: string
  order_id: string | null
  order_ref: string | null
  order_status: string | null
  livemode: boolean | null
  user_id: string | null
  resolved_at: string | null
  resolution: string | null
  resolved_by: string | null
  manual: boolean
}
export interface AlertList { open: Alert[]; resolved: Alert[] }

// Uma busca só para a barra lateral, as Métricas e a página Atenção (pelo contexto do Layout), de novo a cada 5
// minutos, a frequência da varredura do banco, e depois de resolver.
export function useAlerts() {
  const alerts = useResource<AlertList>('/admin/alerts')
  const { reload } = alerts
  useEffect(() => {
    const timer = setInterval(reload, 5 * 60_000)
    return () => clearInterval(timer)
  }, [reload])
  return alerts
}
export type Alerts = ReturnType<typeof useAlerts>
export const useAlertsContext = () => useOutletContext<Alerts>()

const EMAILS: Record<string, string> = { delivery: 'E-mail de acesso', gift: 'E-mail do presente', refund: 'Aviso de reembolso' }
const text = (value: unknown) => (typeof value === 'string' ? value : '')

// O título e o que fazer, como no e-mail dos admins.
export function describeAlert(alert: Alert): { title: string; hint: string } {
  const d = alert.details
  const ref = alert.order_ref ?? ''
  switch (alert.kind) {
    case 'dispute': {
      const amount = typeof d.amount === 'number' && d.currency ? `${money(d.amount, text(d.currency))}. ` : ''
      return { title: `Contestação no pedido ${ref}`, hint: `${amount}Mande as provas na Stripe ${d.due_by ? `até ${formatMoment(text(d.due_by))}` : 'dentro do prazo que ela der'}.` }
    }
    case 'delivery_failed': {
      const action = d.email_kind === 'refund' ? 'Avise a pessoa por outro caminho.' : 'Confira o e-mail da pessoa e use Reenviar na ficha do pedido.'
      return d.cause === 'bounced'
        ? { title: `${EMAILS[text(d.email_kind)] ?? 'E-mail'} do pedido ${ref} voltou`, hint: `O endereço não recebe e-mails. ${action}` }
        : { title: `${EMAILS[text(d.email_kind)] ?? 'E-mail'} do pedido ${ref} não saiu`, hint: `O envio falhou de vez${d.error ? ` (${text(d.error)})` : ''}. ${action}` }
    }
    case 'order_stuck':
      return { title: `Pedido ${ref} parado`, hint: 'Aberto há mais de 26 horas: o aviso da Stripe não chegou. Use Conferir com a Stripe na ficha do pedido.' }
    case 'stripe_unmatched':
      return { title: 'Aviso da Stripe sem pedido', hint: `A Stripe avisou um pagamento (${text(d.type)}) de um pedido que não existe aqui. Confira o evento na Stripe.` }
    case 'email_queue_stuck':
      return { title: 'Fila de e-mails parada', hint: 'Há e-mail esperando há mais de 30 minutos. Fecha sozinho quando a fila andar.' }
    case 'backup_late':
      return { title: 'Backup atrasado', hint: 'A cópia de segurança do banco não roda há mais de 26 horas. Fecha sozinho com a próxima cópia.' }
    // Os alertas do Plunk (2026-11-01): a cópia dele e as inscrições que não chegam lá.
    case 'plunk_backup_late':
      return { title: 'Backup do Plunk atrasado', hint: 'A cópia de segurança do Plunk (os contatos e o histórico dos e-mails) não roda há mais de 26 horas. Confira o backup.log na VPS. Fecha sozinho com a próxima cópia.' }
    case 'marketing_sync_stuck': {
      const count = typeof d.count === 'number' ? d.count : 1
      const problem = d.error ? ` (${text(d.error)})` : ''
      return {
        title: 'Inscrições sem chegar ao Plunk',
        hint: `${count === 1 ? '1 pessoa que aceitou os e-mails está' : `${count} pessoas que aceitaram os e-mails estão`} há mais de 1 hora sem chegar ao Plunk${problem}, sem as boas-vindas. Confira se o Plunk está no ar. Fecha sozinho quando passarem.`,
      }
    }
    case 'terms_missing':
      return { title: `Pedido ${ref} pago sem o aceite dos termos`, hint: 'O pagamento passou sem o "Li e aceito" gravado: alguém destravou o formulário à mão. Guarde isto para um pedido de reembolso ou uma contestação.' }
    case 'site_down': {
      // A checagem automática (2026-10-26), a cada 5 minutos: o site abre e a loja lista os produtos com preço.
      const since = formatMoment(text(d.since))
      const problem = d.error ? ` (${text(d.error)})` : ''
      if (d.target === 'site') return { title: 'Site fora do ar', hint: `Não abre desde ${since}${problem}. Confira a VPS no painel da Hostinger. Fecha sozinho quando o site voltar.` }
      if (d.target === 'store') return { title: 'Loja sem preços', hint: `Os produtos não aparecem com preço desde ${since}${problem}: ninguém consegue comprar. Confira o status da Supabase e da Stripe. Fecha sozinho quando voltar.` }
      if (d.target === 'plunk') return { title: 'Plunk fora do ar', hint: `Não responde desde ${since}${problem}: os e-mails de acesso aos jogos e as novidades não saem. Confira a VPS no painel da Hostinger. Fecha sozinho quando voltar.` }
      return { title: 'Checagem do site parada', hint: `A checagem automática não chega desde ${since}: a API da loja pode estar fora do ar. Confira o status da Supabase. Fecha sozinho quando voltar.` }
    }
  }
}

// A contestação ou o evento no painel da Stripe, no modo certo (teste ou produção).
export function stripeAlertUrl(alert: Alert): string | null {
  const d = alert.details
  const base = `https://dashboard.stripe.com/${(d.livemode ?? alert.livemode) === false ? 'test/' : ''}`
  if (alert.kind === 'dispute' && d.dispute_id) return `${base}disputes/${encodeURIComponent(text(d.dispute_id))}`
  if (alert.kind === 'stripe_unmatched' && d.event_id) return `${base}events/${encodeURIComponent(text(d.event_id))}`
  return null
}

// Prazo de um alerta (revisão de UX, 2026-10-31): a contestação tem até quando mandar as provas na Stripe. Urgente com 3
// dias ou menos. Os abertos vêm do mais urgente: os com prazo primeiro (o mais perto antes), depois o mais novo.
export function alertDeadline(alert: Alert, now = Date.now()): { label: string; urgent: boolean } | null {
  const due = typeof alert.details.due_by === 'string' ? Date.parse(alert.details.due_by) : Number.NaN
  if (alert.resolved_at || Number.isNaN(due)) return null
  const days = Math.ceil((due - now) / 86_400_000)
  if (due <= now) return { label: 'Prazo vencido', urgent: true }
  return { label: days <= 1 ? 'Prazo: termina em menos de 1 dia' : `Prazo: faltam ${days} dias`, urgent: days <= 3 }
}

export function byUrgency(list: Alert[]): Alert[] {
  const due = (alert: Alert) => (typeof alert.details.due_by === 'string' ? Date.parse(alert.details.due_by) : Number.POSITIVE_INFINITY)
  return [...list].sort((a, b) => due(a) - due(b) || Date.parse(b.opened_at) - Date.parse(a.opened_at))
}
