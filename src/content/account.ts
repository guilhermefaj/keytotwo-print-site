// Texto do consentimento de marketing (LGPD, art. 8º): o que chega, por onde e como sair. Mudou o texto, muda a versão:
// cada aceite grava a versão que a pessoa viu (marketing_consents.text_version).
export const marketingConsent = {
  label: 'Quero receber ideias',
  detail: 'Jogos novos, ofertas, lembrete da sacola e dicas depois da compra, por e-mail. Dá para sair quando quiser.',
  version: 'mkt-2026-10-19',
  approved: true,
}

// Antes de sair da lista (responsável, 2026-11-01): o que a pessoa deixa de receber, sem culpa e com a saída clara, em
// um clique a mais. Só o que os e-mails trazem de verdade: jogos novos, cupons e ofertas (o PRIMEIRA10 nas boas-vindas)
// e as dicas. O mesmo texto em Minha conta (janela) e no link do e-mail (/email/preferencias).
export const leaveNewsletter = {
  title: 'Vamos sentir sua falta',
  lead: 'Sem as novidades por e-mail, você deixa de receber:',
  losses: [
    'o aviso quando sair um jogo novo',
    'os cupons e as ofertas que mandamos por e-mail',
    'ideias para a próxima noite a dois',
  ],
  keeps: 'Os e-mails de acesso e dos seus pedidos continuam chegando, e seus jogos seguem em Meus jogos.',
  stay: 'Quero continuar recebendo',
  leave: 'Parar de receber',
}

// Perfil em Minha conta (responsável, 2026-11-01): tudo opcional; o nome da conta Google vem preenchido.
export const profileCopy = {
  title: 'Sobre você',
  intro: 'Como chamamos você e por onde falar com você, se precisar. Tudo opcional.',
  fromGoogle: 'Veio da sua conta Google. Pode trocar se quiser.',
  birthHelp: 'Para conhecer melhor quem joga com a gente.',
  whatsappHelp: 'Só para falar sobre a sua conta ou um pedido, se precisar. Nada de propaganda por lá.',
  saved: 'Pronto, seus dados foram salvos.',
}

// Pedido de cortesia (presente dado pela equipe no admin, 2026-10-23).
export const giftStatus = 'Presente da KeyToTwo'

export const orderStatus: Record<string, string> = {
  pending_payment: 'Aguardando pagamento', paid: 'Pagamento confirmado', failed: 'Pagamento não concluído',
  disputed: 'Pagamento em contestação', dispute_lost: 'Contestação encerrada', refunded: 'Reembolsado',
}
