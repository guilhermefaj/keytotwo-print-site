import { IconArrowLeft, IconExternalLink } from '@tabler/icons-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, ApiError, useResource } from '../api'
import { catalogActionLabel, parseReais, productState, stripePriceUrl, type CatalogList, type CatalogProduct } from '../catalog'
import { Fact, Section } from '../Detail'
import { count, formatMoment, money } from '../format'
import { LoadError } from '../LoadError'
import { ReasonAction } from '../ReasonAction'
import { SiteStatus } from '../SiteStatus'

// Ficha de um produto do catálogo (2026-10-24): preço (Price novo na Stripe), preço riscado da promoção, situação
// (pausar e voltar a vender) e, no pacote, os jogos (pôr, com o presente para quem já tem, e tirar). Cada ação pede o
// motivo; no fim, o catálogo é buscado de novo e o aviso diz quando a loja fica em dia.
export function ProductRoute() {
  const { code } = useParams()
  return <ProductPage key={code} code={code!} />
}

function ProductPage({ code }: { code: string }) {
  const { data, previous, error, loading, reload } = useResource<CatalogList>('/admin/catalog')
  const list = data ?? (loading ? previous : undefined)
  const [notice, setNotice] = useState<string>()
  const noticeRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (notice) noticeRef.current?.focus() }, [notice])
  const done = (text: string) => { setNotice(text); reload() }
  const product = list?.products.find(item => item.code === code)

  if (!list || !product) {
    return <>
      <title>Catálogo — Admin KeyToTwo</title>
      <BackToList />
      {!list && !error ? <p className="status" role="status">Abrindo o produto…</p>
        : <LoadError error={error ?? new ApiError('NOT_FOUND')} retry={reload} missing="Este produto não existe no catálogo." />}
    </>
  }

  const state = productState(product)
  const post = (path: string, body: Record<string, unknown>) => api(`/admin/products/${product.code}/${path}`, { method: 'POST', body })
  return <>
    <title>{`${product.name ?? product.code} — Admin KeyToTwo`}</title>
    <BackToList />
    <header className="page-heading user-heading">
      <div>
        <p className="user-badges"><span className={`badge${state.tone ? ` badge-${state.tone}` : ''}`}>{state.label}</span></p>
        <h1>{product.name ?? product.code}</h1>
        <p>{product.code} · {product.kind === 'bundle' ? 'Pacote' : 'Jogo avulso'} · {count(product.paid_orders)} {product.paid_orders === 1 ? 'pedido pago' : 'pedidos pagos'}, {count(product.owners)} {product.owners === 1 ? 'pessoa tem' : 'pessoas têm'}</p>
      </div>
    </header>
    {notice && <p className="notice" role="status" ref={noticeRef} tabIndex={-1}>{notice}</p>}
    <SiteStatus version={list.version} path="/catalogo/versao.json" synced="A loja está em dia com o catálogo." />

    <Section id="preco" title="Preço">
      <dl className="facts">
        <Fact label="Preço na loja">{product.price ? money(product.price.unit_amount, product.price.currency) : 'Sem preço na Stripe'}</Fact>
        <Fact label="Preço riscado">{product.list_price ? `${money(product.list_price.amount, 'brl')} (${product.list_price.label})` : 'Nenhum'}</Fact>
        {product.stripe_price_id && <Fact label="Preço na Stripe">
          <a className="text-link" href={stripePriceUrl(product.stripe_price_id, list.livemode)} target="_blank" rel="noopener">{product.stripe_price_id}<IconExternalLink aria-hidden="true" size={14} stroke={1.75} /><span className="sr-only"> (abre a Stripe em nova aba)</span></a>
        </Fact>}
      </dl>
      {product.price && <PriceChange product={product} onDone={done} post={post} />}
      <ListPrice product={product} onDone={done} post={post} />
    </Section>

    {product.kind === 'bundle' && <PackGames product={product} list={list} onDone={done} post={post} />}
    {product.kind === 'single' && <Section id="pdf" title="Jogo e PDF">
      {product.games.map(game => {
        const info = list.games.find(item => item.code === game.code)
        return <p key={game.code}><strong>{game.name}</strong> · {info?.file ? `PDF na versão ${info.file.version}` : 'sem PDF publicado'}{info?.packs.length ? ` · também no pacote ${info.packs.join(', ')}` : ''}</p>
      })}
      <p className="field-help">Trocar o PDF é com a equipe técnica, por script.</p>
    </Section>}

    <Section id="historico" title="Histórico do admin">
      {product.history.length === 0 ? <p className="status">Ninguém da equipe mexeu neste produto pelo admin ainda.</p>
        : <ul className="timeline">{product.history.map((entry, index) => <li key={index}>
          <time dateTime={entry.created_at}>{formatMoment(entry.created_at)}</time> <strong>{catalogActionLabel(entry.action)}</strong>
          {typeof entry.details.reason === 'string' && <span>: {entry.details.reason}</span>}{entry.by && <span className="timeline-by"> · {entry.by}</span>}
        </li>)}</ul>}
    </Section>

    <section className="danger-zone" aria-labelledby="acoes-produto">
      <h2 id="acoes-produto">Situação</h2>
      {product.status === 'active'
        ? <ReasonAction label="Pausar a venda" confirm="Pausar" danger
            intro={`Sai da loja e ninguém consegue comprar até voltar. Quem já comprou continua com o jogo${product.kind === 'single' ? '; o pacote que o traz continua à venda' : ''}.`}
            onConfirm={reason => post('status', { status: 'archived', reason }).then(() => done('A venda foi pausada. A loja atualiza em 1 ou 2 minutos.'))} />
        : <ReasonAction label="Voltar a vender" confirm="Voltar a vender"
            intro="Volta à loja na hora, com o preço de agora. Precisa ter o preço, o nome e cada jogo publicado com o PDF."
            onConfirm={reason => post('status', { status: 'active', reason }).then(() => done('O produto voltou à venda. A loja atualiza em 1 ou 2 minutos.'))} />}
    </section>
  </>
}

type Post = (path: string, body: Record<string, unknown>) => Promise<unknown>

const BackToList = () => <Link className="back-link" to="/catalogo"><IconArrowLeft aria-hidden="true" size={18} stroke={1.75} />Todo o catálogo</Link>

// Trocar o preço: cria o Price novo na Stripe e arquiva o atual.
function PriceChange({ product, onDone, post }: { product: CatalogProduct; onDone: (text: string) => void; post: Post }) {
  const [typed, setTyped] = useState('')
  const field = useId()
  const amount = parseReais(typed)
  const valid = amount !== null && amount >= 100 && amount <= 100_000 && amount !== product.price?.unit_amount
  return <ReasonAction label="Trocar o preço" confirm="Trocar o preço" ready={valid}
    intro="Cria o preço novo na Stripe e arquiva o atual. A sacola já mostra o novo; quem está no meio do pagamento paga o atual."
    onConfirm={reason => post('price', { amount, reason }).then(() => onDone(`O preço agora é ${money(amount!, 'brl')}. A loja atualiza em 1 ou 2 minutos.`))}>
    <div className="field">
      <label htmlFor={field}>Preço novo, em reais</label>
      <input id={field} inputMode="decimal" value={typed} onChange={event => setTyped(event.target.value)} placeholder="14,90" autoComplete="off" aria-describedby={`${field}-ajuda`} />
      <p className="field-help" id={`${field}-ajuda`}>De R$ 1,00 a R$ 1.000,00.</p>
    </div>
  </ReasonAction>
}

// Preço riscado da promoção: aparece na loja ao lado do preço, só se for maior que ele.
function ListPrice({ product, onDone, post }: { product: CatalogProduct; onDone: (text: string) => void; post: Post }) {
  const [typed, setTyped] = useState(product.list_price ? (product.list_price.amount / 100).toFixed(2).replace('.', ',') : '')
  const [label, setLabel] = useState(product.list_price?.label ?? 'Preço de lançamento')
  const amountField = useId()
  const labelField = useId()
  const amount = parseReais(typed)
  const valid = amount !== null && amount >= 100 && amount <= 100_000 && label.trim().length >= 2 && label.trim().length <= 40
  return <>
    <ReasonAction label={product.list_price ? 'Mudar o preço riscado' : 'Pôr preço riscado'} confirm="Salvar" ready={valid}
      intro="O valor aparece riscado ao lado do preço, com o rótulo em cima, só quando for maior que o preço da loja."
      onConfirm={reason => post('list-price', { amount, label: label.trim(), reason }).then(() => onDone('O preço riscado foi salvo. A loja atualiza em 1 ou 2 minutos.'))}>
      <div className="field">
        <label htmlFor={amountField}>Preço riscado, em reais</label>
        <input id={amountField} inputMode="decimal" value={typed} onChange={event => setTyped(event.target.value)} placeholder="39,90" autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor={labelField}>Rótulo</label>
        <input id={labelField} value={label} onChange={event => setLabel(event.target.value)} maxLength={40} autoComplete="off" />
      </div>
    </ReasonAction>
    {product.list_price && <ReasonAction label="Tirar o preço riscado" confirm="Tirar"
      intro="A loja passa a mostrar só o preço."
      onConfirm={reason => post('list-price', { amount: null, reason }).then(() => onDone('O preço riscado saiu. A loja atualiza em 1 ou 2 minutos.'))} />}
  </>
}

// Os jogos do pacote, na ordem da loja: tirar (fica com pelo menos dois) e pôr um jogo no fim, com a opção de dar o
// jogo a quem já tem o pacote (pelo avulso dele, como presente).
function PackGames({ product, list, onDone, post }: { product: CatalogProduct; list: CatalogList; onDone: (text: string) => void; post: Post }) {
  const options = list.games.filter(game => game.access === 'paid' && game.status === 'published' && !product.games.some(item => item.code === game.code))
  const [game, setGame] = useState('')
  const [gift, setGift] = useState(true)
  const [notify, setNotify] = useState(true)
  const gameField = useId()
  const chosen = list.games.find(item => item.code === game)
  const single = chosen?.single ? list.products.find(item => item.code === chosen.single) : undefined
  const canGift = Boolean(single?.sellable)
  return <Section id="jogos" title="Jogos do pacote" count={product.games.length}>
    <ol className="plain-list">{product.games.map(item => <li key={item.code} className="plain-row">
      <div className="plain-row-main"><strong>{item.name}</strong><span className="plain-row-sub">{item.position}º no pacote · {item.code}</span></div>
      {product.games.length > 2 && <ReasonAction label={`Tirar do pacote: ${item.name}`} short="Tirar do pacote" confirm="Tirar" danger
        intro="Sai do pacote para as próximas compras. Quem já comprou o pacote continua com este jogo."
        onConfirm={reason => post(`games/${item.code}/remove`, { reason }).then(() => onDone(`${item.name} saiu do pacote. A loja atualiza em 1 ou 2 minutos.`))} />}
    </li>)}</ol>
    {options.length === 0 ? <p className="field-help">Todos os jogos publicados já estão neste pacote.</p>
      : <ReasonAction label="Pôr um jogo no pacote" confirm="Pôr no pacote" ready={Boolean(game)}
        intro="O jogo entra no fim do pacote para as próximas compras."
        onConfirm={reason => post('games', { game, gift: gift && canGift, notify: gift && canGift && notify, reason }).then(result => {
          const gifted = (result as { gifted: number }).gifted
          onDone(`${chosen?.name ?? game} entrou no pacote${gifted ? ` e foi de presente para ${count(gifted)} ${gifted === 1 ? 'pessoa' : 'pessoas'}` : ''}. A loja atualiza em 1 ou 2 minutos.`)
        })}>
        <div className="field">
          <label htmlFor={gameField}>Jogo</label>
          <select id={gameField} value={game} onChange={event => setGame(event.target.value)}>
            <option value="">Escolha um jogo</option>
            {options.map(option => <option key={option.code} value={option.code}>{option.name} ({option.code})</option>)}
          </select>
        </div>
        {game && (canGift ? <>
          <label className="check-field">
            <input type="checkbox" checked={gift} onChange={event => setGift(event.target.checked)} />
            <span>Dar o jogo a quem já tem o pacote ({count(product.owners)} {product.owners === 1 ? 'pessoa tem' : 'pessoas têm'} o pacote; quem já tem o jogo fica de fora)</span>
          </label>
          {gift && <label className="check-field">
            <input type="checkbox" checked={notify} onChange={event => setNotify(event.target.checked)} />
            <span>Avisar por e-mail, com o link de baixar</span>
          </label>}
        </> : <p className="field-help">Este jogo não tem o avulso à venda, então não dá para mandar de presente: entra só para as próximas compras.</p>)}
      </ReasonAction>}
  </Section>
}
