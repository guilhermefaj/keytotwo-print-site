import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync, readFileSync } from 'node:fs'
import { authStorageKey, session } from './session'

// Blog no admin (2026-10-23): lista, criar, editar, publicar, imagens, conflito e excluir. A API do blog é simulada em
// memória (mesmos códigos e formatos de docs/api-contract.md); o bucket e o /blog/versao.json do site também.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test.skip(() => !existsSync('admin/dist/index.html'), 'Requires `npm run build:admin`')

const MEDIA = 'https://blog-teste.s3.teste-001.backblazeb2.com'
const VERSION = 'b'.repeat(32)
type Post = Record<string, unknown> & { id: string; slug: string; status: string; updated_at: string; published_at: string | null }

function post(id: string, extra: Partial<Post> = {}): Post {
  return { id, slug: `post-${id}`, title: `Post ${id}`, description: 'Resumo do post.', author: 'Equipe KeyToTwo', date: '2026-10-20', cover: null, cover_alt: '',
    tags: ['Jogos'], body: '## Começo\n\nTexto do post.', status: 'draft', published_at: null, created_at: '2026-10-20T12:00:00.000001+00:00', updated_at: '2026-10-20T12:00:00.000001+00:00', ...extra }
}

interface Options { posts?: Post[]; liveVersion?: string | null; conflict?: boolean }

// API simulada: guarda os posts, devolve 409 quando a versão aberta não é a atual e registra cada chamada.
async function blogApi(page: Page, { posts = [], liveVersion = VERSION, conflict = false }: Options = {}) {
  const store = new Map(posts.map(item => [item.id, structuredClone(item)]))
  const calls: { method: string; path: string; body: unknown; type?: string }[] = []
  let clock = 0
  const stamp = () => `2026-10-23T12:00:${String(++clock).padStart(2, '0')}.123456+00:00`
  await page.addInitScript(([key, value]) => localStorage.setItem(key, JSON.stringify(value)), [authStorageKey, session('aal2')] as const)
  await page.route('**/auth/v1/**', route => route.fulfill({ json: session('aal2').user }))
  await page.route('**/blog/versao.json', route => (liveVersion ? route.fulfill({ json: { version: liveVersion } }) : route.fulfill({ status: 404, body: '' })))
  await page.route(`${MEDIA}/**`, route => route.fulfill({ contentType: 'image/png', body: readFileSync('public/media/icons/kito-192.png') }))
  await page.route('**/functions/v1/api/admin/blog/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.split('/api')[1]
    const method = request.method()
    const body = method === 'POST' && path === '/admin/blog/images' ? null : request.postDataJSON()
    calls.push({ method, path: `${path}${url.search}`, body, type: request.headers()['content-type'] })
    const id = path.split('/')[4]
    if (path === '/admin/blog/posts' && method === 'GET') {
      return route.fulfill({ json: { version: VERSION, media_base: MEDIA, posts: [...store.values()].map(item => Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'body'))) } })
    }
    if (path === '/admin/blog/posts' && method === 'POST') {
      const created = { ...body.post, id: `novo${store.size + 1}`, published_at: body.post.status === 'published' ? stamp() : null, created_at: stamp(), updated_at: stamp() }
      store.set(created.id, created)
      return route.fulfill({ status: 201, json: { post: created } })
    }
    if (path === '/admin/blog/images') {
      return route.fulfill({ status: 201, json: { path: '/images/blog/2026/10/ab12cd34-mesa.webp', url: `${MEDIA}/2026/10/ab12cd34-mesa.webp` } })
    }
    const current = store.get(id)
    if (!current) return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Post não encontrado.' } } })
    if (method === 'GET') return route.fulfill({ json: { post: current, media_base: MEDIA } })
    if (method === 'DELETE') { store.delete(id); return route.fulfill({ json: { deleted: true } }) }
    if (conflict || body.expected_updated_at !== current.updated_at) {
      const saved = { ...current, title: 'Salvo em outra aba', updated_at: stamp() }
      store.set(id, saved)
      return route.fulfill({ status: 409, json: { error: { code: 'EDIT_CONFLICT', message: 'Este post foi salvo em outro lugar depois que você abriu. Copie o que mudou, recarregue e salve de novo.', details: { post: saved } } } })
    }
    const updated = { ...current, ...body.post, published_at: current.published_at ?? (body.post.status === 'published' ? stamp() : null), updated_at: stamp() }
    store.set(id, updated)
    return route.fulfill({ json: { post: updated } })
  })
  return { calls, store }
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(n => n.target) }))).toEqual([])
}
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test('lista: posts do mais editado ao mais antigo, filtro por status, site em dia e link para o site', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await blogApi(page, { posts: [post('a', { status: 'published', published_at: '2026-10-21T10:00:00Z', title: 'Publicado A' }), post('b', { title: 'Rascunho B' })] })
  await page.goto('/blog')
  await expect(page.getByRole('heading', { level: 1, name: 'Blog' })).toBeVisible()
  const list = page.getByRole('list', { name: 'Posts' })
  await expect(list.locator('.post-row-title')).toHaveText(['Publicado A', 'Rascunho B'])
  await expect(list.locator('.badge')).toHaveText(['Publicado', 'Rascunho'])
  await expect(page.getByRole('status').filter({ hasText: 'O site está em dia' })).toBeVisible()
  await expect(list.getByRole('link', { name: /Ver “Publicado A” no site/ })).toHaveAttribute('href', /\/blog\/post-a$/)
  await axe(page)
  await page.getByRole('button', { name: /Rascunhos/ }).click()
  await expect(list.locator('.post-row-title')).toHaveText(['Rascunho B'])
  await expect(page.getByRole('button', { name: /Rascunhos/ })).toHaveAttribute('aria-pressed', 'true')
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 })
    expect(await noSideScroll(page)).toBe(true)
  }
  await list.getByRole('link', { name: 'Rascunho B' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Editar post' })).toBeVisible()
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue('Rascunho B')
})

test('site atrasado: avisa que está atualizando', async ({ page }) => {
  await blogApi(page, { posts: [post('a', { status: 'published', published_at: '2026-10-21T10:00:00Z' })], liveVersion: 'c'.repeat(32) })
  await page.goto('/blog')
  await expect(page.getByRole('status').filter({ hasText: 'Atualizando o site' })).toBeVisible()
})

test('novo post: endereço sai do título, prévia ao lado, publicar incompleto aponta o que falta; rascunho e depois publicar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { calls } = await blogApi(page, { posts: [post('a', { author: 'Ana Souza' })] })
  await page.goto('/blog')
  await page.getByRole('link', { name: 'Novo post' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Novo post' })).toBeVisible()
  await expect(page.getByLabel('Autor')).toHaveValue('Ana Souza')
  await page.getByLabel('Título', { exact: true }).fill('Jogos para casais: 5 ideias!')
  await expect(page.getByLabel('Endereço')).toHaveValue('jogos-para-casais-5-ideias')
  await page.getByLabel('Autor').fill('')
  await page.getByLabel('Texto em Markdown').fill('# Primeira ideia\n\nUm parágrafo com **negrito**.')
  const preview = page.getByRole('region', { name: 'Prévia do post' })
  await expect(preview.locator('.preview-title')).toHaveText('Jogos para casais: 5 ideias!')
  // O "# " do texto desce para H2, como no site: o título do post é o H1 da página.
  await expect(preview.locator('.blog-prose h2')).toHaveText('Primeira ideia')
  await expect(preview.locator('.blog-prose strong')).toHaveText('negrito')
  await expect(preview.locator('.blog-draft')).toHaveText('Rascunho')

  await page.getByRole('button', { name: 'Publicar' }).click()
  const summary = page.getByRole('alert').filter({ hasText: 'Antes de publicar, corrija' })
  await expect(summary.getByRole('link')).toHaveText(['Escreva o resumo antes de publicar. Ele aparece na lista e no Google.', 'Diga quem escreveu antes de publicar.'])
  await expect(summary).toBeFocused()
  await expect(page.getByLabel('Resumo')).toHaveAttribute('aria-invalid', 'true')
  expect(calls.filter(call => call.method !== 'GET')).toEqual([])
  await axe(page)

  await page.getByRole('button', { name: 'Salvar rascunho' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Rascunho salvo.' })).toBeVisible()
  await expect(page).toHaveURL(/\/blog\/novo2$/)
  const created = calls.find(call => call.method === 'POST')!
  expect(created.body).toEqual({ post: { slug: 'jogos-para-casais-5-ideias', title: 'Jogos para casais: 5 ideias!', description: '', author: '', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), cover: null, cover_alt: '', tags: [], body: '# Primeira ideia\n\nUm parágrafo com **negrito**.', status: 'draft' } })

  await page.getByLabel('Resumo').fill('Cinco ideias para a noite.')
  await page.getByLabel('Autor').fill('Ana Souza')
  await page.getByLabel('Temas').fill('Jogos, Casal')
  await page.getByRole('button', { name: 'Publicar' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Publicado. O post entra no site em poucos minutos.' })).toBeVisible()
  const put = calls.find(call => call.method === 'PUT')!
  expect(put.path).toBe('/admin/blog/posts/novo2')
  expect(put.body).toMatchObject({ expected_updated_at: expect.stringMatching(/^2026-10-23T12:00:\d{2}\.123456\+00:00$/), post: { status: 'published', author: 'Ana Souza', tags: ['Jogos', 'Casal'] } })
  await expect(page.locator('.editor-heading .badge')).toHaveText('Publicado')
  await expect(page.getByLabel('Endereço')).toHaveAttribute('readonly', '')
  await expect(page.getByRole('button', { name: 'Salvar e atualizar o site' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Ver no site/ })).toHaveAttribute('href', /\/blog\/jogos-para-casais-5-ideias$/)
})

test('imagens: a do texto vai reduzida em WebP e entra no Markdown; a capa pede descrição para publicar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { calls } = await blogApi(page, { posts: [post('a')] })
  await page.goto('/blog/a')
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue('Post a')
  await page.getByLabel('Texto em Markdown').press('End')
  await page.getByLabel('Inserir imagem no texto').setInputFiles('public/media/icons/kito-192.png')
  await expect(page.getByLabel('Texto em Markdown')).toHaveValue(/!\[Descreva a imagem\]\(\/images\/blog\/2026\/10\/ab12cd34-mesa\.webp\)/)
  const upload = calls.find(call => call.path.startsWith('/admin/blog/images'))!
  expect([upload.path, upload.type]).toEqual(['/admin/blog/images?name=kito-192.png', 'image/webp'])
  // A descrição provisória fica selecionada: é só digitar por cima.
  await page.keyboard.type('Kito sentado')
  await expect(page.getByLabel('Texto em Markdown')).toHaveValue(/!\[Kito sentado\]\(\/images\/blog\/2026\/10\/ab12cd34-mesa\.webp\)/)
  await expect(page.getByRole('region', { name: 'Prévia do post' }).locator('.blog-prose img')).toHaveAttribute('src', `${MEDIA}/2026/10/ab12cd34-mesa.webp`)

  await page.locator('#campo-capa').setInputFiles('public/media/icons/kito-192.png')
  await expect(page.locator('.cover-thumb')).toHaveAttribute('src', `${MEDIA}/2026/10/ab12cd34-mesa.webp`)
  await page.getByRole('button', { name: 'Publicar' }).click()
  await expect(page.getByRole('alert').getByRole('link', { name: 'Descreva a capa para quem não vê a imagem.' })).toBeVisible()
  await page.getByLabel('Descrição da capa').fill('Mesa com o jogo aberto')
  await page.getByRole('button', { name: 'Publicar' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Publicado.' })).toBeVisible()
  expect(calls.find(call => call.method === 'PUT')!.body).toMatchObject({ post: { cover: '/images/blog/2026/10/ab12cd34-mesa.webp', cover_alt: 'Mesa com o jogo aberto' } })
  await axe(page)
})

test('conflito: outra aba salvou antes; dá para carregar a versão salva', async ({ page }) => {
  await blogApi(page, { posts: [post('a')], conflict: true })
  await page.goto('/blog/a')
  await page.getByLabel('Título', { exact: true }).fill('Meu título')
  await page.getByRole('button', { name: 'Salvar rascunho' }).click()
  await expect(page.getByRole('alert')).toContainText('Este post foi salvo em outro lugar depois que você abriu.')
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue('Meu título')
  await page.getByRole('button', { name: /Carregar a versão salva/ }).click()
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue('Salvo em outra aba')
})

test('sair com mudanças pergunta antes; excluir pede confirmação e volta à lista', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { calls } = await blogApi(page, { posts: [post('a', { title: 'Vai sair' })] })
  await page.goto('/blog/a')
  await page.getByLabel('Título', { exact: true }).fill('Mudei')
  await expect(page.getByText('Mudanças sem salvar')).toBeVisible()
  await page.getByRole('navigation', { name: 'Seções do admin' }).getByRole('link', { name: 'Métricas' }).click()
  const prompt = page.getByRole('alertdialog', { name: /Sair sem salvar/ })
  await expect(prompt).toBeVisible()
  await prompt.getByRole('button', { name: 'Continuar editando' }).click()
  await expect(page).toHaveURL(/\/blog\/a$/)
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue('Mudei')

  await page.getByRole('button', { name: 'Excluir este post' }).click()
  await page.getByRole('group', { name: 'Confirmar exclusão' }).getByRole('button', { name: 'Excluir de vez' }).click()
  await expect(page).toHaveURL(/\/blog$/)
  await expect(page.getByRole('status').filter({ hasText: '“Vai sair” foi excluído.' })).toBeVisible()
  expect(calls.filter(call => call.method === 'DELETE').map(call => call.path)).toEqual(['/admin/blog/posts/a'])
  await expect(page.getByRole('heading', { name: 'Nenhum post ainda' })).toBeVisible()
})

test('celular: escrever e prévia em abas, sem rolagem lateral', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await blogApi(page, { posts: [post('a')] })
  await page.goto('/blog/a')
  await expect(page.getByLabel('Texto em Markdown')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Prévia do post' })).toBeHidden()
  await page.getByRole('button', { name: 'Prévia', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Prévia do post' }).locator('.blog-prose h2')).toHaveText('Começo')
  await expect(page.getByLabel('Texto em Markdown')).toBeHidden()
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 })
    expect(await noSideScroll(page)).toBe(true)
  }
  await axe(page)
})

test('favicon do admin: o K escuro, não o Kito da loja', async ({ page }) => {
  await blogApi(page)
  await page.goto('/blog')
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/favicon.svg')
  const icon = await page.request.get('/favicon.svg')
  expect(icon.status()).toBe(200)
  expect(await icon.text()).toContain('#123a3d')
})
