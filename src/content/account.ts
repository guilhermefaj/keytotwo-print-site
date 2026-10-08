// Draft used only in stage=test until the owner approves the consent copy/version.
export const marketingConsent = {
  label: 'Quero receber novidades e comunicações da KeyToTwo por e-mail.',
  detail: 'É opcional. Você pode mudar essa preferência em Conta a qualquer momento.',
  pending: 'PENDENTE: texto de consentimento em validação. Preferência disponível para teste.',
  version: 'mkt-test-v1',
  approved: false,
}

export const orderStatus: Record<string, string> = {
  pending_payment: 'Aguardando pagamento', paid: 'Pagamento confirmado', failed: 'Pagamento não concluído',
  disputed: 'Pagamento em contestação', dispute_lost: 'Contestação encerrada', refunded: 'Reembolsado',
}
