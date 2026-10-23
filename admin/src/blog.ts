import type { BlogPostInput, BlogProblem } from '../../supabase/functions/_shared/blog-rules.ts'
import { ApiError } from './api'
import { apiBase, publishableKey, supabase } from './supabase'

// Blog no admin (2026-10-23): os posts vêm da API (/admin/blog/*); as regras são as mesmas da API e do build do site.
// O Markdown (markdown-it) fica em blog-markdown.ts, que só o editor carrega.
export type { BlogPostInput, BlogProblem }
export { slugify } from '../../supabase/functions/_shared/blog-rules.ts'

export interface BlogPost extends BlogPostInput {
  id: string
  published_at: string | null
  created_at: string
  updated_at: string
}
export type BlogPostSummary = Omit<BlogPost, 'body'>
export interface BlogList { version: string; posts: BlogPostSummary[]; media_base: string | null }

// Uma imagem do bucket do blog, como a galeria lista (GET /admin/blog/images), com os posts que a usam.
export interface BlogImage { path: string; url: string; size: number; uploaded_at: string; used_by: { id: string; title: string; status: 'draft' | 'published' }[] }
export interface BlogImages { images: BlogImage[]; truncated: boolean; media_base: string }

// As imagens que um post usa (capa e texto), contadas como o banco conta: a galeria não deixa apagar nenhuma delas.
export const imagePathsIn = (body: string, cover: string | null) =>
  [...(cover ? [cover] : []), ...Array.from(body.matchAll(/\/images\/blog\/[A-Za-z0-9_./-]+/g), match => match[0])]

// "/images/blog/2026/10/ab12cd34-mesa-de-jogo.webp" vira "mesa-de-jogo.webp" (sem a pasta e sem o sorteio do envio).
export const imageName = (path: string) => path.split('/').pop()!.replace(/^[0-9a-f]{8}-/, '')
export const formatSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`)

// Endereço de uma imagem do blog (/images/blog/<chave>) no bucket público, para a prévia e a capa.
export function mediaUrl(path: string, mediaBase: string | null): string {
  return mediaBase && path.startsWith('/images/blog/') ? `${mediaBase}/${path.slice('/images/blog/'.length)}` : path
}

export function readingMinutes(body: string): number {
  const words = body.replace(/[#>*_`[\]()!-]/g, ' ').match(/[\p{L}\p{N}]+/gu)?.length ?? 0
  return Math.max(1, Math.ceil(words / 200))
}

// Data de hoje no calendário de Brasília (o site mostra a data sem fuso).
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())

export const formatDate = (date: string) => new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
export const formatShortDate = (date: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
export const formatMoment = (value: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(value))

// Imagens: até 1600 px de largura em WebP, reduzidas no navegador. GIF segue como está (perderia a animação).
const MAX_WIDTH = 1600
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif']
export const acceptedImages = ACCEPTED.join(',')

export async function prepareImage(file: File): Promise<{ blob: Blob; type: string }> {
  if (!ACCEPTED.includes(file.type)) throw new ApiError('UNSUPPORTED_MEDIA_TYPE', 'Use uma imagem PNG, JPG, WebP, AVIF ou GIF.')
  if (file.type === 'image/gif') return { blob: file, type: file.type }
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_WIDTH / bitmap.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.82))
  return blob && blob.type === 'image/webp' ? { blob, type: 'image/webp' } : { blob: file, type: file.type }
}

// Envia para o bucket do blog pela API; devolve o caminho que vai no texto (/images/blog/...) e o endereço público.
export async function uploadImage(file: File): Promise<{ path: string; url: string }> {
  const { blob, type } = await prepareImage(file)
  if (blob.size > 5 * 1024 * 1024) throw new ApiError('PAYLOAD_TOO_LARGE', 'A imagem passou de 5 MB mesmo reduzida. Use uma menor.')
  const session = (await supabase?.auth.getSession())?.data.session
  if (!session) throw new ApiError('UNAUTHENTICATED')
  const response = await fetch(`${apiBase}/admin/blog/images?name=${encodeURIComponent(file.name)}`, {
    method: 'POST', headers: { apikey: publishableKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': type }, body: blob,
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(result.error?.code || 'INTERNAL_ERROR', result.error?.message)
  return result as { path: string; url: string }
}
