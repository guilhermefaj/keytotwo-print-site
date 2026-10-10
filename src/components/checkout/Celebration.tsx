import type { CSSProperties } from 'react'

export function Celebration() {
  return <div className="purchase-celebration" aria-hidden="true"><img src="/media/experience/kito-hi-256.webp" width="256" height="256" alt="" />{Array.from({ length: 10 }, (_, index) => <span className="confetti-piece" key={index} style={{ '--piece': index } as CSSProperties} />)}</div>
}
