// Códigos documentados em docs/api-contract.md.
export type ErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_TOKEN'
  | 'INVALID_SIGNATURE'
  | 'TERMS_NOT_ACCEPTED'
  | 'UNAUTHENTICATED'
  | 'EMAIL_NOT_CONFIRMED'
  | 'NOT_ENTITLED'
  | 'FREE_GAMES_LOCKED'
  | 'NOT_ADMIN'
  | 'MFA_REQUIRED'
  | 'EDIT_CONFLICT'
  | 'SLUG_TAKEN'
  | 'SLUG_LOCKED'
  | 'IMAGE_IN_USE'
  | 'PROTECTED_ACCOUNT'
  | 'ALREADY_REVOKED'
  | 'ORDER_NOT_DELIVERABLE'
  | 'EMAIL_ALREADY_QUEUED'
  | 'NOT_SUBSCRIBED'
  | 'ALREADY_BLOCKED'
  | 'NOT_BLOCKED'
  | 'TARGET_NOT_CONFIRMED'
  | 'ORIGIN_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'FILE_NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'PRODUCT_UNAVAILABLE'
  | 'ALREADY_OWNED'
  | 'CART_EMPTY'
  | 'CART_CHANGED'
  | 'TERMS_CHANGED'
  | 'ACCOUNT_DELETION_BLOCKED'
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

// Corpo em bytes, com limite de tamanho (16 KB por padrão).
export async function readBytes(req: Request, maxBytes = MAX_BODY_BYTES): Promise<Uint8Array> {
  const declared = Number(req.headers.get('Content-Length'))
  if (declared > maxBytes) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Corpo da requisição grande demais.')
  const bytes = new Uint8Array(await req.arrayBuffer())
  if (bytes.byteLength > maxBytes) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Corpo da requisição grande demais.')
  return bytes
}

// Corpo como texto, com o mesmo limite.
export async function readText(req: Request, maxBytes = MAX_BODY_BYTES): Promise<string> {
  return new TextDecoder().decode(await readBytes(req, maxBytes))
}

export const isContentType = (req: Request, type: string) =>
  new RegExp(`^${type.replace('/', '\\/')}\\s*(;|$)`, 'i').test(req.headers.get('Content-Type') ?? '')

export async function readJson(req: Request, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  if (!isContentType(req, 'application/json')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Envie o corpo como application/json.')
  }
  const text = await readText(req, maxBytes)
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, 'INVALID_REQUEST', 'Corpo JSON inválido.')
  }
}

// Corpo JSON que precisa ser um objeto (as rotas leem campos nomeados).
export async function readJsonObject(req: Request, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const body = await readJson(req, maxBytes)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'INVALID_REQUEST', 'O corpo precisa ser um objeto JSON.')
  }
  return body as Record<string, unknown>
}
