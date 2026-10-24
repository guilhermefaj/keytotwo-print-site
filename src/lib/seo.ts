import { otherPages, publicPages } from '../content/site.ts'
import { productPages, type Product } from '../content/products.ts'
import { supportEmail } from '../content/help.ts'
import { instagram, tiktok } from '../content/gratuitos.ts'
import type { BlogPostSummary } from './blog.ts'
import { catalogEntry } from '../content/catalog.ts'
import { siteConfig } from './site-config.ts'

export function pageSeo(pathname: string, post?: BlogPostSummary) {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (post && path === `/blog/${post.slug}`) {
    return {
      // Os campos do Google, quando preenchidos no admin, valem mais que o título e o resumo do post.
      title: `${post.seoTitle || post.title} — KeyToTwo`, description: post.seoDescription || post.description,
      canonical: new URL(path, siteConfig.origin).href,
      robots: siteConfig.stage === 'live' && !post.draft ? 'index, follow' : 'noindex, nofollow',
    }
  }
  const pages: Record<string, { title: string; description: string }> = { ...publicPages, ...otherPages }
  const page = pages[path] ?? otherPages['/404']
  return {
    ...page,
    canonical: new URL(pages[path] ? path : '/404', siteConfig.origin).href,
    robots: siteConfig.stage === 'live' && Object.hasOwn(publicPages, path) ? 'index, follow' : 'noindex, nofollow',
  }
}

// Imagem de compartilhamento (og:image, 1200×630, scripts/prepare-og-images.mjs): a capa do produto na página dele,
// a dos gratuitos em /gratuitos e a da Coleção nas demais.
export const shareImageSize = { width: 1200, height: 630 }
export function productForPath(pathname: string): Product | undefined {
  const path = pathname.replace(/\/+$/, '')
  return productPages.find(product => path === `/loja/${product.slug}`)
}
export function shareImage(pathname: string) {
  const path = pathname.replace(/\/+$/, '') || '/'
  const product = productForPath(path)
  const code = product ? product.code.toLowerCase() : path === '/gratuitos' ? 'f001' : 'p001'
  return {
    url: new URL(`/media/og/${code}.jpg`, siteConfig.origin).href,
    alt: product ? `Capa de ${product.title}` : path === '/gratuitos' ? 'Capa de Hora dos Artistas, jogo gratuito da KeyToTwo' : 'Capa da Coleção KeyToTwo: Fundadores',
  }
}

const organization = () => ({
  '@type': 'Organization', '@id': `${siteConfig.origin}/#organizacao`, name: 'KeyToTwo', url: siteConfig.origin,
  logo: new URL('/media/hero/keytotwo-logo.webp', siteConfig.origin).href, email: supportEmail, sameAs: [instagram.href, tiktok.href],
})

// Página inicial: quem é a KeyToTwo e o site.
export function homeJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@graph': [organization(), { '@type': 'WebSite', '@id': `${siteConfig.origin}/#site`, name: 'KeyToTwo', url: siteConfig.origin, inLanguage: 'pt-BR', publisher: { '@id': `${siteConfig.origin}/#organizacao` } }],
  }
}

// Página do produto: o produto com o preço do catálogo no build (o Price da Stripe; fora do catálogo, sem oferta) e a
// trilha Início › Loja › produto.
export function productJsonLd(product: Product) {
  const url = new URL(`/loja/${product.slug}`, siteConfig.origin).href
  const listed = catalogEntry(product.code)?.price
  const price = listed && product.availability === 'sale' ? (listed.unit_amount / 100).toFixed(2) : null
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Product', name: product.title, description: product.seo.description, sku: product.code, url,
        image: shareImage(`/loja/${product.slug}`).url, brand: { '@type': 'Brand', name: 'KeyToTwo' },
        ...(price ? { offers: { '@type': 'Offer', price, priceCurrency: listed!.currency.toUpperCase(), availability: 'https://schema.org/InStock', url, seller: { '@id': `${siteConfig.origin}/#organizacao` } } } : {}),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [['Início', '/'], ['Loja', '/loja'], [product.title, `/loja/${product.slug}`]].map(([name, path], index) => ({
          '@type': 'ListItem', position: index + 1, name, item: new URL(path, siteConfig.origin).href,
        })),
      },
      organization(),
    ],
  }
}

export function blogPostingJsonLd(post: BlogPostSummary) {
  const canonical = new URL(`/blog/${post.slug}`, siteConfig.origin).href
  return {
    '@context': 'https://schema.org', '@type': 'BlogPosting',
    headline: post.title, description: post.seoDescription || post.description,
    datePublished: post.date, inLanguage: 'pt-BR',
    url: canonical, mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    author: post.author ? { '@type': 'Person', name: post.author } : { '@type': 'Organization', name: 'KeyToTwo', url: siteConfig.origin },
    publisher: { '@type': 'Organization', name: 'KeyToTwo', url: siteConfig.origin },
    ...(post.cover ? { image: new URL(post.cover, siteConfig.origin).href } : {}),
    ...(post.tags.length ? { keywords: post.tags.join(', ') } : {}),
  }
}

export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}
