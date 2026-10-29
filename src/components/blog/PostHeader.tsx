import { IconBrandInstagram } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { instagramProfile } from '../../lib/blog'
import { formatDate } from '../../lib/format'

// Topo do post (DESIGN.md › Blog): selo de rascunho, data, tempo de leitura, autor (com o Instagram, se houver), título,
// resumo e temas. O mesmo no
// site e na prévia do admin, que passa o título como parágrafo (a página do admin já tem o H1). `children` entra no fim.
export function PostHeader({ draft, date, readingMinutes, author, authorInstagram, title, description, tags, children }: {
  draft: boolean; date?: string; readingMinutes: number; author: string; authorInstagram: string; title: ReactNode; description: string; tags: readonly string[]; children?: ReactNode
}) {
  return <header className="blog-post-heading">
    <div className="blog-meta">
      {draft && <span className="blog-draft">Rascunho</span>}
      {date && <time dateTime={date}>{formatDate(date)}</time>}
      <span>{readingMinutes} min de leitura</span>
      {author && <span className="blog-author">Por {author}{authorInstagram && <> · <a href={instagramProfile(authorInstagram)} target="_blank" rel="noopener" aria-label={`@${authorInstagram} no Instagram (abre em nova aba)`}><IconBrandInstagram aria-hidden="true" size={16} stroke={1.75} />@{authorInstagram}</a></>}</span>}
    </div>
    {title}
    {description && <p className="blog-description">{description}</p>}
    {tags.length > 0 && <ul className="blog-tags" aria-label="Temas">{tags.map(tag => <li key={tag}>{tag}</li>)}</ul>}
    {children}
  </header>
}
