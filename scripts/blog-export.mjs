// Blog no banco (2026-10-23): antes do build, traz os posts publicados (GET /blog/posts da API) para content/blog e as
// imagens deles, do bucket público, para public/images/blog. Só os builds da VPS rodam isto (CONTENT_SOURCE=api no
// Dockerfile); fora dela, o site usa os arquivos do repositório. A versão do que veio vai para /blog/versao.json, que o
// admin compara com a do banco. Qualquer falha (rede, post inválido, imagem ausente) para o build: o site no ar não muda.
// Post com capa ganha a imagem de compartilhamento (JPEG 1200×630, recorte central, em /images/blog/og/<endereço>.jpg):
// o WhatsApp e as redes nem sempre mostram WebP.
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { stringify } from 'yaml'
import { parseBlogPost } from '../src/lib/blog.server.ts'

const TIMEOUT_MS = 30_000

export async function exportBlog({ root, apiUrl, apiKey, fetch = globalThis.fetch }) {
  const response = await fetch(`${apiUrl.replace(/\/+$/, '')}/blog/posts`, { headers: { apikey: apiKey }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) throw new Error(`Blog: /blog/posts respondeu HTTP ${response.status}`)
  const { version, posts, media_base: mediaBase } = await response.json()
  if (typeof version !== 'string' || !/^[0-9a-f]{32}$/.test(version) || !Array.isArray(posts)) throw new Error('Blog: resposta inválida de /blog/posts')

  // Os arquivos do repositório (rascunho de exemplo dos testes) saem: no ar, só o que está publicado no banco.
  const directory = path.join(root, 'content/blog')
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
  const images = new Set()
  const shares = []
  for (const post of posts) {
    const shareImage = post.cover ? `/images/blog/og/${post.slug}.jpg` : undefined
    const front = {
      title: post.title, description: post.description, date: post.date, author: post.author,
      ...(post.cover ? { cover: post.cover } : {}), coverAlt: post.cover_alt ?? '', tags: post.tags ?? [], draft: false,
      ...(post.seo_title ? { seoTitle: post.seo_title } : {}), ...(post.seo_description ? { seoDescription: post.seo_description } : {}),
      ...(shareImage ? { shareImage } : {}),
    }
    if (shareImage) shares.push({ cover: post.cover, shareImage })
    const filename = `${post.slug}.md`
    const source = `---\n${stringify(front, { defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN' })}---\n${post.body}\n`
    // As mesmas regras do build; um post que não passa para a exportação inteira, com o nome dele no erro.
    const parsed = parseBlogPost(source, filename)
    for (const match of parsed.html.matchAll(/<img[^>]+src="([^"]+)"/g)) images.add(match[1])
    if (parsed.cover) images.add(parsed.cover)
    await writeFile(path.join(directory, filename), source)
  }

  if (images.size && typeof mediaBase !== 'string') throw new Error('Blog: há imagens nos posts, mas a API não informou o bucket (media_base)')
  for (const image of images) {
    const key = image.slice('/images/blog/'.length)
    const file = await fetch(`${mediaBase}/${key.split('/').map(encodeURIComponent).join('/')}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!file.ok) throw new Error(`Blog: imagem ${image} respondeu HTTP ${file.status} no bucket`)
    const target = path.join(root, 'public', image)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, new Uint8Array(await file.arrayBuffer()))
  }
  for (const { cover, shareImage } of shares) {
    const target = path.join(root, 'public', shareImage)
    await mkdir(path.dirname(target), { recursive: true })
    await sharp(path.join(root, 'public', cover)).resize(1200, 630, { fit: 'cover', position: 'centre' }).jpeg({ quality: 82, mozjpeg: true }).toFile(target)
  }

  await mkdir(path.join(root, 'public/blog'), { recursive: true })
  await writeFile(path.join(root, 'public/blog/versao.json'), `${JSON.stringify({ version })}\n`)
  return { version, posts: posts.length, images: images.size }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apiUrl = process.env.VITE_SUPABASE_URL
  const apiKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!apiUrl || !apiKey) throw new Error('Blog: VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY são obrigatórias')
  const result = await exportBlog({ root: process.cwd(), apiUrl: `${apiUrl.replace(/\/+$/, '')}/functions/v1/api`, apiKey })
  console.log(`Blog: ${result.posts} posts e ${result.images} imagens da versão ${result.version}`)
}
