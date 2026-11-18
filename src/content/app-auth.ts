// Páginas de conta do app KeyToTwo (responsável, 2026-11-18). O app de celular para casais (Flutter) tem um Supabase
// próprio, diferente do da loja. Os e-mails dele (confirmar cadastro, trocar e-mail, recuperar senha) passam por esse
// Supabase e trazem a pessoa para /auth/callback e /auth/recover. Os dois caminhos estão configurados no app e no
// Supabase dele: não mudar. Textos do pedido do responsável, sem mudança.

// Só a chave publicável (sb_publishable_…), que existe para ficar no navegador. Nunca a secreta nem a service_role:
// tests/unit/app-auth.test.mjs barra qualquer outro formato.
export const appSupabase = {
  url: 'https://wbvzrfzexcptlusxehvi.supabase.co',
  publishableKey: 'sb_publishable_TnFqB2i-X2_DDXjDGQug6w_fCpzcjYW',
}

// Enquanto o navegador lê o link (o HTML pré-renderizado não conhece o fragmento).
export const appChecking = { title: 'Um instante', text: 'Conferindo o link do e-mail…' }

export const appCallback = {
  signup: { title: 'E-mail confirmado!', text: 'Sua conta no KeyToTwo está pronta. Volte ao app e entre com seu e-mail e senha.' },
  email_change: { title: 'E-mail trocado!', text: 'Seu novo e-mail já vale no KeyToTwo. Volte ao app para continuar.' },
  message: { title: 'Falta só um passo', text: 'Confirmamos este endereço. Agora abra o link que mandamos para o outro e-mail para concluir a troca.' },
  error: { title: 'Este link não vale mais', text: 'Ele já foi usado ou passou do prazo de 1 hora. Se você já confirmou, é só entrar no app. Se não, peça um novo e-mail pelo app.' },
  empty: { title: 'Tudo certo por aqui', text: 'Volte ao app KeyToTwo para continuar.' },
} as const

export const appRecover = {
  expired: { title: 'Esse link venceu', text: 'Peça um novo no app, em “Esqueci minha senha”.' },
  done: { title: 'Senha trocada!', text: 'Volte ao app KeyToTwo e entre com a nova senha.' },
  form: {
    title: 'Crie uma nova senha',
    password: 'Nova senha',
    confirmation: 'Confirmar nova senha',
    rule: 'Pelo menos 8 caracteres, com letra maiúscula, letra minúscula, número e símbolo.',
    submit: 'Salvar nova senha',
    submitting: 'Salvando…',
    show: 'Mostrar',
    hide: 'Esconder',
  },
  errors: {
    mismatch: 'As senhas não conferem.',
    same: 'A nova senha precisa ser diferente da anterior.',
    weak: 'Essa senha não atende aos requisitos de segurança. Escolha outra.',
    other: 'Não foi possível trocar a senha. Confira sua conexão e tente de novo.',
  },
} as const
