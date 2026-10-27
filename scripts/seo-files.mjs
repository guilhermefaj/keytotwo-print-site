import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { privateRoutes, publicPages } from '../src/content/site.ts'
import { readBlogPosts } from '../src/lib/blog.server.ts'
import { buildSiteConfig } from '../src/lib/site-build.server.ts'

// Match Vite's build mode and precedence; no secrets are read or emitted.
const config = buildSiteConfig()
const outDir = path.resolve('build/client')
await mkdir(outDir, { recursive: true })
const xmlEscape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll("'", '&apos;')
const posts = await readBlogPosts({ stage: config.stage })
const urls = config.stage === 'live' ? [...Object.keys(publicPages), ...posts.map(post => `/blog/${post.slug}`)] : []
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(route => `  <url><loc>${xmlEscape(new URL(route, config.origin).href)}</loc></url>`).join('\n')}\n</urlset>\n`
// Fora da busca: entrada, compra, o Portal (privateRoutes), o link dos e-mails e os atalhos para o admin (nginx.conf).
const blocked = ['/entrar', '/carrinho', '/pagamento', ...privateRoutes, '/pedido/', '/email/', '/admin', '/painel', '/404']
const robots = config.stage === 'live'
  ? `User-agent: *\nAllow: /\n${blocked.map(route => `Disallow: ${route}\n`).join('')}Sitemap: ${config.origin}/sitemap.xml\n`
  : 'User-agent: *\nDisallow: /\n'
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>Blog KeyToTwo</title><link>${xmlEscape(`${config.origin}/blog`)}</link>
<description>${xmlEscape(publicPages['/blog'].description)}</description><language>pt-BR</language>
<atom:link href="${xmlEscape(`${config.origin}/blog/rss.xml`)}" rel="self" type="application/rss+xml" />
${posts.map(post => {
  const url = xmlEscape(`${config.origin}/blog/${post.slug}`)
  return `<item><title>${xmlEscape(`${post.draft ? 'Rascunho: ' : ''}${post.title}`)}</title><link>${url}</link><guid isPermaLink="true">${url}</guid><description>${xmlEscape(post.description)}</description><pubDate>${new Date(`${post.date}T00:00:00Z`).toUTCString()}</pubDate>${post.tags.map(tag => `<category>${xmlEscape(tag)}</category>`).join('')}</item>`
}).join('\n')}
</channel></rss>\n`
await mkdir(path.join(outDir, 'blog'), { recursive: true })
await writeFile(path.join(outDir, 'blog/rss.xml'), rss)
await writeFile(path.join(outDir, 'robots.txt'), robots)
await writeFile(path.join(outDir, 'sitemap.xml'), sitemap)
console.log(`SEO: ${config.stage}; ${urls.length} public sitemap URLs; ${posts.length} RSS posts; origin ${config.origin}`)
