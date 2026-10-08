import { pending } from '../lib/pending'
import { j001 } from './games'
import { offer } from './offer'

export const help = [
  { id: 'compra', title: 'Antes de comprar', paragraphs: ['O pacote reúne cinco jogos digitais para imprimir. Três nomes estão confirmados e duas vagas aguardam definição. A compra ainda não está disponível.', offer.price, offer.refund, offer.legalReview] },
  { id: 'acesso', title: 'Conta e acesso aos jogos', paragraphs: [offer.delivery, offer.access, pending('implementação do cadastro, carrinho, compra, recuperação de acesso e envio por e-mail.'), offer.updates] },
  { id: 'impressao', title: 'Impressão e preparação', paragraphs: ['Em Rabisque e Adivinhe, o PDF tem quatro páginas A4: são quatro folhas ao imprimir uma página por folha, em uma face. A folha usada para desenhar é adicional.', j001.materials, j001.preparation, pending('testes de margens, escala, impressão em preto e branco e legibilidade. As especificações de Rabisque e Adivinhe não se aplicam automaticamente aos demais jogos.')] },
  { id: 'contato', title: 'Atendimento', paragraphs: [pending('canal de contato confirmado, identificação do fornecedor e condições de suporte.')] },
]
