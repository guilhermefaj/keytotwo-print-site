import { AccountNav, DataStatus } from '../components/account/AccountUi'
import { dateLabel, type Library } from '../lib/api'
import { useApiResource } from '../lib/use-api-resource'
import { useEffect } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { DownloadButton } from '../components/account/DownloadButton'
import { deliveryMock, fileSize } from '../lib/downloads'

export default function MeusJogos() {
  const library = useApiResource<Library>('/library')
  const [params] = useSearchParams()
  const { hash } = useLocation()
  useEffect(() => {
    if (!/^#jogo-[A-Za-z0-9_-]+$/.test(hash) || !library.data) return
    const target = document.getElementById(hash.slice(1))
    target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'center' })
  }, [hash, library.data])
  return <main id="conteudo" tabIndex={-1} className="account-page content-width"><AccountNav /><p className="eyebrow">Para jogar de novo</p><h1>Meus jogos</h1><p>As próximas rodadas moram aqui. Acesse seus jogos quando quiser.</p>
    {params.get('link') === 'expirado' && <p className="library-notice" role="status">O link do e-mail venceu, mas seu acesso aos jogos continua aqui. Escolha Baixar PDF para gerar um novo.</p>}
    {params.get('link') === 'indisponivel' && <p className="library-notice" role="status">Não foi possível abrir aquele link. Confira os jogos disponíveis abaixo ou <Link className="inline-link" to="/ajuda">procure ajuda</Link>.</p>}
    {deliveryMock && <p className="checkout-demo">Demonstração da entrega (mock): os botões ainda não baixam arquivos.</p>}
    <DataStatus {...library} retry={library.reload} />
    {library.data && <>
      {library.data.pending.length > 0 && <section className="account-card"><h2>Aguardando confirmação</h2>{library.data.pending.map(order => <p key={order.ref}>Pedido <span className="break-anywhere">{order.ref}</span>: {order.products.map(product => product.name).join(', ')}. O pagamento ainda está pendente.</p>)}</section>}
      {library.data.games.length === 0 ? <div className="account-card"><h2>Seus próximos jogos começam aqui</h2><p>Você ainda não tem jogos liberados.</p><a className="button button-primary" href="/#comprar">Escolher um encontro</a></div> : <ul className="library-grid">{library.data.games.map(game => {
        const pdf = game.files.find(file => file.kind === 'pdf')
        return <li className="account-card" key={game.code} id={`jogo-${game.code}`} tabIndex={-1}><h2>{game.name}</h2><p>Faz parte de: {game.products.map(product => product.name).join(', ')}.</p><p className="field-help">Adquirido em {dateLabel(game.acquired_at)}.</p><p className="file-meta">PDF{pdf && fileSize(pdf.size_bytes) && ` · ${fileSize(pdf.size_bytes)}`}</p><DownloadButton fileId={pdf?.id} gameCode={game.code} onRefresh={library.reload} /></li>
      })}</ul>}
    </>}
  </main>
}
