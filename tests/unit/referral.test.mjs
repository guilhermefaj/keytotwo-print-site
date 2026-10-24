import assert from 'node:assert/strict'
import { test } from 'node:test'

// Indicação no navegador (src/lib/referral.ts), com um localStorage de mentira.
const storage = new Map()
globalThis.window = new EventTarget()
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) }
const { captureReferral, readReferral: lastWritten, referralForOrder, referralFromUrl, writeReferral } = await import('../../src/lib/referral.ts')

test('indicação: o link do parceiro e as marcas de campanha; o resto da URL não conta', () => {
  const landed = referralFromUrl(new URL('https://keytotwo.com.br/loja/pacote?p=Ana-Souza&utm_source=instagram&utm_medium=stories&x=1'))
  assert.equal(landed.partner, 'ana-souza')
  assert.deepEqual([landed.path, landed.utm_source, landed.utm_medium, landed.utm_campaign], ['/loja/pacote', 'instagram', 'stories', undefined])
  assert.equal(referralFromUrl(new URL('https://keytotwo.com.br/loja?x=1')), null)
  assert.equal(referralFromUrl(new URL('https://keytotwo.com.br/?p=ana%20souza')), null)
  assert.equal(referralFromUrl(new URL('https://keytotwo.com.br/?p=ana%20souza&utm_source=tiktok')).partner, undefined)
})

test('indicação: conta a visita uma vez por dia; parceiro que não vale fica só com a campanha; o pedido não leva o nome', async () => {
  writeReferral(null)
  const visits = []
  const visit = async (partner) => { visits.push(partner); return partner === 'ana-souza' ? { name: 'Ana Souza', code: 'ANA10', percent_off: 10 } : null }
  const seen = []
  window.addEventListener('keytotwo:indicacao-mudou', () => seen.push(true))

  await captureReferral(new URL('https://keytotwo.com.br/?p=ana-souza&utm_source=instagram'), visit)
  await captureReferral(new URL('https://keytotwo.com.br/loja?p=ana-souza'), visit)
  assert.deepEqual(visits, ['ana-souza'])

  // o segundo link (mesmo dia) troca as marcas, mantém o que a API disse e não conta de novo
  const order = referralForOrder(lastWritten())
  assert.deepEqual(Object.keys(order).sort(), ['landed_at', 'partner', 'path'])
  assert.equal(order.path, '/loja')

  await captureReferral(new URL('https://keytotwo.com.br/?p=pausado&utm_campaign=natal'), visit)
  assert.deepEqual(visits, ['ana-souza', 'pausado'])
  assert.deepEqual(Object.keys(referralForOrder(lastWritten())).sort(), ['landed_at', 'path', 'utm_campaign'])

  // a API falhou: a indicação fica guardada sem o nome, e a próxima página tenta de novo
  await captureReferral(new URL('https://keytotwo.com.br/?p=ana-souza'), async () => { throw new Error('rede') })
  assert.equal(lastWritten().name, undefined)
  assert.equal(lastWritten().partner, 'ana-souza')
  assert.ok(seen.length > 0)
})

test('indicação: depois de 30 dias não vale mais', () => {
  writeReferral({ partner: 'ana-souza', landed_at: new Date(Date.now() - 31 * 86_400_000).toISOString(), path: '/' })
  assert.equal(lastWritten(), null)
})
