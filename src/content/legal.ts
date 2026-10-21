import { pending } from '../lib/pending'
import { supportEmail } from './help'

// Termos, Política de reembolso e Política de privacidade (responsável, 2026-10-19). Fatos conferidos no código:
// tabelas do banco (docs/data-contract.md), funções (docs/api-contract.md) e o que o navegador guarda.
// Um bloco string é um parágrafo; uma lista de strings vira uma lista com marcadores.
export type LegalBlock = string | readonly string[]
export type LegalSection = { title: string; id: string; paragraphs: readonly LegalBlock[] }
export type LegalContent = { title: string; intro: string; version: string; versionLabel: string; sections: readonly LegalSection[] }

/** Quem fornece e quem controla os dados. Sem endereço físico publicado (decisão do responsável). */
export const company = {
  brand: 'KeyToTwo',
  legalName: 'CHALK LABS CONSULTORIA EM TI LTDA',
  name: 'Chalk Labs',
  cnpj: '66.782.936/0001-20',
  email: supportEmail,
}

// Única pendência jurídica, fora da tela: o responsável libera depois de revisar os três textos.
export const legalReview = pending('validação jurídica dos Termos, da Privacidade e da política de não reembolso.')

const termsDate = '2026-10-19'
const termsLabel = 'Versão de 19 de outubro de 2026'

/** Versão aceita no pagamento. O servidor confere a mesma (TERMS_VERSION); mudou o texto, muda a versão. */
export const termsVersion = `termos-${termsDate}`

/** Aviso antes da compra (produto e sacola), sempre com o link para /reembolsos. */
export const refundNotice = 'Produto digital: o acesso é liberado assim que o pagamento é confirmado. Depois da liberação, não há reembolso, salvo arquivo com defeito ou cobrança indevida.'

const termos: LegalContent = {
  title: 'Termos de uso',
  version: termsDate,
  versionLabel: termsLabel,
  intro: 'Estes termos valem para o site keytotwo.com.br, para a conta e para a compra dos jogos KeyToTwo. Ao criar uma conta ou fazer uma compra, você declara que leu e aceita estes termos, a Política de reembolso e a Política de privacidade.',
  sections: [
    { title: 'Quem fornece', id: 'fornecedor', paragraphs: [
      `KeyToTwo é uma marca da ${company.legalName}, inscrita no CNPJ sob o nº ${company.cnpj} ("Chalk Labs"), fornecedora dos jogos vendidos neste site.`,
      `Atendimento, inclusive sobre pedidos e dados pessoais: ${company.email}.`,
    ] },
    { title: 'O que vendemos', id: 'produto', paragraphs: [
      'Os jogos KeyToTwo são arquivos digitais em PDF, para imprimir e montar em casa. Nada é enviado pelo correio: impressão, papel e materiais ficam por sua conta, conforme a lista de cada jogo na loja.',
      'Cada jogo pode ser vendido sozinho ou dentro de um pacote. A página de cada produto informa o que está incluído antes da compra.',
    ] },
    { title: 'Conta', id: 'conta', paragraphs: [
      'Para comprar e acessar os jogos, é preciso ter uma conta. A conta é pessoal e só pode ser criada por pessoas maiores de 18 anos e capazes de assumir obrigações.',
      'Você é responsável por manter o acesso ao seu e-mail e à sua senha sob seu controle, por não compartilhar a conta e pelo que for feito com ela. Se perceber uso indevido, avise o atendimento.',
      'A Chalk Labs pode suspender ou encerrar a conta, com aviso por e-mail, em caso de fraude ou suspeita fundamentada de fraude, abuso do serviço, compartilhamento da conta ou dos arquivos, contestação de pagamento feita de má-fé ou descumprimento destes termos. Nesses casos, o acesso aos jogos pode ser encerrado sem reembolso.',
      'Você pode excluir a conta quando quiser, em Minha conta. A exclusão encerra o acesso aos jogos comprados. Guarde uma cópia dos PDFs antes de excluir.',
    ] },
    { title: 'Licença de uso', id: 'licenca', paragraphs: [
      'Com a compra, a Chalk Labs concede a você uma licença pessoal, não exclusiva e intransferível para baixar, imprimir e jogar os jogos comprados, em casa, com quem convive com você, sem fins comerciais. Você pode imprimir quantas cópias precisar para esse uso.',
      'A licença não transfere a propriedade dos arquivos nem do conteúdo. Sem autorização por escrito, não é permitido:',
      [
        'revender, alugar, sublicenciar ou dar os jogos, impressos ou em arquivo;',
        'compartilhar o PDF ou o link de download, inclusive em grupos de mensagens, redes sociais, pastas de nuvem com acesso público ou sites de arquivos;',
        'publicar os jogos, no todo ou em parte, ou criar versões derivadas para distribuir;',
        'imprimir para vender ou usar os jogos em evento pago, aula, oficina, festa contratada ou outra atividade comercial;',
        'remover ou alterar marcas e avisos de autoria ou de licença dos arquivos;',
        'usar os arquivos para treinar ou alimentar sistemas de inteligência artificial.',
      ],
      'Para usos fora desta licença, como eventos e uso comercial, escreva para o atendimento. O descumprimento da licença a encerra e pode levar ao encerramento da conta, sem prejuízo das medidas legais cabíveis.',
    ] },
    { title: 'Propriedade intelectual', id: 'propriedade-intelectual', paragraphs: [
      'A marca KeyToTwo, o personagem Kito, os jogos, as ilustrações, os textos e o design dos arquivos e do site pertencem à Chalk Labs ou são usados com autorização. Eles estão protegidos pela Lei de Direitos Autorais (Lei nº 9.610/1998) e pela Lei de Propriedade Industrial (Lei nº 9.279/1996).',
      'Estes termos não dão direito de usar a marca ou os personagens além do previsto na licença.',
    ] },
    { title: 'Preços, pagamento e cupons', id: 'precos', paragraphs: [
      'Os preços aparecem na loja, em moeda brasileira, e são confirmados na sacola e no pagamento, antes de você pagar. O valor cobrado é o exibido no pagamento.',
      'O pagamento é feito por Pix ou cartão e processado pela Stripe. A KeyToTwo não recebe nem guarda os dados completos do cartão.',
      'Cupons seguem as condições informadas na divulgação (valor, validade e limite de uso), não podem ser trocados por dinheiro e podem ser encerrados quando a validade terminar ou em caso de uso indevido.',
      'Se um preço for publicado com erro evidente, muito diferente do valor praticado (por falha técnica ou de digitação, por exemplo), a Chalk Labs pode cancelar o pedido antes da liberação e devolver todo o valor pago, ou oferecer a compra pelo preço correto.',
      'O pedido só é concluído quando a Stripe confirma o pagamento. Pagamento recusado, não concluído ou expirado não gera cobrança nem acesso.',
    ] },
    { title: 'Entrega e acesso', id: 'entrega', paragraphs: [
      'A entrega é digital. Assim que o pagamento é confirmado, os jogos aparecem em Meus jogos, na sua conta, e um e-mail com botões de download é enviado para o endereço da conta. A confirmação costuma ser imediata, mas pode levar alguns minutos.',
      'Os botões de download do e-mail valem por 30 dias. Depois disso, os jogos continuam em Meus jogos.',
      'O acesso em Meus jogos não expira enquanto o serviço KeyToTwo estiver em funcionamento. Se o serviço for encerrado, você será avisado por e-mail com pelo menos 30 dias de antecedência, para baixar os arquivos. Recomendamos guardar uma cópia dos PDFs.',
      'O site e os downloads dependem de serviços de terceiros e podem ficar fora do ar por manutenção ou falha. Nesses casos, o acesso é restabelecido assim que possível.',
    ] },
    { title: 'Atualizações dos jogos', id: 'atualizacoes', paragraphs: [
      'A Chalk Labs pode, a seu critério, corrigir, melhorar ou substituir os arquivos dos jogos. Quando houver uma versão nova, ela fica em Meus jogos sem custo adicional, no lugar da anterior.',
      'Não há obrigação de lançar versões novas, conteúdos extras ou jogos novos. Jogos novos são produtos à parte, vendidos separadamente.',
    ] },
    { title: 'Reembolso e contestações', id: 'reembolso', paragraphs: [
      'Os jogos são conteúdo digital entregue logo depois da confirmação do pagamento, a seu pedido. Por isso, depois que o acesso é liberado, não há reembolso nem desistência da compra: o arquivo já foi entregue e pode ser copiado. No pagamento, você declara estar ciente disso ao aceitar estes termos.',
      'Arquivo com defeito, jogo não entregue e cobrança em duplicidade ou com erro têm solução: corrigimos, reenviamos ou devolvemos o valor. As regras completas estão na Política de reembolso (keytotwo.com.br/reembolsos), que faz parte destes termos.',
      'Se você contestar o pagamento no banco ou na operadora do cartão (chargeback), o acesso aos jogos do pedido fica suspenso enquanto a contestação estiver aberta. Se ela for encerrada a favor da Chalk Labs, o acesso volta. Se for encerrada a seu favor, ou se o valor for devolvido, o acesso aos jogos do pedido é encerrado.',
    ] },
    { title: 'Responsabilidades', id: 'responsabilidade', paragraphs: [
      'Os jogos são produtos de entretenimento. Não prometemos nenhum resultado no relacionamento, e eles não substituem orientação ou acompanhamento profissional.',
      'O resultado da impressão depende da impressora, do papel, da tinta e das configurações usadas. O guia da Ajuda traz recomendações, mas a impressão e os materiais são de sua responsabilidade.',
      'Alguns jogos pedem tesoura, estilete ou outros materiais cortantes. Use-os com cuidado, sobre uma base adequada, e mantenha-os longe de crianças. Peças pequenas não são indicadas para crianças pequenas.',
      'A Chalk Labs não responde por danos causados por uso em desacordo com estes termos ou com as instruções dos jogos, por culpa exclusiva de quem usa ou de terceiros, nem por falhas de serviços fora do seu controle, como provedores de internet e bancos (Código de Defesa do Consumidor, art. 14, § 3º).',
      'Nada nestes termos afasta direitos que a lei garante ao consumidor e que não podem ser limitados por contrato.',
    ] },
    { title: 'Dados pessoais', id: 'dados', paragraphs: [
      'O tratamento de dados pessoais segue a Política de privacidade (keytotwo.com.br/privacidade).',
    ] },
    { title: 'Alterações destes termos', id: 'alteracoes', paragraphs: [
      'Estes termos têm versão e data, indicadas no topo da página. A versão aceita no pagamento vale para aquela compra.',
      'A Chalk Labs pode atualizar os termos para refletir mudanças no serviço ou na lei. A versão nova vale para as compras feitas depois da publicação. Mudanças que afetem o acesso a jogos já comprados serão avisadas por e-mail com antecedência.',
    ] },
    { title: 'Lei aplicável e foro', id: 'foro', paragraphs: [
      'Estes termos seguem a lei brasileira, em especial o Código de Defesa do Consumidor (Lei nº 8.078/1990) e o Marco Civil da Internet (Lei nº 12.965/2014).',
      `Antes de qualquer medida, fale com o atendimento em ${company.email}: a maioria dos problemas se resolve por e-mail. Se houver disputa judicial, ela pode ser proposta no foro do domicílio do consumidor.`,
    ] },
  ],
}

const reembolso: LegalContent = {
  title: 'Política de reembolso',
  version: termsDate,
  versionLabel: termsLabel,
  intro: 'Os jogos KeyToTwo são arquivos digitais liberados logo depois da confirmação do pagamento. Esta política explica quando há reembolso e o que fazer se algo der errado. Ela faz parte dos Termos de uso.',
  sections: [
    { title: 'Sem reembolso depois da liberação', id: 'regra', paragraphs: [
      'Ao pagar, você pede a entrega imediata do conteúdo digital e declara estar ciente de que, por isso, não há reembolso depois que o acesso é liberado. Esse aceite fica registrado no pedido, com a versão dos termos e o momento em que foi dado.',
      'A liberação acontece quando o pagamento é confirmado: os jogos aparecem em Meus jogos e o e-mail de entrega é enviado. A partir daí, o arquivo já foi entregue e pode ser copiado. Por isso, não é possível desistir da compra nem pedir reembolso depois da liberação.',
      'Antes da liberação, a compra não está concluída: se o pagamento não for confirmado, não há cobrança. Se você pagou e o acesso não foi liberado, escreva para o atendimento.',
    ] },
    { title: 'Quando corrigimos, reenviamos ou devolvemos', id: 'excecoes', paragraphs: [
      'Mesmo depois da liberação, você tem solução nestes casos, como garante o Código de Defesa do Consumidor:',
      [
        'Arquivo com defeito: o PDF não abre, está corrompido, incompleto ou diferente do anunciado. Corrigimos e reenviamos o arquivo. Se não for resolvido em até 30 dias, você pode escolher a devolução do valor pago pelo jogo com defeito.',
        'Jogo não entregue: o pagamento foi confirmado, mas os jogos não apareceram em Meus jogos. Liberamos o acesso; se não for possível, devolvemos o valor.',
        'Cobrança em duplicidade ou com erro: você foi cobrado duas vezes pelo mesmo pedido ou por um valor diferente do exibido no pagamento. Estornamos o valor cobrado a mais.',
      ],
      'Dificuldade de impressão, falta de materiais, mudança de ideia ou o jogo não agradar não são defeito do arquivo. Para imprimir melhor, veja o guia na Ajuda.',
    ] },
    { title: 'Como pedir', id: 'como-pedir', paragraphs: [
      `Escreva para ${company.email}, a partir do e-mail da sua conta, com o número do pedido (ele aparece em Pedidos, no Portal) e a descrição do problema. Se puder, mande uma captura de tela.`,
      'Respondemos em até 5 dias.',
      'A devolução, quando houver, é feita pela Stripe, no mesmo meio de pagamento. No cartão, o prazo para aparecer na fatura depende do banco emissor. No Pix, o valor volta para a conta de origem.',
      'Quando um pedido é reembolsado, o acesso aos jogos dele é encerrado.',
    ] },
    { title: 'Contestações (chargeback)', id: 'contestacoes', paragraphs: [
      'Se você contestar o pagamento direto no banco ou na operadora do cartão, o acesso aos jogos do pedido fica suspenso enquanto a contestação estiver aberta.',
      'Se a contestação for encerrada a favor da Chalk Labs, o acesso volta. Se for encerrada a seu favor, o acesso aos jogos do pedido é encerrado em definitivo.',
      'Contestar uma compra recebida sem motivo legítimo pode levar à suspensão da conta, como preveem os Termos de uso.',
    ] },
  ],
}

const privacidade: LegalContent = {
  title: 'Política de privacidade',
  version: '2026-10-20',
  versionLabel: 'Versão de 20 de outubro de 2026',
  intro: 'Esta política explica quais dados pessoais a KeyToTwo trata, para quê, com quem compartilha, por quanto tempo guarda e como você exerce seus direitos, conforme a Lei Geral de Proteção de Dados (LGPD, Lei nº 13.709/2018).',
  sections: [
    { title: 'Quem cuida dos seus dados', id: 'controladora', paragraphs: [
      `A controladora dos dados é a ${company.legalName}, CNPJ ${company.cnpj}, dona da marca KeyToTwo.`,
      `Por ser agente de tratamento de pequeno porte (Resolução CD/ANPD nº 2/2022), a Chalk Labs não indicou encarregado de dados. O canal para qualquer assunto sobre dados pessoais é ${company.email}.`,
    ] },
    { title: 'Quais dados tratamos', id: 'dados', paragraphs: [
      [
        'Conta: e-mail, data de criação, confirmação do e-mail e data do último acesso. Se você entra com o Google, também o nome e a foto do perfil que o Google compartilha. Se você cria uma senha, ela é guardada só de forma cifrada (hash).',
        'Compras: itens da sacola, pedidos, produtos, valores, cupom usado, datas, a versão dos termos aceita e o momento do aceite, e as referências do pagamento na Stripe.',
        'Acesso aos jogos: a sua biblioteca em Meus jogos e o registro de cada download, inclusive dos gratuitos (qual arquivo e quando).',
        'Preferência de e-mail: se você aceita receber novidades, com o histórico de quando aceitou ou retirou o aceite, por onde e qual versão do texto viu.',
        'E-mails enviados: tipo da mensagem (entrega, lembrete ou novidade), endereço, situação do envio e, quando a Brevo avisa, devolução, reclamação de spam ou descadastro.',
        'Uso da loja: eventos como conta confirmada, item colocado ou tirado da sacola, pagamento iniciado e pedido pago, ligados à sua conta.',
        'Registros de acesso: o serviço de login e a hospedagem registram endereço IP, data e hora dos acessos e dados do navegador.',
        'Pagamento: os dados do cartão ou do Pix (como número do cartão, nome e documento, quando pedidos) são informados direto à Stripe. A KeyToTwo não recebe nem guarda o número do cartão.',
      ],
      'Não pedimos dados pessoais sensíveis.',
    ] },
    { title: 'Para que usamos e com qual base legal', id: 'finalidades', paragraphs: [
      [
        'Criar e manter a conta, processar compras, entregar os jogos, enviar os e-mails de acesso e de pedido e prestar atendimento: execução do contrato (LGPD, art. 7º, V).',
        'Guardar pedidos e registros de pagamento e cumprir obrigações fiscais e contábeis: cumprimento de obrigação legal (art. 7º, II).',
        'Guardar registros de acesso pelo prazo do Marco Civil da Internet: cumprimento de obrigação legal (art. 7º, II).',
        'Prevenir fraude e abuso, proteger a conta, os arquivos e o serviço, tratar contestações e defender direitos: legítimo interesse (art. 7º, IX) e exercício regular de direitos (art. 7º, VI).',
        'Entender o uso da loja para melhorar o site e os jogos, com eventos ligados à conta e sem ferramentas de rastreamento de terceiros: legítimo interesse (art. 7º, IX).',
        'Enviar novidades, ofertas, lembrete da sacola e dicas depois da compra: consentimento (art. 7º, I), que você dá e retira em Minha conta ou pelo link de cada e-mail.',
      ],
      'Comprar não depende de aceitar e-mails de novidades. Retirar o consentimento não afeta os e-mails de acesso e de pedido. Não vendemos dados pessoais.',
      'Os jogos gratuitos são a exceção: para baixá-los, é preciso ter conta e aceitar os e-mails de novidades (LGPD, art. 9º, § 3º). Quem retira o aceite depois continua baixando os gratuitos.',
    ] },
    { title: 'Com quem compartilhamos', id: 'compartilhamento', paragraphs: [
      'Usamos fornecedores que tratam dados em nosso nome (operadores), só para as finalidades acima:',
      [
        'Supabase: banco de dados, login e funções do site. Os dados ficam em servidores em São Paulo.',
        'Stripe: processamento dos pagamentos (Pix e cartão) e prevenção de fraude. A Stripe também trata dados de pagamento como controladora, para cumprir obrigações próprias, conforme a política dela.',
        'Brevo: envio dos e-mails.',
        'Backblaze B2: armazenamento dos arquivos dos jogos. O download sai direto do Backblaze, que registra o acesso técnico.',
        'Google: login com a conta Google, quando você escolhe essa opção.',
        'Provedor de hospedagem: o servidor que publica o site.',
      ],
      'Também podemos compartilhar dados quando a lei exigir, por ordem judicial ou de autoridade competente, ou para defender direitos.',
      'Stripe, Brevo, Backblaze e Google podem tratar dados fora do Brasil, em países como os Estados Unidos e os da União Europeia. Essas transferências são necessárias para executar o contrato com você e seguem as garantias contratuais desses fornecedores (LGPD, art. 33, II e IX).',
    ] },
    { title: 'Por quanto tempo guardamos', id: 'retencao', paragraphs: [
      [
        'Conta, sacola, biblioteca, preferência de e-mail e histórico de consentimento: enquanto a conta existir.',
        'Pedidos e registros de pagamento: pelo prazo exigido pela legislação fiscal e para defesa em eventual processo (em regra, 5 anos). Se você excluir a conta, os pedidos ficam sem o seu e-mail e sem ligação com você, só com produtos, valores, datas e a referência do pagamento na Stripe.',
        'E-mails enviados: o registro de cada mensagem é apagado 90 dias depois do envio.',
        'Registros de acesso: 6 meses, como exige o Marco Civil da Internet (Lei nº 12.965/2014, art. 15).',
        'Lista de supressão: e-mails que voltaram, reclamaram de spam ou pediram descadastro continuam numa lista para não receberem novidades, mesmo depois da exclusão da conta. É ela que garante essa escolha.',
        'Eventos de uso e de download: enquanto a conta existir. Depois da exclusão, ficam sem ligação com você, só como estatística.',
      ],
    ] },
    { title: 'Seus direitos', id: 'direitos', paragraphs: [
      'A LGPD (art. 18) garante a você, a qualquer momento:',
      [
        'confirmar se tratamos seus dados e ter acesso a eles;',
        'corrigir dados incompletos, inexatos ou desatualizados;',
        'pedir a anonimização, o bloqueio ou a eliminação de dados desnecessários, excessivos ou tratados em desacordo com a lei;',
        'receber seus dados num formato estruturado (portabilidade);',
        'pedir a eliminação dos dados tratados com o seu consentimento e retirar o consentimento;',
        'saber com quem compartilhamos seus dados e as consequências de não dar o consentimento;',
        'se opor a um tratamento feito em desacordo com a lei.',
      ],
      'Sem precisar escrever, em Minha conta você baixa uma cópia dos seus dados (arquivo JSON com conta, pedidos, biblioteca, consentimentos, downloads e e-mails), muda a preferência de e-mail e exclui a conta. A exclusão é imediata e encerra o acesso aos jogos; os pedidos ficam guardados sem identificação, como explicado acima.',
      `Para os demais pedidos, escreva para ${company.email} a partir do e-mail da conta. Podemos pedir uma confirmação de identidade antes de atender. Respondemos em até 15 dias.`,
      'Você também pode apresentar reclamação à Autoridade Nacional de Proteção de Dados (ANPD).',
    ] },
    { title: 'Cookies e armazenamento no navegador', id: 'navegador', paragraphs: [
      'O site não usa cookies de publicidade nem ferramentas de análise ou rastreamento de terceiros.',
      'Quando você entra na conta, o navegador guarda a sessão no armazenamento local (localStorage), para você continuar conectado. Ela é apagada quando você sai da conta.',
      'Na página de pagamento, o formulário da Stripe é carregado e pode gravar cookies próprios, usados para segurança e prevenção de fraude. Ao entrar com o Google, você passa pela página do Google, que segue a política dele.',
    ] },
    { title: 'Segurança', id: 'seguranca', paragraphs: [
      'Usamos conexão cifrada (HTTPS), senhas guardadas como hash, códigos de acesso de uso único, links de download assinados e temporários e acesso ao banco só pelos sistemas da loja, com o mínimo de permissões.',
      'Nenhum sistema é totalmente seguro. Se houver um incidente que possa causar risco ou dano relevante, avisaremos você e a ANPD, como manda a lei.',
    ] },
    { title: 'Menores de idade', id: 'menores', paragraphs: [
      'O site e a conta são para maiores de 18 anos. Não tratamos de propósito dados de crianças e adolescentes. Se soubermos de uma conta de menor de idade, ela será excluída.',
    ] },
    { title: 'Alterações desta política', id: 'alteracoes', paragraphs: [
      'Esta política tem versão e data, indicadas no topo da página. Se ela mudar de forma relevante, avisaremos no site e, quando for o caso, por e-mail.',
    ] },
    { title: 'Contato', id: 'contato', paragraphs: [
      `Dúvidas e pedidos sobre dados pessoais: ${company.email}.`,
    ] },
  ],
}

export const legal: Record<'termos' | 'reembolso' | 'privacidade', LegalContent> = { termos, reembolso, privacidade }
