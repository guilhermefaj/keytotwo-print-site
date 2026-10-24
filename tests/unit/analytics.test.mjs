import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'

// O GA só liga no build live, no domínio real: o módulo de configuração vira um stub desse cenário, e o navegador
// é o mínimo que o analytics.ts usa (window com eventos, localStorage, document com cookie e <head>).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './seo' && context.parentURL?.endsWith('/src/lib/analytics.ts')) {
      return { url: 'data:text/javascript,export const siteConfig = { stage: "live", origin: "https://keytotwo.com.br" }', shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const store = new Map()
globalThis.window = Object.assign(new EventTarget(), { location: { hostname: 'keytotwo.com.br' } })
globalThis.location = window.location
globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)) }
globalThis.document = { cookie: '', head: { append() {} }, createElement: () => ({}) }

const { setCookieChoice, track } = await import('../../src/lib/analytics.ts')
const pushed = () => window.dataLayer.map(args => [...args])
const events = () => pushed().filter(([kind]) => kind === 'event').map(([, name]) => name)

test('recusar para os eventos na hora; aceitar de novo, na mesma página, volta a medir', () => {
  setCookieChoice('granted')
  track('view_item')
  assert.deepEqual(events(), ['view_item'])

  setCookieChoice('denied')
  assert.equal(window['ga-disable-G-9NVMZZS65E'], true)
  assert.deepEqual(pushed().at(-1), ['consent', 'update', { analytics_storage: 'denied' }])
  track('add_to_cart')
  assert.deepEqual(events(), ['view_item'], 'depois de recusar, nenhum evento sai')

  setCookieChoice('granted')
  assert.equal(window['ga-disable-G-9NVMZZS65E'], false)
  assert.deepEqual(pushed().at(-1), ['consent', 'update', { analytics_storage: 'granted' }])
  track('purchase')
  assert.deepEqual(events(), ['view_item', 'purchase'])
  // O gtag não é instalado duas vezes.
  assert.equal(pushed().filter(([kind]) => kind === 'config').length, 1)
})
