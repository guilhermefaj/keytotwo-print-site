import { Link, isRouteErrorResponse, useLoaderData, useRouteError, type ClientLoaderFunctionArgs, type LoaderFunctionArgs } from 'react-router'
import { readBlogPosts } from '../lib/blog.server'
import { formatBlogDate } from '../lib/blog'
import { siteConfig } from '../lib/seo'
import { site } from '../content/site'
import { Newsletter } from '../components/newsletter/Newsletter'
import { BackLink } from '../components/ui/BackLink'
import '../blog.css'

export async function loader({ params }: LoaderFunctionArgs) {
  const post = (await readBlogPosts({ stage: siteConfig.stage })).find(post => post.slug === params.slug)
  if (!post) throw new Response('Artigo não encontrado', { status: 404 })
  return { post }
}

// Prerender só grava .data dos slugs publicados; no runtime (SPA com fallback) o
// router relata a ausência como um erro interno de rota. Traduzimos esse sinal
// em um 404 de verdade para o ErrorBoundary; erros reais seguem inalterados.
export async function clientLoader(args: ClientLoaderFunctionArgs) {
  try {
    return await args.serverLoader()
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('No result found for routeId')) {
      throw new Response('Artigo não encontrado', { status: 404 })
    }
    throw error
  }
}
clientLoader.hydrate = true

export default function BlogPost() {
  const { post } = useLoaderData<typeof loader>()
  return <main id="conteudo" tabIndex={-1} className="blog-page blog-post content-width">
    <BackLink to="/blog">Voltar ao blog</BackLink>
    <article>
      <header className="blog-post-heading">
        <div className="blog-meta">
          {post.draft && <span className="blog-draft">Rascunho</span>}
          <time dateTime={post.date}>{formatBlogDate(post.date)}</time>
          <span>{post.readingMinutes} min de leitura</span>
        </div>
        <h1>{post.title}</h1>
        <p className="blog-description">{post.description}</p>
        {post.tags.length > 0 && <ul className="blog-tags" aria-label="Temas">{post.tags.map(tag => <li key={tag}>{tag}</li>)}</ul>}
      </header>
      {post.cover && <img className="blog-post-cover" src={post.cover} alt={post.coverAlt} width="1200" height="800" fetchPriority="high" />}
      {/* Only HTML produced by blog.server.ts with raw HTML disabled reaches here. */}
      <div className="blog-prose" dangerouslySetInnerHTML={{ __html: post.html }} />
    </article>
    <aside className="blog-package" aria-labelledby="blog-package-title">
      <h2 id="blog-package-title">{site.closing}</h2>
      <p>{site.description}</p>
      <Link className="button button-primary" to="/loja">Ver os jogos</Link>
    </aside>
    <Newsletter />
    <BackLink to="/blog">Voltar ao blog</BackLink>
  </main>
}

export function ErrorBoundary() {
  const error = useRouteError()
  const missing = isRouteErrorResponse(error) && error.status === 404
  return <main id="conteudo" tabIndex={-1} className="blog-page blog-post content-width">
    <h1>{missing ? 'Artigo não encontrado' : 'Não foi possível abrir este artigo'}</h1>
    <p>{missing ? 'Este endereço não está disponível. Veja os artigos publicados no blog.' : 'Tente abrir o artigo novamente a partir do blog.'}</p>
    <BackLink to="/blog">Voltar ao blog</BackLink>
  </main>
}
