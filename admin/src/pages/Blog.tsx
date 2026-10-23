import { IconExternalLink, IconPlus, IconTrash } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { api, apiMessage, useResource } from '../api'
import { formatMoment, formatShortDate, type BlogList, type BlogPostSummary } from '../blog'
import { SiteStatus } from '../SiteStatus'
import { siteUrl } from '../supabase'

type Filter = 'all' | 'published' | 'draft'
const filters: { value: Filter; label: string }[] = [{ value: 'all', label: 'Todos' }, { value: 'published', label: 'Publicados' }, { value: 'draft', label: 'Rascunhos' }]

// Lista do blog (2026-10-23): todos os posts, do editado mais recente ao mais antigo, e se o site já tem o que foi publicado.
// Excluir direto na linha: o post some da lista na hora e a versão nova do blog vem na resposta da API.
export function BlogPage() {
  const { data, error, loading, reload } = useResource<BlogList>('/admin/blog/posts')
  const [filter, setFilter] = useState<Filter>('all')
  const locationNotice = (useLocation().state as { notice?: string } | null)?.notice
  const [deleted, setDeleted] = useState<{ ids: string[]; version?: string; notice?: string }>({ ids: [] })
  const noticeRef = useRef<HTMLParagraphElement>(null)
  const posts = (data?.posts ?? []).filter(post => !deleted.ids.includes(post.id))
  const shown = filter === 'all' ? posts : posts.filter(post => post.status === filter)
  const total = (value: Filter) => (value === 'all' ? posts.length : posts.filter(post => post.status === value).length)
  const notice = deleted.notice ?? locationNotice

  function onDeleted(post: BlogPostSummary, version: string) {
    const text = post.status === 'published' ? `“${post.title}” foi excluído e sai do site em 1 ou 2 minutos.` : `“${post.title}” foi excluído.`
    setDeleted(current => ({ ids: [...current.ids, post.id], version, notice: text }))
  }
  // A linha some com o botão em foco: o foco vai para o aviso.
  useEffect(() => { if (deleted.notice) noticeRef.current?.focus() }, [deleted])

  return <>
    <title>Blog — Admin KeyToTwo</title>
    <header className="page-heading page-heading-actions">
      <div>
        <h1>Blog</h1>
        <p>Posts do blog da loja. Rascunhos ficam só aqui; publicados entram no site em 1 ou 2 minutos.</p>
      </div>
      <Link className="button button-primary" to="/blog/novo"><IconPlus aria-hidden="true" size={18} stroke={2} />Novo post</Link>
    </header>
    {notice && <p className="notice" role="status" ref={noticeRef} tabIndex={-1}>{notice}</p>}
    {loading && <p className="status" role="status">Carregando os posts…</p>}
    {!loading && error !== undefined && <div className="status-error" role="alert"><p>{apiMessage(error)}</p><button className="button button-secondary" type="button" onClick={reload}>Tentar de novo</button></div>}
    {data && <>
      <SiteStatus version={deleted.version ?? data.version} hasPublished={posts.some(post => post.status === 'published')} />
      <div className="toolbar">
        <div className="periods" role="group" aria-label="Mostrar">
          {filters.map(({ value, label }) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label} <span className="count">{total(value)}</span></button>)}
        </div>
      </div>
      {posts.length === 0
        ? <div className="empty"><h2>Nenhum post ainda</h2><p>Escreva o primeiro: ele fica como rascunho até você publicar.</p><Link className="button button-secondary" to="/blog/novo">Escrever o primeiro post</Link></div>
        : shown.length === 0
          ? <p className="status">Nenhum post neste filtro.</p>
          : <ul className="post-list" aria-label="Posts">{shown.map(post => <PostRow key={post.id} post={post} onDeleted={onDeleted} />)}</ul>}
    </>}
  </>
}

function PostRow({ post, onDeleted }: { post: BlogPostSummary; onDeleted: (post: BlogPostSummary, version: string) => void }) {
  const published = post.status === 'published'
  const [confirm, setConfirm] = useState<{ busy: boolean; error?: string } | null>(null)
  const opener = useRef<HTMLButtonElement>(null)

  function cancel() {
    setConfirm(null)
    opener.current?.focus()
  }
  async function remove() {
    setConfirm({ busy: true })
    try {
      const result = await api<{ deleted: true; version: string }>(`/admin/blog/posts/${post.id}`, { method: 'DELETE' })
      onDeleted(post, result.version)
    } catch (error) {
      setConfirm({ busy: false, error: apiMessage(error) })
    }
  }

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
    <button ref={opener} className="post-row-link post-row-delete" type="button" aria-expanded={confirm !== null} onClick={() => setConfirm({ busy: false })}>
      <IconTrash aria-hidden="true" size={16} stroke={1.75} /><span className="sr-only">Excluir “{post.title}”</span>
    </button>
    {confirm && <div className="row-confirm" role="group" aria-label={`Confirmar a exclusão de “${post.title}”`}>
      <p>{published ? 'Excluir este post? Ele sai do admin e do site. Não dá para desfazer.' : 'Excluir este rascunho? Não dá para desfazer.'}</p>
      {confirm.error && <p className="field-error" role="alert">{confirm.error}</p>}
      <button className="button button-danger" type="button" disabled={confirm.busy} onClick={() => void remove()}>{confirm.busy ? 'Excluindo…' : 'Excluir de vez'}</button>
      <button className="button button-secondary" type="button" disabled={confirm.busy} onClick={cancel} autoFocus>Cancelar</button>
    </div>}
  </li>
}
