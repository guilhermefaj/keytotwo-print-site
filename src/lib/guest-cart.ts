import { useSyncExternalStore } from 'react'

// Sacola de quem ainda não entrou: só os códigos, na ordem em que entraram, guardados neste navegador. Os preços e as
// regras vêm da API (POST /cart/quote). Ao entrar, ela se junta à sacola da conta (POST /cart/merge) e sai daqui.
const KEY = 'keytotwo:sacola'
const CHANGE = 'keytotwo:sacola-mudou'
const CODE = /^[A-Z][A-Z0-9-]{1,23}$/
export const guestCartLimit = 20

// Sem armazenamento (janela privada, dados bloqueados), a sacola dura enquanto a página estiver aberta.
let memory: string[] = []
let cachedRaw: string | null | undefined
let cached: string[] = []
const none: string[] = []

function parse(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]')
    return Array.isArray(value) ? [...new Set(value.filter((code): code is string => typeof code === 'string' && CODE.test(code)))].slice(0, guestCartLimit) : []
  } catch { return [] }
}

function snapshot(): string[] {
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

export function writeGuestCart(codes: string[]) {
  memory = codes
  try {
    if (codes.length) localStorage.setItem(KEY, JSON.stringify(codes))
    else localStorage.removeItem(KEY)
  } catch { /* fica só na memória */ }
  window.dispatchEvent(new Event(CHANGE))
}

export function useGuestCartCodes(): string[] {
  return useSyncExternalStore(subscribe, snapshot, () => none)
}
