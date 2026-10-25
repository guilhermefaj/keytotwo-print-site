import { readText } from '../../_shared/http.ts'

// POST /csp-report (pública, 2026-10-25): o navegador avisa aqui o que o CSP do site barraria (no modo só relatório) ou
// barrou. Só vai para o log, para ajustar a política antes de ela valer: a diretiva, a origem do que foi barrado e o
// caminho da página, sem a consulta (que pode ter token). Aceita os dois formatos (report-uri e Reporting API).
const MAX_REPORTS = 10

const text = (value: unknown, max = 60) => (typeof value === 'string' ? value.slice(0, max) : '')

function originOf(value: unknown): string {
  const raw = text(value, 500)
  if (!raw || !/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw.slice(0, 20) || '?'
  try {
    const url = new URL(raw)
    return url.origin === 'null' ? url.protocol : url.origin
  } catch {
    return '?'
  }
}

function pathOf(value: unknown): string {
  try {
    return new URL(text(value, 500)).pathname.slice(0, 100)
  } catch {
    return '?'
  }
}

export async function cspReport(req: Request): Promise<Response> {
  let body: unknown = null
  try {
    body = JSON.parse(await readText(req, 8 * 1024))
  } catch {
    // corpo grande ou fora do formato: nada a registrar
  }
  const reports: Record<string, unknown>[] = Array.isArray(body)
    ? body.filter((item) => item?.type === 'csp-violation').map((item) => item.body ?? {})
    : body && typeof body === 'object' && 'csp-report' in body ? [(body as Record<string, Record<string, unknown>>)['csp-report'] ?? {}] : []
  for (const report of reports.slice(0, MAX_REPORTS)) {
    const directive = text(report.effectiveDirective ?? report['effective-directive'] ?? report['violated-directive'])
    const blocked = originOf(report.blockedURL ?? report['blocked-uri'])
    const page = pathOf(report.documentURL ?? report['document-uri'])
    const mode = report.disposition === 'enforce' ? 'barrou' : 'barraria'
    console.log(`csp: ${mode} ${directive} ${blocked} em ${page}`)
  }
  return new Response(null, { status: 204 })
}
