// Gera 5 PDFs FICTÍCIOS (rotulados TESTE, sem conteúdo dos jogos) e sobe ao bucket de TESTE do B2.
// Uso (autorizado só no bucket de teste):
//   npx deno@2.9.6 run --no-lock --config supabase/functions/deno.json --allow-read --allow-net \
//     supabase/functions/tests/upload-test-pdfs.ts <caminho do modelo de segredos .env>
// A chave de ESCRITA é lida do modelo de segredos só aqui; nada é impresso além de chave, tamanho e sha256.
import { presignUrl } from '../_shared/b2.ts'
import { bucketKeys, sha256 as sha256Of } from './upload-config.ts'

const GAMES = ['TESTE-J01', 'TESTE-J02', 'TESTE-J03', 'TESTE-J04', 'TESTE-J05']

// PDF mínimo válido, determinístico (mesmo conteúdo = mesmo sha256), só ASCII.
function testPdf(code: string): ArrayBuffer {
  const text = `TESTE - KeyToTwo - ${code} - arquivo ficticio de teste, sem conteudo real dos jogos.`
  const stream = `BT /F1 12 Tf 48 760 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info << /Title (TESTE ${code}) >> >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(body).buffer as ArrayBuffer
}

const { write, read } = await bucketKeys(Deno.args[0])

const result = []
for (const code of GAMES) {
  const filename = `${code}-v1.0.pdf`
  const key = `paid/${code}/1.0/${filename}`
  const bytes = testPdf(code)
  const sha256 = await sha256Of(bytes)

  const put = await presignUrl(write, { method: 'PUT', key, expiresIn: 300 })
  const upload = await fetch(put.url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` },
    body: bytes,
  })
  await upload.body?.cancel()
  if (!upload.ok) throw new Error(`upload de ${key} falhou (HTTP ${upload.status})`)

  // Conferência com a chave SÓ LEITURA: tipo, disposição e conteúdo.
  const get = await fetch((await presignUrl(read, { key, expiresIn: 60 })).url)
  const back = await get.arrayBuffer()
  result.push({
    object_key: key,
    filename,
    size_bytes: bytes.byteLength,
    sha256,
    leitura_ok: get.status === 200 && await sha256Of(back) === sha256,
    content_type: get.headers.get('content-type'),
    content_disposition: get.headers.get('content-disposition'),
  })
}
console.log(JSON.stringify({ bucket_configurado: true, arquivos: result }, null, 2))
