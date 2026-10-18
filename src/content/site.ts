import { productPages } from './products.ts'

// Sources: Site — Estrutura e taxonomia; Site — Direção visual (draft copy).
export const navigation = [
  { label: 'Início', href: '/' },
  { label: 'Loja', href: '/loja' },
  { label: 'Blog', href: '/blog' },
] as const

export const site = {
  description: 'Jogos para casais imprimirem e jogarem juntos em casa.',
  heroDescription: 'Um pacote de jogos para imprimir, preparar e jogar juntos em casa. O Kito traz a ideia. Vocês fazem a noite acontecer.',
  closing: 'Da tela para a mesa.',
}

// Only these routes may enter the sitemap in live. Private/preview shells never do.
export const publicPages = {
  ...Object.fromEntries(productPages.map(product => [`/loja/${product.slug}`, { title: `${product.seo.title} — KeyToTwo`, description: product.seo.description }])),
  '/loja': { title: 'Loja de jogos para casais imprimirem — KeyToTwo', description: 'Jogos em PDF para casais, avulsos ou no pacote: desenho, tabuleiro e mistério para imprimir e jogar em casa.' },
  '/blog': { title: 'Blog — KeyToTwo', description: 'Acompanhe os artigos e as próximas ideias da KeyToTwo.' },
  '/': { title: 'Jogos para casais imprimirem em casa — KeyToTwo', description: 'Jogos em PDF para casais imprimirem e jogarem juntos em casa. Comprem um jogo ou o pacote e baixem na conta, sem prazo para acessar.' },
  '/ajuda': { title: 'Ajuda com jogos, impressão e acesso — KeyToTwo', description: 'Como comprar, baixar e imprimir os jogos da KeyToTwo, o que cada jogo pede e como falar com o atendimento.' },
  '/termos': { title: 'Termos de uso — KeyToTwo', description: 'Consulte o estado dos termos de uso da KeyToTwo, incluindo licença dos jogos, condições de acesso e validações pendentes.' },
  '/privacidade': { title: 'Privacidade e dados pessoais — KeyToTwo', description: 'Veja o estado da política de privacidade da KeyToTwo e as informações sobre dados pessoais que aguardam validação.' },
} as const

export const otherPages = {
  '/preview/hero': { title: 'Prévia da página de venda — KeyToTwo', description: 'Prévia de desenvolvimento da página de venda KeyToTwo, com a hero do Kito e informações do pacote em preparação.' },
  '/entrar': { title: 'Entrar — KeyToTwo', description: 'Página de entrada para acessar sua conta KeyToTwo.' },
  '/meus-jogos': { title: 'Meus jogos — KeyToTwo', description: 'Área reservada aos jogos adquiridos na KeyToTwo.' },
  '/conta': { title: 'Minha conta — KeyToTwo', description: 'Área reservada às informações da sua conta KeyToTwo.' },
  '/pedidos': { title: 'Meus pedidos — KeyToTwo', description: 'Consulte os pedidos e acompanhe suas compras na KeyToTwo.' },
  '/pagamento': { title: 'Pagamento — KeyToTwo', description: 'Confira seu pedido e finalize o pagamento com segurança.' },
  '/jogo-gratuito': { title: 'Jogo gratuito — KeyToTwo', description: 'Confira a disponibilidade da experiência gratuita da KeyToTwo.' },
  '/email/preferencias': { title: 'Preferências de e-mail — KeyToTwo', description: 'Escolha se deseja receber novidades da KeyToTwo por e-mail.' },
  '/pedido/confirmacao': { title: 'Status da compra — KeyToTwo', description: 'Acompanhe a confirmação do seu pedido KeyToTwo.' },
  '/carrinho': { title: 'Sacola de compras — KeyToTwo', description: 'Confira os itens da sua sacola KeyToTwo. É preciso criar uma conta e entrar para finalizar a compra.' },
  '/404': { title: 'Página não encontrada — KeyToTwo', description: 'Este endereço não está disponível. Volte à página inicial da KeyToTwo.' },
} as const
