// @ts-types="npm:@types/markdown-it@14.1.2"
import MarkdownIt from 'markdown-it'
import { rpc, rpcRow } from '../../_shared/admin.ts'
import { requireAdminSession } from '../../_shared/auth.ts'
import { blogConfig, blogMediaBase, putObject } from '../../_shared/b2.ts'
import { blogProblems, markdownImages, readBlogPostInput, slugify, type BlogPostInput, type MarkdownToken } from '../../_shared/blog-rules.ts'
import { ConfigError } from '../../_shared/env.ts'
import { HttpError, json, readBytes, readJsonObject } from '../../_shared/http.ts'

// Blog (2026-10-23): o admin lista, cria, edita e exclui posts; o build do site lê os publicados e a VPS confere a
// versão para reconstruir. Rotas /admin/* pedem sessão com o segundo fator, e o banco confere o admin em cada chamada.

const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false })
const POST_BYTES = 512 * 1024
const IMAGE_BYTES = 5 * 1024 * 1024
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Tipo declarado → extensão e o começo do arquivo de verdade (o bucket é público: nada que não seja imagem entra).
const IMAGE_TYPES: Record<string, { ext: string; magic: (bytes: Uint8Array) => boolean }> = {
  'image/webp': { ext: 'webp', magic: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP' },
  'image/png': { ext: 'png', magic: (b) => b[0] === 0x89 && ascii(b, 1, 4) === 'PNG' },
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/gif': { ext: 'gif', magic: (b) => ascii(b, 0, 4) === 'GIF8' },
  'image/avif': { ext: 'avif', magic: (b) => ascii(b, 4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(b, 8, 12)) },
}
const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))

const notAdmin = () => new HttpError(403, 'NOT_ADMIN', 'Esta área é só para a equipe da KeyToTwo.')
const notFound = () => new HttpError(404, 'NOT_FOUND', 'Post não encontrado.')

// Sem o bucket configurado o admin ainda lista e edita; só o envio de imagem fica indisponível.
function mediaBase(): string | null {
  try {
    return blogMediaBase()
  } catch (error) {
    if (error instanceof ConfigError) return null
    throw error
  }
}

function postId(params: Record<string, string>): string {
  if (!ID.test(params.id ?? '')) throw notFound()
  return params.id
}

// O post do corpo, com as mesmas regras do build: publicado inválido travaria a atualização do site.
function postInput(body: Record<string, unknown>): BlogPostInput {
  const post = readBlogPostInput(body.post)
  if (!post) throw new HttpError(400, 'INVALID_REQUEST', 'Post inválido.')
  const problems = blogProblems(post, markdownImages(markdown.parse(post.body, {}) as unknown as MarkdownToken[]))
  if (problems.length) throw new HttpError(400, 'INVALID_REQUEST', problems[0].message, { details: { problems } })
  return post
}

type Saved = { outcome: string; post: Record<string, unknown> | null }

function savedPost(result: Saved, status = 200): Response {
  switch (result.outcome) {
    case 'ok':
      return json({ post: result.post }, status)
    case 'forbidden':
      throw notAdmin()
    case 'not_found':
      throw notFound()
    case 'conflict':
      throw new HttpError(409, 'EDIT_CONFLICT', 'Este post foi salvo em outro lugar depois que você abriu. Copie o que mudou, recarregue e salve de novo.', { details: { post: result.post } })
    case 'slug_taken':
      throw new HttpError(409, 'SLUG_TAKEN', 'Já existe um post com este endereço. Escolha outro.')
    case 'slug_locked':
      throw new HttpError(409, 'SLUG_LOCKED', 'O endereço não muda depois que o post foi publicado.')
    default:
      throw new Error(`admin_save_blog_post: outcome inesperado (${result.outcome})`)
  }
}

// GET /admin/blog/posts: todos os posts, sem o texto, com a versão publicada e a base das imagens.
export async function adminBlogPosts(req: Request): Promise<Response> {
  const user = await requireAdminSession(req)
  const result = await rpcRow<{ outcome: string; result: Record<string, unknown> }>('admin_list_blog_posts', { p_user_id: user.id })
  if (result.outcome !== 'ok') throw notAdmin()
  return json({ ...result.result, media_base: mediaBase() })
}

// POST /admin/blog/posts { post }: cria (rascunho ou já publicado).
export async function adminCreateBlogPost(req: Request): Promise<Response> {
  const user = await requireAdminSession(req)
  const post = postInput(await readJsonObject(req, POST_BYTES))
  const result = await rpcRow<Saved>('admin_save_blog_post', { p_user_id: user.id, p_post_id: null, p_post: post, p_expected_updated_at: null })
  return savedPost(result, 201)
}

// GET /admin/blog/posts/:id: o post inteiro, para o editor.
export async function adminBlogPost(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  const id = postId(params)
  const result = await rpcRow<{ outcome: string; post: Record<string, unknown> | null }>('admin_get_blog_post', { p_user_id: user.id, p_post_id: id })
  if (result.outcome === 'forbidden') throw notAdmin()
  if (result.outcome !== 'ok') throw notFound()
  return json({ post: result.post, media_base: mediaBase() })
}

// PUT /admin/blog/posts/:id { post, expected_updated_at }: grava se ninguém salvou depois que o editor abriu.
export async function adminUpdateBlogPost(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  const id = postId(params)
  const body = await readJsonObject(req, POST_BYTES)
  const expected = body.expected_updated_at
  if (typeof expected !== 'string' || !Number.isFinite(Date.parse(expected))) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Informe expected_updated_at, a versão que o editor abriu.')
  }
  const post = postInput(body)
  return savedPost(await rpcRow<Saved>('admin_save_blog_post', { p_user_id: user.id, p_post_id: id, p_post: post, p_expected_updated_at: expected }))
}

// DELETE /admin/blog/posts/:id: some do admin e, se estava publicado, do site na próxima atualização.
export async function adminDeleteBlogPost(req: Request, _url: URL, params: Record<string, string>): Promise<Response> {
  const user = await requireAdminSession(req)
  const id = postId(params)
  const result = await rpcRow<{ outcome: string }>('admin_delete_blog_post', { p_user_id: user.id, p_post_id: id })
  if (result.outcome === 'forbidden') throw notAdmin()
  if (result.outcome !== 'ok') throw notFound()
  return json({ deleted: true })
}

// POST /admin/blog/images?name=<nome do arquivo>: a imagem crua no corpo (o admin já reduz e converte para WebP).
// Vai para o bucket público em <ano>/<mês>/<sorteio>-<nome>.<ext>; no texto, o caminho é /images/blog/<chave>.
export async function adminBlogImage(req: Request, url: URL): Promise<Response> {
  const user = await requireAdminSession(req)
  const type = (req.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase()
  const kind = Object.hasOwn(IMAGE_TYPES, type) ? IMAGE_TYPES[type] : undefined
  if (!kind) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Envie uma imagem WebP, PNG, JPG, GIF ou AVIF.')
  const bytes = await readBytes(req, IMAGE_BYTES)
  if (bytes.byteLength < 12 || !kind.magic(bytes)) throw new HttpError(400, 'INVALID_REQUEST', 'O arquivo não é uma imagem desse tipo.')

  const config = blogConfig()
  const now = new Date()
  const name = slugify((url.searchParams.get('name') ?? '').replace(/\.[a-z0-9]+$/i, '')).slice(0, 40).replace(/-+$/, '') || 'imagem'
  const random = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('')
  const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${random}-${name}.${kind.ext}`
  const path = `/images/blog/${key}`

  const allowed = await rpcRow<{ outcome: string }>('admin_register_blog_image', { p_user_id: user.id, p_path: path })
  if (allowed.outcome !== 'ok') throw notAdmin()
  await putObject(config, key, bytes, type)
  return json({ path, url: `${blogMediaBase()}/${key}` }, 201)
}

// GET /blog/posts (pública): os publicados com o texto, para o build do site, mais a versão e a base das imagens.
export async function blogPublished(): Promise<Response> {
  const result = await rpc<Record<string, unknown>>('list_published_blog_posts')
  return json({ ...result, media_base: mediaBase() })
}

// GET /blog/version (pública): a versão do que está publicado; a VPS compara com a do site no ar.
export async function blogVersion(): Promise<Response> {
  return json({ version: await rpc<string>('get_blog_version') })
}
