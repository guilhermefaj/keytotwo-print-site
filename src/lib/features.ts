import { siteConfig } from './seo'

// Frontend-only preview; live/preview never expose an unfinished subscription flow.
// Set VITE_GUEST_NEWSLETTER=false to hide it even in stage=test.
export const guestNewsletterPreview = siteConfig.stage === 'test' && import.meta.env.VITE_GUEST_NEWSLETTER !== 'false'

// Newsletter escondida até existir o envio (responsável, 2026-10-16): some do rodapé, dos posts e da
// confirmação, para quem entrou e para visitantes. A preferência de e-mail da Minha conta continua.
// VITE_NEWSLETTER=true traz a seção de volta.
export const newsletterVisible = import.meta.env.VITE_NEWSLETTER === 'true'
