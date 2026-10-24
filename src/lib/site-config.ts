import defaults from '../../site.config.json' with { type: 'json' }

// Stage (preview, test, live) e origem do site, das variáveis do build (VITE_SITE_*) ou de site.config.json. Fica fora
// do seo.ts: quem só precisa saber o stage não carrega o conteúdo de todas as páginas.
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
