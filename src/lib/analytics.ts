import { useSyncExternalStore } from 'react'
import { siteConfig } from './seo'

// GA4 (responsável, 2026-10-22): só no domínio real, só depois do "Aceitar" no aviso de cookies (LGPD: consentimento,
// Política de privacidade › Cookies). No stage test o aviso aparece para revisão, mas aceitar não carrega nada.
const gaMeasurementId = 'G-9NVMZZS65E'

type Choice = 'granted' | 'denied'
type Stored = { value: Choice; at: string; version: number }
const KEY = 'keytotwo:cookies'
const CHANGE = 'keytotwo:cookies-mudou'
const REOPEN = 'keytotwo:cookies-reabrir'
// Muda quando o texto do aviso muda de forma relevante: a escolha antiga deixa de valer e o aviso volta.
const VERSION = 1
// A escolha vale por um ano; depois o aviso pergunta de novo.
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000

declare global {
  interface Window { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void }
}

// Medição de verdade só no host de produção do build live (o teste e o localhost nunca enviam dados).
function analyticsAvailable() {
  return siteConfig.stage === 'live' && typeof location !== 'undefined' && location.hostname === new URL(siteConfig.origin).hostname
}
export const cookieNoticeEnabled = () => analyticsAvailable() || siteConfig.stage === 'test'

let cachedRaw: string | null | undefined
let cached: Choice | null = null
function snapshot(): Choice | null {
  let raw: string | null
  try { raw = localStorage.getItem(KEY) } catch { return null }
  if (raw !== cachedRaw) {
    cachedRaw = raw
    try {
      const stored = JSON.parse(raw ?? 'null') as Stored | null
      const valid = stored && (stored.value === 'granted' || stored.value === 'denied') && stored.version === VERSION && Date.now() - Date.parse(stored.at) < MAX_AGE_MS
      cached = valid ? stored.value : null
    } catch { cached = null }
  }
  return cached
}
function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === KEY) onChange() }
  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGE, onChange)
  return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(CHANGE, onChange) }
}
// null: ainda não escolheu (ou a escolha venceu); no pré-render, sempre null.
export const useCookieChoice = () => useSyncExternalStore(subscribe, snapshot, () => null)

export function setCookieChoice(value: Choice) {
  try { localStorage.setItem(KEY, JSON.stringify({ value, at: new Date().toISOString(), version: VERSION } satisfies Stored)) } catch { /* sem armazenamento: vale só nesta página */ }
  cachedRaw = undefined
  window.dispatchEvent(new Event(CHANGE))
  if (value === 'granted') loadAnalytics()
  else revokeAnalytics()
}

// "Cookies" no rodapé: reabre o aviso para mudar a escolha.
export const reopenCookieNotice = () => window.dispatchEvent(new Event(REOPEN))
export function onCookieNoticeReopen(listener: () => void) {
  window.addEventListener(REOPEN, listener)
  return () => window.removeEventListener(REOPEN, listener)
}

let loaded = false
export function loadAnalytics() {
  if (loaded || !analyticsAvailable() || snapshot() !== 'granted') return
  loaded = true
  window.dataLayer = window.dataLayer || []
  // O gtag precisa do objeto arguments, não de um array.
  // eslint-disable-next-line prefer-rest-params
  window.gtag = function gtag() { window.dataLayer!.push(arguments) }
  window.gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' })
  window.gtag('js', new Date())
  window.gtag('config', gaMeasurementId, { allow_google_signals: false, allow_ad_personalization_signals: false })
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`
  document.head.append(script)
}

// Recusa depois de ter aceitado: o GA4 para de gravar e os cookies dele (_ga, _ga_*) saem do navegador.
function revokeAnalytics() {
  window.gtag?.('consent', 'update', { analytics_storage: 'denied' })
  const domain = location.hostname.replace(/^www\./, '')
  for (const name of document.cookie.split(';').map(cookie => cookie.split('=')[0].trim()).filter(name => name === '_ga' || name.startsWith('_ga_'))) {
    for (const scope of ['', `; domain=${domain}`, `; domain=.${domain}`]) document.cookie = `${name}=; max-age=0; path=/${scope}`
  }
}

// Eventos de loja do GA4 (view_item, add_to_cart, begin_checkout, purchase); sem aceite, nada sai.
export type AnalyticsItem = { item_id: string; item_name: string; price?: number; quantity?: number }
export function track(event: string, params: { currency?: string; value?: number; transaction_id?: string; items?: AnalyticsItem[] } = {}) {
  if (loaded) window.gtag?.('event', event, params)
}
export const toReais = (cents: number) => Math.round(cents) / 100

// Preço de tabela do conteúdo ("R$ 29,90") em reais.
export function offerValue(price: string): number | undefined {
  const value = Number(price.replace(/[^\d,]/g, '').replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? value : undefined
}

// A confirmação não recebe valor nem itens: o início do pagamento guarda o que foi para a Stripe nesta aba. O valor é
// o da sacola, antes de cupom. A compra é medida uma vez por sessão do Checkout, mesmo recarregando a confirmação.
const CHECKOUT = 'keytotwo:checkout-medido'
const PURCHASES = 'keytotwo:compras-medidas'
type CheckoutSnapshot = { currency: string; value: number; items: AnalyticsItem[] }
export function trackBeginCheckout(snapshot: CheckoutSnapshot) {
  track('begin_checkout', snapshot)
  try { sessionStorage.setItem(CHECKOUT, JSON.stringify(snapshot)) } catch { /* sem armazenamento: a compra sai sem valor */ }
}
export function trackPurchase(sessionId: string) {
  if (!loaded) return
  try {
    const measured: string[] = JSON.parse(localStorage.getItem(PURCHASES) ?? '[]')
    if (measured.includes(sessionId)) return
    localStorage.setItem(PURCHASES, JSON.stringify([...measured, sessionId].slice(-20)))
  } catch { /* segue: no pior caso, a compra é medida de novo ao recarregar */ }
  let snapshot: Partial<CheckoutSnapshot> = {}
  try { snapshot = JSON.parse(sessionStorage.getItem(CHECKOUT) ?? '{}') } catch { /* sem valor */ }
  track('purchase', { transaction_id: sessionId, ...snapshot })
}
