import { offer } from './offer'

export const faq = [
  { id: 'formato', question: 'É um jogo para jogar no celular?', answer: 'A ideia é sair da tela. Vocês recebem arquivos digitais para imprimir, preparar e jogar juntos.' },
  { id: 'impressao', question: 'Preciso ter impressora?', answer: 'Vocês podem imprimir em casa ou em uma gráfica. Confiram as instruções de preparação antes de começar.', link: { href: '/ajuda#impressao', label: 'Ajuda com a impressão' } },
  { id: 'conta', question: 'Como recebo os jogos?', answer: 'É preciso criar uma conta para comprar. Após a compra, os jogos ficam em Meus jogos e também são enviados por e-mail.' },
  { id: 'prazo', question: 'Tem prazo para acessar?', answer: offer.access },
  { id: 'reembolso', question: 'E se eu quiser pedir reembolso?', answer: offer.refund, link: { href: '/reembolsos', label: 'Ler a política de reembolsos' } },
]
