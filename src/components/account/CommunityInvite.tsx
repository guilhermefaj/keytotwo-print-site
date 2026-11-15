import { IconBrandWhatsapp, IconShare } from '@tabler/icons-react'
import { foundersCommunity } from '../../content/account'
import { Icon } from '../ui/Icon'

// Convite do grupo da KeyToTwo no WhatsApp (2026-11-04; desde 2026-11-15 para toda conta). O link vem só da api
// (community_url): sem ele, o card não existe. Botão primário da marca, sem o verde do WhatsApp. O convite ao par usa
// wa.me sem número: o WhatsApp abre com a mensagem pronta e a pessoa escolhe o contato. Fica no topo de Meus jogos e,
// em Gratuitos, depois que os jogos são liberados.
export function CommunityInvite({ url, className = '' }: { url: string; className?: string }) {
  return <section className={`portal-community ${className}`.trim()} aria-labelledby="community-title">
    <div><h2 id="community-title">{foundersCommunity.title}</h2><p>{foundersCommunity.text}</p></div>
    <div className="portal-community-action">
      <a className="button button-primary" href={url} target="_blank" rel="noopener noreferrer"><Icon component={IconBrandWhatsapp} />{foundersCommunity.action}<span className="sr-only"> (abre em nova aba)</span></a>
      <a className="text-button" href={`https://wa.me/?text=${encodeURIComponent(foundersCommunity.shareMessage(url))}`} target="_blank" rel="noopener noreferrer"><Icon component={IconShare} />{foundersCommunity.share}<span className="sr-only"> pelo WhatsApp (abre em nova aba)</span></a>
    </div>
  </section>
}
