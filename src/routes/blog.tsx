import { Link } from 'react-router'
import type { Route } from './+types/blog'
import { readBlogPosts, summarizeBlogPost } from '../lib/blog.server'
import { formatBlogDate } from '../lib/blog'
import { siteConfig } from '../lib/seo'

export async function loader() {
  return { posts: (await readBlogPosts({ stage: siteConfig.stage })).map(summarizeBlogPost) }
}

export default function Blog({ loaderData }: Route.ComponentProps) {
  return <main id="conteudo" tabIndex={-1} className="blog-page content-width">
    <header className="blog-intro">
      <h1>Blog</h1>
      <p>Um espaço da KeyToTwo para acompanhar as próximas ideias.</p>
    </header>
    {loaderData.posts.length ? <ul className="blog-list" aria-label="Artigos">
      {loaderData.posts.map(post => <li key={post.slug}>
        <article className={`blog-entry${post.cover ? ' blog-entry-with-cover' : ''}`}>
          {post.cover && <img className="blog-list-cover" src={post.cover} alt={post.coverAlt} width="960" height="640" loading="lazy" />}
          <div>
            <div className="blog-meta">
              {post.draft && <span className="blog-draft">Rascunho</span>}
              <time dateTime={post.date}>{formatBlogDate(post.date)}</time>
              <span>{post.readingMinutes} min de leitura</span>
            </div>
            <h2><Link to={`/blog/${post.slug}`}>{post.title}</Link></h2>
            <p>{post.description}</p>
            {post.tags.length > 0 && <ul className="blog-tags" aria-label="Temas">{post.tags.map(tag => <li key={tag}>{tag}</li>)}</ul>}
          </div>
        </article>
      </li>)}
    </ul> : <section className="blog-empty" aria-labelledby="blog-empty-title">
      <h2 id="blog-empty-title">Nenhum texto publicado ainda.</h2>
      <p>Enquanto isso, os jogos já estão na Loja.</p>
      <Link className="inline-link" to="/loja">Ver os jogos</Link>
    </section>}
    <a className="inline-link blog-rss" href="/blog/rss.xml">Acompanhar pelo RSS</a>
  </main>
}
