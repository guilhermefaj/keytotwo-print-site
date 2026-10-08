import { pending } from '../lib/pending'
import { offer } from './offer'

export type LegalContent = { title: string; intro: string; sections: { title: string; paragraphs: string[] }[] }

// These are explicit gaps, not legal documents. No inferred commercial conditions.
export const legal: Record<'termos' | 'privacidade' | 'reembolsos', LegalContent> = {
  termos: {
    title: 'Termos de uso', intro: pending('redação dos termos de uso e validação jurídica.'),
    sections: [
      { title: 'Produto e operação', paragraphs: ['O produto proposto é um pacote digital de cinco jogos para imprimir.', pending('identificação do fornecedor, condições de compra e publicação dos materiais.')] },
      { title: 'Uso e acesso', paragraphs: [offer.delivery, offer.access, offer.license, offer.updates] },
      { title: 'Liberação do download e reembolso', paragraphs: [offer.refund, offer.legalReview] },
    ],
  },
  privacidade: {
    title: 'Privacidade', intro: pending('política de privacidade correspondente à operação real e validação jurídica.'),
    sections: [
      { title: 'Dados pessoais', paragraphs: [pending('identificação do responsável pelo tratamento, dados utilizados, finalidades e bases legais.')] },
      { title: 'Serviços, armazenamento e prazos', paragraphs: [pending('descrição dos serviços envolvidos, compartilhamento, retenção, transferências e eventuais cookies.')] },
      { title: 'Seus direitos e contato', paragraphs: [pending('canal para solicitações sobre dados pessoais e procedimento de atendimento.')] },
    ],
  },
  reembolsos: {
    title: 'Reembolsos', intro: offer.legalReview,
    sections: [
      { title: 'Antes de comprar', paragraphs: [offer.refund, 'Esta é a condição definida para a oferta de download. O texto final ainda depende de validação jurídica; esta página não é uma política legal concluída.'] },
      { title: 'Contestações e exceções', paragraphs: ['Uma contestação aberta revoga o acesso. Se a contestação for vencida pelo vendedor, o acesso é restabelecido. Um reembolso manual excepcional também revoga o acesso.', pending('redação jurídica dos procedimentos, exceções aplicáveis e direitos do consumidor.')] },
      { title: 'Atendimento', paragraphs: [pending('canal de contato confirmado e procedimento de atendimento.')] },
    ],
  },
}
