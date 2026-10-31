// Testes de contrato da ses-events (docs/api-contract.md 8.3): avisos do Amazon SES pelo Amazon SNS, sem rede.
// O SNS assina com a chave do certificado dele (RSA-SHA256); aqui a chave é gerada na hora e o PEM baixado do SNS
// simulado vira essa chave. A leitura do certificado de verdade vale na confirmação da inscrição em produção.
import { assert, assertEquals } from '@std/assert'
import { captureErrors, contractTest, onRpc, onSns, row, rpcCalls, SES_TOPIC_ARN, snsCalls } from './contract-helpers.ts'
import { X509Certificate } from 'node:crypto'
import { handleSesEvents, snsKeys, spkiFromPem } from '../ses-events/handler.ts'

// Certificado autoassinado de teste (só a parte pública, RSA 2048, com a versão v3 explícita, como os do SNS).
const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIDLTCCAhWgAwIBAgIUIzPRroNUgkKHMsZPewKK6WSJ25UwDQYJKoZIhvcNAQEL
BQAwJjEkMCIGA1UEAwwbc25zLnVzLWVhc3QtMi5hbWF6b25hd3MuY29tMB4XDTI2
MTAzMTE2NTIxOFoXDTM2MTAyODE2NTIxOFowJjEkMCIGA1UEAwwbc25zLnVzLWVh
c3QtMi5hbWF6b25hd3MuY29tMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKC
AQEAi257ZGcrO04QsjkkVxhl2eplrjRCON0ycoxGH6SEXOJSQ1FqRQYUT78wBLtw
BzriXQ2ExKOG240V4AaH4HIvWTBeAzbREW2X3h5uEG55YLrcULePmOBOoANpSSWL
J67UGbzyRwSmghTtvc6v9+PGx/5i8z3Y22/8ATSMd8AY3mHvsieI9AaYhTXai2l/
jQ0fGPFNbJkXwCQOoT67eEnnmtZi5Roh5LOLsVDdZwY/Ba7d3pAi7rLqjVxQClFJ
roh4CCyBqQnz+hZuPxrhb4pWOqq/10jiahQS0ilacwMFxQLkmt27/PkODEHlVhC0
R74V4rn+UaiPsYdoaezmGfLMhwIDAQABo1MwUTAdBgNVHQ4EFgQUfZAzjWq3BXzV
SL/5Y9y6LTw+dbowHwYDVR0jBBgwFoAUfZAzjWq3BXzVSL/5Y9y6LTw+dbowDwYD
VR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAKskfbPp9laIZRo6/ijm0
ck2W5qNCUtxIyPhX2FYq4FZAs1ro0duORxUW0cBVvCJRwcR49TbBJsgsqjz5nxHU
tFtgPyKtMrUlPNLVHuYXcmXPzDoCsVCjtDvrOgBMjWmWpGpyLQ4q2SzStmkXfoi+
P9W5ceiNwTX0wdiiFhe+AFGUA1wxjrC/SHuPLmEvYPaDqqthedOF5GamCoeI3XWZ
vCrlDHuMgMKugzgL4LV2i+t1xt/4rkDNhtKA7IGlH8RscBnoMVYsnbYwEz0E7A1S
178wYR4wPBKv4e92X+UmWbzIVV9r0bVlleHInYFJGt3liZMhJKb7mi0d0ydIeryu
6A==
-----END CERTIFICATE-----`

// A função lê a chave do certificado sem node:crypto; aqui o node:crypto (do Deno dos testes) confere o resultado.
const realFromPem = snsKeys.fromPem

contractTest('ses-events: a chave pública sai do certificado igual à do node:crypto e vira chave de verificação', async () => {
  assertEquals(spkiFromPem(TEST_CERT), new Uint8Array(new X509Certificate(TEST_CERT).publicKey.export({ type: 'spki', format: 'der' })))
  const key = await realFromPem(TEST_CERT)
  assertEquals([key.type, key.algorithm.name, key.usages], ['public', 'RSASSA-PKCS1-v1_5', ['verify']])
  for (const bad of ['', '-----BEGIN CERTIFICATE-----\nMAA=\n-----END CERTIFICATE-----', TEST_CERT.replace('MIIDLTCC', 'MIIDLTCD')]) {
    let failed = false
    try {
      spkiFromPem(bad)
    } catch {
      failed = true
    }
    assert(failed, `deveria recusar: ${bad.slice(0, 40)}`)
  }
})

const pair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify'],
)
snsKeys.fromPem = (pem: string) => pem === 'PEM-DE-TESTE' ? Promise.resolve(pair.publicKey) : Promise.reject(new Error('pem inesperado'))

const CERT = 'https://sns.us-east-2.amazonaws.com/SimpleNotificationService-teste.pem'
const CONFIRM = `https://sns.us-east-2.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${SES_TOPIC_ARN}&Token=tok`
const snsOk = () => onSns((url) => ({ status: 200, body: url.endsWith('.pem') ? 'PEM-DE-TESTE' : '<ConfirmSubscriptionResponse/>' }))

type Fields = Record<string, string>

// Assina como o SNS: os campos do tipo, em ordem, como "nome\nvalor\n".
async function signed(fields: Fields, cert = CERT): Promise<Fields> {
  const order = fields.Type === 'Notification'
    ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
    : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']
  const text = order.filter((k) => k in fields).map((k) => `${k}\n${fields[k]}\n`).join('')
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(text)))
  return { ...fields, SignatureVersion: '2', Signature: btoa(String.fromCharCode(...signature)), SigningCertURL: cert }
}

const notification = (event: unknown, extra: Fields = {}) =>
  signed({ Type: 'Notification', MessageId: 'sns-1', TopicArn: SES_TOPIC_ARN, Message: JSON.stringify(event), Timestamp: '2026-10-31T16:00:00.000Z', ...extra })

const confirmation = (subscribeUrl = CONFIRM) =>
  signed({ Type: 'SubscriptionConfirmation', MessageId: 'sns-0', TopicArn: SES_TOPIC_ARN, Message: 'Confirme', SubscribeURL: subscribeUrl, Token: 'tok', Timestamp: '2026-10-31T16:00:00.000Z' })

const post = (body: unknown) => handleSesEvents(new Request('http://localhost/ses-events', {
  method: 'POST', headers: { 'Content-Type': 'text/plain; charset=UTF-8' }, body: typeof body === 'string' ? body : JSON.stringify(body),
}))

const status = async (body: unknown) => (await captureErrors(() => post(body))).result.status

const BOUNCE = {
  eventType: 'Bounce',
  mail: { messageId: '0100-ses-1', destination: ['a@example.com', 'b@example.com'] },
  bounce: { bounceType: 'Permanent', bounceSubType: 'General', bouncedRecipients: [{ emailAddress: ' A@Example.com ' }, { emailAddress: 'b@example.com' }], timestamp: '2026-10-31T15:59:58.000Z' },
}

contractTest('ses-events: método 405, corpo inválido 400, tópico, assinatura ou certificado errados 400, sem tocar no banco', async () => {
  onRpc(() => row({ outcome: 'applied', user_id: null }))
  snsOk()
  assertEquals((await handleSesEvents(new Request('http://localhost/ses-events'))).status, 405)
  assertEquals(await status('{'), 400)
  assertEquals(await status('[]'), 400)

  const good = await notification(BOUNCE)
  assertEquals(await status({ ...good, TopicArn: 'arn:aws:sns:us-east-2:999999999999:outro' }), 400)
  assertEquals(await status({ ...good, Message: JSON.stringify({ ...BOUNCE, mail: { messageId: 'trocado' } }) }), 400)
  assertEquals(await status({ ...good, Signature: 'não é base64!' }), 400)
  assertEquals(await status({ ...good, SignatureVersion: '1' }), 400)
  for (const cert of [
    'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-teste.pem',
    'http://sns.us-east-2.amazonaws.com/SimpleNotificationService-teste.pem',
    'https://sns.us-east-2.amazonaws.com.example/SimpleNotificationService-teste.pem',
    'https://sns.us-east-2.amazonaws.com/outro.txt',
  ]) assertEquals(await status({ ...good, SigningCertURL: cert }), 400, cert)
  assertEquals(rpcCalls.length, 0)
  assert(snsCalls.every((url) => url === CERT))
})

contractTest('ses-events: confirma a inscrição só no endereço do SNS da região do tópico', async () => {
  snsOk()
  const res = await post(await confirmation())
  assertEquals([res.status, await res.json()], [200, { confirmed: true }])
  assert(snsCalls.includes(CONFIRM))

  snsOk()
  assertEquals(await status(await confirmation('https://example.com/?Action=ConfirmSubscription')), 400)
  assert(!snsCalls.some((url) => url.startsWith('https://example.com')))

  onSns((url) => (url.endsWith('.pem') ? { status: 200, body: 'PEM-DE-TESTE' } : { status: 500, body: '' }))
  assertEquals(await status(await confirmation()), 500)
})

contractTest('ses-events: bounce definitivo e reclamação viram record_email_event com origem ses_events; o resto é ignorado', async () => {
  snsOk()
  onRpc(() => row({ outcome: 'applied', user_id: null }))
  const bounce = await post(await notification(BOUNCE))
  assertEquals([bounce.status, await bounce.json()], [200, { received: 2, recorded: 2, ignored: 0 }])
  assertEquals(rpcCalls.map((c) => [c.fn, c.secretKeyOk, c.args]), [
    ['record_email_event', true, { p_email: 'a@example.com', p_event: 'hard_bounce', p_provider_message_id: '0100-ses-1', p_occurred_at: '2026-10-31T15:59:58.000Z', p_source: 'ses_events' }],
    ['record_email_event', true, { p_email: 'b@example.com', p_event: 'hard_bounce', p_provider_message_id: '0100-ses-1', p_occurred_at: '2026-10-31T15:59:58.000Z', p_source: 'ses_events' }],
  ])

  // Formato das notificações da identidade (notificationType), com assunto: também vale.
  onRpc(() => row({ outcome: 'applied', user_id: null }))
  const complaint = await post(await notification({
    notificationType: 'Complaint', mail: { messageId: '0100-ses-2' },
    complaint: { complainedRecipients: [{ emailAddress: 'c@example.com' }], timestamp: '2026-10-31T16:01:00.000Z' },
  }, { Subject: 'Amazon SES Email Event Notification' }))
  assertEquals([complaint.status, (await complaint.json()).recorded], [200, 1])
  assertEquals([rpcCalls[0].args.p_event, rpcCalls[0].args.p_email, rpcCalls[0].args.p_source], ['complaint', 'c@example.com', 'ses_events'])

  onRpc(() => row({ outcome: 'applied', user_id: null }))
  for (const event of [
    { ...BOUNCE, bounce: { ...BOUNCE.bounce, bounceType: 'Transient' } },
    { eventType: 'Delivery', mail: { messageId: '0100-ses-3' }, delivery: { recipients: ['d@example.com'] } },
    { eventType: 'Open', mail: { messageId: '0100-ses-4' } },
  ]) {
    const res = await post(await notification(event))
    assertEquals([res.status, await res.json()], [200, { received: 0, recorded: 0, ignored: 1 }])
  }
  assertEquals(rpcCalls.length, 0)
  assertEquals(await status(await notification('não é um objeto')), 400)
  assertEquals(await status(await signed({ Type: 'Notification', MessageId: 'sns-9', TopicArn: SES_TOPIC_ARN, Message: '{', Timestamp: '2026-10-31T16:00:00.000Z' })), 400)
})

contractTest('ses-events: KT001 é ignorado; falha do banco ou do certificado vira 500 para o SNS reenviar, sem e-mail no log', async () => {
  snsOk()
  onRpc(() => ({ status: 400, body: { code: 'KT001', message: 'e-mail inválido' } }))
  const { result: invalid } = await captureErrors(async () => await post(await notification(BOUNCE)))
  assertEquals(await invalid.json(), { received: 2, recorded: 0, ignored: 2 })

  onRpc(() => ({ status: 503, body: { message: 'indisponível' } }))
  const { result: down, logs } = await captureErrors(async () => await post(await notification(BOUNCE)))
  assertEquals(down.status, 500)
  assert(!logs.join('\n').toLowerCase().includes('example.com'))

  // Certificado fora do ar: 500 e nada guardado; na próxima mensagem o certificado é baixado de novo.
  const other = 'https://sns.us-east-2.amazonaws.com/SimpleNotificationService-outro.pem'
  onRpc(() => row({ outcome: 'applied', user_id: null }))
  onSns(() => ({ status: 503, body: '' }))
  assertEquals((await captureErrors(async () => await post(await signed({ Type: 'Notification', MessageId: 'sns-2', TopicArn: SES_TOPIC_ARN, Message: JSON.stringify(BOUNCE), Timestamp: '2026-10-31T16:00:00.000Z' }, other)))).result.status, 500)
  snsOk()
  const again = await post(await signed({ Type: 'Notification', MessageId: 'sns-2', TopicArn: SES_TOPIC_ARN, Message: JSON.stringify(BOUNCE), Timestamp: '2026-10-31T16:00:00.000Z' }, other))
  assertEquals([again.status, snsCalls], [200, [other]])
})
