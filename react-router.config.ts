import type { Config } from '@react-router/dev/config'
import { readBlogPosts } from './src/lib/blog.server'
import { buildSiteConfig } from './src/lib/site-build.server'
import { productPages } from './src/content/products'

export default {
  appDirectory: 'src',
  buildDirectory: 'build',
  ssr: false,
  async prerender({ getStaticPaths }) {
    const { stage } = buildSiteConfig()
    const posts = await readBlogPosts({ stage })
    // The unbounded catch-all uses the generated SPA fallback, not an HTML file per URL.
    return [...getStaticPaths(), ...productPages.map(product => `/loja/${product.slug}`), ...posts.map(post => `/blog/${post.slug}`)]
  },
} satisfies Config
