import { otherPages, publicPages } from '../content/site.ts'
import defaults from '../../site.config.json' with { type: 'json' }
import type { BlogPostSummary } from './blog.ts'

type PublicEnv = { VITE_SITE_STAGE?: string; VITE_SITE_URL?: string }
export function resolveSiteConfig(env: PublicEnv) {
  const stage = env.VITE_SITE_STAGE || defaults.stage
  if (!['preview', 'test', 'live'].includes(stage)) throw new Error('VITE_SITE_STAGE must be preview, test or live.')
  const url = new URL(env.VITE_SITE_URL || defaults.url)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('VITE_SITE_URL must be an HTTP(S) origin without credentials, path, query or fragment.')
  }
  if (stage === 'live' && url.protocol !== 'https:') throw new Error('Live VITE_SITE_URL must use HTTPS.')
  return { stage, origin: url.origin, showCartAccess: stage !== 'preview' }
}

export const siteConfig = resolveSiteConfig({ VITE_SITE_STAGE: import.meta.env?.VITE_SITE_STAGE, VITE_SITE_URL: import.meta.env?.VITE_SITE_URL })

export function pageSeo(pathname: string, post?: BlogPostSummary) {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (post && path === `/blog/${post.slug}`) {
    return {
      title: `${post.title} — KeyToTwo`, description: post.description,
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

export function blogPostingJsonLd(post: BlogPostSummary) {
  const canonical = new URL(`/blog/${post.slug}`, siteConfig.origin).href
  return {
    '@context': 'https://schema.org', '@type': 'BlogPosting',
    headline: post.title, description: post.description,
    datePublished: post.date, inLanguage: 'pt-BR',
    url: canonical, mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    publisher: { '@type': 'Organization', name: 'KeyToTwo', url: siteConfig.origin },
    ...(post.cover ? { image: new URL(post.cover, siteConfig.origin).href } : {}),
    ...(post.tags.length ? { keywords: post.tags.join(', ') } : {}),
  }
}

export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}
