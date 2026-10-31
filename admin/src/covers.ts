import type { SyntheticEvent } from 'react'
import { siteUrl } from './supabase'

// A capa do produto no site para as miniaturas do Catálogo (revisão de UX, 2026-10-31). Segue a convenção do site
// (cover() em src/content/games.ts: /media/games/<código>-capa-640.webp), sem trazer o catálogo do site para o admin.
export const coverOf = (code: string) => `${siteUrl}/media/games/${code.toLowerCase()}-capa-640.webp`

// Produto sem capa no site (a imagem não existe): a miniatura some e fica o fundo neutro.
export const hideMissingCover = (event: SyntheticEvent<HTMLImageElement>) => { event.currentTarget.style.visibility = 'hidden' }
