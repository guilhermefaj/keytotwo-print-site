import { Link } from 'react-router'
import { formatBlogDate, type BlogPostSummary } from '../../lib/blog'

export function FromBlog({ posts }: { posts: BlogPostSummary[] }) {
  if (!posts.length) return null
  return <section className="page-section from-blog" aria-labelledby="from-blog-title"><div className="content-width"><div className="from-blog-heading"><h2 id="from-blog-title">Do blog</h2><Link className="inline-link" to="/blog">Ver todos os textos <span aria-hidden="true">→</span></Link></div><ul className="home-posts">{posts.map(post => <li key={post.slug}><article>{post.cover && <img src={post.cover} alt={post.coverAlt} width="960" height="640" loading="lazy" decoding="async" />}<time dateTime={post.date}>{formatBlogDate(post.date)}</time><h3><Link to={`/blog/${post.slug}`}>{post.title}</Link></h3><p>{post.description}</p></article></li>)}</ul></div></section>
}
