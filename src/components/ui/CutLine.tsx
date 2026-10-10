/** Linha de recorte com tesoura: separa duas folhas. Decorativa; ver DESIGN.md › Linha de recorte. */
export function CutLine({ className = '' }: { className?: string }) {
  return <div className={`cut-line ${className}`.trim()} aria-hidden="true">
    <svg width="28" height="24" viewBox="0 0 28 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="6" cy="6" r="4" /><circle cx="6" cy="18" r="4" /><path d="M9.5 8 26 18M9.5 16 26 6" /></svg>
  </div>
}
