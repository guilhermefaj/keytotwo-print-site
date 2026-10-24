import type { ReactNode } from 'react'
import { formatDate } from '../../lib/format'

// Topo do post (DESIGN.md › Blog): selo de rascunho, data, tempo de leitura, autor, título, resumo e temas. O mesmo no
// site e na prévia do admin, que passa o título como parágrafo (a página do admin já tem o H1). `children` entra no fim.
export function PostHeader({ draft, date, readingMinutes, author, title, description, tags, children }: {
  draft: boolean; date?: string; readingMinutes: number; author: string; title: ReactNode; description: string; tags: readonly string[]; children?: ReactNode
}) {
  return <header className="blog-post-heading">
    <div className="blog-meta">
      {draft && <span className="blog-draft">Rascunho</span>}
      {date && <time dateTime={date}>{formatDate(date)}</time>}
      <span>{readingMinutes} min de leitura</span>
      {author && <span className="blog-author">Por {author}</span>}
    </div>
    {title}
    {description && <p className="blog-description">{description}</p>}
    {tags.length > 0 && <ul className="blog-tags" aria-label="Temas">{tags.map(tag => <li key={tag}>{tag}</li>)}</ul>}
    {children}
  </header>
}
