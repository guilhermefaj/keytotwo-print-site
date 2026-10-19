// Texto do consentimento de marketing (LGPD, art. 8º): o que chega, por onde e como sair. Mudou o texto, muda a versão:
// cada aceite grava a versão que a pessoa viu (marketing_consents.text_version).
export const marketingConsent = {
  label: 'Quero receber ideias',
  detail: 'Jogos novos, ofertas, lembrete da sacola e dicas depois da compra, por e-mail. Dá para sair quando quiser.',
  version: 'mkt-2026-10-19',
  approved: true,
}

export const orderStatus: Record<string, string> = {
  pending_payment: 'Aguardando pagamento', paid: 'Pagamento confirmado', failed: 'Pagamento não concluído',
  disputed: 'Pagamento em contestação', dispute_lost: 'Contestação encerrada', refunded: 'Reembolsado',
}
