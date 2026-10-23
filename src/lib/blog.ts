// Browser-safe types and presentation helpers. Parsing lives in blog.server.ts.
export type BlogPostSummary = {
  slug: string
  title: string
  description: string
  date: string
  // Quem escreveu; vazio nos arquivos antigos (a página não mostra a linha e o JSON-LD usa a KeyToTwo).
  author: string
  cover?: string
  coverAlt: string
  tags: string[]
  draft: boolean
  readingMinutes: number
}

export type BlogPost = BlogPostSummary & { html: string; wordCount: number }

export function formatBlogDate(date: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
}
