import { readdir, readFile, access } from 'node:fs/promises'
import path from 'node:path'
import MarkdownIt from 'markdown-it'
import { parseDocument } from 'yaml'
import type { BlogPost, BlogPostSummary } from './blog.ts'

type BlogStage = 'live' | 'preview' | 'test'
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function imagePath(value: string) {
  // Images belong to the public blog media directory, never an arbitrary URL.
  return /^\/images\/blog\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(?:avif|webp|png|jpe?g|gif)$/i.test(value)
    && !value.includes('..')
}

export function parseBlogPost(source: string, filename: string): BlogPost {
  const fail = (message: string): never => { throw new Error(`Blog ${filename}: ${message}`) }
  const slug = filename.replace(/\.md$/, '')
  if (!filename.endsWith('.md') || !slugPattern.test(slug)) fail('slug inválido; use letras minúsculas, números e hífens.')
  const match = source.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/)
  if (!match) return fail('frontmatter YAML obrigatório.')
  const document = parseDocument(match[1], { schema: 'core', uniqueKeys: true })
  if (document.errors.length) fail('frontmatter YAML inválido ou com campos duplicados.')
  const data: unknown = document.toJS({ maxAliasCount: 0 })
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('frontmatter deve ser um objeto.')
  const fields = data as Record<string, unknown>
  const requiredText = (name: string) => {
    const value = fields[name]
    if (typeof value !== 'string' || !value.trim()) return fail(`${name} deve ser um texto preenchido.`)
    return value.trim()
  }
  const title = requiredText('title')
  const description = requiredText('description')
  const date = requiredText('date')
  const timestamp = Date.parse(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(timestamp)
    || new Date(timestamp).toISOString().slice(0, 10) !== date) fail('date deve ser uma data válida no formato AAAA-MM-DD.')
  if (typeof fields.draft !== 'boolean') fail('draft deve ser booleano (true ou false).')
  if (fields.coverAlt !== undefined && typeof fields.coverAlt !== 'string') fail('coverAlt deve ser texto.')
  const coverAlt = ((fields.coverAlt ?? '') as string).trim()
  let cover: string | undefined
  if (fields.cover !== undefined && fields.cover !== '') {
    if (typeof fields.cover !== 'string' || !imagePath(fields.cover)) fail('cover deve apontar para uma imagem em /images/blog.')
    cover = fields.cover as string
    if (!coverAlt) fail('coverAlt é obrigatório quando há capa.')
  }
  const tags = fields.tags ?? []
  if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string' || !tag.trim())) fail('tags deve ser uma lista de textos preenchidos.')
  if (!match[2].trim()) fail('body não pode ficar vazio.')

  const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false })
  const tokens = markdown.parse(match[2], {})
  const hasH1 = tokens.some(token => token.type === 'heading_open' && token.tag === 'h1')
  for (const token of tokens) {
    // The page owns the H1; Markdown headings start at H2.
    if (hasH1 && (token.type === 'heading_open' || token.type === 'heading_close')) {
      token.tag = `h${Math.min(6, Number(token.tag.slice(1)) + 1)}`
    }
    for (const child of token.children ?? []) {
      if (child.type !== 'image') continue
      if (!imagePath(child.attrGet('src') ?? '')) fail('imagens do texto devem estar em /images/blog.')
      if (!child.content.trim()) fail('imagens do texto precisam de uma descrição alternativa.')
      child.attrSet('loading', 'lazy')
      child.attrSet('decoding', 'async')
    }
  }
  const text = tokens.filter(token => token.type === 'inline' || token.type === 'fence' || token.type === 'code_block')
    .map(token => token.children?.filter(child => ['text', 'code_inline'].includes(child.type)).map(child => child.content).join(' ') ?? token.content)
    .join(' ')
  const wordCount = text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0
  return {
    slug, title, description, date, ...(cover ? { cover } : {}), coverAlt,
    tags: (tags as string[]).map(tag => tag.trim()), draft: fields.draft as boolean,
    wordCount, readingMinutes: Math.max(1, Math.ceil(wordCount / 200)),
    html: markdown.renderer.render(tokens, markdown.options, {}),
  }
}

export async function readBlogPosts({ stage, root = process.cwd() }: { stage: BlogStage | string; root?: string }): Promise<BlogPost[]> {
  if (!['preview', 'test', 'live'].includes(stage)) throw new Error('Stage inválido ao carregar o blog.')
  const directory = path.join(root, 'content/blog')
  let files
  try { files = await readdir(directory, { withFileTypes: true }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const posts = await Promise.all(files.filter(file => file.isFile() && file.name.endsWith('.md')).map(async file => {
    const post = parseBlogPost(await readFile(path.join(directory, file.name), 'utf8'), file.name)
    const images = [...post.html.matchAll(/<img[^>]+src="([^"]+)"/g)].map(match => match[1])
    if (post.cover) images.push(post.cover)
    for (const image of new Set(images)) {
      try { await access(path.join(root, 'public', image)) } catch { throw new Error(`Blog ${file.name}: imagem ausente: ${image}`) }
    }
    return post
  }))
  return posts.filter(post => stage !== 'live' || !post.draft)
    .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug))
}

export function summarizeBlogPost(post: BlogPost): BlogPostSummary {
  const { slug, title, description, date, cover, coverAlt, tags, draft, readingMinutes } = post
  return { slug, title, description, date, cover, coverAlt, tags, draft, readingMinutes }
}
