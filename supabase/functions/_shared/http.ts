// Códigos documentados em docs/api-contract.md.
export type ErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHENTICATED'
  | 'NOT_ENTITLED'
  | 'ORIGIN_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'FILE_NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'PRODUCT_UNAVAILABLE'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INTERNAL_ERROR'
  | 'PAYMENT_PROVIDER_ERROR'
  | 'FILE_UNAVAILABLE'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly headers?: HeadersInit,
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

export function errorResponse(status: number, code: ErrorCode, message: string, headers?: HeadersInit): Response {
  return json({ error: { code, message } }, status, headers)
}

// Nunca registra corpo, headers, e-mail ou token: só o tipo e a mensagem do erro.
export function toErrorResponse(error: unknown): Response {
  if (error instanceof HttpError) return errorResponse(error.status, error.code, error.message, error.headers)
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
