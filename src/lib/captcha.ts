import { useCallback, useEffect, useRef } from 'react'

// Turnstile da Cloudflare (2026-11-09): confirma que é gente quem pede código ou entra com senha, quase sempre sem
// mostrar nada na tela. Quem exige o token é o Auth da Supabase (Bot and Abuse Protection); o site só o obtém e envia.
// Se o Turnstile não carregar, o pedido segue sem token e a Supabase decide: com o captcha ligado, responde
// captcha_failed, e a tela sugere recarregar ou entrar com o Google, que não passa pelo captcha.
// A chave é pública e só vale nos domínios cadastrados no widget.
const SITE_KEY: string = import.meta.env?.VITE_TURNSTILE_SITE_KEY ?? '0x4AAAAAAF6aL9Z1XZcA8Ur8'
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const WAIT_MS = 8_000
// Quando o Turnstile pede um clique, a pessoa precisa de tempo para ver e responder.
const WAIT_INTERACTIVE_MS = 90_000

type Turnstile = {
  render(container: HTMLElement, options: Record<string, unknown>): string
  reset(widget: string): void
  remove(widget: string): void
}
declare global {
  interface Window { turnstile?: Turnstile }
}

let script: Promise<void> | undefined
function loadScript(attempt = 1): Promise<void> {
  script ??= new Promise<void>((resolve, reject) => {
    const element = document.createElement('script')
    element.src = SCRIPT
    element.async = true
    element.nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce ?? ''
    element.onload = () => resolve()
    // Queda momentânea de conexão: tenta de novo antes de desistir, porque sem o token a entrada por e-mail falha.
    element.onerror = () => {
      element.remove()
      script = undefined
      if (attempt >= 3) reject(new Error('turnstile'))
      else window.setTimeout(() => loadScript(attempt + 1).then(resolve, reject), attempt * 1000)
    }
    document.head.append(element)
  })
  return script
}

// Só nos domínios reais: em localhost e nos testes não há desafio, e o Auth local não pede token.
export const captchaActive = (hostname = location.hostname) => Boolean(SITE_KEY) && /(^|\.)keytotwo\.com\.br$/.test(hostname)

// `boxRef` vai num <div> que fica montado em todos os passos da tela. O script só carrega em quem usa o hook.
export function useCaptcha() {
  const boxRef = useRef<HTMLDivElement>(null)
  const widget = useRef<string | null>(null)
  const token = useRef('')
  const interactive = useRef(false)

  useEffect(() => {
    if (!captchaActive()) return
    let cancelled = false
    loadScript().then(() => {
      if (cancelled || !boxRef.current || !window.turnstile) return
      widget.current = window.turnstile.render(boxRef.current, {
        sitekey: SITE_KEY,
        language: 'pt-br',
        theme: 'light',
        size: 'flexible',
        appearance: 'interaction-only',
        callback: (value: string) => { token.current = value; interactive.current = false },
        'expired-callback': () => { token.current = '' },
        'before-interactive-callback': () => { interactive.current = true },
        'error-callback': () => { token.current = ''; return true },
      })
    }).catch(() => undefined)
    return () => {
      cancelled = true
      if (widget.current) window.turnstile?.remove(widget.current)
      widget.current = null
      token.current = ''
    }
  }, [])

  const getToken = useCallback(async () => {
    if (!captchaActive()) return undefined
    const started = Date.now()
    while (!token.current) {
      if (Date.now() - started > (interactive.current ? WAIT_INTERACTIVE_MS : WAIT_MS)) return undefined
      await new Promise(resolve => window.setTimeout(resolve, 150))
    }
    return token.current
  }, [])

  // Cada token vale uma vez: depois de usar, o widget gera outro.
  const reset = useCallback(() => {
    token.current = ''
    if (widget.current) window.turnstile?.reset(widget.current)
  }, [])

  return { boxRef, getToken, reset }
}
