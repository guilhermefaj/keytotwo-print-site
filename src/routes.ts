import { index, route, type RouteConfig } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('preview/hero', 'routes/home.tsx', { id: 'preview-hero' }),
  route('entrar', 'routes/entrar.tsx'),
  route('carrinho', 'routes/carrinho.tsx'),
  route('meus-jogos', 'routes/meus-jogos.tsx'),
  route('conta', 'routes/conta.tsx'),
  route('pedido/confirmacao', 'routes/pedido.confirmacao.tsx'),
  route('ajuda', 'routes/ajuda.tsx'),
  route('termos', 'routes/termos.tsx'),
  route('privacidade', 'routes/privacidade.tsx'),
  route('reembolsos', 'routes/reembolsos.tsx'),
  // A static 404 document for the host, plus client-side unknown routes.
  route('404', 'routes/not-found.tsx'),
  route('*', 'routes/not-found.tsx', { id: 'not-found-catchall' }),
] satisfies RouteConfig
