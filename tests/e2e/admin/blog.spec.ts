import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync, readFileSync } from 'node:fs'
import { authStorageKey, session } from './session'

// Blog no admin (2026-10-23): lista, criar, editar, publicar, imagens (botão, galeria do bucket, arrastar e colar,
// apagar do bucket), conflito e excluir (no editor e na lista). A API do blog é simulada em memória (mesmos códigos e formatos de
// docs/api-contract.md); o bucket e o /blog/versao.json do site também.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })
test.skip(() => !existsSync('admin/dist/index.html'), 'Requires `npm run build:admin`')

const MEDIA = 'https://blog-teste.s3.teste-001.backblazeb2.com'
const VERSION = 'b'.repeat(32)
type Post = Record<string, unknown> & { id: string; slug: string; status: string; updated_at: string; published_at: string | null }

function post(id: string, extra: Partial<Post> = {}): Post {
  return { id, slug: `post-${id}`, title: `Post ${id}`, description: 'Resumo do post.', author: 'Equipe KeyToTwo', date: '2026-10-20', cover: null, cover_alt: '',
    tags: ['Jogos'], body: '## Começo\n\nTexto do post.', status: 'draft', published_at: null, created_at: '2026-10-20T12:00:00.000001+00:00', updated_at: '2026-10-20T12:00:00.000001+00:00', ...extra }
}

type Image = { path: string; url: string; size: number; uploaded_at: string; used_by: { id: string; title: string; status: string }[] }
const image = (key: string, uploaded_at: string, size = 48_000, used_by: Image['used_by'] = []): Image => ({ path: `/images/blog/${key}`, url: `${MEDIA}/${key}`, size, uploaded_at, used_by })
// liveVersion 'follow': o site fica logo com a versão do banco (como se o vigia já tivesse reconstruído).
interface Options { posts?: Post[]; liveVersion?: string | null; conflict?: boolean; images?: Image[] }

// API simulada: guarda os posts, devolve 409 quando a versão aberta não é a atual e registra cada chamada. A versão do
// blog muda quando um publicado muda, como no banco.
async function blogApi(page: Page, { posts = [], liveVersion = VERSION, conflict = false, images: initialImages = [] }: Options = {}) {
  const store = new Map(posts.map(item => [item.id, structuredClone(item)]))
  let images = structuredClone(initialImages)
  const calls: { method: string; path: string; body: unknown; type?: string }[] = []
  let clock = 0
  let version = VERSION
  let generation = 0
  let uploads = 0
  const stamp = () => `2026-10-23T12:00:${String(++clock).padStart(2, '0')}.123456+00:00`
  const bump = () => { version = String(++generation).padStart(32, 'c') }
  await page.addInitScript(([key, value]) => localStorage.setItem(key, JSON.stringify(value)), [authStorageKey, session('aal2')] as const)
  await page.route('**/auth/v1/**', route => route.fulfill({ json: session('aal2').user }))
  await page.route('**/blog/versao.json', route => (liveVersion ? route.fulfill({ json: { version: liveVersion === 'follow' ? version : liveVersion } }) : route.fulfill({ status: 404, body: '' })))
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
      return route.fulfill({ json: { version, media_base: MEDIA, posts: [...store.values()].map(item => Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'body'))) } })
    }
    if (path === '/admin/blog/posts' && method === 'POST') {
      const created = { ...body.post, id: `novo${store.size + 1}`, published_at: body.post.status === 'published' ? stamp() : null, created_at: stamp(), updated_at: stamp() }
      store.set(created.id, created)
      if (created.status === 'published') bump()
      return route.fulfill({ status: 201, json: { post: created, version } })
    }
    if (path === '/admin/blog/images' && method === 'GET') return route.fulfill({ json: { images, truncated: false, media_base: MEDIA } })
    if (path === '/admin/blog/images' && method === 'DELETE') {
      images = images.filter(item => item.path !== url.searchParams.get('path'))
      return route.fulfill({ json: { deleted: true } })
    }
    if (path === '/admin/blog/images') {
      const key = `2026/10/ab12cd3${3 + ++uploads}-mesa.webp`
      return route.fulfill({ status: 201, json: { path: `/images/blog/${key}`, url: `${MEDIA}/${key}` } })
    }
    const current = store.get(id)
    if (!current) return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Post não encontrado.' } } })
    if (method === 'GET') return route.fulfill({ json: { post: current, media_base: MEDIA } })
    if (method === 'DELETE') {
      store.delete(id)
      if (current.status === 'published') bump()
      return route.fulfill({ json: { deleted: true, version } })
    }
    if (conflict || body.expected_updated_at !== current.updated_at) {
      const saved = { ...current, title: 'Salvo em outra aba', updated_at: stamp() }
      store.set(id, saved)
      return route.fulfill({ status: 409, json: { error: { code: 'EDIT_CONFLICT', message: 'Este post foi salvo em outro lugar depois que você abriu. Copie o que mudou, recarregue e salve de novo.', details: { post: saved } } } })
    }
    const updated = { ...current, ...body.post, published_at: current.published_at ?? (body.post.status === 'published' ? stamp() : null), updated_at: stamp() }
    store.set(id, updated)
    if (current.status === 'published' || updated.status === 'published') bump()
    return route.fulfill({ json: { post: updated, version } })
  })
  return { calls, store }
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(n => n.target) }))).toEqual([])
}
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
// O texto do post é um editor visual; o botão Markdown mostra o texto cru que vai ser salvo (e volta ao visual).
const richText = (page: Page) => page.getByRole('textbox', { name: 'Texto do post' })
const markdownButton = (page: Page) => page.getByRole('toolbar', { name: 'Formatação' }).getByRole('button', { name: 'Markdown' })
async function markdownOf(page: Page) {
  await markdownButton(page).click()
  const value = await page.getByLabel('Texto em Markdown').inputValue()
  await markdownButton(page).click()
  return value
}

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
  await markdownButton(page).click()
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
  expect(created.body).toEqual({ post: { slug: 'jogos-para-casais-5-ideias', title: 'Jogos para casais: 5 ideias!', description: '', author: '', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), cover: null, cover_alt: '', tags: [], body: '# Primeira ideia\n\nUm parágrafo com **negrito**.', status: 'draft', seo_title: '', seo_description: '' } })

  await page.getByLabel('Resumo').fill('Cinco ideias para a noite.')
  await page.getByLabel('Autor').fill('Ana Souza')
  await page.getByLabel('Temas').fill('Jogos, Casal')
  await page.getByRole('button', { name: 'Publicar' }).click()
  await expect(page.locator('.notice')).toHaveText('Publicado.')
  // O site ainda está com a versão anterior: o aviso acompanha até ele atualizar.
  await expect(page.getByRole('status').filter({ hasText: 'Atualizando o site' })).toBeVisible()
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
  const { calls } = await blogApi(page, { posts: [post('a')], liveVersion: 'follow' })
  await page.goto('/blog/a')
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue('Post a')
  await richText(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.getByLabel('Enviar imagens para o texto').setInputFiles('public/media/icons/kito-192.png')
  // A imagem entra selecionada e o foco vai para a descrição dela.
  const alt = page.getByRole('group', { name: 'Imagem selecionada' }).getByLabel('Descrição da imagem')
  await expect(alt).toBeFocused()
  const upload = calls.find(call => call.path.startsWith('/admin/blog/images'))!
  expect([upload.path, upload.type]).toEqual(['/admin/blog/images?name=kito-192.png', 'image/webp'])
  await page.keyboard.type('Kito sentado')
  await expect(richText(page).locator('img')).toHaveAttribute('src', `${MEDIA}/2026/10/ab12cd34-mesa.webp`)
  expect(await markdownOf(page)).toMatch(/!\[Kito sentado\]\(\/images\/blog\/2026\/10\/ab12cd34-mesa\.webp\)/)
  await expect(page.getByRole('region', { name: 'Prévia do post' }).locator('.blog-prose img')).toHaveAttribute('src', `${MEDIA}/2026/10/ab12cd34-mesa.webp`)

  await page.locator('#campo-capa').setInputFiles('public/media/icons/kito-192.png')
  await expect(page.locator('.cover-thumb')).toHaveAttribute('src', `${MEDIA}/2026/10/ab12cd35-mesa.webp`)
  await page.getByRole('button', { name: 'Publicar' }).click()
  await expect(page.getByRole('alert').getByRole('link', { name: 'Descreva a capa para quem não vê a imagem.' })).toBeVisible()
  await page.getByLabel('Descrição da capa').fill('Mesa com o jogo aberto')
  await page.getByRole('button', { name: 'Publicar' }).click()
  await expect(page.locator('.notice')).toHaveText('Publicado.')
  // O site já está com a versão nova (vigia simulado): o aviso confirma.
  await expect(page.getByRole('status').filter({ hasText: 'O post já está no ar no site, com esta versão.' })).toBeVisible()
  expect(calls.find(call => call.method === 'PUT')!.body).toMatchObject({ post: { cover: '/images/blog/2026/10/ab12cd35-mesa.webp', cover_alt: 'Mesa com o jogo aberto' } })
  await axe(page)
})

test('galeria: as imagens do bucket entram no texto e na capa, sem enviar de novo; procura pelo nome e Esc fecha', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const images = [image('2026/10/aa11bb22-mesa-de-jogo.webp', '2026-10-23T16:00:00.000Z', 31_858), image('2026/10/cc33dd44-kito.webp', '2026-10-22T10:00:00.000Z', 1_500_000), image('2026/09/ee55ff66-capa-antiga.png', '2026-09-30T09:00:00.000Z')]
  const { calls } = await blogApi(page, { posts: [post('a')], images })
  await page.goto('/blog/a')
  await richText(page).click()
  await page.getByRole('toolbar', { name: 'Formatação' }).getByRole('button', { name: 'Galeria' }).click()
  const gallery = page.getByRole('dialog', { name: 'Galeria de imagens' })
  await expect(gallery).toBeVisible()
  await expect(gallery.getByRole('status')).toHaveText('3 imagens')
  await expect(gallery.locator('.gallery-name')).toHaveText(['mesa-de-jogo.webp', 'kito.webp', 'capa-antiga.png'])
  await expect(gallery.locator('.gallery-meta').nth(1)).toContainText('1,4 MB')
  await expect(gallery.getByLabel('Procurar pelo nome do arquivo')).toBeFocused()
  await axe(page)
  await gallery.getByLabel('Procurar pelo nome do arquivo').fill('mesa')
  await expect(gallery.getByRole('status')).toHaveText('1 de 3')
  await gallery.getByRole('button', { name: /^mesa-de-jogo\.webp/ }).click()
  await expect(gallery).toBeHidden()
  await expect(page.getByRole('group', { name: 'Imagem selecionada' }).getByLabel('Descrição da imagem')).toBeFocused()
  await page.keyboard.type('Mesa de jogo')
  expect(await markdownOf(page)).toMatch(/!\[Mesa de jogo\]\(\/images\/blog\/2026\/10\/aa11bb22-mesa-de-jogo\.webp\)/)

  const choose = page.getByRole('button', { name: 'Escolher da galeria' })
  await choose.click()
  const cover = page.getByRole('dialog', { name: 'Escolher a capa' })
  await cover.getByRole('button', { name: /^kito\.webp/ }).click()
  await expect(cover).toBeHidden()
  await expect(page.locator('.cover-thumb')).toHaveAttribute('src', `${MEDIA}/2026/10/cc33dd44-kito.webp`)
  await expect(page.getByLabel('Descrição da capa')).toBeVisible()

  await choose.click()
  await expect(cover).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(cover).toBeHidden()
  await expect(choose).toBeFocused()
  // Escolher da galeria não envia nada: só lista o bucket.
  expect(calls.filter(call => call.path.startsWith('/admin/blog/images')).map(call => call.method)).toEqual(['GET', 'GET', 'GET'])
})

test('galeria: apaga do bucket só o que nenhum post usa, nem o aberto sem salvar; confirma no próprio cartão', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const images = [
    image('2026/10/aa11bb22-livre.webp', '2026-10-23T16:00:00.000Z'),
    image('2026/10/cc33dd44-capa-de-outro.webp', '2026-10-22T10:00:00.000Z', 48_000, [{ id: 'b', title: 'Outro post', status: 'published' }]),
    image('2026/10/ee55ff66-salva.webp', '2026-10-21T10:00:00.000Z'),
    image('2026/10/ab77cd88-digitada.webp', '2026-10-20T10:00:00.000Z'),
  ]
  const { calls } = await blogApi(page, { posts: [post('a', { body: 'Texto.\n\n![Foto](/images/blog/2026/10/ee55ff66-salva.webp)' }), post('b', { title: 'Outro post' })], images })
  await page.goto('/blog/a')
  // Uma imagem posta no texto agora, ainda sem salvar, também conta como deste post.
  await markdownButton(page).click()
  await page.getByLabel('Texto em Markdown').press('ControlOrMeta+End')
  await page.keyboard.type('\n\n![Nova](/images/blog/2026/10/ab77cd88-digitada.webp)')
  await markdownButton(page).click()
  await page.getByRole('toolbar', { name: 'Formatação' }).getByRole('button', { name: 'Galeria' }).click()
  const gallery = page.getByRole('dialog', { name: 'Galeria de imagens' })
  const cards = gallery.locator('.gallery-card')
  await expect(cards.locator('.gallery-use')).toHaveText(['Em uso em “Outro post”', 'Neste post', 'Neste post'])
  await expect(gallery.getByRole('button', { name: /^Apagar/ })).toHaveCount(1)

  const remove = gallery.getByRole('button', { name: 'Apagar livre.webp do bucket' })
  await remove.click()
  const confirm = gallery.getByRole('group', { name: 'Confirmar: apagar livre.webp' })
  await expect(confirm).toContainText('Apagar do bucket? Não dá para desfazer.')
  await expect(confirm.getByRole('button', { name: 'Cancelar' })).toBeFocused()
  await axe(page)
  await confirm.getByRole('button', { name: 'Cancelar' }).click()
  await expect(confirm).toBeHidden()
  await expect(remove).toBeFocused()
  expect(calls.filter(call => call.method === 'DELETE')).toEqual([])

  await remove.click()
  await confirm.getByRole('button', { name: 'Apagar', exact: true }).click()
  const notice = gallery.locator('.gallery-notice')
  await expect(notice).toHaveText('“livre.webp” foi apagada do bucket.')
  await expect(notice).toBeFocused()
  await expect(gallery.locator('.gallery-name')).toHaveText(['capa-de-outro.webp', 'salva.webp', 'digitada.webp'])
  await expect(gallery.locator('.gallery-count')).toHaveText('3 imagens')
  expect(calls.filter(call => call.method === 'DELETE').map(call => call.path)).toEqual([`/admin/blog/images?path=${encodeURIComponent('/images/blog/2026/10/aa11bb22-livre.webp')}`])
  // Apagar não mexe no texto: a galeria continua aberta e o post, como estava.
  await expect(gallery).toBeVisible()
  await page.keyboard.press('Escape')
  expect(await markdownOf(page)).toMatch(/!\[Nova\]\(\/images\/blog\/2026\/10\/ab77cd88-digitada\.webp\)/)
})

test('arrastar e colar: as imagens vão para o bucket e entram no texto; texto colado segue como texto', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { calls } = await blogApi(page, { posts: [post('a', { body: 'Antes.' })] })
  await page.goto('/blog/a')
  const text = richText(page)
  await text.click()
  await page.keyboard.press('ControlOrMeta+End')
  const box = (await text.boundingBox())!
  const inside = { clientX: box.x + box.width / 2, clientY: box.y + 30 }
  // Um PNG de verdade, feito no navegador, num DataTransfer como o do sistema.
  const transfer = (count: number) => page.evaluateHandle(async count => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 40, height: 30 })
    canvas.getContext('2d')!.fillRect(0, 0, 40, 30)
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(png => resolve(png!), 'image/png'))
    const data = new DataTransfer()
    for (let index = 0; index < count; index++) data.items.add(new File([blob], `foto-${index + 1}.png`, { type: 'image/png' }))
    return data
  }, count)

  const pasted = await transfer(1)
  await text.evaluate((element, clipboardData) => element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })), pasted)
  await expect(page.getByRole('group', { name: 'Imagem selecionada' }).getByLabel('Descrição da imagem')).toBeFocused()
  expect(calls.filter(call => call.method === 'POST').map(call => [call.path, call.type])).toEqual([['/admin/blog/images?name=foto-1.png', 'image/webp']])
  expect(await markdownOf(page)).toMatch(/^Antes\.\n\n!\[\]\(\/images\/blog\/2026\/10\/ab12cd34-mesa\.webp\)/)

  const dropped = await transfer(2)
  await text.evaluate((element, [dataTransfer, point]) => {
    element.dispatchEvent(new DragEvent('dragover', { dataTransfer, bubbles: true, cancelable: true, ...point }))
    element.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true, ...point }))
  }, [dropped, inside] as const)
  await expect(page.getByRole('status').filter({ hasText: '2 imagens no texto. Clique em cada uma para escrever a descrição.' })).toBeVisible()
  expect(calls.filter(call => call.method === 'POST')).toHaveLength(3)
  const markdown = await markdownOf(page)
  expect(markdown).toContain('/images/blog/2026/10/ab12cd35-mesa.webp')
  expect(markdown).toContain('/images/blog/2026/10/ab12cd36-mesa.webp')

  // Texto com imagem junto (Word, páginas): cola o texto, sem enviar nada.
  await text.evaluate(element => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', 'Um parágrafo copiado.')
    clipboardData.items.add(new File(['x'], 'figura.png', { type: 'image/png' }))
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  })
  expect(calls.filter(call => call.method === 'POST')).toHaveLength(3)

  // Arquivo que não é imagem: avisa e não envia.
  await text.evaluate((element, point) => {
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(new File(['%PDF'], 'regras.pdf', { type: 'application/pdf' }))
    element.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true, ...point }))
  }, inside)
  await expect(page.locator('#ajuda-body')).toHaveText('Só imagens entram no texto: PNG, JPG, WebP, AVIF ou GIF.')
  expect(calls.filter(call => call.method === 'POST')).toHaveLength(3)
})

test('excluir na lista: confirma na própria linha, o post some na hora e o aviso acompanha o site', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { calls } = await blogApi(page, { posts: [post('a', { status: 'published', published_at: '2026-10-21T10:00:00Z', title: 'Publicado A' }), post('b', { title: 'Rascunho B' })] })
  await page.goto('/blog')
  const list = page.getByRole('list', { name: 'Posts' })
  const remove = list.getByRole('button', { name: 'Excluir “Publicado A”' })
  await remove.click()
  const confirm = list.getByRole('group', { name: 'Confirmar a exclusão de “Publicado A”' })
  await expect(confirm).toContainText('Ele sai do admin e do site. Não dá para desfazer.')
  await expect(confirm.getByRole('button', { name: 'Cancelar' })).toBeFocused()
  await axe(page)
  await confirm.getByRole('button', { name: 'Cancelar' }).click()
  await expect(confirm).toBeHidden()
  await expect(remove).toBeFocused()
  expect(calls.filter(call => call.method === 'DELETE')).toEqual([])

  await remove.click()
  await confirm.getByRole('button', { name: 'Excluir de vez' }).click()
  await expect(list.locator('.post-row-title')).toHaveText(['Rascunho B'])
  const notice = page.locator('.notice')
  await expect(notice).toHaveText('“Publicado A” foi excluído e sai do site em 1 ou 2 minutos.')
  await expect(notice).toBeFocused()
  await expect(page.getByRole('status').filter({ hasText: 'Atualizando o site' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Todos/ })).toContainText('1')
  expect(calls.filter(call => call.method === 'DELETE').map(call => call.path)).toEqual(['/admin/blog/posts/a'])
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 })
    expect(await noSideScroll(page)).toBe(true)
  }
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

test('celular: editor e prévia abrem e fecham (a prévia começa fechada), sem rolagem lateral', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await blogApi(page, { posts: [post('a')] })
  await page.goto('/blog/a')
  const preview = page.getByRole('region', { name: 'Prévia do post' })
  await expect(richText(page)).toBeVisible()
  await expect(preview).toBeHidden()
  await page.getByRole('button', { name: 'Prévia', exact: true }).click()
  await expect(preview.locator('.blog-prose h2')).toHaveText('Começo')
  await expect(richText(page)).toBeVisible()
  await page.getByRole('button', { name: 'Editor', exact: true }).click()
  await expect(richText(page)).toBeHidden()
  // Pelo menos um fica aberto: com só a prévia, o botão dela não fecha.
  await expect(page.getByRole('button', { name: 'Prévia', exact: true })).toBeDisabled()
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 })
    expect(await noSideScroll(page)).toBe(true)
  }
  await axe(page)
})

test('editor visual: os botões ligam e desligam (negrito de novo tira), mostram o que está ativo e o texto sai em Markdown', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await blogApi(page, { posts: [post('a', { body: 'Primeira linha.\n\npalavra' })] })
  await page.goto('/blog/a')
  const toolbar = page.getByRole('toolbar', { name: 'Formatação' })
  const bold = toolbar.getByRole('button', { name: 'Negrito (Ctrl+B)' })
  const italic = toolbar.getByRole('button', { name: 'Itálico (Ctrl+I)' })
  await richText(page).getByText('palavra').selectText()
  await bold.click()
  await expect(bold).toHaveAttribute('aria-pressed', 'true')
  expect(await markdownOf(page)).toBe('Primeira linha.\n\n**palavra**')
  await richText(page).getByText('palavra').selectText()
  await bold.click()
  await expect(bold).toHaveAttribute('aria-pressed', 'false')
  await italic.click()
  await expect(italic).toHaveAttribute('aria-pressed', 'true')
  expect(await markdownOf(page)).toMatch(/^Primeira linha\.\n\n[*_]palavra[*_]$/)
  await richText(page).getByText('palavra').selectText()
  await italic.click()
  await toolbar.getByRole('button', { name: 'Subtítulo', exact: true }).click()
  await expect(toolbar.getByRole('button', { name: 'Subtítulo', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(await markdownOf(page)).toBe('Primeira linha.\n\n## palavra')
  await expect(page.getByRole('region', { name: 'Prévia do post' }).locator('.blog-prose h2')).toHaveText('palavra')
  // Link: o endereço vai numa barra, sem janela do navegador.
  await richText(page).getByText('Primeira linha.').selectText()
  await toolbar.getByRole('button', { name: 'Link' }).click()
  const linkBar = page.getByRole('group', { name: 'Link' })
  await expect(linkBar.getByLabel('Endereço do link')).toBeFocused()
  await linkBar.getByLabel('Endereço do link').fill('https://keytotwo.com.br/loja')
  await linkBar.getByRole('button', { name: 'Aplicar' }).click()
  expect(await markdownOf(page)).toMatch(/\]\(https:\/\/keytotwo\.com\.br\/loja\)/)
  await expect(page.getByText('Mudanças sem salvar')).toBeVisible()
  await axe(page)
})

test('Google e compartilhamento: campos opcionais com a prévia da busca, salvos com o post', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { calls } = await blogApi(page, { posts: [post('a', { title: 'Jogos para a noite de sábado', description: 'Três ideias rápidas.' })] })
  await page.goto('/blog/a')
  const box = page.locator('details.seo-box')
  await expect(box).not.toHaveAttribute('open', '')
  await box.locator('summary').click()
  const google = page.getByRole('group', { name: 'Prévia no Google' })
  await expect(google.locator('.google-title')).toHaveText('Jogos para a noite de sábado — KeyToTwo')
  await expect(google.locator('.google-description')).toHaveText('Três ideias rápidas.')
  await expect(google.locator('.google-url')).toHaveText('keytotwo.com.br › blog › post-a')
  await expect(page.getByLabel('Título no Google')).toHaveAttribute('placeholder', 'Jogos para a noite de sábado')
  await page.getByLabel('Título no Google').fill('Jogos de sábado à noite')
  await page.getByLabel('Descrição no Google').fill('x'.repeat(170))
  await expect(google.locator('.google-title')).toHaveText('Jogos de sábado à noite — KeyToTwo')
  await expect(google.locator('.google-description')).toHaveText(`${'x'.repeat(154)}…`)
  await expect(page.locator('#ajuda-seo_description')).toContainText('Passou de 155: o Google deve cortar o fim.')
  await axe(page)
  await page.getByRole('button', { name: 'Salvar rascunho' }).click()
  await expect(page.locator('.notice')).toHaveText('Rascunho salvo.')
  expect(calls.find(call => call.method === 'PUT')!.body).toMatchObject({ post: { seo_title: 'Jogos de sábado à noite', seo_description: 'x'.repeat(170) } })
})

test('favicon do admin: o K escuro, não o Kito da loja', async ({ page }) => {
  await blogApi(page)
  await page.goto('/blog')
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/favicon.svg')
  const icon = await page.request.get('/favicon.svg')
  expect(icon.status()).toBe(200)
  expect(await icon.text()).toContain('#123a3d')
})
