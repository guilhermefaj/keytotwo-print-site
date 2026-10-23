import { IconArrowLeft, IconBlockquote, IconBold, IconExternalLink, IconHeading, IconItalic, IconLink, IconList, IconPhoto } from '@tabler/icons-react'
import { useDeferredValue, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Link, useBlocker, useNavigate, useParams } from 'react-router'
import { api, ApiError, apiMessage, useResource } from '../api'
import { acceptedImages, formatDate, mediaUrl, readingMinutes, slugify, today, uploadImage, type BlogList, type BlogPost, type BlogPostInput, type BlogProblem } from '../blog'
import { problemsOf, renderMarkdown } from '../blog-markdown'
import { siteUrl } from '../supabase'

// Editor do blog (2026-10-23): /blog/novo cria, /blog/:id edita. Rascunho guarda o que estiver pronto; publicar confere
// o post inteiro com as regras do build do site. O endereço sai do título até a primeira publicação e depois fica fixo.

type Status = BlogPostInput['status']
type Form = Omit<BlogPostInput, 'status' | 'tags'> & { tags: string }
type Field = BlogProblem['field']

const formOf = (post: BlogPost | null, author = ''): Form => post
  ? { slug: post.slug, title: post.title, description: post.description, author: post.author, date: post.date, cover: post.cover, cover_alt: post.cover_alt, tags: post.tags.join(', '), body: post.body }
  : { slug: '', title: '', description: '', author, date: today(), cover: null, cover_alt: '', tags: '', body: '' }
const inputOf = (form: Form, status: Status): BlogPostInput => ({ ...form, tags: form.tags.split(',').map(tag => tag.trim()).filter(Boolean), status })
const sameForm = (a: Form, b: Form) => JSON.stringify(a) === JSON.stringify(b)

// Logo depois de criar, o post passa direto para o editor do endereço novo, uma vez só (recarregar busca na API).
const handoff = new Map<string, { post: BlogPost; notice: string }>()

// Um editor por endereço: trocar de post (ou de /blog/novo para o post criado) monta tudo de novo.
export function BlogEditorRoute() {
  const { id } = useParams()
  return <BlogEditorPage key={id ?? 'novo'} id={id} />
}

function BlogEditorPage({ id }: { id?: string }) {
  const [fresh] = useState(() => {
    const entry = id ? handoff.get(id) : undefined
    if (id) handoff.delete(id)
    return entry
  })
  if (!id) return <NewPost />
  if (fresh) return <Editor initial={fresh.post} mediaBase={null} notice={fresh.notice} />
  return <ExistingPost id={id} />
}

function NewPost() {
  const { data, error, loading, reload } = useResource<BlogList>('/admin/blog/posts')
  if (loading) return <Loading />
  if (error !== undefined) return <LoadError error={error} reload={reload} />
  // O autor do último post editado já vem preenchido.
  return <Editor initial={null} mediaBase={data!.media_base} defaultAuthor={data!.posts.find(post => post.author)?.author ?? ''} />
}

function ExistingPost({ id }: { id: string }) {
  const { data, error, loading, reload } = useResource<{ post: BlogPost; media_base: string | null }>(`/admin/blog/posts/${id}`)
  if (loading) return <Loading />
  if (error !== undefined) return <LoadError error={error} reload={reload} />
  return <Editor key={data!.post.id} initial={data!.post} mediaBase={data!.media_base} />
}

const Loading = () => <><title>Blog — Admin KeyToTwo</title><BackToList /><p className="status" role="status">Abrindo o post…</p></>

function LoadError({ error, reload }: { error: unknown; reload: () => void }) {
  const missing = error instanceof ApiError && error.code === 'NOT_FOUND'
  return <>
    <title>Blog — Admin KeyToTwo</title>
    <BackToList />
    <div className="status-error" role="alert">
      <p>{missing ? 'Este post não existe mais. Ele pode ter sido excluído.' : apiMessage(error)}</p>
      {!missing && <button className="button button-secondary" type="button" onClick={reload}>Tentar de novo</button>}
    </div>
  </>
}

const BackToList = () => <Link className="back-link" to="/blog"><IconArrowLeft aria-hidden="true" size={18} stroke={1.75} />Todos os posts</Link>

type Busy = null | 'save' | 'publish' | 'unpublish' | 'delete'
type Message = { kind: 'ok' | 'error'; text: string; conflict?: BlogPost }

function Editor({ initial, mediaBase: initialMedia, defaultAuthor = '', notice }: { initial: BlogPost | null; mediaBase: string | null; defaultAuthor?: string; notice?: string }) {
  const navigate = useNavigate()
  const [saved, setSaved] = useState(initial)
  const [form, setForm] = useState(() => formOf(initial, defaultAuthor))
  const [mediaBase, setMediaBase] = useState(initialMedia)
  const [slugTouched, setSlugTouched] = useState(Boolean(initial))
  const [attempt, setAttempt] = useState<Status | null>(null)
  const [serverProblems, setServerProblems] = useState<BlogProblem[]>([])
  const [busy, setBusy] = useState<Busy>(null)
  const [message, setMessage] = useState<Message | null>(notice ? { kind: 'ok', text: notice } : null)
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const summary = useRef<HTMLDivElement>(null)
  const leaving = useRef(false)

  const status: Status = saved?.status ?? 'draft'
  const published = status === 'published'
  const slugLocked = Boolean(saved?.published_at)
  const dirty = !sameForm(form, formOf(saved, saved ? '' : defaultAuthor))
  const problems = attempt ? mergeProblems(problemsOf(inputOf(form, attempt)), serverProblems) : []
  const problem = (field: Field) => problems.find(item => item.field === field)?.message

  // A primeira vista do post salvo traz a base das imagens quando veio pela navegação (sem buscar de novo).
  useEffect(() => {
    if (mediaBase !== null) return
    const controller = new AbortController()
    api<BlogList>('/admin/blog/posts', { signal: controller.signal }).then(list => setMediaBase(list.media_base), () => {})
    return () => controller.abort()
  }, [mediaBase])

  // Sair com mudanças sem salvar: o navegador pergunta (fechar a aba) e o admin também (links da barra).
  const dirtyRef = useRef(dirty)
  useEffect(() => { dirtyRef.current = dirty })
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current && !leaving.current) event.preventDefault() }
    addEventListener('beforeunload', warn)
    return () => removeEventListener('beforeunload', warn)
  }, [])
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirtyRef.current && !leaving.current && currentLocation.pathname !== nextLocation.pathname)

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm(current => {
    const next = { ...current, [key]: value }
    // Enquanto ninguém mexeu no endereço e o post nunca foi publicado, ele acompanha o título.
    if (key === 'title' && !slugTouched && !slugLocked) next.slug = slugify(String(value))
    return next
  })
  const field = (key: Exclude<keyof Form, 'cover'>) => ({
    id: `campo-${key}`, value: form[key] ?? '',
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(key, event.target.value),
    'aria-invalid': problem(key as Field) ? true : undefined,
    'aria-describedby': [problem(key as Field) && `erro-${key}`, `ajuda-${key}`].filter(Boolean).join(' ') || undefined,
  })

  async function save(next: Status) {
    const post = inputOf(form, next)
    setAttempt(next)
    setServerProblems([])
    setMessage(null)
    if (problemsOf(post).length) {
      requestAnimationFrame(() => summary.current?.focus())
      return
    }
    setBusy(next === status ? 'save' : next === 'published' ? 'publish' : 'unpublish')
    try {
      const result = saved
        ? await api<{ post: BlogPost }>(`/admin/blog/posts/${saved.id}`, { method: 'PUT', body: { post, expected_updated_at: saved.updated_at } })
        : await api<{ post: BlogPost }>('/admin/blog/posts', { method: 'POST', body: { post } })
      const text = next === 'draft'
        ? (published ? 'O post voltou para rascunho e sai do site em poucos minutos.' : 'Rascunho salvo.')
        : (published ? 'Alterações salvas. O site atualiza em poucos minutos.' : 'Publicado. O post entra no site em poucos minutos.')
      setAttempt(null)
      if (!saved) {
        leaving.current = true
        handoff.set(result.post.id, { post: result.post, notice: text })
        navigate(`/blog/${result.post.id}`, { replace: true })
        return
      }
      setSaved(result.post)
      setForm(formOf(result.post))
      setMessage({ kind: 'ok', text })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_REQUEST' && Array.isArray(error.details?.problems)) {
        setServerProblems(error.details.problems as BlogProblem[])
        requestAnimationFrame(() => summary.current?.focus())
      } else {
        const conflict = error instanceof ApiError && error.code === 'EDIT_CONFLICT' ? error.details?.post as BlogPost | undefined : undefined
        setMessage({ kind: 'error', text: apiMessage(error), conflict })
      }
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!saved) return
    setBusy('delete')
    try {
      await api(`/admin/blog/posts/${saved.id}`, { method: 'DELETE' })
      leaving.current = true
      navigate('/blog', { state: { notice: published ? `“${saved.title}” foi excluído e sai do site em poucos minutos.` : `“${saved.title}” foi excluído.` } })
    } catch (error) {
      setMessage({ kind: 'error', text: apiMessage(error) })
      setBusy(null)
      setConfirmDelete(false)
    }
  }

  // Ctrl+S (ou ⌘S) salva sem mudar o status.
  const saveRef = useRef(save)
  useEffect(() => { saveRef.current = save })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (!busy) void saveRef.current(status)
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [busy, status])

  const verb = attempt === 'published' ? 'publicar' : 'salvar'
  return <>
    <title>{`${saved ? saved.title : 'Novo post'} — Admin KeyToTwo`}</title>
    <BackToList />
    <header className="page-heading page-heading-actions editor-heading">
      <div>
        <p className={`badge${published ? ' badge-published' : ''}`}>{published ? 'Publicado' : 'Rascunho'}</p>
        <h1>{saved ? 'Editar post' : 'Novo post'}</h1>
      </div>
      {published && saved && <a className="text-link" href={`${siteUrl}/blog/${saved.slug}`} target="_blank" rel="noopener">Ver no site<IconExternalLink aria-hidden="true" size={16} stroke={1.75} /><span className="sr-only"> (abre em nova aba)</span></a>}
    </header>

    {message && <div className={message.kind === 'ok' ? 'notice' : 'status-error'} role={message.kind === 'ok' ? 'status' : 'alert'}>
      <p>{message.text}</p>
      {message.conflict && <button className="button button-secondary" type="button" onClick={() => { setSaved(message.conflict!); setForm(formOf(message.conflict!)); setMessage(null) }}>Carregar a versão salva (descarta o que mudou aqui)</button>}
    </div>}
    {problems.length > 0 && <div className="error-summary" ref={summary} tabIndex={-1} role="alert" aria-labelledby="erros-titulo">
      <h2 id="erros-titulo">Antes de {verb}, corrija:</h2>
      <ul>{problems.map(item => <li key={item.field}><a href={`#campo-${item.field === 'cover' ? 'capa' : item.field}`}>{item.message}</a></li>)}</ul>
    </div>}

    <form className="editor" onSubmit={event => { event.preventDefault(); void save(status) }} noValidate>
      <div className="field field-title">
        <label htmlFor="campo-title">Título</label>
        <input {...field('title')} maxLength={160} autoComplete="off" />
        <FieldError field="title" text={problem('title')} />
      </div>

      <section className="editor-details" aria-label="Dados do post">
        <div className="field">
          <label htmlFor="campo-slug">Endereço</label>
          <div className="slug-input"><span aria-hidden="true">/blog/</span><input {...field('slug')} onChange={event => { setSlugTouched(true); set('slug', event.target.value) }} readOnly={slugLocked} autoComplete="off" spellCheck={false} /></div>
          <p className="field-help" id="ajuda-slug">{slugLocked ? 'Fixo depois da primeira publicação, para não quebrar links.' : 'Sai do título. Pode mudar até a primeira publicação.'}</p>
          <FieldError field="slug" text={problem('slug')} />
        </div>
        <div className="field">
          <label htmlFor="campo-author">Autor</label>
          <input {...field('author')} autoComplete="off" />
          <p className="field-help" id="ajuda-author">Aparece como “Por …” no post.</p>
          <FieldError field="author" text={problem('author')} />
        </div>
        <div className="field">
          <label htmlFor="campo-date">Data</label>
          <input {...field('date')} type="date" />
          <p className="field-help" id="ajuda-date">A data mostrada no post e na ordem da lista.</p>
          <FieldError field="date" text={problem('date')} />
        </div>
        <div className="field field-wide">
          <label htmlFor="campo-description">Resumo</label>
          <textarea {...field('description')} rows={2} />
          <p className="field-help" id="ajuda-description">Aparece na lista do blog e no Google. {form.description.length}/300</p>
          <FieldError field="description" text={problem('description')} />
        </div>
        <div className="field">
          <label htmlFor="campo-tags">Temas</label>
          <input {...field('tags')} autoComplete="off" />
          <p className="field-help" id="ajuda-tags">Separe com vírgula. Até 10.</p>
          <FieldError field="tags" text={problem('tags')} />
        </div>
        <Cover form={form} mediaBase={mediaBase} problem={problem('cover')} altProblem={problem('cover_alt')} onChange={(cover, alt) => setForm(current => ({ ...current, cover, cover_alt: alt ?? current.cover_alt }))} altField={field('cover_alt')} />
      </section>

      <section className="editor-body" aria-labelledby="texto-titulo">
        <div className="editor-body-head">
          <h2 id="texto-titulo">Texto</h2>
          <div className="periods editor-tabs" role="group" aria-label="Mostrar">
            <button type="button" aria-pressed={tab === 'write'} onClick={() => setTab('write')}>Escrever</button>
            <button type="button" aria-pressed={tab === 'preview'} onClick={() => setTab('preview')}>Prévia</button>
          </div>
        </div>
        <div className={`editor-panes editor-panes-${tab}`}>
          <MarkdownEditor value={form.body} onChange={value => set('body', value)} problem={problem('body')} />
          <Preview form={form} status={status} mediaBase={mediaBase} />
        </div>
      </section>

      <div className="editor-actions">
        <p className="editor-state" role="status">{busy ? (busy === 'delete' ? 'Excluindo…' : 'Salvando…') : dirty ? 'Mudanças sem salvar' : saved ? 'Tudo salvo' : ''}</p>
        {published
          ? <>
            <button className="button button-secondary" type="button" disabled={busy !== null} onClick={() => void save('draft')}>{busy === 'unpublish' ? 'Voltando…' : 'Voltar para rascunho'}</button>
            <button className="button button-primary" type="submit" disabled={busy !== null}>{busy === 'save' ? 'Salvando…' : 'Salvar e atualizar o site'}</button>
          </>
          : <>
            <button className="button button-secondary" type="submit" disabled={busy !== null}>{busy === 'save' ? 'Salvando…' : 'Salvar rascunho'}</button>
            <button className="button button-primary" type="button" disabled={busy !== null} onClick={() => void save('published')}>{busy === 'publish' ? 'Publicando…' : 'Publicar'}</button>
          </>}
      </div>
    </form>

    {saved && <section className="danger-zone" aria-labelledby="excluir-titulo">
      <h2 id="excluir-titulo">Excluir post</h2>
      {confirmDelete
        ? <div className="danger-confirm" role="group" aria-label="Confirmar exclusão">
          <p>{published ? 'O post sai do admin e do site. Não dá para desfazer.' : 'O rascunho sai do admin. Não dá para desfazer.'}</p>
          <button className="button button-danger" type="button" disabled={busy !== null} onClick={() => void remove()}>{busy === 'delete' ? 'Excluindo…' : 'Excluir de vez'}</button>
          <button className="button button-secondary" type="button" disabled={busy !== null} onClick={() => setConfirmDelete(false)}>Cancelar</button>
        </div>
        : <button className="text-button text-button-danger" type="button" onClick={() => setConfirmDelete(true)}>Excluir este post</button>}
    </section>}

    {blocker.state === 'blocked' && <div className="leave-prompt" role="alertdialog" aria-modal="false" aria-labelledby="sair-titulo">
      <p id="sair-titulo">Sair sem salvar? As mudanças deste post se perdem.</p>
      <button className="button button-secondary" type="button" onClick={() => blocker.reset()} autoFocus>Continuar editando</button>
      <button className="button button-danger" type="button" onClick={() => blocker.proceed()}>Sair sem salvar</button>
    </div>}
  </>
}

// Problemas do navegador e os que a API devolveu, um por campo (a API pode saber de algo a mais).
function mergeProblems(local: BlogProblem[], server: BlogProblem[]): BlogProblem[] {
  return [...local, ...server.filter(item => !local.some(other => other.field === item.field))]
}

function FieldError({ field, text }: { field: string; text?: string }) {
  return text ? <p className="field-error" id={`erro-${field}`}>{text}</p> : null
}

type AltField = { id: string; value: string; onChange: (event: ChangeEvent<HTMLInputElement>) => void; 'aria-invalid'?: boolean; 'aria-describedby'?: string }

function Cover({ form, mediaBase, problem, altProblem, onChange, altField }: { form: Form; mediaBase: string | null; problem?: string; altProblem?: string; onChange: (cover: string | null, alt?: string) => void; altField: AltField }) {
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false })
  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setState({ busy: true })
    try {
      const { path } = await uploadImage(file)
      onChange(path)
      setState({ busy: false })
    } catch (error) {
      setState({ busy: false, error: apiMessage(error) })
    }
  }
  return <div className="field field-wide cover-field">
    <span className="field-label" id="capa-rotulo">Capa <span className="field-optional">(opcional)</span></span>
    <div className="cover-row">
      {form.cover && <img className="cover-thumb" src={mediaUrl(form.cover, mediaBase)} alt="" width="160" height="107" />}
      <div className="cover-actions">
        <label className="button button-secondary file-button" aria-describedby="capa-rotulo">
          <IconPhoto aria-hidden="true" size={18} stroke={1.75} />{state.busy ? 'Enviando…' : form.cover ? 'Trocar capa' : 'Enviar capa'}
          <input id="campo-capa" className="sr-only" type="file" accept={acceptedImages} disabled={state.busy} onChange={event => void pick(event)} />
        </label>
        {form.cover && <button className="text-button" type="button" onClick={() => onChange(null, '')}>Remover capa</button>}
      </div>
    </div>
    <p className="field-help" role="status">{state.error ?? (state.busy ? 'Reduzindo e enviando a imagem…' : 'Ela é reduzida e convertida para WebP antes de subir.')}</p>
    {problem && <p className="field-error">{problem}</p>}
    {form.cover && <div className="field">
      <label htmlFor="campo-cover_alt">Descrição da capa</label>
      <input {...altField} autoComplete="off" />
      <p className="field-help" id="ajuda-cover_alt">Para quem não vê a imagem: o que ela mostra.</p>
      {altProblem && <p className="field-error" id="erro-cover_alt">{altProblem}</p>}
    </div>}
  </div>
}

type Tool = { label: string; icon: ReactNode } & ({ kind: 'wrap'; before: string; after: string; placeholder: string } | { kind: 'prefix'; mark: string; placeholder: string })
const icon = { size: 18, stroke: 1.75, 'aria-hidden': true } as const
const tools: Tool[] = [
  { label: 'Subtítulo', icon: <IconHeading {...icon} />, kind: 'prefix', mark: '## ', placeholder: 'Subtítulo' },
  { label: 'Negrito', icon: <IconBold {...icon} />, kind: 'wrap', before: '**', after: '**', placeholder: 'texto em negrito' },
  { label: 'Itálico', icon: <IconItalic {...icon} />, kind: 'wrap', before: '_', after: '_', placeholder: 'texto em itálico' },
  { label: 'Link', icon: <IconLink {...icon} />, kind: 'wrap', before: '[', after: '](https://)', placeholder: 'texto do link' },
  { label: 'Lista', icon: <IconList {...icon} />, kind: 'prefix', mark: '- ', placeholder: 'Item' },
  { label: 'Citação', icon: <IconBlockquote {...icon} />, kind: 'prefix', mark: '> ', placeholder: 'Citação' },
]

// Markdown com uma barra de atalhos. As inserções passam pelo histórico do campo (Ctrl+Z desfaz).
function MarkdownEditor({ value, onChange, problem }: { value: string; onChange: (value: string) => void; problem?: string }) {
  const area = useRef<HTMLTextAreaElement>(null)
  const [upload, setUpload] = useState<{ busy: boolean; error?: string }>({ busy: false })

  function insert(text: string, select?: [number, number]) {
    const element = area.current!
    element.focus()
    const start = element.selectionStart
    if (!document.execCommand('insertText', false, text)) {
      element.setRangeText(text, start, element.selectionEnd, 'end')
      onChange(element.value)
    }
    if (select) element.setSelectionRange(start + select[0], start + select[1])
  }
  function wrap(before: string, after: string, placeholder: string) {
    const element = area.current!
    const selected = element.value.slice(element.selectionStart, element.selectionEnd) || placeholder
    insert(`${before}${selected}${after}`, [before.length, before.length + selected.length])
  }
  function prefix(mark: string, placeholder: string) {
    const element = area.current!
    const lineStart = element.value.lastIndexOf('\n', element.selectionStart - 1) + 1
    element.setSelectionRange(lineStart, element.selectionEnd)
    const lines = (element.value.slice(lineStart, element.selectionEnd) || placeholder).split('\n')
    const text = lines.map(line => `${mark}${line.replace(/^(#{1,6} |> |- )/, '')}`).join('\n')
    insert(text, lines.length === 1 ? [mark.length, text.length] : undefined)
  }
  async function image(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUpload({ busy: true })
    try {
      const { path } = await uploadImage(file)
      setUpload({ busy: false })
      const alt = 'Descreva a imagem'
      insert(`\n\n![${alt}](${path})\n\n`, [4, 4 + alt.length])
    } catch (error) {
      setUpload({ busy: false, error: apiMessage(error) })
    }
  }

  function run(tool: Tool) {
    if (tool.kind === 'wrap') wrap(tool.before, tool.after, tool.placeholder)
    else prefix(tool.mark, tool.placeholder)
  }
  return <div className="markdown-editor">
    <div className="markdown-toolbar" role="toolbar" aria-label="Formatação" aria-controls="campo-body">
      {tools.map(tool => <button key={tool.label} type="button" className="tool" title={tool.label} aria-label={tool.label} onClick={() => run(tool)}>{tool.icon}</button>)}
      <label className="tool tool-text" title="Imagem">
        <IconPhoto size={18} stroke={1.75} aria-hidden="true" /><span>{upload.busy ? 'Enviando…' : 'Imagem'}</span>
        <input className="sr-only" type="file" accept={acceptedImages} disabled={upload.busy} onChange={event => void image(event)} aria-label="Inserir imagem no texto" />
      </label>
    </div>
    <label className="sr-only" htmlFor="campo-body">Texto em Markdown</label>
    <textarea ref={area} id="campo-body" className="markdown-input" value={value} onChange={event => onChange(event.target.value)} spellCheck
      aria-invalid={problem ? true : undefined} aria-describedby={['ajuda-body', problem && 'erro-body'].filter(Boolean).join(' ')}
      placeholder={'Escreva em Markdown.\n\n## Um subtítulo\n\nUm parágrafo com **negrito** e um [link](https://keytotwo.com.br).'} />
    <p className="field-help" id="ajuda-body" role="status">{upload.error ?? (upload.busy ? 'Reduzindo e enviando a imagem…' : 'Subtítulos começam em ##. HTML não funciona aqui, como no site.')}</p>
    {problem && <p className="field-error" id="erro-body">{problem}</p>}
  </div>
}

// Prévia com as classes do blog do site (src/blog.css): o post como vai aparecer, imagens vindas do bucket.
function Preview({ form, status, mediaBase }: { form: Form; status: Status; mediaBase: string | null }) {
  const body = useDeferredValue(form.body)
  const tags = form.tags.split(',').map(tag => tag.trim()).filter(Boolean)
  // tabIndex: a prévia rola sozinha, então precisa receber foco para rolar pelo teclado.
  return <section className="preview" aria-label="Prévia do post" tabIndex={0}>
    <article className="blog-post">
      <header className="blog-post-heading">
        <div className="blog-meta">
          {status === 'draft' && <span className="blog-draft">Rascunho</span>}
          {form.date && /^\d{4}-\d{2}-\d{2}$/.test(form.date) && <time dateTime={form.date}>{formatDate(form.date)}</time>}
          <span>{readingMinutes(body)} min de leitura</span>
          {form.author.trim() && <span className="blog-author">Por {form.author.trim()}</span>}
        </div>
        <p className="preview-title">{form.title || 'Sem título'}</p>
        {form.description && <p className="blog-description">{form.description}</p>}
        {tags.length > 0 && <ul className="blog-tags" aria-label="Temas">{tags.map(tag => <li key={tag}>{tag}</li>)}</ul>}
      </header>
      {form.cover && <img className="blog-post-cover" src={mediaUrl(form.cover, mediaBase)} alt={form.cover_alt} width="1200" height="800" />}
      {/* Só o HTML do markdown-it com HTML cru desligado, como no site. */}
      {body.trim() ? <div className="blog-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(body, mediaBase) }} /> : <p className="preview-empty">O texto aparece aqui enquanto você escreve.</p>}
    </article>
  </section>
}
