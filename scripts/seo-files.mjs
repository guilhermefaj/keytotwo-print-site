import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { catalogEntry } from '../src/content/catalog.ts'
import { freebies, needLabels } from '../src/content/games.ts'
import { instagram, tiktok } from '../src/content/gratuitos.ts'
import { supportEmail } from '../src/content/help.ts'
import { company } from '../src/content/legal.ts'
import { productPages } from '../src/content/products.ts'
import { privateRoutes, publicPages } from '../src/content/site.ts'
import { money } from '../src/lib/format.ts'
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
// llms.txt (proposta de llmstxt.org, 2026-10-29): a loja em texto simples para assistentes de IA que o leiam. O Google
// diz que não usa e que não muda a busca. Só fatos das mesmas fontes das páginas (conteúdo e catálogo do build), sem
// recado aos assistentes. Só em live: fora dele os preços são de teste.
const page = route => new URL(route, config.origin).href
const price = code => {
  const entry = catalogEntry(code)
  if (!entry?.price) return ''
  const text = amount => money(amount, entry.price.currency).replaceAll('\u00a0', ' ')
  const list = entry.list_price && entry.list_price.amount > entry.price.unit_amount ? entry.list_price : null
  return list ? ` De ${text(list.amount)} por ${text(entry.price.unit_amount)} (${list.label}).` : ` ${text(entry.price.unit_amount)}.`
}
const needs = game => game.needs?.length ? ` Além do PDF: ${game.needs.map(need => needLabels[need].replace(/^./, letter => letter.toLowerCase())).join('; ')}.` : ''
const llms = `# KeyToTwo

> Jogos em PDF para casais imprimirem e jogarem juntos em casa. Loja on-line brasileira, em português, com preços em reais.

A KeyToTwo é uma marca da ${company.legalName}, CNPJ ${company.cnpj}.

## Jogos à venda

${productPages.map(product => `- [${product.title}](${page(`/loja/${product.slug}`)}): ${product.seo.description}${product.kind === 'bundle' ? ` Traz ${product.games.map(game => game.name).join(', ').replace(/, ([^,]*)$/, ' e $1')}.` : needs(product.games[0])}${price(product.code)}`).join('\n')}

## Jogos gratuitos

${freebies.map(game => `- [${game.name}](${page('/gratuitos')}): ${game.summary}${needs(game)}`).join('\n')}

Os gratuitos são liberados para quem cria a conta e aceita receber os e-mails da KeyToTwo.

## Como funciona

- Os jogos são digitais: nada é enviado pelo correio. Depois do pagamento, os PDFs aparecem em Meus jogos, no site, e chegam também por e-mail. Em Meus jogos, o acesso não tem prazo.
- O pagamento é por Pix ou cartão, pela Stripe. É preciso ter uma conta para pagar.
- Para imprimir: papel A4 comum, em tamanho real (100%), só a frente de cada folha.
- Arquivo com defeito, jogo não entregue e cobrança em duplicidade têm solução pelo atendimento. Os casos de reembolso estão na Política de reembolso.

## Páginas

- [Loja](${page('/loja')})
- [Ajuda](${page('/ajuda')}): compra, conta, impressão, o que cada jogo pede e atendimento.
- [Política de reembolso](${page('/reembolsos')})
- [Termos de uso](${page('/termos')})
- [Política de privacidade](${page('/privacidade')})
${posts.length ? `
## Blog

${posts.map(post => `- [${post.title}](${page(`/blog/${post.slug}`)}): ${post.description}`).join('\n')}
` : ''}
## Contato

- E-mail: ${supportEmail}
- Instagram: ${instagram.href}
- TikTok: ${tiktok.href}
`
await mkdir(path.join(outDir, 'blog'), { recursive: true })
if (config.stage === 'live') await writeFile(path.join(outDir, 'llms.txt'), llms)
else await rm(path.join(outDir, 'llms.txt'), { force: true })
await writeFile(path.join(outDir, 'blog/rss.xml'), rss)
await writeFile(path.join(outDir, 'robots.txt'), robots)
await writeFile(path.join(outDir, 'sitemap.xml'), sitemap)
console.log(`SEO: ${config.stage}; ${urls.length} public sitemap URLs; ${posts.length} RSS posts; origin ${config.origin}`)
