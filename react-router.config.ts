import type { Config } from '@react-router/dev/config'

export default {
  appDirectory: 'src',
  buildDirectory: 'build',
  ssr: false,
  prerender({ getStaticPaths }) {
    // The unbounded catch-all uses the generated SPA fallback, not an HTML file per URL.
    return getStaticPaths()
  },
} satisfies Config
