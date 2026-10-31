// Automações do marketing no Plunk (2026-10-31, fase 4), pela API do Plunk com a chave secreta do projeto. Cria o que
// falta (pelo nome) e não mexe no que já existe; as automações nascem desligadas. Os modelos (Boas-vindas 1, 2 e 3) já
// estão no Plunk. Nada daqui vai para o log além de nomes e ids.
//
//   node --env-file=<arquivo de segredos> deploy/plunk/automacoes.mjs            cria o que falta, desligado
//   node --env-file=<arquivo de segredos> deploy/plunk/automacoes.mjs --ligar    liga as duas automações
//
// Variáveis: PLUNK_SECRET_KEY, PLUNK_WEBHOOK_SECRET (o mesmo segredo da função plunk-webhook), SUPABASE_URL e, opcional,
// PLUNK_API_URL (padrão https://api.email.keytotwo.com.br).
//
// 1. "Boas-vindas" (evento inscricao, que o site manda na primeira inscrição; uma vez por pessoa):
//    Boas-vindas 1 → 3 dias → Boas-vindas 2 → 4 dias → já comprou? sai → inscrição mais de 7 dias antes da abertura das
//    vendas? sai (vai na campanha do lançamento) → Boas-vindas 3. O Plunk pula sozinho quem saiu da lista.
// 2. "Descadastro no Plunk → site" (evento contact.unsubscribed, a cada vez): avisa a função plunk-webhook.
// 3. Campanha "Lançamento: boas-vindas 3" em rascunho, para quem se inscreveu antes da trava e não comprou. Agendar
//    (09/11 às 19h) só com o OK do responsável, no painel do Plunk.

const API = (process.env.PLUNK_API_URL || 'https://api.email.keytotwo.com.br').replace(/\/+$/, '')
const KEY = process.env.PLUNK_SECRET_KEY
const HOOK_SECRET = process.env.PLUNK_WEBHOOK_SECRET
const FUNCTIONS = `${(process.env.SUPABASE_URL || '').replace(/\/+$/, '')}/functions/v1`
if (!KEY || !HOOK_SECRET || !process.env.SUPABASE_URL) throw new Error('faltam PLUNK_SECRET_KEY, PLUNK_WEBHOOK_SECRET ou SUPABASE_URL')

const WELCOME = 'Boas-vindas'
const UNSUBSCRIBE = 'Descadastro no Plunk → site'
const LAUNCH = 'Lançamento: boas-vindas 3'

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : {}
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json).slice(0, 200)}`)
  return json
}
const list = (json) => json.data ?? json.items ?? json.workflows ?? json.campaigns ?? json.templates ?? (Array.isArray(json) ? json : [])

const templates = list(await call('GET', '/templates?limit=100'))
const template = (prefix) => {
  const found = templates.find((t) => t.name.startsWith(prefix))
  if (!found) throw new Error(`modelo "${prefix}" não está no Plunk`)
  return found
}
const workflows = list(await call('GET', '/workflows?limit=100'))

// Um passo novo, sem ligação automática; a ligação vem depois, explícita.
const step = (workflowId, type, name, y, x, config, templateId) =>
  call('POST', `/workflows/${workflowId}/steps`, { type, name, position: { x, y }, config, templateId, autoConnect: false })
const link = (workflowId, fromStepId, toStepId, branch) =>
  call('POST', `/workflows/${workflowId}/transitions`, { fromStepId, toStepId, ...(branch ? { condition: { branch } } : {}) })
const triggerOf = async (workflowId) => (await call('GET', `/workflows/${workflowId}`)).steps.find((s) => s.type === 'TRIGGER')

async function createWelcome() {
  const wf = await call('POST', '/workflows', {
    name: WELCOME, eventName: 'inscricao', allowReentry: false, enabled: false,
    description: 'Três e-mails depois da primeira inscrição no site. Quem comprou não recebe o 3º; quem se inscreveu mais de 7 dias antes da abertura das vendas recebe o 3º na campanha do lançamento.',
  })
  const trigger = await triggerOf(wf.id)
  const bv1 = await step(wf.id, 'SEND_EMAIL', 'Boas-vindas 1', 250, 100, { templateId: template('Boas-vindas 1').id }, template('Boas-vindas 1').id)
  const wait3 = await step(wf.id, 'DELAY', 'Espera 3 dias', 400, 100, { amount: 3, unit: 'days' })
  const bv2 = await step(wf.id, 'SEND_EMAIL', 'Boas-vindas 2', 550, 100, { templateId: template('Boas-vindas 2').id }, template('Boas-vindas 2').id)
  const wait4 = await step(wf.id, 'DELAY', 'Espera 4 dias', 700, 100, { amount: 4, unit: 'days' })
  const bought = await step(wf.id, 'CONDITION', 'Já comprou?', 850, 100, { field: 'data.comprou', operator: 'equals', value: true })
  const exitBought = await step(wf.id, 'EXIT', 'Sai: já comprou', 1000, 400, { reason: 'já comprou' })
  const launch = await step(wf.id, 'CONDITION', 'Inscrição antes da trava do lançamento?', 1000, 100, { field: 'data.boas_vindas_no_lancamento', operator: 'equals', value: true })
  const exitLaunch = await step(wf.id, 'EXIT', 'Sai: vai na campanha do lançamento', 1150, 400, { reason: 'campanha do lançamento' })
  const bv3 = await step(wf.id, 'SEND_EMAIL', 'Boas-vindas 3', 1150, 100, { templateId: template('Boas-vindas 3').id }, template('Boas-vindas 3').id)
  await link(wf.id, trigger.id, bv1.id)
  await link(wf.id, bv1.id, wait3.id)
  await link(wf.id, wait3.id, bv2.id)
  await link(wf.id, bv2.id, wait4.id)
  await link(wf.id, wait4.id, bought.id)
  await link(wf.id, bought.id, exitBought.id, 'yes')
  await link(wf.id, bought.id, launch.id, 'no')
  await link(wf.id, launch.id, exitLaunch.id, 'yes')
  await link(wf.id, launch.id, bv3.id, 'no')
  return wf
}

async function createUnsubscribe() {
  const wf = await call('POST', '/workflows', {
    name: UNSUBSCRIBE, eventName: 'contact.unsubscribed', allowReentry: true, enabled: false,
    description: 'Quem sai da lista pelo rodapé de um e-mail do Plunk sai também no site (função plunk-webhook). A pausa não conta.',
  })
  const trigger = await triggerOf(wf.id)
  const hook = await step(wf.id, 'WEBHOOK', 'Avisa o site', 250, 100, {
    url: `${FUNCTIONS}/plunk-webhook`, method: 'POST',
    headers: { Authorization: `Bearer ${HOOK_SECRET}` },
    body: { email: '{{email}}', motivo: '{{event.reason}}' },
  })
  await link(wf.id, trigger.id, hook.id)
  return wf
}

async function ensure(name, create) {
  const found = workflows.find((w) => w.name === name)
  if (found) return { wf: found, created: false }
  return { wf: await create(), created: true }
}

const welcome = await ensure(WELCOME, createWelcome)
const unsubscribe = await ensure(UNSUBSCRIBE, createUnsubscribe)

const campaigns = list(await call('GET', '/campaigns?limit=100'))
let campaign = campaigns.find((c) => c.name === LAUNCH)
if (!campaign) {
  const bv3 = template('Boas-vindas 3')
  campaign = await call('POST', '/campaigns', {
    name: LAUNCH,
    description: 'O 3º e-mail das boas-vindas na abertura das vendas (09/11 às 19h), para quem se inscreveu mais de 7 dias antes e ainda não comprou.',
    subject: bv3.subject, body: bv3.body, from: bv3.from, fromName: bv3.fromName, replyTo: bv3.replyTo, type: 'MARKETING',
    audienceType: 'FILTERED',
    audienceCondition: {
      logic: 'AND',
      groups: [{ filters: [
        { field: 'subscribed', operator: 'equals', value: true },
        { field: 'data.boas_vindas_no_lancamento', operator: 'equals', value: true },
        { field: 'data.comprou', operator: 'equals', value: false },
      ] }],
    },
  })
  campaign = campaign.data ?? campaign
  console.log(`campanha criada em rascunho: ${LAUNCH} (${campaign.id})`)
} else {
  console.log(`campanha já existe: ${LAUNCH} (${campaign.id}, ${campaign.status})`)
}

for (const { wf, created } of [welcome, unsubscribe]) {
  if (process.argv.includes('--ligar') && !wf.enabled) await call('PATCH', `/workflows/${wf.id}`, { enabled: true })
  const now = await call('GET', `/workflows/${wf.id}`)
  console.log(`${created ? 'criada' : 'já existe'}: ${now.name} (${now.id}) · ${now.steps.length} passos · ${now.enabled ? 'ligada' : 'desligada'}`)
}
