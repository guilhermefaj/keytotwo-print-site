import { siteConfig } from './seo'

// Frontend-only preview; live/preview never expose an unfinished subscription flow.
// Set VITE_GUEST_NEWSLETTER=false to hide it even in stage=test.
export const guestNewsletterPreview = siteConfig.stage === 'test' && import.meta.env.VITE_GUEST_NEWSLETTER !== 'false'
