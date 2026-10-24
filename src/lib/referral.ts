import { useSyncExternalStore } from 'react'

// Indicação (2026-10-24, decisões do responsável): quem chega por ?p=<apelido> (o link de um parceiro) ou com as marcas
// de campanha (utm_*). O navegador guarda por 30 dias, e o último link vale; o pagamento aplica o código do parceiro e o
// pedido guarda de onde a pessoa veio (POST /checkout, referral). Sem dado pessoal: o apelido, a data, a página e as
// marcas do link. Política de privacidade › Cookies e armazenamento no navegador.
const KEY = 'keytotwo:indicacao'
const CHANGE = 'keytotwo:indicacao-mudou'
const DAYS = 30
const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const

export type Referral = {
  partner?: string
  landed_at: string
  path: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  // o que a API disse do parceiro na visita: o nome e o código ativo dele (para a faixa e o pagamento)
  name?: string
  code?: string | null
  percent_off?: number | null
  // o dia (de Brasília) em que a visita foi contada: uma por parceiro por dia
  counted_on?: string
}

export const isPartnerSlug = (value: string) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value) && value.length <= 30
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())

let memory: Referral | null = null
let cachedRaw: string | null | undefined
let cached: Referral | null = null

function parse(raw: string | null): Referral | null {
  try {
    const value = JSON.parse(raw ?? 'null') as Referral | null
    if (!value || typeof value.landed_at !== 'string' || typeof value.path !== 'string') return null
    if (Date.now() - Date.parse(value.landed_at) > DAYS * 86_400_000) return null
    return value
  } catch { return null }
}

export function readReferral(): Referral | null {
  let raw: string | null
  try { raw = localStorage.getItem(KEY) } catch { return memory }
  if (raw !== cachedRaw) { cachedRaw = raw; cached = parse(raw) }
  return cached
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === KEY) onChange() }
  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGE, onChange)
  return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(CHANGE, onChange) }
}

export function writeReferral(referral: Referral | null) {
  memory = referral
  try {
    if (referral) localStorage.setItem(KEY, JSON.stringify(referral))
    else localStorage.removeItem(KEY)
  } catch { /* fica só na memória */ }
  window.dispatchEvent(new Event(CHANGE))
}

export function useReferral(): Referral | null {
  return useSyncExternalStore(subscribe, readReferral, () => null)
}

// O link que trouxe a pessoa agora: o parceiro (?p) e as marcas de campanha. Sem nenhum dos dois, null (a indicação
// guardada continua).
export function referralFromUrl(url: URL): Referral | null {
  const partner = url.searchParams.get('p')?.trim().toLowerCase() ?? ''
  const utm = Object.fromEntries(UTM.flatMap(key => {
    const value = url.searchParams.get(key)?.trim().slice(0, 100)
    return value ? [[key, value]] : []
  }))
  if (!isPartnerSlug(partner) && !Object.keys(utm).length) return null
  return { ...(isPartnerSlug(partner) ? { partner } : {}), ...utm, landed_at: new Date().toISOString(), path: url.pathname.slice(0, 100) }
}

// Guarda o link novo e, se for de parceiro, conta a visita (uma por dia) e traz o nome e o código dele. Parceiro que não
// vale (pausado, apelido errado): fica só a campanha.
export async function captureReferral(url: URL, visit: (partner: string) => Promise<{ name: string; code: string | null; percent_off: number | null } | null>) {
  const landed = referralFromUrl(url)
  if (!landed) return
  const previous = readReferral()
  const samePartner = landed.partner && previous?.partner === landed.partner
  if (samePartner && previous?.counted_on === today()) {
    writeReferral({ ...landed, name: previous.name, code: previous.code, percent_off: previous.percent_off, counted_on: previous.counted_on })
    return
  }
  writeReferral(landed)
  if (!landed.partner) return
  const partner = await visit(landed.partner).catch(() => undefined)
  if (partner === undefined) return // a API falhou: a indicação fica, e a próxima página tenta de novo
  writeReferral(partner ? { ...landed, ...partner, counted_on: today() } : { ...landed, partner: undefined })
}

// O que vai para o pedido (POST /checkout): sem o nome nem o código, que o banco não precisa.
const ORDER_KEYS = ['partner', 'landed_at', 'path', ...UTM] as const
export function referralForOrder(referral: Referral | null) {
  return referral ? Object.fromEntries(ORDER_KEYS.flatMap(key => (referral[key] ? [[key, referral[key]]] : []))) : undefined
}
