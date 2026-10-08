import { AccountNav, DataStatus } from '../components/account/AccountUi'
import { dateLabel, type Library } from '../lib/api'
import { useApiResource } from '../lib/use-api-resource'

export default function MeusJogos() {
  const library = useApiResource<Library>('/library')
  return <main id="conteudo" tabIndex={-1} className="account-page content-width"><AccountNav /><p className="eyebrow">Para jogar de novo</p><h1>Meus jogos</h1><p>As próximas rodadas moram aqui. Acesse seus jogos quando quiser.</p>
    <DataStatus {...library} retry={library.reload} />
    {library.data && <>
      {library.data.pending.length > 0 && <section className="account-card"><h2>Aguardando confirmação</h2>{library.data.pending.map(order => <p key={order.ref}>Pedido <span className="break-anywhere">{order.ref}</span>: {order.products.map(product => product.name).join(', ')}. O pagamento ainda está pendente.</p>)}</section>}
      {library.data.games.length === 0 ? <div className="account-card"><h2>Seus próximos jogos começam aqui</h2><p>Você ainda não tem jogos liberados.</p><a className="button button-primary" href="/#comprar">Escolher um encontro</a></div> : <ul className="library-grid">{library.data.games.map(game => <li className="account-card" key={game.code}><h2>{game.name}</h2><p>Adquirido em {dateLabel(game.acquired_at)}.</p><p>Faz parte de: {game.products.map(product => product.name).join(', ')}.</p><p className="pending-copy">Estamos preparando o acesso aos arquivos. {game.files.length === 0 && 'Os arquivos deste jogo ainda estão em preparação.'}</p></li>)}</ul>}
    </>}
  </main>
}
