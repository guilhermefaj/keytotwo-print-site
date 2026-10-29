// Browser-safe types and presentation helpers. Parsing lives in blog.server.ts.
export type BlogPostSummary = {
  slug: string
  title: string
  description: string
  date: string
  // Quem escreveu; vazio nos arquivos antigos (a página não mostra a linha e o JSON-LD usa a KeyToTwo).
  author: string
  // O Instagram de quem escreveu, sem o @ (2026-10-29); vazio, o post mostra só o nome.
  authorInstagram: string
  cover?: string
  coverAlt: string
  tags: string[]
  draft: boolean
  readingMinutes: number
  // Google e compartilhamento (2026-10-23): vazios, valem o título e o resumo.
  seoTitle: string
  seoDescription: string
  // A capa em JPEG 1200×630 para o WhatsApp e as redes (o build da VPS gera); sem ela, a capa original.
  shareImage?: string
}

export type BlogPost = BlogPostSummary & { html: string; wordCount: number }

export const instagramProfile = (handle: string) => `https://www.instagram.com/${handle}/`

// Até 3 posts com tema em comum, do que divide mais temas ao mais novo. Sem tema em comum, nenhum.
export function relatedPosts<T extends BlogPostSummary>(post: BlogPostSummary, posts: T[], limit = 3): T[] {
  const tags = new Set(post.tags.map(tag => tag.toLowerCase()))
  return posts.filter(other => other.slug !== post.slug)
    .map(other => ({ other, shared: other.tags.filter(tag => tags.has(tag.toLowerCase())).length }))
    .filter(item => item.shared > 0)
    .sort((a, b) => b.shared - a.shared || b.other.date.localeCompare(a.other.date) || a.other.slug.localeCompare(b.other.slug))
    .slice(0, limit)
    .map(item => item.other)
}
