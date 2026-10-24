import type { ReactNode } from 'react'

// Partes das fichas do admin (conta e pedido): uma seção com título (e a contagem, quando há) e um fato da lista de fatos.
export function Section({ id, title, count, children }: { id: string; title: string; count?: number; children: ReactNode }) {
  return <section className="detail-section" aria-labelledby={`secao-${id}`}>
    <h2 id={`secao-${id}`}>{title}{count !== undefined && <span className="count"> {count}</span>}</h2>
    {children}
  </section>
}

export const Fact = ({ label, children }: { label: string; children: ReactNode }) => <div><dt>{label}</dt><dd>{children}</dd></div>
