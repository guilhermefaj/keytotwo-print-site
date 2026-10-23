// Testes de contrato do blog no admin e das rotas públicas do build (docs/api-contract.md), sem rede e sem banco.
import { assertEquals, assertMatch } from '@std/assert'
import { b2Calls, contractTest, onB2, onRpc, request, rpcCalls, sessionToken, userId } from './contract-helpers.ts'
import { handleRequest } from '../api/router.ts'

const ID = '0b6c8f8e-3f0a-4c1e-9a55-2d5f6b0d1a11'
const SAVED_AT = '2026-10-23T12:00:00.123456+00:00'
const MEDIA = 'https://blog-de-teste.s3.teste-001.backblazeb2.com'

function post(extra: Record<string, unknown> = {}) {
  return { slug: 'jogos-para-casais', title: 'Jogos para casais', description: 'Ideias para a noite.', author: 'Equipe KeyToTwo',
    date: '2026-10-23', cover: null, cover_alt: '', tags: ['Jogos'], body: 'Texto do post.\n\n![Mesa com o jogo](/images/blog/2026/10/ab12cd34-mesa.webp)', status: 'published', ...extra }
}
const stored = (extra: Record<string, unknown> = {}) => ({ id: ID, ...post(), published_at: SAVED_AT, created_at: SAVED_AT, updated_at: SAVED_AT, ...extra })
const admin = () => sessionToken({ aal: 'aal2' })
const send = async (path: string, options: { method?: string; token?: string; body?: unknown; headers?: HeadersInit }) => {
  const res = await handleRequest(request(path, options))
  return { status: res.status, body: await res.json() }
}

contractTest('rotas do blog no admin: sem sessão 401; sem o segundo fator 403 MFA_REQUIRED, antes do banco', async () => {
  onRpc(() => ({ status: 200, body: null }))
  const aal1 = await sessionToken({ aal: 'aal1' })
  for (const [path, method] of [['/admin/blog/posts', 'GET'], ['/admin/blog/posts', 'POST'], [`/admin/blog/posts/${ID}`, 'GET'], [`/admin/blog/posts/${ID}`, 'PUT'], [`/admin/blog/posts/${ID}`, 'DELETE'], ['/admin/blog/images', 'POST']]) {
    const body = method === 'GET' || method === 'DELETE' ? undefined : {}
    assertEquals((await send(path, { method, body })).body.error.code, 'UNAUTHENTICATED', `${method} ${path}`)
    const res = await send(path, { method, token: aal1, body })
    assertEquals([res.status, res.body.error.code], [403, 'MFA_REQUIRED'], `${method} ${path}`)
  }
  assertEquals(rpcCalls.length, 0)
})

contractTest('GET /admin/blog/posts: lista do banco com a versão e a base pública das imagens; não admin 403', async () => {
  const token = await admin()
  onRpc(() => ({ status: 200, body: [{ outcome: 'ok', result: { version: 'v1', posts: [{ id: ID, title: 'Jogos para casais' }] } }] }))
  const res = await send('/admin/blog/posts', { token })
  assertEquals(res.status, 200)
  assertEquals(res.body, { version: 'v1', posts: [{ id: ID, title: 'Jogos para casais' }], media_base: MEDIA })
  assertEquals(rpcCalls.map((c) => [c.fn, c.args, c.secretKeyOk]), [['admin_list_blog_posts', { p_user_id: userId(token) }, true]])
  onRpc(() => ({ status: 200, body: [{ outcome: 'forbidden', result: null }] }))
  const denied = await send('/admin/blog/posts', { token })
  assertEquals([denied.status, denied.body.error.code], [403, 'NOT_ADMIN'])
})

contractTest('POST /admin/blog/posts: rascunho só com título e endereço; textos aparados e capa vazia vira null', async () => {
  const token = await admin()
  onRpc(() => ({ status: 200, body: [{ outcome: 'ok', post: stored({ status: 'draft' }) }] }))
  const draft = { ...post({ status: 'draft', description: '', author: '', body: '' }), title: '  Jogos para casais  ', cover: '', tags: [' Jogos ', ''] }
  const res = await send('/admin/blog/posts', { method: 'POST', token, body: { post: draft } })
  assertEquals(res.status, 201)
  assertEquals(res.body.post.id, ID)
  assertEquals(rpcCalls[0].fn, 'admin_save_blog_post')
  assertEquals(rpcCalls[0].args, { p_user_id: userId(token), p_post_id: null, p_expected_updated_at: null,
    p_post: { ...post({ status: 'draft', description: '', author: '', body: '' }), cover: null, tags: ['Jogos'] } })
})

contractTest('publicar exige o post completo e as regras do build, sem chegar ao banco', async () => {
  const token = await admin()
  onRpc(() => ({ status: 200, body: [{ outcome: 'ok', post: stored() }] }))
  const cases: [Record<string, unknown>, string, string][] = [
    [{ description: '', author: '', body: '  ' }, 'description', 'Escreva o resumo antes de publicar. Ele aparece na lista e no Google.'],
    [{ body: '![Foto](https://exemplo.test/foto.png)' }, 'body', 'Há uma imagem de fora do blog no texto. Envie as imagens pelo botão "Imagem".'],
    [{ body: '![](/images/blog/2026/10/foto.webp)' }, 'body', 'Há uma imagem sem descrição no texto. Escreva a descrição entre os colchetes: ![descrição](endereço).'],
    [{ title: 'Texto PENDENTE de revisão' }, 'title', 'Tire a marcação PENDENTE antes de publicar: o site não publica conteúdo com ela.'],
    [{ cover: '/images/blog/2026/10/capa.webp', cover_alt: '' }, 'cover_alt', 'Descreva a capa para quem não vê a imagem.'],
    [{ slug: 'Jogos Para Casais' }, 'slug', 'Use só letras minúsculas sem acento, números e hífens no endereço.'],
    [{ date: '2026-02-30' }, 'date', 'Escolha uma data válida.'],
    [{ tags: ['Jogos', 'jogos'] }, 'tags', 'Tire os temas repetidos.'],
  ]
  for (const [extra, field, message] of cases) {
    const res = await send('/admin/blog/posts', { method: 'POST', token, body: { post: post(extra) } })
    assertEquals([res.status, res.body.error.code, res.body.error.message], [400, 'INVALID_REQUEST', message], field)
    assertEquals(res.body.error.details.problems[0].field, field)
  }
  const incomplete = await send('/admin/blog/posts', { method: 'POST', token, body: { post: post({ description: '', author: '', body: '' }) } })
  assertEquals(incomplete.body.error.details.problems.map((p: { field: string }) => p.field), ['description', 'author', 'body'])
  for (const body of [{}, { post: { ...post(), status: 'arquivado' } }, { post: { ...post(), tags: 'Jogos' } }]) {
    assertEquals((await send('/admin/blog/posts', { method: 'POST', token, body })).body.error.message, 'Post inválido.')
  }
  // Rascunho guarda mesmo com imagem de fora: a regra só vale para publicar.
  await send('/admin/blog/posts', { method: 'POST', token, body: { post: post({ status: 'draft', body: '![Foto](https://exemplo.test/foto.png)' }) } })
  assertEquals(rpcCalls.map((c) => c.fn), ['admin_save_blog_post'])
})

contractTest('PUT /admin/blog/posts/:id: grava com a versão aberta; conflito, endereço repetido e fixo viram 409', async () => {
  const token = await admin()
  onRpc(() => ({ status: 200, body: [{ outcome: 'ok', post: stored({ title: 'Novo' }) }] }))
  const missing = await send(`/admin/blog/posts/${ID}`, { method: 'PUT', token, body: { post: post() } })
  assertEquals([missing.status, missing.body.error.code], [400, 'INVALID_REQUEST'])
  const ok = await send(`/admin/blog/posts/${ID}`, { method: 'PUT', token, body: { post: post({ title: 'Novo' }), expected_updated_at: SAVED_AT } })
  assertEquals([ok.status, ok.body.post.title], [200, 'Novo'])
  assertEquals(rpcCalls.map((c) => c.args), [{ p_user_id: userId(token), p_post_id: ID, p_post: post({ title: 'Novo' }), p_expected_updated_at: SAVED_AT }])

  const outcomes: [string, number, string][] = [['conflict', 409, 'EDIT_CONFLICT'], ['slug_taken', 409, 'SLUG_TAKEN'], ['slug_locked', 409, 'SLUG_LOCKED'], ['not_found', 404, 'NOT_FOUND'], ['forbidden', 403, 'NOT_ADMIN']]
  for (const [outcome, status, code] of outcomes) {
    onRpc(() => ({ status: 200, body: [{ outcome, post: outcome === 'conflict' ? stored({ title: 'Salvo em outra aba' }) : null }] }))
    const res = await send(`/admin/blog/posts/${ID}`, { method: 'PUT', token, body: { post: post(), expected_updated_at: SAVED_AT } })
    assertEquals([res.status, res.body.error.code], [status, code], outcome)
    if (outcome === 'conflict') assertEquals(res.body.error.details.post.title, 'Salvo em outra aba')
  }
})

contractTest('GET e DELETE /admin/blog/posts/:id: id inválido é 404 sem banco; abre e exclui pelo banco', async () => {
  const token = await admin()
  onRpc((fn) => ({ status: 200, body: [fn === 'admin_get_blog_post' ? { outcome: 'ok', post: stored() } : { outcome: 'ok' }] }))
  assertEquals((await send('/admin/blog/posts/nao-e-um-id', { token })).status, 404)
  assertEquals(rpcCalls.length, 0)
  const opened = await send(`/admin/blog/posts/${ID}`, { token })
  assertEquals([opened.status, opened.body.post.body, opened.body.media_base], [200, stored().body, MEDIA])
  const deleted = await send(`/admin/blog/posts/${ID}`, { method: 'DELETE', token })
  assertEquals([deleted.status, deleted.body], [200, { deleted: true }])
  assertEquals(rpcCalls.map((c) => [c.fn, c.args]), [['admin_get_blog_post', { p_user_id: userId(token), p_post_id: ID }], ['admin_delete_blog_post', { p_user_id: userId(token), p_post_id: ID }]])
  onRpc(() => ({ status: 200, body: [{ outcome: 'not_found', post: null }] }))
  assertEquals((await send(`/admin/blog/posts/${ID}`, { token })).body.error.code, 'NOT_FOUND')
})

const webp = () => new Uint8Array([...new TextEncoder().encode('RIFF'), 0, 0, 0, 0, ...new TextEncoder().encode('WEBPVP8 '), 1, 2, 3])
async function upload(token: string, bytes: Uint8Array, type: string, name = 'Mesa de Jogo.png') {
  const res = await handleRequest(new Request(`http://localhost/api/admin/blog/images?name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': type }, body: bytes.slice().buffer,
  }))
  return { status: res.status, body: await res.json() }
}

contractTest('POST /admin/blog/images: confere o admin no banco, grava no bucket do blog e devolve o caminho do site', async () => {
  const token = await admin()
  onB2(() => ({ status: 200, body: {} }))
  onRpc(() => ({ status: 200, body: [{ outcome: 'ok' }] }))
  const res = await upload(token, webp(), 'image/webp')
  assertEquals(res.status, 201)
  assertMatch(res.body.path, /^\/images\/blog\/\d{4}\/\d{2}\/[0-9a-f]{8}-mesa-de-jogo\.webp$/)
  assertEquals(res.body.url, `${MEDIA}/${res.body.path.slice('/images/blog/'.length)}`)
  assertEquals(rpcCalls.map((c) => [c.fn, c.args]), [['admin_register_blog_image', { p_user_id: userId(token), p_path: res.body.path }]])
  assertEquals(b2Calls.map((c) => [c.method, c.host, c.key, c.contentType, c.size]), [['PUT', 'blog-de-teste.s3.teste-001.backblazeb2.com', res.body.path.slice('/images/blog/'.length), 'image/webp', webp().byteLength]])

  onB2(() => ({ status: 200, body: {} }))
  for (const [bytes, type, status, code] of [[webp(), 'text/html', 415, 'UNSUPPORTED_MEDIA_TYPE'], [new TextEncoder().encode('<html><script>x</script></html>'), 'image/png', 400, 'INVALID_REQUEST'], [new Uint8Array(5 * 1024 * 1024 + 1), 'image/webp', 413, 'PAYLOAD_TOO_LARGE']] as const) {
    const bad = await upload(token, bytes, type)
    assertEquals([bad.status, bad.body.error.code], [status, code], type)
  }
  onRpc(() => ({ status: 200, body: [{ outcome: 'forbidden' }] }))
  assertEquals((await upload(token, webp(), 'image/webp')).body.error.code, 'NOT_ADMIN')
  assertEquals(b2Calls.length, 0)
})

contractTest('GET /blog/posts e /blog/version são públicas: o build lê os publicados e a VPS a versão', async () => {
  onRpc((fn) => ({ status: 200, body: fn === 'get_blog_version' ? 'v2' : { version: 'v2', posts: [stored()] } }))
  const posts = await send('/blog/posts', {})
  assertEquals([posts.status, posts.body.version, posts.body.posts[0].slug, posts.body.media_base], [200, 'v2', 'jogos-para-casais', MEDIA])
  const version = await send('/blog/version', {})
  assertEquals([version.status, version.body], [200, { version: 'v2' }])
  assertEquals(rpcCalls.map((c) => [c.fn, c.secretKeyOk, c.hasAuthorization]), [['list_published_blog_posts', true, false], ['get_blog_version', true, false]])
})
