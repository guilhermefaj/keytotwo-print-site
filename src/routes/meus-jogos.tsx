import { productName } from '../content/products'
import { DataStatus } from '../components/account/AccountUi'
import { type Library } from '../lib/api'
import { dateLabel } from '../lib/format'
import { useApiResource } from '../lib/use-api-resource'
import { useEffect, type CSSProperties } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { DownloadButton } from '../components/account/DownloadButton'
import { deliveryMock, fileSize, type FreeGames } from '../lib/downloads'
import { useShop } from '../lib/shop-context'
import { GameCover } from '../components/account/GameCover'
import { KitoEmpty } from '../components/ui/KitoEmpty'

export default function MeusJogos() {
  const library = useApiResource<Library>('/library')
  // Os gratuitos liberados (conta + aceite de e-mails, para sempre) entram na mesma grade, depois dos comprados.
  const freeGames = useApiResource<FreeGames>('/free-games', true, deliveryMock)
  const { account } = useShop()
  const unlocked = Boolean(account.data?.free_games_unlocked)
  const free = freeGames.data?.games ?? []
  const shownFree = unlocked ? free : []
  const [params] = useSearchParams()
  const { hash } = useLocation()
  useEffect(() => {
    if (!/^#jogo-[A-Za-z0-9_-]+$/.test(hash) || !library.data) return
    const target = document.getElementById(hash.slice(1))
    target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'center' })
  }, [hash, library.data])
  return <section aria-labelledby="portal-title"><div className="portal-heading"><h1 id="portal-title" tabIndex={-1}>Meus jogos</h1><p>Escolham um jogo, preparem os materiais e puxem uma cadeira.</p></div>
    {params.get('link') === 'expirado' && <p className="library-notice" role="status">O link do e-mail venceu, mas seu acesso aos jogos continua aqui. Escolha Baixar PDF para gerar um novo.</p>}
    {params.get('link') === 'indisponivel' && <p className="library-notice" role="status">Não foi possível abrir aquele link. Confira os jogos disponíveis abaixo ou <Link className="inline-link" to="/ajuda">procure ajuda</Link>.</p>}
    {deliveryMock && <p className="checkout-demo">Demonstração da entrega (mock): os botões ainda não baixam arquivos.</p>}
    <DataStatus {...library} retry={library.reload} />
    {library.data && <>
      {library.data.pending.length > 0 && <section className="portal-pending"><h2>Aguardando confirmação</h2><p>Seus jogos aparecerão aqui quando o pagamento for confirmado.</p><Link className="inline-link" to="/pedidos">Acompanhar pedidos</Link></section>}
      {library.data.games.length === 0 && shownFree.length === 0 ? <div className="portal-empty"><KitoEmpty /><div><h2>Seus próximos jogos começam aqui</h2><p>Por enquanto, só o Kito mora aqui.</p><Link className="button button-primary" to="/loja">Ver os jogos</Link></div></div> : <ul className="library-grid portal-library">
        {library.data.games.map((game, index) => <LibraryGame key={game.code} code={game.code} name={game.name} order={index} collection={game.products.map(product => productName(product.code, product.name)).join(', ')}
          file={game.files.find(file => file.kind === 'pdf')} note={`Na sua conta desde ${dateLabel(game.acquired_at)}.`} onRefresh={library.reload} />)}
        {shownFree.map((game, index) => <LibraryGame key={game.code} code={game.code} name={game.name} order={library.data!.games.length + index} collection="Gratuito" file={game.file} isFree note="Liberado na sua conta." onRefresh={freeGames.reload} />)}
      </ul>}
      {!unlocked && account.data && free.length > 0 && <p className="library-notice">Os jogos gratuitos também ficam aqui depois que você os libera. <Link className="inline-link" to="/gratuitos">Ver os gratuitos</Link></p>}
    </>}
  </section>
}

// Card da biblioteca: comprado (pacotes e data de entrada) ou gratuito (selo e o download sem pedido). A nota do pé
// existe nos dois, para os botões ficarem alinhados na linha.
function LibraryGame({ code, name, collection, file, isFree = false, note, order, onRefresh }: { code: string; name: string; collection: string; file?: { id: string; size_bytes: number }; isFree?: boolean; note: string; order: number; onRefresh: () => void }) {
  return <li className="portal-game" id={`jogo-${code}`} tabIndex={-1} data-free={isFree || undefined} style={{ '--game-order': Math.min(order, 5) } as CSSProperties}>
    <GameCover code={code} name={name} />
    <div className="portal-game-body"><h2>{name}</h2><p className="game-collection">{collection}</p><p className="file-meta">PDF{file && fileSize(file.size_bytes) && ` · ${fileSize(file.size_bytes)}`}</p>
      <DownloadButton fileId={file?.id} gameCode={code} isFree={isFree} onRefresh={onRefresh} />
      <Link className="game-print-link" to="/ajuda#impressao">Como imprimir</Link>
      <p className="game-acquired">{note}</p>
    </div>
  </li>
}
