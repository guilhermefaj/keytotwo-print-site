import { productName } from '../content/products'
import { DataStatus } from '../components/account/AccountUi'
import { dateLabel, type Library } from '../lib/api'
import { useApiResource } from '../lib/use-api-resource'
import { useEffect, type CSSProperties } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { DownloadButton } from '../components/account/DownloadButton'
import { deliveryMock, fileSize } from '../lib/downloads'
import { GameCover } from '../components/account/GameCover'
import { KitoEmpty } from '../components/ui/KitoEmpty'

export default function MeusJogos() {
  const library = useApiResource<Library>('/library')
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
      {library.data.games.length === 0 ? <div className="portal-empty"><KitoEmpty /><div><h2>Seus próximos jogos começam aqui</h2><p>Você ainda não tem jogos liberados.</p><Link className="button button-primary" to="/#comprar">Quero o pacote</Link></div></div> : <ul className="library-grid portal-library">{library.data.games.map((game, index) => {
        const pdf = game.files.find(file => file.kind === 'pdf')
        return <li className="portal-game" key={game.code} id={`jogo-${game.code}`} tabIndex={-1} style={{ '--game-order': Math.min(index, 5) } as CSSProperties}>
          <GameCover code={game.code} name={game.name} />
          <div className="portal-game-body"><h2>{game.name}</h2><p className="game-collection">{game.products.map(product => productName(product.code, product.name)).join(', ')}</p><p className="file-meta">PDF{pdf && fileSize(pdf.size_bytes) && ` · ${fileSize(pdf.size_bytes)}`}</p>
            <DownloadButton fileId={pdf?.id} gameCode={game.code} onRefresh={library.reload} />
            <Link className="game-print-link" to="/ajuda#impressao">Como imprimir</Link>
            <p className="game-acquired">Adquirido em {dateLabel(game.acquired_at)}.</p>
          </div>
        </li>
      })}</ul>}
    </>}
  </section>
}
