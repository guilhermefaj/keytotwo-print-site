import { loadEnv } from 'vite'
import { resolveSiteConfig } from './seo.ts'

// Shared by route discovery, prerendering and SEO files; matches Vite precedence.
export function buildSiteConfig() {
  return resolveSiteConfig({ ...loadEnv(process.env.SEO_MODE || 'production', process.cwd(), 'VITE_SITE_'),
    ...(process.env.VITE_SITE_STAGE ? { VITE_SITE_STAGE: process.env.VITE_SITE_STAGE } : {}),
    ...(process.env.VITE_SITE_URL ? { VITE_SITE_URL: process.env.VITE_SITE_URL } : {}),
  })
}
