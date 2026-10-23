import { IconExternalLink, IconPlus } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { apiMessage, useResource } from '../api'
import { formatMoment, formatShortDate, type BlogList, type BlogPostSummary } from '../blog'
import { siteUrl } from '../supabase'

type Filter = 'all' | 'published' | 'draft'
const filters: { value: Filter; label: string }[] = [{ value: 'all', label: 'Todos' }, { value: 'published', label: 'Publicados' }, { value: 'draft', label: 'Rascunhos' }]

// Lista do blog (2026-10-23): todos os posts, do editado mais recente ao mais antigo, e se o site já tem o que foi publicado.
export function BlogPage() {
  const { data, error, loading, reload } = useResource<BlogList>('/admin/blog/posts')
  const [filter, setFilter] = useState<Filter>('all')
  const notice = (useLocation().state as { notice?: string } | null)?.notice
  const posts = data?.posts ?? []
  const shown = filter === 'all' ? posts : posts.filter(post => post.status === filter)
  const total = (value: Filter) => (value === 'all' ? posts.length : posts.filter(post => post.status === value).length)

  return <>
    <title>Blog — Admin KeyToTwo</title>
    <header className="page-heading page-heading-actions">
      <div>
        <h1>Blog</h1>
        <p>Posts do blog da loja. Rascunhos ficam só aqui; publicados entram no site em poucos minutos.</p>
      </div>
      <Link className="button button-primary" to="/blog/novo"><IconPlus aria-hidden="true" size={18} stroke={2} />Novo post</Link>
    </header>
    {notice && <p className="notice" role="status">{notice}</p>}
    {loading && <p className="status" role="status">Carregando os posts…</p>}
    {!loading && error !== undefined && <div className="status-error" role="alert"><p>{apiMessage(error)}</p><button className="button button-secondary" type="button" onClick={reload}>Tentar de novo</button></div>}
    {data && <>
      <SiteStatus version={data.version} hasPublished={posts.some(post => post.status === 'published')} />
      <div className="toolbar">
        <div className="periods" role="group" aria-label="Mostrar">
          {filters.map(({ value, label }) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label} <span className="count">{total(value)}</span></button>)}
        </div>
      </div>
      {posts.length === 0
        ? <div className="empty"><h2>Nenhum post ainda</h2><p>Escreva o primeiro: ele fica como rascunho até você publicar.</p><Link className="button button-secondary" to="/blog/novo">Escrever o primeiro post</Link></div>
        : shown.length === 0
          ? <p className="status">Nenhum post neste filtro.</p>
          : <ul className="post-list" aria-label="Posts">{shown.map(post => <PostRow key={post.id} post={post} />)}</ul>}
    </>}
  </>
}

function PostRow({ post }: { post: BlogPostSummary }) {
  const published = post.status === 'published'
  return <li className="post-row">
    <div className="post-row-main">
      <Link className="post-row-title" to={`/blog/${post.id}`}>{post.title}</Link>
      <span className="post-row-slug">/blog/{post.slug}</span>
    </div>
    <span className={`badge${published ? ' badge-published' : ''}`}>{published ? 'Publicado' : 'Rascunho'}</span>
    <dl className="post-row-meta">
      <div><dt>Data</dt><dd><time dateTime={post.date}>{formatShortDate(post.date)}</time></dd></div>
      <div><dt>Autor</dt><dd>{post.author || '—'}</dd></div>
      <div><dt>Editado</dt><dd><time dateTime={post.updated_at}>{formatMoment(post.updated_at)}</time></dd></div>
    </dl>
    {published
      ? <a className="post-row-link" href={`${siteUrl}/blog/${post.slug}`} target="_blank" rel="noopener"><IconExternalLink aria-hidden="true" size={16} stroke={1.75} /><span className="sr-only">Ver “{post.title}” no site (abre em nova aba)</span></a>
      : <span className="post-row-link" aria-hidden="true" />}
  </li>
}

// O site guarda a versão do blog que foi para o ar (/blog/versao.json); igual à do banco, está em dia.
// Enquanto difere, confere de novo a cada 20 s: o vigia da VPS reconstrói o site em poucos minutos.
type Sync = 'checking' | 'synced' | 'pending' | 'unknown'
function SiteStatus({ version, hasPublished }: { version: string; hasPublished: boolean }) {
  const [state, setState] = useState<{ version: string; sync: Sync }>({ version, sync: 'checking' })
  const sync = state.version === version ? state.sync : 'checking'
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    const check = () => fetch(`${siteUrl}/blog/versao.json`, { cache: 'no-store', signal: controller.signal })
      .then(response => (response.ok ? response.json() : null))
      .then((live: { version?: string } | null) => {
        const next: Sync = !live?.version ? 'unknown' : live.version === version ? 'synced' : 'pending'
        setState({ version, sync: next })
        if (next === 'pending') timer = setTimeout(check, 20_000)
      }, () => { if (!controller.signal.aborted) setState({ version, sync: 'unknown' }) })
    void check()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [version])
  if (sync === 'checking' || (sync === 'unknown' && !hasPublished)) return null
  const text = sync === 'synced' ? 'O site está em dia com os posts publicados.'
    : sync === 'pending' ? 'Atualizando o site com as últimas mudanças. Leva poucos minutos; esta mensagem some quando terminar.'
      : 'Não deu para conferir se o site já tem as últimas mudanças.'
  return <p className={`site-sync site-sync-${sync}`} role="status"><span aria-hidden="true" className="site-sync-dot" />{text}</p>
}
