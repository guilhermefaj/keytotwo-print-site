import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { AuthGate } from './AuthGate'
import { Layout } from './Layout'
import { BlogPage } from './pages/Blog'
import { MetricsPage } from './pages/Metrics'
import { NotFoundPage, SoonPage } from './pages/Soon'
import { UsersPage } from './pages/Users'
import './admin.css'

// Roteador de dados: o editor do blog pergunta antes de sair com mudanças sem salvar (useBlocker).
// O editor (com o markdown-it) só carrega quando alguém abre um post; a ficha de uma conta, quando alguém abre a conta.
const router = createBrowserRouter([{
  element: <Layout />,
  children: [
    { index: true, element: <MetricsPage /> },
    { path: 'blog', element: <BlogPage /> },
    { path: 'blog/novo', lazy: async () => ({ Component: (await import('./pages/BlogEditor')).BlogEditorRoute }) },
    { path: 'blog/:id', lazy: async () => ({ Component: (await import('./pages/BlogEditor')).BlogEditorRoute }) },
    { path: 'pedidos', element: <SoonPage section="pedidos" /> },
    { path: 'usuarios', element: <UsersPage /> },
    { path: 'usuarios/:id', lazy: async () => ({ Component: (await import('./pages/User')).UserRoute }) },
    { path: '*', element: <NotFoundPage /> },
  ],
}])

createRoot(document.getElementById('admin')!).render(
  <AuthGate>
    <RouterProvider router={router} />
  </AuthGate>,
)
