// Limite por visitante da api (_shared/rate-limit.ts), sem rede e sem banco.
import { assertEquals } from '@std/assert'
import { contractTest, request, usageCalls } from './contract-helpers.ts'
import { handleRequest } from '../api/router.ts'
import { clientIp, hit, rateLimit, resetRateLimit, ruleFor } from '../_shared/rate-limit.ts'

const from = (ip: string) => ({ 'cf-connecting-ip': ip })
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

contractTest('limite: cada rota cai na regra certa e admin e agendamentos ficam de fora', () => {
  assertEquals(ruleFor('/admin/users'), null)
  assertEquals(ruleFor('/internal/uptime'), null)
  for (const path of ['/free/pote-de-planos', '/free-download', '/download-url', '/d/abc']) assertEquals(ruleFor(path)?.name, 'download')
  for (const path of ['/checkout', '/checkout/terms']) assertEquals(ruleFor(path)?.name, 'checkout')
  for (const path of ['/account/delete', '/csp-report', '/referral/visit', '/email/unsubscribe']) assertEquals(ruleFor(path)?.name, 'form')
  for (const path of ['/catalog', '/free-games', '/account', '/rota-que-nao-existe']) assertEquals(ruleFor(path)?.name, 'general')
})

contractTest('limite: sem endereço conhecido, o pedido segue', () => {
  resetRateLimit()
  const req = request('/checkout', { method: 'POST' })
  assertEquals(clientIp(req), null)
  for (let i = 0; i < 100; i++) assertEquals(rateLimit(req, '/checkout'), null)
})

contractTest('limite: a janela conta, barra e libera de novo', () => {
  resetRateLimit()
  const rule = { name: 'teste', limit: 2, windowMs: 1000 }
  assertEquals(hit('a', rule, 0), null)
  assertEquals(hit('a', rule, 10), null)
  assertEquals(hit('a', rule, 500), 1)
  assertEquals(hit('b', rule, 500), null)
  assertEquals(hit('a', rule, 1000), null)
})

contractTest('limite na api: responde 429 com Retry-After, não vai ao banco e não afeta outro visitante', async () => {
  resetRateLimit()
  for (let i = 0; i < 20; i++) await handleRequest(request('/checkout', { method: 'POST', headers: from('203.0.113.9') }))
  await settle()
  const counted = usageCalls.length
  const blocked = await handleRequest(request('/checkout', { method: 'POST', headers: from('203.0.113.9') }))
  await settle()
  assertEquals(blocked.status, 429)
  assertEquals((await blocked.json()).error.code, 'RATE_LIMITED')
  assertEquals(blocked.headers.get('Retry-After'), '60')
  assertEquals(usageCalls.length, counted)
  const other = await handleRequest(request('/checkout', { method: 'POST', headers: from('203.0.113.10') }))
  assertEquals(other.status === 429, false)
  await other.body?.cancel()
})

contractTest('limite na api: o preflight do navegador não conta', async () => {
  resetRateLimit()
  for (let i = 0; i < 40; i++) {
    const response = await handleRequest(request('/checkout', { method: 'OPTIONS', headers: from('203.0.113.11') }))
    assertEquals(response.status === 429, false)
    await response.body?.cancel()
  }
})
