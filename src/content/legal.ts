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

// Validação jurídica dos Termos, da Política de reembolso e da Privacidade: aprovada em 2026-10-22, na versão
// termos-2026-10-22 (responsável). Mudou o texto, muda a versão e o jurídico revê de novo.

// Revisão jurídica de 2026-10-22: atualizações, versões, licença x acesso, suspensão, responsabilidade, arrependimento,
// gratuitos e fotos. Fatos conferidos no código: Pix (Stripe, reembolso em até 90 dias para a conta de origem),
// exclusão em Minha conta (bloqueada com pagamento em andamento ou contestação aberta; pedidos anonimizados), links do
// e-mail de 30 dias (DELIVERY_TTL_SECONDS), arquivo novo no lugar do anterior (files.status) e contestação suspendendo
// e devolvendo o acesso (orders.status disputed/paid/dispute_lost).
const termsDate = '2026-10-22'
const termsLabel = 'Versão de 22 de outubro de 2026'

/** Versão aceita no pagamento. O servidor confere a mesma (TERMS_VERSION); mudou o texto, muda a versão. */
export const termsVersion = `termos-${termsDate}`

/** Aviso antes da compra (produto e sacola), sempre com o link para /reembolsos. */
export const refundNotice = 'Produto digital: o acesso é liberado assim que o pagamento é confirmado. Fora dos casos da Política de reembolso e da lei, não há reembolso depois da liberação.'

const termos: LegalContent = {
  title: 'Termos de uso',
  version: termsDate,
  versionLabel: termsLabel,
  intro: 'Estes termos valem para o site keytotwo.com.br, para a conta e para os jogos KeyToTwo, pagos e gratuitos. Ao criar uma conta, liberar um jogo gratuito ou fazer uma compra, você declara que leu e aceita estes termos, a Política de reembolso e a Política de privacidade.',
  sections: [
    { title: 'Quem fornece', id: 'fornecedor', paragraphs: [
      `KeyToTwo é uma marca da ${company.legalName}, inscrita no CNPJ sob o nº ${company.cnpj} ("Chalk Labs"), fornecedora dos jogos vendidos neste site.`,
      `Atendimento, inclusive sobre pedidos e dados pessoais: ${company.email}.`,
    ] },
    { title: 'O que vendemos', id: 'produto', paragraphs: [
      'Os jogos KeyToTwo são arquivos digitais em PDF, para imprimir e montar em casa. Nada é enviado pelo correio: impressão, papel e materiais ficam por sua conta, conforme a lista de cada jogo na loja.',
      'Cada jogo pode ser vendido sozinho ou dentro de um pacote. A página de cada produto informa o que está incluído antes da compra.',
      'Alguns jogos são gratuitos e são liberados nas condições informadas na página Gratuitos. Eles seguem as mesmas regras de licença e de propriedade intelectual destes termos.',
    ] },
    { title: 'Conta', id: 'conta', paragraphs: [
      'Para comprar, liberar jogos gratuitos e acessar os jogos, é preciso ter uma conta. A conta é pessoal e só pode ser criada por pessoas maiores de 18 anos e capazes de assumir obrigações.',
      'Você é responsável por manter o acesso ao seu e-mail e à sua senha sob seu controle, por não compartilhar a conta e pelo que for feito com ela. Se perceber uso indevido, avise o atendimento.',
      'Você pode excluir a conta quando quiser, em Minha conta. A exclusão é definitiva: encerra o acesso à conta e aos downloads, e as compras não podem ser recuperadas em outra conta. A licença das cópias que você já baixou continua valendo, nas condições destes termos, por isso guarde os PDFs antes de excluir. Com um pagamento em andamento ou uma contestação aberta, a exclusão só é possível depois que eles terminarem.',
    ] },
    { title: 'Suspensão e encerramento da conta', id: 'suspensao', paragraphs: [
      'Diante de suspeita fundamentada de fraude, de acesso indevido à conta ou de distribuição indevida dos arquivos, a Chalk Labs pode suspender a conta ou os downloads de imediato, como medida preventiva, enquanto apura o caso. Você é avisado por e-mail e pode apresentar esclarecimentos ao atendimento.',
      'A suspensão é provisória. Se a suspeita não se confirmar, o acesso é restabelecido.',
      'Se uma infração a estes termos for comprovada, a conta pode ser encerrada em definitivo. As licenças dos jogos ligados à infração terminam, sem reembolso desses jogos. O encerramento não implica, por si só, a perda das demais compras: a licença das cópias já baixadas dos outros jogos continua valendo, salvo se elas também estiverem envolvidas na infração.',
      'Contestar um pagamento é um direito seu e não é, por si só, uma infração. Só a contestação feita de má-fé, de uma compra recebida e reconhecida, pode levar às medidas desta seção.',
      'Tudo isso sem prejuízo das medidas legais cabíveis contra quem copia, distribui ou vende os jogos sem autorização.',
    ] },
    { title: 'Licença de uso', id: 'licenca', paragraphs: [
      'Com a compra, ou com a liberação de um jogo gratuito, a Chalk Labs concede a você uma licença pessoal, não exclusiva e intransferível para baixar, imprimir e jogar o jogo, em casa, com quem convive com você, sem fins comerciais. Você pode imprimir quantas cópias precisar para esse uso.',
      'A licença vale por prazo indeterminado para as cópias que você baixou, mesmo depois da exclusão da conta ou do encerramento do serviço. Ela termina se a compra for desfeita (reembolso ou contestação encerrada a seu favor) ou se você descumprir estes termos. Nesses casos, as cópias devem ser apagadas.',
      'A licença não transfere a propriedade dos arquivos nem do conteúdo. Sem autorização por escrito, não é permitido:',
      [
        'revender, alugar, sublicenciar ou dar os jogos, impressos ou em arquivo;',
        'compartilhar o PDF ou o link de download, inclusive em grupos de mensagens, redes sociais, pastas de nuvem com acesso público ou sites de arquivos;',
        'publicar os jogos, no todo ou em parte, ou criar versões derivadas para distribuir;',
        'imprimir para vender ou usar os jogos em evento pago, aula, oficina, festa contratada ou outra atividade comercial;',
        'remover ou alterar marcas e avisos de autoria ou de licença dos arquivos;',
        'usar os arquivos para treinar ou alimentar sistemas de inteligência artificial.',
      ],
      'Fotos e vídeos de vocês jogando e do que vocês criaram no jogo, como um desenho ou a mesa montada, podem ser publicados nas suas redes, como registro pessoal. A publicação não pode ter fins comerciais nem mostrar o jogo de um jeito que permita reproduzi-lo ou jogá-lo sem a licença, como páginas inteiras, conjuntos de cartas ou o próprio arquivo.',
      'Para usos fora desta licença, como eventos e uso comercial, escreva para o atendimento. O descumprimento da licença a encerra e pode levar às medidas da seção Suspensão e encerramento da conta, sem prejuízo das medidas legais cabíveis.',
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
      'Os downloads em Meus jogos ficam disponíveis enquanto a conta existir e o serviço KeyToTwo estiver em funcionamento, sem obrigação de hospedagem permanente dos arquivos. Se o serviço for encerrado, você será avisado por e-mail com pelo menos 30 dias de antecedência, para baixar os arquivos; a licença das cópias baixadas continua valendo. Recomendamos guardar uma cópia dos PDFs.',
      'O site e os downloads podem ficar fora do ar por manutenção ou falha. Nesses casos, o acesso é restabelecido assim que possível. Se um problema impedir o acesso a um jogo comprado, fale com o atendimento.',
    ] },
    { title: 'Atualizações dos jogos', id: 'atualizacoes', paragraphs: [
      'A Chalk Labs pode corrigir erros, atualizar, melhorar ou substituir os arquivos dos jogos. A versão nova fica em Meus jogos sem custo adicional e pode ocupar o lugar da anterior, que não precisa continuar disponível para download.',
      'Uma atualização não retira as características essenciais do jogo informadas na página do produto no momento da compra.',
      'Não há obrigação de produzir atualizações, conteúdos extras ou jogos novos. Atualizar um jogo comprado é diferente de lançar outro produto, como um jogo novo, uma expansão ou outra edição, que pode ser vendido separadamente.',
    ] },
    { title: 'Reembolso e contestações', id: 'reembolso', paragraphs: [
      'Os jogos são conteúdo digital entregue logo depois da confirmação do pagamento, a seu pedido. Antes de pagar, você é informado de que, a partir da liberação, o arquivo fica disponível para download e cópia.',
      'Fora dos casos previstos na Política de reembolso e na lei, não há reembolso depois da liberação. Pedidos de desistência feitos no prazo legal são analisados conforme o Código de Defesa do Consumidor. As regras completas estão na Política de reembolso (keytotwo.com.br/reembolsos), que faz parte destes termos.',
      'Se você contestar o pagamento no banco ou na operadora do cartão (chargeback), o acesso aos jogos do pedido fica suspenso enquanto a contestação estiver aberta. Se ela for encerrada a favor da Chalk Labs, o acesso volta. Se for encerrada a seu favor, ou se o valor for devolvido, a compra é desfeita e a licença dos jogos do pedido termina.',
    ] },
    { title: 'Responsabilidades', id: 'responsabilidade', paragraphs: [
      'Os jogos são produtos de entretenimento. Não prometemos nenhum resultado no relacionamento, e eles não substituem orientação ou acompanhamento profissional.',
      'O resultado da impressão depende da impressora, do papel, da tinta e das configurações usadas. O guia da Ajuda traz recomendações, mas a impressão e os materiais são de sua responsabilidade.',
      'Alguns jogos pedem tesoura, estilete ou outros materiais cortantes. Use-os com cuidado, sobre uma base adequada, e mantenha-os longe de crianças. Peças pequenas não são indicadas para crianças pequenas.',
      'A Chalk Labs não responde por danos causados por uso em desacordo com estes termos ou com as instruções dos jogos, por culpa exclusiva de quem usa ou de terceiros, nem por problemas no seu próprio aparelho, impressora ou conexão com a internet (Código de Defesa do Consumidor, art. 14, § 3º).',
      'Nada nestes termos afasta direitos que a lei garante ao consumidor e que não podem ser limitados por contrato.',
    ] },
    { title: 'Dados pessoais', id: 'dados', paragraphs: [
      'O tratamento de dados pessoais segue a Política de privacidade (keytotwo.com.br/privacidade).',
    ] },
    { title: 'Alterações destes termos', id: 'alteracoes', paragraphs: [
      'Estes termos têm versão e data, indicadas no topo da página. A versão aceita no pagamento rege aquela compra.',
      'A Chalk Labs pode atualizar os termos para refletir mudanças no serviço ou na lei. A versão nova vale para as compras feitas depois da publicação.',
      'Ajustes no funcionamento do serviço, como canais de atendimento, meios de pagamento ou recursos do site, valem a partir da publicação, sem reduzir os direitos de compras anteriores.',
      'Mudanças que afetem o acesso a jogos já comprados serão avisadas por e-mail com antecedência. O aviso informa a mudança; ele não reduz, por si só, os direitos garantidos pela versão aceita na compra.',
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
    { title: 'Entrega imediata e reembolso', id: 'regra', paragraphs: [
      'Ao pagar, você pede a entrega imediata do conteúdo digital e declara estar ciente de que, a partir da liberação, o arquivo fica disponível para download e cópia. Esse aceite fica registrado no pedido, com a versão dos termos e o momento em que foi dado.',
      'A liberação acontece quando o pagamento é confirmado: os jogos aparecem em Meus jogos e o e-mail de entrega é enviado. Fora dos casos desta política e da lei, não há reembolso depois da liberação.',
      'Pedidos de desistência feitos em até 7 dias da compra são analisados conforme o Código de Defesa do Consumidor. Se a desistência for aceita, o valor é devolvido, a compra é desfeita e a licença e o acesso aos jogos do pedido terminam; as cópias baixadas devem ser apagadas.',
      'Antes da liberação, a compra não está concluída: se o pagamento não for confirmado, não há cobrança. Se você pagou e o acesso não foi liberado, escreva para o atendimento.',
    ] },
    { title: 'Quando corrigimos, reenviamos ou devolvemos', id: 'excecoes', paragraphs: [
      'Mesmo depois da liberação, você tem solução nestes casos, como garante o Código de Defesa do Consumidor:',
      [
        'Arquivo com defeito: o PDF não abre, está corrompido, incompleto ou diferente do anunciado. Corrigimos e reenviamos o arquivo. Se não for resolvido em até 30 dias, você pode escolher a devolução do valor pago pelo jogo com defeito.',
        'Jogo não entregue: o pagamento foi confirmado, mas os jogos não apareceram em Meus jogos. Liberamos o acesso; se não for possível, devolvemos o valor.',
        'Cobrança em duplicidade ou com erro: você foi cobrado duas vezes pelo mesmo pedido ou por um valor diferente do exibido no pagamento. Estornamos o valor cobrado a mais.',
      ],
      'Dificuldade de impressão, falta de materiais ou o jogo não agradar não são defeito do arquivo. Para imprimir melhor, veja o guia na Ajuda.',
    ] },
    { title: 'Como pedir', id: 'como-pedir', paragraphs: [
      `Escreva para ${company.email}, a partir do e-mail da sua conta, com o número do pedido (ele aparece em Pedidos, no Portal) e a descrição do problema. Se puder, mande uma captura de tela.`,
      'Respondemos em até 5 dias.',
      'A devolução, quando houver, é feita pela Stripe, no mesmo meio de pagamento. No cartão, o prazo para aparecer na fatura depende do banco emissor. No Pix, o valor volta para a conta de origem quando a devolução é feita em até 90 dias do pagamento; depois disso, combinamos com você outra forma de devolução.',
      'Quando um pedido é reembolsado, a compra é desfeita: a licença e o acesso aos jogos dele terminam.',
    ] },
    { title: 'Contestações (chargeback)', id: 'contestacoes', paragraphs: [
      'Contestar um pagamento direto no banco ou na operadora do cartão é um direito seu. Enquanto a contestação estiver aberta, o acesso aos jogos do pedido fica suspenso.',
      'Se a contestação for encerrada a favor da Chalk Labs, o acesso volta. Se for encerrada a seu favor, a compra é desfeita e o acesso aos jogos do pedido termina em definitivo.',
      'Só a contestação feita de má-fé, de uma compra recebida e reconhecida, pode levar às medidas da seção Suspensão e encerramento da conta, nos Termos de uso.',
    ] },
  ],
}

const privacidade: LegalContent = {
  title: 'Política de privacidade',
  version: '2026-10-22',
  versionLabel: 'Versão de 22 de outubro de 2026',
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
        'Navegação, só se você aceitar os cookies: páginas visitadas, de onde você chegou, tipo de aparelho e de navegador, cidade aproximada e ações como ver um jogo, colocar na sacola e comprar, medidas pelo Google Analytics sem o seu e-mail nem ligação com a sua conta.',
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
        'Entender o uso da loja para melhorar o site e os jogos, com eventos ligados à conta: legítimo interesse (art. 7º, IX).',
        'Medir as visitas ao site com o Google Analytics, para saber o que funciona e de onde as pessoas chegam: consentimento (art. 7º, I), que você dá ou recusa no aviso de cookies e muda a qualquer momento em "Cookies", no rodapé.',
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
        'Google: login com a conta Google, quando você escolhe essa opção, e o Google Analytics, que mede as visitas só se você aceitar os cookies.',
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
        'Google Analytics: 14 meses, o prazo configurado na ferramenta. A sua escolha sobre os cookies fica guardada no navegador por 12 meses; depois, o aviso pergunta de novo.',
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
      'Sem precisar escrever, em Minha conta você baixa uma cópia dos seus dados (arquivo JSON com conta, pedidos, biblioteca, consentimentos, downloads e e-mails), muda a preferência de e-mail e exclui a conta. A exclusão é imediata e encerra o acesso à conta e aos downloads (a licença das cópias já baixadas continua valendo, como dizem os Termos de uso); os pedidos ficam guardados sem identificação, como explicado acima.',
      `Para os demais pedidos, escreva para ${company.email} a partir do e-mail da conta. Podemos pedir uma confirmação de identidade antes de atender. Respondemos em até 15 dias.`,
      'Você também pode apresentar reclamação à Autoridade Nacional de Proteção de Dados (ANPD).',
    ] },
    { title: 'Cookies e armazenamento no navegador', id: 'navegador', paragraphs: [
      'Cookies de análise (Google Analytics): só com o seu aceite no aviso de cookies. Eles contam as visitas e as ações na loja, sem ligação com a sua conta. Não usamos cookies de publicidade, e os sinais do Google para anúncios ficam desligados.',
      'Você muda a escolha a qualquer momento em "Cookies", no rodapé. Recusar não muda nada no uso do site e apaga os cookies do Google Analytics deste navegador.',
      'Quando você entra na conta, o navegador guarda a sessão no armazenamento local (localStorage), para você continuar conectado. Ela é apagada quando você sai da conta. A sacola de quem ainda não entrou e a sua escolha sobre os cookies também ficam no armazenamento local do navegador.',
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
