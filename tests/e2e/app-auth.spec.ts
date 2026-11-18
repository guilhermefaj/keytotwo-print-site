import { mkdir } from 'node:fs/promises'
import { expect, test, type Page, type Route } from './fixtures/test'

// Páginas de conta do app KeyToTwo (2026-11-18): /auth/callback e /auth/recover. O Supabase do app é simulado aqui;
// nenhum teste fala com o projeto de verdade. APP_AUTH_CAPTURE=1 grava um print de cada estado em 360 px.
const appAuth = 'https://wbvzrfzexcptlusxehvi.supabase.co/auth/v1'
const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
// Um JWT só com o formato certo (a página não confere assinatura; quem confere é o Supabase, simulado aqui).
const accessToken = `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url({ sub: 'app-user', aud: 'authenticated', role: 'authenticated', exp: 4102444800, session_id: 's1' })}.assinatura`
const user = { id: 'app-user', aud: 'authenticated', role: 'authenticated', email: 'pessoa@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-11-01T00:00:00Z' }
const recoveryLink = `/auth/recover#access_token=${accessToken}&refresh_token=refresh-1&expires_in=3600&token_type=bearer&type=recovery`

async function capture(page: Page, name: string) {
  if (process.env.APP_AUTH_CAPTURE !== '1') return
  await mkdir('.maestri/design-review/app-auth', { recursive: true })
  await page.screenshot({ path: `.maestri/design-review/app-auth/${name}.png`, fullPage: true, animations: 'disabled' })
}

// Tudo o que a página pede fora do próprio site. Só o Supabase do app pode aparecer, e só na página de senha.
function outsideRequests(page: Page) {
  const urls: string[] = []
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1')) urls.push(request.url()) })
  return urls
}

const cors = (route: Route) => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
  'Access-Control-Allow-Headers': route.request().headers()['access-control-request-headers'] ?? '*',
  // Como o Supabase de verdade: o supabase-js só lê o código do erro (same_password…) com este cabeçalho à vista.
  'Access-Control-Expose-Headers': 'x-supabase-api-version',
  'x-supabase-api-version': '2024-01-01',
})

// O Supabase do app: GET /user confere o link; PUT /user troca a senha (resposta escolhida pelo teste); logout.
async function appSupabase(page: Page, update: () => { status: number; json?: object } | 'offline' = () => ({ status: 200, json: user })) {
  const calls: { method: string; path: string; body?: unknown }[] = []
  await page.route(`${appAuth}/**`, async route => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(route) })
    const path = new URL(request.url()).pathname.replace('/auth/v1', '')
    calls.push({ method: request.method(), path, body: request.postDataJSON?.() ?? undefined })
    if (path === '/user' && request.method() === 'GET') return route.fulfill({ status: 200, headers: cors(route), json: user })
    if (path === '/user' && request.method() === 'PUT') {
      const answer = update()
      if (answer === 'offline') return route.abort('internetdisconnected')
      return route.fulfill({ status: answer.status, headers: cors(route), json: answer.json ?? {} })
    }
    if (path === '/logout') return route.fulfill({ status: 204, headers: cors(route) })
    return route.fulfill({ status: 404, headers: cors(route), json: {} })
  })
  return calls
}

test.use({ viewport: { width: 360, height: 760 } })

test('callback: cada link mostra a mensagem certa e some da barra de endereço, sem nada da loja nem de terceiros', async ({ page }) => {
  const outside = outsideRequests(page)
  const cases = [
    ['#access_token=x&refresh_token=y&type=signup', 'E-mail confirmado!', 'Sua conta no KeyToTwo está pronta. Volte ao app e entre com seu e-mail e senha.', 'callback-cadastro'],
    ['#access_token=x&refresh_token=y&type=email_change', 'E-mail trocado!', 'Seu novo e-mail já vale no KeyToTwo. Volte ao app para continuar.', 'callback-troca-de-email'],
    ['#message=Confirmation+link+accepted.+Please+proceed+to+confirm+link+sent+to+the+other+email', 'Falta só um passo', 'Confirmamos este endereço. Agora abra o link que mandamos para o outro e-mail para concluir a troca.', 'callback-falta-um-passo'],
    ['#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', 'Este link não vale mais', 'Ele já foi usado ou passou do prazo de 1 hora. Se você já confirmou, é só entrar no app. Se não, peça um novo e-mail pelo app.', 'callback-link-vencido'],
    ['', 'Tudo certo por aqui', 'Volte ao app KeyToTwo para continuar.', 'callback-sem-dados'],
  ] as const
  for (const [hash, title, text, name] of cases) {
    await page.goto('about:blank') // cada link do e-mail abre uma página nova (trocar só o # não recarrega)
    await page.goto(`/auth/callback${hash}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
    await expect(page.locator('.app-auth-text')).toHaveText(text)
    expect(await page.evaluate(() => window.location.href), 'o fragmento sai da barra').toMatch(/\/auth\/callback\/?$/)
    await capture(page, name)
  }
  // Moldura enxuta: logotipo e Kito, sem cabeçalho, cupom, sacola, aviso de cookies nem rodapé da loja.
  await expect(page.locator('.app-auth-header .wordmark')).toHaveText('KeyToTwo')
  await expect(page.locator('.app-auth-kito')).toBeVisible()
  await expect(page.locator('.site-header, .promo-bar, footer, .cookie-notice, [href="/carrinho"], nav')).toHaveCount(0)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex, nofollow/)
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')
  expect(outside, 'nenhum pedido para fora do site (nem o Supabase da loja)').toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('recover: link vencido ou incompleto mostra o aviso, sem formulário e sem chamar o Supabase', async ({ page }) => {
  const outside = outsideRequests(page)
  for (const [hash, name] of [['#error=access_denied&error_code=otp_expired', 'recover-link-vencido'], ['#access_token=x&refresh_token=y&type=signup', ''], ['', '']] as const) {
    await page.goto('about:blank')
    await page.goto(`/auth/recover${hash}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Esse link venceu')
    await expect(page.locator('.app-auth-text')).toHaveText('Peça um novo no app, em “Esqueci minha senha”.')
    await expect(page.locator('form')).toHaveCount(0)
    expect(await page.evaluate(() => window.location.href)).toMatch(/\/auth\/recover\/?$/)
    if (name) await capture(page, name)
  }
  expect(outside).toEqual([])
})

test('recover: tokens falsos terminam no aviso de link vencido, sem quebrar', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/auth/recover#access_token=x&refresh_token=y&type=recovery')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Esse link venceu')
  await expect(page.locator('form')).toHaveCount(0)
  expect(await page.evaluate(() => window.location.href)).toMatch(/\/auth\/recover\/?$/)
  expect(errors).toEqual([])
})

test('recover: formulário confere a senha, traduz cada erro do Supabase e termina em "Senha trocada!"', async ({ page }) => {
  let answer: { status: number; json?: object } | 'offline' = { status: 422, json: { code: 'same_password', msg: 'New password should be different from the old password.' } }
  const calls = await appSupabase(page, () => answer)
  const outside = outsideRequests(page)
  await page.goto(recoveryLink)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Crie uma nova senha')
  expect(await page.evaluate(() => window.location.href), 'tokens fora da barra').toMatch(/\/auth\/recover\/?$/)
  expect(calls[0], 'o link é conferido no Supabase do app').toMatchObject({ method: 'GET', path: '/user' })
  await expect(page.getByText('Pelo menos 8 caracteres, com letra maiúscula, letra minúscula, número e símbolo.')).toBeVisible()
  await capture(page, 'recover-formulario')

  const password = page.getByLabel('Nova senha', { exact: true })
  const confirmation = page.getByLabel('Confirmar nova senha')
  const save = page.getByRole('button', { name: 'Salvar nova senha' })
  const alert = page.locator('.form-error')

  // Mostrar e esconder, campo a campo.
  await password.fill('Abcdef1!')
  await expect(password).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Mostrar a nova senha' }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Esconder a nova senha' }).click()
  await expect(password).toHaveAttribute('type', 'password')
  await expect(page.getByRole('button', { name: 'Mostrar a confirmação' })).toBeVisible()

  // Validação no navegador, antes de enviar.
  await password.fill('abcdefgh')
  await confirmation.fill('abcdefgh')
  await save.click()
  await expect(alert).toHaveText('Essa senha não atende aos requisitos de segurança. Escolha outra.')
  await password.fill('Abcdef1!')
  await confirmation.fill('Abcdef1?')
  await save.click()
  await expect(alert).toHaveText('As senhas não conferem.')
  await capture(page, 'recover-senhas-diferentes')
  expect(calls.filter(call => call.method === 'PUT'), 'nada enviado com a senha inválida').toHaveLength(0)

  // Respostas do Supabase, em português.
  await confirmation.fill('Abcdef1!')
  await save.click()
  await expect(alert).toHaveText('A nova senha precisa ser diferente da anterior.')
  answer = { status: 422, json: { code: 'weak_password', msg: 'Password is known to be weak', weak_password: { reasons: ['pwned'] } } }
  await save.click()
  await expect(alert).toHaveText('Essa senha não atende aos requisitos de segurança. Escolha outra.')
  answer = 'offline'
  await save.click()
  await expect(alert).toHaveText('Não foi possível trocar a senha. Confira sua conexão e tente de novo.')
  await expect(page.locator('body')).not.toContainText(/password|weak|known/i)

  answer = { status: 200, json: user }
  await save.click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Senha trocada!')
  await expect(page.locator('.app-auth-text')).toHaveText('Volte ao app KeyToTwo e entre com a nova senha.')
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
  await capture(page, 'recover-senha-trocada')
  expect(calls.filter(call => call.method === 'PUT').at(-1)?.body).toMatchObject({ password: 'Abcdef1!' })
  await expect.poll(() => calls.some(call => call.path === '/logout')).toBe(true)
  expect(outside.every(url => url.startsWith(appAuth)), `só o Supabase do app: ${outside.join(', ')}`).toBe(true)
  // Nada da sessão do app fica guardado no navegador.
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('sb-')))).toEqual([])
})

test('recover: sessão vencida no meio do caminho vira o aviso de link vencido; o botão trava enquanto envia', async ({ page }) => {
  let release: () => void = () => undefined
  const held = new Promise<void>(resolve => { release = resolve })
  await appSupabase(page, () => ({ status: 401, json: { code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist' } }))
  await page.route(`${appAuth}/user`, async route => {
    if (route.request().method() !== 'PUT') return route.fallback()
    await held
    return route.fallback()
  })
  await page.goto(recoveryLink)
  await page.getByLabel('Nova senha', { exact: true }).fill('Abcdef1!')
  await page.getByLabel('Confirmar nova senha').fill('Abcdef1!')
  await page.getByRole('button', { name: 'Salvar nova senha' }).click()
  await expect(page.getByRole('button', { name: 'Salvando…' })).toBeDisabled()
  release()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Esse link venceu')
  await expect(page.locator('form')).toHaveCount(0)
})
