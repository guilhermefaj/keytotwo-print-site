// Perfil em Minha conta (2026-11-01): as regras de PUT /account/profile e de set_account_profile, para avisar no
// formulário antes de enviar. O WhatsApp vai para a API no formato internacional (E.164) e volta formatado.

export const nameMax = 80

/** Espaços das pontas fora e um espaço só entre as palavras, como o servidor guarda. */
export function tidyName(input: string): string {
  return input.trim().replace(/\s+/g, ' ')
}

/**
 * "(11) 91234-5678", "11 91234 5678", "+55 11 91234-5678" ou "+351 912 345 678" → E.164; null quando não é um número.
 * Sem o +, vale o Brasil: DDD e celular (9 e mais 8 dígitos) ou fixo (8 dígitos).
 */
export function toWhatsapp(input: string): string | null {
  const trimmed = input.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (trimmed.startsWith('+')) return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null
  const national = digits.length >= 12 && digits.startsWith('55') ? digits.slice(2) : digits.replace(/^0/, '')
  return /^[1-9][1-9](?:9\d{8}|[2-8]\d{7})$/.test(national) ? `+55${national}` : null
}

/** "+5511912345678" → "(11) 91234-5678"; número de outro país fica como está. */
export function formatWhatsapp(e164: string | null | undefined): string {
  if (!e164) return ''
  const br = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164)
  return br ? `(${br[1]}) ${br[2]}-${br[3]}` : e164
}

/** A maior data de nascimento aceita: 18 anos antes de hoje, no dia de Brasília (29/02 vira 28/02), como o servidor. */
export function adultBirthLimit(now = new Date()): string {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now).split('-').map(Number)
  const limit = new Date(Date.UTC(year - 18, month - 1, day))
  if (limit.getUTCMonth() !== month - 1) limit.setUTCDate(0)
  return limit.toISOString().slice(0, 10)
}
