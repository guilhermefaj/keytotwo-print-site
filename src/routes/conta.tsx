import { productName } from '../content/products'
import { useState } from 'react'
import { Link } from 'react-router'
import { AccountNav, DataStatus } from '../components/account/AccountUi'
import { MarketingPreference } from '../components/account/MarketingPreference'
import { orderStatus } from '../content/account'
import { dateLabel, money } from '../lib/api'
import { useShop } from '../lib/shop-context'
import { authErrorMessage, supabase } from '../lib/supabase'

export default function Conta() {
  const { account } = useShop()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function signOut() {
    setBusy(true); setError('')
    try {
      const { error } = await supabase().auth.signOut({ scope: 'local' })
      if (error) throw error
    } catch (cause) { setError(authErrorMessage(cause)); setBusy(false) }
  }
  return <main id="conteudo" tabIndex={-1} className="account-page content-width"><AccountNav /><p className="eyebrow">Tudo no seu lugar</p><h1>Conta</h1>
    <DataStatus {...account} retry={account.reload} />
    {account.data && <div className="account-columns"><div><section className="account-card" aria-labelledby="account-email"><h2 id="account-email">Seu acesso</h2><p className="break-anywhere">{account.data.email}</p><div className="form-actions"><Link className="inline-link" to="/entrar?mode=recover&next=%2Fconta">Definir ou alterar senha</Link><button className="text-button" disabled={busy} onClick={signOut}>Sair da conta</button></div><p className="form-error" role="alert">{error}</p></section>
      <section className="account-card" aria-labelledby="marketing-title"><h2 id="marketing-title">Preferência de e-mail</h2><p>Receber novidades é uma escolha sua. Não faz parte dos termos nem é necessário para comprar.</p><MarketingPreference key={account.data.email} marketing={account.data.marketing} onSaved={account.reload} /></section></div>
      <section className="account-card" aria-labelledby="orders-title"><h2 id="orders-title">Pedidos</h2>{account.data.orders.length === 0 ? <p>Você ainda não tem pedidos.</p> : <ul className="order-list">{account.data.orders.map(order => <li key={order.ref}><h3>Pedido <span className="break-anywhere">{order.ref}</span></h3><p>{dateLabel(order.created_at)} · {orderStatus[order.status] || 'Situação em atualização'}</p><ul>{order.items.map(item => <li key={item.code}>{productName(item.code, item.name)}</li>)}</ul><p>{money(order.amount_total, order.currency)}</p></li>)}</ul>}<Link className="inline-link" to="/meus-jogos">Ir para Meus jogos</Link></section>
    </div>}
  </main>
}
