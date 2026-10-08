import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadEnv } from 'vite'
import { publicPages } from '../src/content/site.ts'
import { resolveSiteConfig } from '../src/lib/seo.ts'

// Match Vite's build mode and precedence; no secrets are read or emitted.
const mode = process.env.SEO_MODE || 'production'
const config = resolveSiteConfig({ ...loadEnv(mode, process.cwd(), 'VITE_SITE_'),
  ...(process.env.VITE_SITE_STAGE ? { VITE_SITE_STAGE: process.env.VITE_SITE_STAGE } : {}),
  ...(process.env.VITE_SITE_URL ? { VITE_SITE_URL: process.env.VITE_SITE_URL } : {}),
})
const outDir = path.resolve('build/client')
await mkdir(outDir, { recursive: true })
const xmlEscape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll("'", '&apos;')
const urls = config.stage === 'live' ? Object.keys(publicPages) : []
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(route => `  <url><loc>${xmlEscape(new URL(route, config.origin).href)}</loc></url>`).join('\n')}\n</urlset>\n`
const robots = config.stage === 'live'
  ? `User-agent: *\nAllow: /\nDisallow: /entrar\nDisallow: /carrinho\nDisallow: /meus-jogos\nDisallow: /conta\nDisallow: /pedido/\nDisallow: /preview/\nDisallow: /404\nSitemap: ${config.origin}/sitemap.xml\n`
  : 'User-agent: *\nDisallow: /\n'
await writeFile(path.join(outDir, 'robots.txt'), robots)
await writeFile(path.join(outDir, 'sitemap.xml'), sitemap)
console.log(`SEO: ${config.stage}; ${urls.length} public sitemap URLs; origin ${config.origin}`)
