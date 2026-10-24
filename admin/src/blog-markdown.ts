import MarkdownIt from 'markdown-it'
import { blogProblems, markdownImages, prepareMarkdownTokens, readingMinutes, readingWords, type BlogPostInput, type BlogProblem, type MarkdownToken } from '../../supabase/functions/_shared/blog-rules.ts'
import { mediaUrl } from './blog'

// O mesmo Markdown do site: sem HTML cru, sem links automáticos, título da página como H1. Só o editor carrega isto.
const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false })
const tokens = (body: string) => markdown.parse(body, {}) as unknown as MarkdownToken[]

export function problemsOf(post: BlogPostInput): BlogProblem[] {
  return blogProblems(post, markdownImages(tokens(post.body)))
}

// O mesmo tempo de leitura que o site mostra.
export const readingMinutesOf = (body: string) => readingMinutes(readingWords(tokens(body)))

export function renderMarkdown(body: string, mediaBase: string | null): string {
  const list = prepareMarkdownTokens(tokens(body), src => mediaUrl(src, mediaBase))
  return markdown.renderer.render(list as unknown as Parameters<typeof markdown.renderer.render>[0], markdown.options, {})
}
