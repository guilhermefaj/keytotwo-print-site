import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router'
import { AuthGate } from './AuthGate'
import { Layout } from './Layout'
import { MetricsPage } from './pages/Metrics'
import { NotFoundPage, SoonPage } from './pages/Soon'
import './admin.css'

createRoot(document.getElementById('admin')!).render(
  <AuthGate>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<MetricsPage />} />
          <Route path="blog" element={<SoonPage section="blog" />} />
          <Route path="pedidos" element={<SoonPage section="pedidos" />} />
          <Route path="usuarios" element={<SoonPage section="usuarios" />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </AuthGate>,
)
