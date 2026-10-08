import { productName } from '../content/products'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth-context'
import { checkoutMock, type OrderStatus } from '../lib/checkout'
import { useShop } from '../lib/shop-context'
import { supabase } from '../lib/supabase'
import { deliveryMock } from '../lib/downloads'

const copy = {
  paid: { title: 'O próximo encontro é de vocês!', text: 'Pagamento confirmado. Seus jogos estão em Meus jogos e também foram enviados para o seu e-mail.', cta: 'Ir para Meus jogos', to: '/meus-jogos' },
  processing: { title: 'Estamos preparando seus jogos', text: 'O pagamento está sendo conferido. Não é preciso pagar novamente; a confirmação pode levar alguns instantes.', cta: 'Ver Meus jogos', to: '/meus-jogos' },
  pending_payment: { title: 'Aguardando o pagamento', text: 'Assim que o pagamento for confirmado, seus jogos aparecem em Meus jogos. Você pode voltar para acompanhar.', cta: 'Ver Meus jogos', to: '/meus-jogos' },
  failed: { title: 'Vamos tentar de novo?', text: 'Este pagamento não foi concluído. Volte ao carrinho para conferir sua escolha e tentar novamente.', cta: 'Voltar ao carrinho', to: '/carrinho' },
  expired: { title: 'O tempo para pagar terminou', text: 'Essa sessão de pagamento expirou. Sua escolha continua no carrinho para começar de novo.', cta: 'Voltar ao carrinho', to: '/carrinho' },
  not_found: { title: 'Não encontramos esse pedido', text: 'Confira o link recebido ou veja seus pedidos na conta. Se precisar, estamos na página de ajuda.', cta: 'Ver meus pedidos', to: '/conta' },
  other_account: { title: 'Este pedido é de outra conta', text: 'Entre com a conta usada na compra para acessar os jogos.', cta: 'Entrar com outra conta', to: '/entrar' },
} as const

function Status({ sessionId }: { sessionId: string }) {
  const { cart, account } = useShop()
  const [result, setResult] = useState<OrderStatus>()
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(true)
  const [revision, setRevision] = useState(0)
  const [signingOut, setSigningOut] = useState(false)
  const demo = checkoutMock && sessionId === 'demo'
  const { reload: refreshCart } = cart
  const { reload: refreshAccount } = account
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    async function check() {
      try {
        const response = demo ? { state: 'paid', next: 'open_library' } as OrderStatus : !/^cs_[A-Za-z0-9_]{10,240}$/.test(sessionId)
          ? { state: 'not_found' } as OrderStatus : await api<OrderStatus>(`/order-status?session_id=${encodeURIComponent(sessionId)}`, { signal: controller.signal })
        if (controller.signal.aborted) return
        setResult(response); setError(''); setChecking(false)
        if (response.state === 'paid' && response.next === 'open_library' && !demo) { refreshCart(); refreshAccount() }
        if (['processing', 'pending_payment'].includes(response.state) && attempt < 6) {
          const delay = [1500, 3000, 6000, 10000, 15000, 20000][attempt++]
          timer = setTimeout(() => { if (!document.hidden) void check(); else { setChecking(false) } }, delay)
        }
      } catch {
        if (!controller.signal.aborted) { setError('Não conseguimos conferir o pedido agora. Tente atualizar o status; não é preciso pagar novamente.'); setChecking(false) }
      }
    }
    void check()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [sessionId, demo, revision, refreshCart, refreshAccount])
  const state = result?.next === 'other_account' ? 'other_account' : result?.state
  const content = state && Object.hasOwn(copy, state) ? copy[state] : undefined
  async function switchAccount() {
    setSigningOut(true)
    const { error } = await supabase().auth.signOut({ scope: 'local' })
    if (error) { setError('Não foi possível trocar de conta. Tente novamente.'); setSigningOut(false) }
    // RequireAuth preserves the full confirmation URL as next after signing out.
  }
  return <main id="conteudo" tabIndex={-1} className="account-page confirmation-page content-width"><div className="confirmation-card">
    <p className="eyebrow">Seu pedido</p><h1>{content?.title || 'Conferindo seu pagamento'}</h1>
    {demo && <p className="checkout-demo"><strong>Demonstração (mock).</strong> Esta confirmação é simulada. Nenhuma compra ou liberação foi feita.</p>}
    {content && <p>{demo ? 'Assim será a confirmação quando o pagamento estiver conectado.' : state === 'paid' && deliveryMock ? 'Pagamento confirmado. Seus jogos estão em Meus jogos, na sua conta.' : content.text}</p>}
    {state === 'paid' && !demo && deliveryMock && <p className="checkout-demo">Prévia da entrega (mock): o download e o envio por e-mail ainda não estão conectados.</p>}
    {checking && <p role="status">Consultando o status do pedido…</p>}
    <p role="alert" className="form-error">{error}</p>
    {state === 'paid' && !demo && Boolean(result?.items?.length) && <ul className="confirmation-items">{result!.items!.map(item => <li key={item.code}>{productName(item.code, item.name)}</li>)}</ul>}
    <div className="form-actions">{content && (state === 'other_account' ? <button className="button button-primary" disabled={signingOut} onClick={switchAccount}>{content.cta}</button> : <Link className="button button-primary" to={content.to}>{content.cta}</Link>)}
      {(error || state === 'processing' || state === 'pending_payment') && <button className="button button-secondary" disabled={checking} onClick={() => { setChecking(true); setError(''); setRevision(value => value + 1) }}>Atualizar status</button>}
      <Link className="inline-link" to="/ajuda">Preciso de ajuda</Link>
    </div>
  </div></main>
}

export default function ConfirmacaoPedido() {
  const [params] = useSearchParams()
  const { session } = useAuth()
  const sessionId = params.get('session_id') || ''
  return <Status key={`${session?.user.id}:${sessionId}`} sessionId={sessionId} />
}
