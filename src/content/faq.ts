import { pending } from '../lib/pending'
import { offer } from './offer'
import { j001 } from './games'

export const faq = [
  { id: 'formato', question: 'Recebo algo pelo correio?', answer: 'O pacote é digital, com jogos para imprimir. Não inclui envio de materiais físicos.' },
  { id: 'composicao', question: 'Quais jogos fazem parte do pacote?', answer: 'Rabisque e Adivinhe, Hora dos Artistas e Boardgame estão confirmados. PENDENTE: os dois jogos que completam o pacote e a validação de todos os materiais.', link: { href: '/#jogos', label: 'Ver os 5 jogos' } },
  { id: 'materiais', question: 'Do que preciso para imprimir e jogar?', answer: `Para Rabisque e Adivinhe: ${j001.materials} ${offer.materials}`, link: { href: '/ajuda#impressao', label: 'Consultar ajuda de impressão' } },
  { id: 'cadastro', question: 'Preciso criar uma conta para comprar?', answer: 'Sim. A venda é somente para usuários cadastrados. Escolha os itens no carrinho e entre na sua conta para finalizar a compra. PENDENTE: implementação do carrinho e da compra.', link: { href: '/entrar', label: 'Ir para Entrar' } },
  { id: 'acesso', question: 'Como vou acessar o que comprei?', answer: `${offer.delivery} PENDENTE: implementação da compra, do acesso e do envio por e-mail.`, link: { href: '/ajuda#acesso', label: 'Ler sobre acesso aos jogos' } },
  { id: 'prazo', question: 'O acesso aos jogos expira?', answer: `${offer.access} ${offer.updates}` },
  { id: 'pessoas', question: 'Para quantas pessoas são os jogos?', answer: 'O pacote é pensado para casais. Rabisque e Adivinhe é cooperativo para duas pessoas. PENDENTE: fichas e regras dos demais jogos.' },
  { id: 'reembolso', question: 'Há reembolso depois da liberação do download?', answer: `${offer.refund} ${offer.legalReview}`, link: { href: '/reembolsos', label: 'Ler a política de reembolsos' } },
  { id: 'atendimento', question: 'Como posso pedir ajuda?', answer: pending('canal de atendimento e condições de suporte.'), link: { href: '/ajuda', label: 'Abrir Ajuda' } },
]
