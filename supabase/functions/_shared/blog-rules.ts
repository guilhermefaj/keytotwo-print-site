// Regras de um post do blog, as mesmas do build do site (src/lib/blog.server.ts e scripts/check-release.mjs): a API
// confere antes de gravar e o editor do admin mostra os mesmos avisos enquanto a pessoa escreve. Rascunho guarda o que
// estiver pronto; publicar exige o post completo, porque um publicado inválido travaria o build do site.
// Sem import: o admin (Vite) usa este arquivo também. O Markdown chega já quebrado em tokens (markdown-it).

export type BlogStatus = 'draft' | 'published'

export interface BlogPostInput {
  slug: string
  title: string
  description: string
  author: string
  // O Instagram de quem escreveu (2026-10-29), opcional: o nome de usuário, sem o @.
  author_instagram: string
  date: string
  cover: string | null
  cover_alt: string
  tags: string[]
  body: string
  status: BlogStatus
  // Para o Google e o compartilhamento (2026-10-23), opcionais: em branco, valem o título e o resumo.
  seo_title: string
  seo_description: string
}

export type BlogField = keyof BlogPostInput
export interface BlogProblem { field: BlogField; message: string }
export interface BlogImage { src: string; alt: string }

// O suficiente de um token do markdown-it para achar as imagens e ajustar os títulos.
export interface MarkdownToken {
  type: string
  tag: string
  content: string
  children: MarkdownToken[] | null
  attrGet(name: string): string | null
  attrSet(name: string, value: string): void
}

export const BLOG_LIMITS = { slug: 80, title: 120, description: 300, author: 80, coverAlt: 300, tags: 10, tag: 40, body: 100_000, seoTitle: 80, seoDescription: 200 }
// O que o Google costuma mostrar inteiro (a prévia do admin avisa quando passa; o limite de cima é o do banco).
export const SEO_IDEAL = { title: 60, description: 155 }
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const instagramPattern = /^[a-z0-9._]{1,30}$/
// A trava do build live recusa conteúdo publicado com esta marcação.
const pendingMarker = /\bPENDENTE\b/i

export const isBlogSlug = (value: string) => slugPattern.test(value)
export const isInstagramHandle = (value: string) => instagramPattern.test(value)

// "@Fulana", "instagram.com/fulana/" e "https://www.instagram.com/fulana?igsh=…" viram "fulana".
export function instagramHandle(value: string): string {
  const text = value.trim()
  const profile = text.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#]*)/i)
  return (profile ? profile[1] : text).replace(/^@/, '').toLowerCase()
}

// Imagens só da pasta do blog (no site, /images/blog; no admin, a mesma chave no bucket público).
export const isBlogImagePath = (value: string) =>
  /^\/images\/blog\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(?:avif|webp|png|jpe?g|gif)$/i.test(value) && !value.includes('..')

// "Jogos para casais: 5 ideias!" vira "jogos-para-casais-5-ideias".
export function slugify(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, BLOG_LIMITS.slug).replace(/-+$/, '')
}

export function isValidDate(value: string): boolean {
  const timestamp = Date.parse(`${value}T00:00:00Z`)
  return datePattern.test(value) && Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
}

// O corpo do pedido vira um post com os textos aparados; null quando algum campo não tem o tipo certo.
export function readBlogPostInput(value: unknown): BlogPostInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const fields = value as Record<string, unknown>
  const text = (name: string) => (typeof fields[name] === 'string' ? fields[name] as string : null)
  const [slug, title, description, author, date, coverAlt, body] = ['slug', 'title', 'description', 'author', 'date', 'cover_alt', 'body'].map(text)
  const cover = fields.cover === null || fields.cover === undefined ? '' : text('cover')
  // Os campos do Google chegaram depois: quem não manda (admin antigo) grava vazio.
  const seoTitle = fields.seo_title === undefined ? '' : text('seo_title')
  const seoDescription = fields.seo_description === undefined ? '' : text('seo_description')
  const authorInstagram = fields.author_instagram === undefined ? '' : text('author_instagram')
  const tags = fields.tags
  const status = fields.status
  if ([slug, title, description, author, date, coverAlt, body, cover, seoTitle, seoDescription, authorInstagram].some(item => item === null)) return null
  if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string')) return null
  if (status !== 'draft' && status !== 'published') return null
  return {
    slug: slug!.trim(), title: title!.trim(), description: description!.trim(), author: author!.trim(),
    author_instagram: instagramHandle(authorInstagram!), date: date!.trim(),
    cover: cover!.trim() || null, cover_alt: coverAlt!.trim(), tags: (tags as string[]).map(tag => tag.trim()).filter(Boolean),
    body: body!, status, seo_title: seoTitle!.trim(), seo_description: seoDescription!.trim(),
  }
}

// Imagens do texto, com a descrição (alt) de cada uma.
export function markdownImages(tokens: MarkdownToken[]): BlogImage[] {
  return tokens.flatMap(token => (token.children ?? []).filter(child => child.type === 'image')
    .map(child => ({ src: child.attrGet('src') ?? '', alt: child.content.trim() })))
}

// O que o site faz antes de renderizar: o título da página é o H1, então um "# " do texto desce um nível;
// imagens carregam só quando aparecem. `src` troca o endereço da imagem (no admin, para o bucket).
export function prepareMarkdownTokens(tokens: MarkdownToken[], src?: (value: string) => string): MarkdownToken[] {
  const hasH1 = tokens.some(token => token.type === 'heading_open' && token.tag === 'h1')
  for (const token of tokens) {
    if (hasH1 && (token.type === 'heading_open' || token.type === 'heading_close')) token.tag = `h${Math.min(6, Number(token.tag.slice(1)) + 1)}`
    for (const child of token.children ?? []) {
      if (child.type !== 'image') continue
      child.attrSet('loading', 'lazy')
      child.attrSet('decoding', 'async')
      if (src) child.attrSet('src', src(child.attrGet('src') ?? ''))
    }
  }
  return tokens
}

// Tempo de leitura, o mesmo no site e na prévia do admin: só as palavras do texto e do código (sem os endereços dos
// links nem as descrições das imagens), a 200 por minuto, com 1 minuto no mínimo.
export function readingWords(tokens: MarkdownToken[]): number {
  const text = tokens.filter(token => token.type === 'inline' || token.type === 'fence' || token.type === 'code_block')
    .map(token => token.children?.filter(child => child.type === 'text' || child.type === 'code_inline').map(child => child.content).join(' ') ?? token.content)
    .join(' ')
  return text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0
}
export const readingMinutes = (words: number) => Math.max(1, Math.ceil(words / 200))

// Todos os problemas do post, na ordem dos campos do editor. Vazio = pode gravar.
export function blogProblems(post: BlogPostInput, images: BlogImage[]): BlogProblem[] {
  const problems: BlogProblem[] = []
  const add = (field: BlogField, message: string) => { if (!problems.some(problem => problem.field === field)) problems.push({ field, message }) }
  const publishing = post.status === 'published'

  if (!post.title) add('title', 'Escreva o título.')
  else if (post.title.length > BLOG_LIMITS.title) add('title', `Use até ${BLOG_LIMITS.title} caracteres no título.`)
  if (!post.slug) add('slug', 'Escreva o endereço do post.')
  else if (post.slug.length > BLOG_LIMITS.slug || !slugPattern.test(post.slug)) add('slug', 'Use só letras minúsculas sem acento, números e hífens no endereço.')
  if (post.description.length > BLOG_LIMITS.description) add('description', `Use até ${BLOG_LIMITS.description} caracteres no resumo.`)
  else if (publishing && !post.description) add('description', 'Escreva o resumo antes de publicar. Ele aparece na lista e no Google.')
  if (post.seo_title.length > BLOG_LIMITS.seoTitle) add('seo_title', `Use até ${BLOG_LIMITS.seoTitle} caracteres no título do Google.`)
  if (post.seo_description.length > BLOG_LIMITS.seoDescription) add('seo_description', `Use até ${BLOG_LIMITS.seoDescription} caracteres na descrição do Google.`)
  if (post.author.length > BLOG_LIMITS.author) add('author', `Use até ${BLOG_LIMITS.author} caracteres no autor.`)
  else if (publishing && !post.author) add('author', 'Diga quem escreveu antes de publicar.')
  if (post.author_instagram && !isInstagramHandle(post.author_instagram)) add('author_instagram', 'Use o nome de usuário do Instagram: até 30 letras, números, pontos ou sublinhados.')
  if (!isValidDate(post.date)) add('date', 'Escolha uma data válida.')
  if (post.cover && !isBlogImagePath(post.cover)) add('cover', 'Envie a capa pelo botão. Ela precisa ficar na pasta do blog.')
  if (post.cover_alt.length > BLOG_LIMITS.coverAlt) add('cover_alt', `Use até ${BLOG_LIMITS.coverAlt} caracteres na descrição da capa.`)
  else if (post.cover && !post.cover_alt) add('cover_alt', 'Descreva a capa para quem não vê a imagem.')
  if (post.tags.length > BLOG_LIMITS.tags) add('tags', `Use até ${BLOG_LIMITS.tags} temas.`)
  else if (post.tags.some(tag => tag.length > BLOG_LIMITS.tag)) add('tags', `Use até ${BLOG_LIMITS.tag} caracteres em cada tema.`)
  else if (new Set(post.tags.map(tag => tag.toLowerCase())).size !== post.tags.length) add('tags', 'Tire os temas repetidos.')
  if (post.body.length > BLOG_LIMITS.body) add('body', `O texto passou de ${BLOG_LIMITS.body.toLocaleString('pt-BR')} caracteres. Divida em dois posts.`)
  else if (publishing && !post.body.trim()) add('body', 'Escreva o texto antes de publicar.')
  else if (publishing && images.some(image => !isBlogImagePath(image.src))) add('body', 'Há uma imagem de fora do blog no texto. Envie as imagens pelo botão "Imagem".')
  else if (publishing && images.some(image => !image.alt)) add('body', 'Há uma imagem sem descrição no texto. Escreva a descrição entre os colchetes: ![descrição](endereço).')
  if (publishing) {
    const marked = (['title', 'slug', 'description', 'seo_title', 'seo_description', 'author', 'cover_alt', 'tags', 'body'] as const)
      .find(field => pendingMarker.test(Array.isArray(post[field]) ? (post[field] as string[]).join(' ') : String(post[field])))
    if (marked) add(marked, 'Tire a marcação PENDENTE antes de publicar: o site não publica conteúdo com ela.')
  }
  return problems
}
