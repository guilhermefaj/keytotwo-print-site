import { startTransition, StrictMode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { HydratedRouter } from 'react-router/dom'

// Desempenho (2026-10-16): as páginas chegam pré-renderizadas e completas. A hidratação espera o primeiro
// quadro, para o navegador pintar o HTML antes do trabalho do React (antes, o FCP só saía depois dela).
function afterFirstPaint(run: () => void) {
  requestAnimationFrame(() => setTimeout(run, 0))
}

afterFirstPaint(() => {
  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <HydratedRouter />
      </StrictMode>,
    )
  })
})
