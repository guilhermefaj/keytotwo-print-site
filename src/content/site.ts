// Sources: Site — Estrutura e taxonomia; Site — Direção visual (draft copy).
export const navigation = [
  { label: 'A experiência', href: '/#experiencia' },
  { label: 'Como funciona', href: '/#como-funciona' },
] as const

export const site = {
  description: 'Jogos para casais imprimirem e jogarem juntos em casa.',
  heroDescription: 'Um pacote com 5 jogos para imprimir, preparar e jogar juntos em casa. O Kito traz a ideia. Vocês fazem a noite acontecer.',
  closing: 'Uma ideia para a próxima noite de vocês.',
}

// Only these routes may enter the sitemap in live. Private/preview shells never do.
export const publicPages = {
  '/': { title: 'Jogos para casais, para imprimir — KeyToTwo', description: 'Saiam do automático com jogos para imprimir e jogar a dois. Uma ideia da KeyToTwo para conversar, rir e fazer a noite acontecer.' },
  '/ajuda': { title: 'Ajuda com jogos, impressão e acesso — KeyToTwo', description: 'Encontre orientações sobre os jogos para imprimir, materiais, acesso às compras e atendimento da KeyToTwo.' },
  '/termos': { title: 'Termos de uso — KeyToTwo', description: 'Consulte o estado dos termos de uso da KeyToTwo, incluindo licença dos jogos, condições de acesso e validações pendentes.' },
  '/privacidade': { title: 'Privacidade e dados pessoais — KeyToTwo', description: 'Veja o estado da política de privacidade da KeyToTwo e as informações sobre dados pessoais que aguardam validação.' },
  '/reembolsos': { title: 'Política de reembolsos — KeyToTwo', description: 'Conheça a condição de não reembolso após a liberação do download e o estado da validação jurídica da política da KeyToTwo.' },
} as const

export const otherPages = {
  '/preview/hero': { title: 'Prévia da página de venda — KeyToTwo', description: 'Prévia de desenvolvimento da página de venda KeyToTwo, com a hero do Kito e informações do pacote em preparação.' },
  '/entrar': { title: 'Entrar — KeyToTwo', description: 'Página de entrada para acessar sua conta KeyToTwo.' },
  '/meus-jogos': { title: 'Meus jogos — KeyToTwo', description: 'Área reservada aos jogos adquiridos na KeyToTwo.' },
  '/conta': { title: 'Minha conta — KeyToTwo', description: 'Área reservada às informações da sua conta KeyToTwo.' },
  '/pedido/confirmacao': { title: 'Status da compra — KeyToTwo', description: 'Acompanhe a confirmação do seu pedido KeyToTwo.' },
  '/carrinho': { title: 'Carrinho de compras — KeyToTwo', description: 'Confira os itens do seu carrinho KeyToTwo. É preciso criar uma conta e entrar para finalizar a compra.' },
  '/404': { title: 'Página não encontrada — KeyToTwo', description: 'Este endereço não está disponível. Volte à página inicial da KeyToTwo.' },
} as const
