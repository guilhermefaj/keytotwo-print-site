import { experience } from '../../content/experience'

export function BrandIcon({ kind }: { kind: string }) {
  return <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {kind === 'connection' ? <><path d="M17 12H7v16h6l5 5v-5h5V17M23 7h10v16h-5l-5 5" /><path d="M12 18h6m-6 5h4m10-10h3m-3 5h3" /></> : kind === 'play' ? <><rect x="8" y="8" width="24" height="24" rx="6" transform="rotate(-8 20 20)" /><path d="M14 14h.01M26 14h.01M20 20h.01M14 26h.01M26 26h.01" strokeWidth="3.5" /></> : <><circle cx="20" cy="20" r="13" /><path d="M20 12v9l6 3M5 7l3-3m24 0 3 3" /></>}
  </svg>
}

export function ExperienceSections() {
  const social = experience.social
  return <>
    <section className="page-section pillars-section" aria-labelledby="experiencia"><div className="content-width">
      <div className="section-heading centered-heading"><p className="eyebrow">O melhor da partida</p><h2 id="experiencia" tabIndex={-1}>Estar ali. De verdade.</h2></div>
      <div className="pillars-grid">{experience.pillars.map(pillar => <article key={pillar.icon}><BrandIcon kind={pillar.icon} /><h3>{pillar.title}</h3><p>{pillar.text}</p></article>)}</div>
    </div></section>
    <section className="page-section experience-section" aria-labelledby="experience-title"><div className="content-width experience-layout">
      <div className="experience-art" aria-hidden="true"><span className="art-topline">o plano de hoje</span><div className="round-talk">só mais<br /><em>uma</em><br />rodada.</div><span className="art-bottomline">vocês dois + uma boa ideia</span></div>
      <div className="experience-copy"><p className="eyebrow">Pode puxar uma cadeira</p><h2 id="experience-title">A melhor parte<br />acontece entre vocês.</h2><p>A conversa que toma outro rumo. A risada depois de uma tentativa duvidosa. A vontade de jogar de novo.</p><p>O Kito traz a ideia. Vocês fazem a noite acontecer.</p><a className="button button-light" href="/#comprar">Vamos jogar juntos<span aria-hidden="true">↗</span></a></div>
    </div></section>
    <section className="page-section social-section" aria-labelledby="social-title"><div className="content-width">
      <div className="section-heading centered-heading"><p className="eyebrow">Histórias a dois</p><h2 id="social-title">{social.heading}</h2><p>{social.description}</p></div>
      <div className="social-metrics"><p><strong>{social.rating === null ? '—' : social.rating.toLocaleString('pt-BR')}</strong><span>{social.rating === null ? social.placeholders.rating : 'Nota dos casais'}</span></p><p><strong>{social.reviewCount === null ? '—' : social.reviewCount.toLocaleString('pt-BR')}</strong><span>{social.reviewCount === null ? social.placeholders.count : 'Relatos recebidos'}</span></p></div>
      <div className="social-grid">{social.testimonials.map(item => <figure key={item.id} className="social-card" data-placeholder={!item.quote || !item.author ? 'true' : undefined}>
        {item.quote && item.author ? <><blockquote>{item.quote}</blockquote><figcaption>{item.author}</figcaption></> : <><span className="placeholder-label">{social.placeholders.label}</span><p className="placeholder-quote">{social.placeholders.quote}</p><span className="placeholder-lines" aria-hidden="true" /><figcaption>{social.placeholders.author}</figcaption></>}
      </figure>)}</div>
    </div></section>
  </>
}
