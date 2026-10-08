import { otherPages, publicPages } from '../content/site.ts'
import defaults from '../../site.config.json' with { type: 'json' }

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

export function pageSeo(pathname: string) {
  const path = pathname.replace(/\/+$/, '') || '/'
  const pages: Record<string, { title: string; description: string }> = { ...publicPages, ...otherPages }
  const page = pages[path] ?? otherPages['/404']
  return {
    ...page,
    canonical: new URL(pages[path] ? path : '/404', siteConfig.origin).href,
    robots: siteConfig.stage === 'live' && Object.hasOwn(publicPages, path) ? 'index, follow' : 'noindex, nofollow',
  }
}
