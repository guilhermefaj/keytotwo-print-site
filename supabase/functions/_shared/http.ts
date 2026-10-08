// Códigos documentados em docs/api-contract.md.
export type ErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_TOKEN'
  | 'TERMS_NOT_ACCEPTED'
  | 'UNAUTHENTICATED'
  | 'EMAIL_NOT_CONFIRMED'
  | 'NOT_ENTITLED'
  | 'ORIGIN_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'FILE_NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'PRODUCT_UNAVAILABLE'
  | 'ALREADY_OWNED'
  | 'CART_EMPTY'
  | 'CART_CHANGED'
  | 'TERMS_CHANGED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INTERNAL_ERROR'
  | 'PAYMENT_PROVIDER_ERROR'
  | 'FILE_UNAVAILABLE'

// details: dado de apoio ao site (códigos de produto, versão do carrinho), nunca dado pessoal.
export interface ErrorExtra {
  headers?: HeadersInit
  details?: Record<string, unknown>
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly extra: ErrorExtra = {},
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}

export function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const merged = new Headers(BASE_HEADERS)
  new Headers(headers).forEach((value, name) => merged.set(name, value))
  return new Response(JSON.stringify(body), { status, headers: merged })
}

export function errorResponse(status: number, code: ErrorCode, message: string, extra: ErrorExtra = {}): Response {
  const error = extra.details ? { code, message, details: extra.details } : { code, message }
  return json({ error }, status, extra.headers)
}

// Nunca registra corpo, headers, e-mail ou token: só o tipo e a mensagem do erro.
export function toErrorResponse(error: unknown): Response {
  if (error instanceof HttpError) return errorResponse(error.status, error.code, error.message, error.extra)
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : typeof error
  console.error(`api: erro não tratado (${detail})`)
  return errorResponse(500, 'INTERNAL_ERROR', 'Erro interno. Tente de novo em instantes.')
}

const MAX_BODY_BYTES = 16 * 1024

export async function readJson(req: Request): Promise<unknown> {
  const type = req.headers.get('Content-Type') ?? ''
  if (!/^application\/json\s*(;|$)/i.test(type)) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Envie o corpo como application/json.')
  }
  const declared = Number(req.headers.get('Content-Length'))
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Corpo da requisição grande demais.')
  const bytes = new Uint8Array(await req.arrayBuffer())
  if (bytes.byteLength > MAX_BODY_BYTES) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Corpo da requisição grande demais.')
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new HttpError(400, 'INVALID_REQUEST', 'Corpo JSON inválido.')
  }
}

// Corpo JSON que precisa ser um objeto (as rotas leem campos nomeados).
export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  const body = await readJson(req)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'INVALID_REQUEST', 'O corpo precisa ser um objeto JSON.')
  }
  return body as Record<string, unknown>
}
