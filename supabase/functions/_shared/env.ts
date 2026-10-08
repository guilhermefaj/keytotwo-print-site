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

function required(name: string): string {
  const value = read(name)
  if (!value) throw new ConfigError(`Variável de ambiente ausente: ${name}`)
  return value
}

// Na nuvem as chaves novas chegam como JSON nomeado (SUPABASE_*_KEYS); a CLI local injeta uma chave só.
function apiKey(jsonName: string, singleName: string, keyName = 'default'): string {
  const json = read(jsonName)
  if (json) {
    let keys: Record<string, unknown>
    try {
      keys = JSON.parse(json)
    } catch {
      throw new ConfigError(`Variável de ambiente inválida: ${jsonName}`)
    }
    const key = keys[keyName]
    if (typeof key === 'string' && key) return key
  }
  return required(singleName)
}

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
  // Opcional no I2b: sem ela, o preço sai null (o site mostra "preço indisponível").
  stripeSecretKey: () => read('STRIPE_SECRET_KEY'),
  // Sem ALLOWED_ORIGINS nenhuma origem de navegador é aceita.
  allowedOrigins: () => (origins ??= parseOrigins()),
}
