// Draft used only in stage=test until the owner approves the consent copy/version.
export const marketingConsent = {
  label: 'Quero receber ideias da KeyToTwo por e-mail.',
  detail: 'Dá para sair quando quiser.',
  pending: 'PENDENTE: texto de consentimento em validação. Preferência disponível para teste.',
  version: 'mkt-test-v2',
  approved: false,
}

export const orderStatus: Record<string, string> = {
  pending_payment: 'Aguardando pagamento', paid: 'Pagamento confirmado', failed: 'Pagamento não concluído',
  disputed: 'Pagamento em contestação', dispute_lost: 'Contestação encerrada', refunded: 'Reembolsado',
}
