import { Link } from 'react-router'

// Seções planejadas (2026-10-23): a página diz o que vem, para a navegação já mostrar o admin inteiro.
const plans = {
  pedidos: { title: 'Pedidos e reembolsos', text: 'Buscar pedidos, reembolsar com confirmação e reenviar o e-mail de entrega. O reembolso continua retirando o acesso pelo aviso da Stripe.' },
} as const

export function SoonPage({ section }: { section: keyof typeof plans }) {
  const { title, text } = plans[section]
  return <>
    <title>{`${title} — Admin KeyToTwo`}</title>
    <header className="page-heading"><p className="tag">Em breve</p><h1>{title}</h1><p>{text}</p></header>
  </>
}

export function NotFoundPage() {
  return <>
    <title>Página não encontrada — Admin KeyToTwo</title>
    <header className="page-heading"><h1>Página não encontrada</h1><p>Este endereço não existe no admin.</p></header>
    <Link className="button button-secondary" to="/">Ir para as métricas</Link>
  </>
}
