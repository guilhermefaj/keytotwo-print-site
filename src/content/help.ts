// Central de ajuda (Fase 3 do plano de design, 2026-10-16). Fatos conferidos no site e nas fichas do
// segundo cérebro: compra com login, Pix ou cartão pela Stripe, um PDF por jogo em Meus jogos, e-mail com
// botões de 30 dias, acesso sem prazo. Reembolso e dados seguem os textos de legal.ts (2026-10-19).
// Nenhuma página do PDF ilustra o guia (DESIGN.md › Ajuda).
// PENDENTE (fora da tela): testes físicos de margens, escala e preto e branco de cada jogo; condições de
// suporte e de atualização dos arquivos. O guia traz só dicas gerais, sem prometer resultado de impressão.

/** Canal de atendimento confirmado pelo responsável em 2026-10-16. */
export const supportEmail = 'contato@keytotwo.com.br'

export type HelpIcon = 'compra' | 'conta' | 'impressao' | 'contato' | 'papel' | 'escala' | 'face' | 'recorte' | 'guardar'

export type HelpSection = { id: string; title: string; summary: string; icon: HelpIcon; paragraphs: readonly string[] }

export const help: readonly HelpSection[] = [
  {
    id: 'compra', title: 'Antes de comprar', icon: 'compra',
    summary: 'Como funcionam a compra, o pagamento, os pacotes e o reembolso.',
    paragraphs: [
      'Os jogos são digitais: vocês compram, baixam o PDF e imprimem em casa. Nada é enviado pelo correio.',
      'O pagamento é feito por Pix ou cartão, no ambiente seguro da Stripe. A KeyToTwo não recebe o número do cartão.',
      'Cada jogo pode ser comprado sozinho ou dentro de um pacote. Se vocês já têm um jogo que vem no pacote, a sacola avisa antes do pagamento.',
      'Os jogos são liberados assim que o pagamento é confirmado. Fora dos casos da Política de reembolso e da lei, não há reembolso depois da liberação. Arquivo com defeito, jogo que não chegou ou cobrança em duplicidade têm solução: é só escrever para o atendimento, que corrige, reenvia ou devolve o valor.',
    ],
  },
  {
    id: 'acesso', title: 'Conta e acesso aos jogos', icon: 'conta',
    summary: 'Entrar, encontrar os jogos, baixar de novo e cuidar dos seus dados.',
    paragraphs: [
      'É preciso ter uma conta para comprar. Dá para entrar com um código enviado por e-mail, com senha ou com a conta Google. Na primeira vez, o código por e-mail já cria a conta.',
      'Depois do pagamento, os jogos aparecem em Meus jogos e chegam também por e-mail.',
      'Os botões de download do e-mail valem por 30 dias. Em Meus jogos, o acesso não tem prazo de expiração.',
      'Esqueceu a senha? Em Entrar, escolha "E-mail e senha" e depois "Esqueci minha senha". Quem entra com código não precisa de senha.',
      'Em Minha conta você baixa uma cópia dos seus dados e pode excluir a conta. A exclusão encerra o acesso aos jogos; antes, guarde os PDFs.',
    ],
  },
  {
    id: 'impressao', title: 'Impressão e preparação', icon: 'impressao',
    summary: 'O guia para o jogo sair da impressora do jeito certo.',
    paragraphs: [],
  },
  {
    id: 'contato', title: 'Atendimento', icon: 'contato',
    summary: 'Falar com a KeyToTwo.',
    paragraphs: [
      'Se for sobre uma compra, mandem o número do pedido. Ele aparece em Pedidos, no Portal.',
      'Pedidos sobre dados pessoais também chegam por aqui. Respondemos às reclamações em até 5 dias.',
    ],
  },
]

// Guia de impressão: dicas gerais, sem regras nem páginas de nenhum jogo.
export const printGuide: ReadonlyArray<{ icon: HelpIcon; title: string; text: string }> = [
  { icon: 'papel', title: 'Papel A4 comum', text: 'Os PDFs são feitos para folhas A4. Não precisa de papel especial.' },
  { icon: 'escala', title: 'Tamanho real (100%)', text: 'Na janela de impressão, escolham "Tamanho real" ou 100%, e não "Ajustar à página", para as peças saírem do tamanho certo.' },
  { icon: 'face', title: 'Uma face por folha', text: 'Imprimam só a frente de cada folha. Assim nada aparece no verso das cartas.' },
  { icon: 'recorte', title: 'Recortem com calma', text: 'Uma tesoura resolve quase tudo. Se o jogo pedir estilete, usem uma base de corte.' },
  { icon: 'guardar', title: 'Guardem para a próxima', text: 'Um envelope por jogo guarda cartas e peças. O PDF continua em Meus jogos se precisarem imprimir de novo.' },
]
