import { index, layout, route, type RouteConfig } from '@react-router/dev/routes'
import { readBlogPosts } from './lib/blog.server'
import { buildSiteConfig } from './lib/site-build.server'
import { productPages } from './content/products'

const hasBlogPosts = (await readBlogPosts({ stage: buildSiteConfig().stage })).length > 0

export default [
  index('routes/home.tsx'),
  route('loja', 'routes/loja.tsx'),
  route('gratuitos', 'routes/gratuitos.tsx'),
  ...(productPages.length ? [route('loja/:slug', 'routes/loja.produto.tsx')] : []),
  route('entrar', 'routes/entrar.tsx'),
  // A sacola funciona sem login (guardada no navegador); o login vem no pagamento.
  route('carrinho', 'routes/carrinho.tsx'),
  layout('routes/private.tsx', [
    route('pagamento', 'routes/pagamento.tsx'),
    layout('routes/minha-area.tsx', [
      route('meus-jogos', 'routes/meus-jogos.tsx'),
      route('pedidos', 'routes/pedidos.tsx'),
      route('conta', 'routes/conta.tsx'),
    ]),
    route('pedido/confirmacao', 'routes/pedido.confirmacao.tsx'),
  ]),
  route('ajuda', 'routes/ajuda.tsx'),
  route('blog', 'routes/blog.tsx'),
  // React Router forbids server loaders with no prerendered URLs in SPA mode.
  // An empty live blog therefore resolves unknown slugs through the existing 404.
  ...(hasBlogPosts ? [route('blog/:slug', 'routes/blog.post.tsx')] : []),
  route('email/preferencias', 'routes/email.preferencias.tsx'),
  route('termos', 'routes/termos.tsx'),
  route('privacidade', 'routes/privacidade.tsx'),
  route('reembolsos', 'routes/reembolsos.tsx'),
  // A static 404 document for the host, plus client-side unknown routes.
  route('404', 'routes/not-found.tsx'),
  route('*', 'routes/not-found.tsx', { id: 'not-found-catchall' }),
] satisfies RouteConfig
