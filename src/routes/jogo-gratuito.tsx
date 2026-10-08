import { Link } from 'react-router'
import { DataStatus } from '../components/account/AccountUi'
import { DownloadButton } from '../components/account/DownloadButton'
import { deliveryMock, fileSize } from '../lib/downloads'
import { useShop } from '../lib/shop-context'

export default function JogoGratuito() {
  const { freeGame } = useShop()
  const available = freeGame.data?.available ? freeGame.data : undefined
  return <main id="conteudo" tabIndex={-1} className="reading-page content-width"><p className="eyebrow">Uma ideia para vocês</p><h1>Jogo gratuito</h1>
    {deliveryMock && <p className="checkout-demo">Prévia da entrega (mock). Nenhum jogo gratuito foi publicado.</p>}
    <DataStatus {...freeGame} retry={freeGame.reload} />
    {available ? <section className="account-card"><h2>{available.game.name}</h2><p className="file-meta">PDF{fileSize(available.file.size_bytes) && ` · ${fileSize(available.file.size_bytes)}`}</p><DownloadButton fileId={available.file.id} isFree onRefresh={freeGame.reload} /></section> : !freeGame.loading && !freeGame.error && <p>Estamos preparando essa experiência. Quando estiver pronta, ela aparece aqui.</p>}
    <Link className="inline-link" to="/">Conhecer a KeyToTwo</Link>
  </main>
}
