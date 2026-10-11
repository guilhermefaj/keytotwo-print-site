import { readFileSync } from 'node:fs'

// The prerendered build decides the stage: test shows the environment banner, live publishes a
// sitemap in robots.txt, anything else is preview. Specs branch on this instead of assuming test.
export type BuiltStage = 'test' | 'preview' | 'live'

export function builtStage(): BuiltStage {
  const html = readFileSync(new URL('../../../build/client/index.html', import.meta.url), 'utf8')
  if (html.includes('Ambiente de teste')) return 'test'
  const robots = readFileSync(new URL('../../../build/client/robots.txt', import.meta.url), 'utf8')
  return /^Sitemap:/m.test(robots) ? 'live' : 'preview'
}
