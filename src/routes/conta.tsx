import { useState } from 'react'
import { Link } from 'react-router'
import { DataStatus } from '../components/account/AccountUi'
import { AccountDeletion, DataExport } from '../components/account/AccountData'
import { MarketingPreference } from '../components/account/MarketingPreference'
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
  return <section aria-labelledby="portal-title"><div className="portal-heading"><h1 id="portal-title" tabIndex={-1}>Minha conta</h1><p>Seu acesso e suas preferências, no mesmo lugar.</p></div>
    <DataStatus {...account} retry={account.reload} />
    {account.data && <div className="portal-settings">
      <section className="portal-setting" aria-labelledby="account-access"><div><h2 id="account-access">Seu acesso</h2><p>Use este e-mail para encontrar suas compras.</p></div><div className="portal-setting-fields"><dl className="account-details"><div><dt>E-mail</dt><dd>{account.data.email}</dd></div><div><dt>Senha</dt><dd><Link className="inline-link" to="/entrar?mode=recover&next=%2Fconta">Definir ou alterar senha</Link></dd></div></dl></div></section>
      <section className="portal-setting" aria-labelledby="marketing-title"><div><h2 id="marketing-title">Novidades por e-mail</h2><p>Jogos novos e ideias para tirar a noite do papel.</p></div><div className="portal-setting-fields"><MarketingPreference key={account.data.email} marketing={account.data.marketing} onSaved={account.reload} /></div></section>
      <section className="portal-setting" aria-labelledby="data-title"><div><h2 id="data-title">Seus dados</h2><p>Uma cópia de tudo o que a KeyToTwo guarda sobre você, para conferir ou levar com você.</p></div><div className="portal-setting-fields"><DataExport /></div></section>
      <section className="portal-signout" aria-labelledby="signout-title"><div><h2 id="signout-title">Sair neste dispositivo</h2><p>Seus jogos continuam guardados para a próxima vez.</p></div><div><button className="button button-secondary" disabled={busy} onClick={signOut}>{busy ? 'Saindo…' : 'Sair da conta'}</button><p className="form-error" role="alert">{error}</p></div></section>
      <section className="portal-setting" aria-labelledby="delete-title"><div><h2 id="delete-title">Excluir minha conta</h2><p>Apaga a conta e encerra o acesso aos jogos comprados.</p></div><div className="portal-setting-fields"><AccountDeletion /></div></section>
    </div>}
  </section>
}
