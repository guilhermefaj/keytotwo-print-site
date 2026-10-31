export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

function read(name: string): string | undefined {
  const value = Deno.env.get(name)?.trim()
  return value ? value : undefined
}

export function required(name: string): string {
  const value = read(name)
  if (!value) throw new ConfigError(`Variável de ambiente ausente: ${name}`)
  return value
}

// Na nuvem as chaves novas chegam como JSON nomeado (SUPABASE_*_KEYS); a CLI local injeta uma chave só.
function namedKey(jsonName: string, keyName: string): string | undefined {
  const json = read(jsonName)
  if (!json) return undefined
  let keys: Record<string, unknown>
  try {
    keys = JSON.parse(json)
  } catch {
    throw new ConfigError(`Variável de ambiente inválida: ${jsonName}`)
  }
  const key = keys[keyName]
  return typeof key === 'string' && key ? key : undefined
}

const apiKey = (jsonName: string, singleName: string) => namedKey(jsonName, 'default') ?? required(singleName)

let origins: readonly string[] | undefined

function parseOrigins(): readonly string[] {
  const list = (read('ALLOWED_ORIGINS') ?? '').split(',').map((item) => item.trim()).filter(Boolean)
  return list.map((item) => {
    let origin: string
    try {
      origin = new URL(item).origin
    } catch {
      throw new ConfigError('Variável de ambiente inválida: ALLOWED_ORIGINS')
    }
    if (origin === 'null') throw new ConfigError('Variável de ambiente inválida: ALLOWED_ORIGINS')
    return origin
  })
}

export const env = {
  supabaseUrl: () => required('SUPABASE_URL'),
  publishableKey: () => apiKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_PUBLISHABLE_KEY'),
  secretKey: () => apiKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SECRET_KEY'),
  // Opcional na leitura de preço (sem ela, o preço sai null); obrigatória no checkout e no webhook.
  stripeSecretKey: () => read('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: () => required('STRIPE_WEBHOOK_SECRET'),
  siteUrl: () => required('SITE_URL').replace(/\/+$/, ''),
  // Admin: base dos links do e-mail de alerta dos admins.
  adminUrl: () => required('ADMIN_URL').replace(/\/+$/, ''),
  termsVersion: () => required('TERMS_VERSION'),
  // Sem ALLOWED_ORIGINS nenhuma origem de navegador é aceita.
  allowedOrigins: () => (origins ??= parseOrigins()),
  // Base pública da api nos links dos e-mails (no local, SUPABASE_URL é o endereço interno do gateway).
  apiPublicUrl: () => (read('API_PUBLIC_URL') ?? `${required('SUPABASE_URL').replace(/\/+$/, '')}/functions/v1/api`).replace(/\/+$/, ''),
  // Links HMAC dos e-mails: o atual assina e verifica; o anterior (opcional) só verifica, durante a rotação.
  emailLinkSecrets: () => [required('EMAIL_LINK_SECRET'), read('EMAIL_LINK_SECRET_PREVIOUS')].filter((s): s is string => Boolean(s)),
  // Segredo da agenda do banco (email-dispatch e /internal/discounts/tick), que vem do Vault no header apikey. Desde
  // 2026-10-25, na nuvem, um segredo próprio (DISPATCH_SECRET), sem poder nenhum no banco; antes era uma chave secreta
  // do Supabase. Sem ele (local), a chave nomeada "dispatch" e, por fim, a "default".
  dispatchKey: () => read('DISPATCH_SECRET') ?? namedKey('SUPABASE_SECRET_KEYS', 'dispatch') ?? apiKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SECRET_KEY'),
  // log (padrão): nada sai para fora; plunk: envio real pelo Plunk (Amazon SES). O modo brevo saiu em 2026-10-31.
  emailMode: () => (read('EMAIL_MODE') === 'plunk' ? 'plunk' : 'log') as 'plunk' | 'log',
  // Plunk (na VPS): base da API (https://api.email.keytotwo.com.br) e a chave secreta do projeto (sk_…).
  plunkApiUrl: () => required('PLUNK_API_URL').replace(/\/+$/, ''),
  plunkSecretKey: () => required('PLUNK_SECRET_KEY'),
  // Com os dois, a exclusão de conta apaga o contato no Plunk (em qualquer modo).
  plunkConfigured: () => Boolean(read('PLUNK_API_URL') && read('PLUNK_SECRET_KEY')),
  // Token Bearer do passo de webhook da automação "Descadastro no Plunk" (a função plunk-webhook).
  plunkWebhookSecret: () => required('PLUNK_WEBHOOK_SECRET'),
  // Tópico SNS dos eventos do SES: a ses-events só aceita mensagens assinadas dele.
  sesEventsTopicArn: () => required('SES_EVENTS_TOPIC_ARN'),
  emailLogMailpitUrl: () => read('EMAIL_LOG_MAILPIT_URL')?.replace(/\/+$/, ''),
  emailFrom: () => ({ email: required('EMAIL_FROM'), name: read('EMAIL_FROM_NAME') ?? 'KeyToTwo' }),
  // Lista de destinatários permitidos fora da produção (vírgula); vazia = todos.
  emailAllowedRecipients: () => (read('EMAIL_ALLOWED_RECIPIENTS') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
}
