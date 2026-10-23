import {
  IconArrowBackUp, IconArrowForwardUp, IconBlockquote, IconBold, IconH2, IconH3, IconItalic, IconLibraryPhoto, IconLink,
  IconList, IconListNumbers, IconMarkdown, IconPhoto, IconSeparatorHorizontal,
} from '@tabler/icons-react'
import { Image, type ImageOptions } from '@tiptap/extension-image'
import { Markdown } from '@tiptap/markdown'
import { EditorContent, mergeAttributes, useEditor, useEditorState, type Editor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react'
import { apiMessage } from '../api'
import { acceptedImages, imagePathsIn, mediaUrl, uploadImage } from '../blog'
import { ImageGallery } from './ImageGallery'

// Texto do post (2026-10-23): editor visual que guarda Markdown (TipTap com @tiptap/markdown), o mesmo formato que o
// site lê. Os botões ligam e desligam (negrito de novo tira o negrito) e mostram o que vale onde está o cursor.
// "Markdown" abre o texto cru. Imagens: Imagem (enviar), Galeria (do bucket), arrastar ou colar; a descrição da imagem
// selecionada fica logo abaixo da barra (o site não publica imagem sem descrição).

// No Markdown a imagem fica com o caminho do site (/images/blog/...); no editor, ela aparece pelo endereço do bucket.
const BlogImage = Image.extend<ImageOptions & { mediaBase: string | null }>({
  addOptions() {
    return { ...this.parent!(), mediaBase: null }
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { src: mediaUrl(String(HTMLAttributes.src ?? ''), this.options.mediaBase) })]
  },
})

type Props = { value: string; onChange: (value: string) => void; mediaBase: string | null; cover: string | null; postId?: string; problem?: string }
type Upload = { busy: boolean; text?: string; error?: string }

export function TextEditor({ value, onChange, mediaBase, cover, postId, problem }: Props) {
  const [mode, setMode] = useState<'visual' | 'markdown'>('visual')
  const [upload, setUpload] = useState<Upload>({ busy: false })
  const [gallery, setGallery] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const lastMarkdown = useRef(value)
  const onChangeRef = useRef(onChange)
  const dropRef = useRef<(files: File[], at?: number) => void>(() => {})
  const altInput = useRef<HTMLInputElement>(null)
  // Imagem escolhida na galeria: entra quando o diálogo termina de fechar (ele devolve o foco ao botão ao fechar).
  const picked = useRef<string | null>(null)
  // Depois de pôr uma imagem, o foco vai para a descrição dela assim que ela aparecer selecionada.
  const askAlt = useRef(false)
  const linkInput = useRef<HTMLInputElement>(null)
  const ids = useId()

  // Uma vez só: lista nova a cada render faz o TipTap recriar o editor (e o cursor voltar ao começo) a cada tecla.
  // O endereço do bucket não muda na vida do editor (a página monta outro quando ele chega).
  const [extensions] = useState(() => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        // Sem o que o site não mostra (código, riscado, sublinhado) e sem o parágrafo vazio que o TipTap põe no fim.
        code: false, codeBlock: false, strike: false, underline: false, trailingNode: false,
        link: { openOnClick: false, autolink: false, linkOnPaste: true, HTMLAttributes: { rel: 'noopener', target: null } },
      }),
      BlogImage.configure({ mediaBase }),
      Markdown,
  ])
  const editor = useEditor({
    extensions,
    content: value,
    contentType: 'markdown',
    editorProps: {
      attributes: { id: 'campo-body', class: 'rich-input blog-prose', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Texto do post', 'aria-describedby': 'ajuda-body' },
      // Colar: só a imagem pura (print, "copiar imagem"). Texto copiado com imagem junto (Word, páginas) cola como texto.
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])]
        if (!files.some(file => file.type.startsWith('image/')) || event.clipboardData?.getData('text/plain')) return false
        event.preventDefault()
        dropRef.current(files)
        return true
      },
      // Soltar arquivos: as imagens entram onde o ponteiro está.
      handleDrop: (view, event, _slice, moved) => {
        const files = [...(event.dataTransfer?.files ?? [])]
        if (moved || !files.length) return false
        event.preventDefault()
        dropRef.current(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos)
        return true
      },
    },
    onUpdate: ({ editor: current }) => {
      const markdown = current.getMarkdown()
      lastMarkdown.current = markdown
      onChangeRef.current(markdown)
    },
  })

  useEffect(() => { onChangeRef.current = onChange })
  // O texto mudou por fora (Markdown, conflito, versão salva): o editor visual acompanha.
  useEffect(() => {
    if (!editor || value === lastMarkdown.current) return
    lastMarkdown.current = value
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
  }, [editor, value])

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => current && {
      bold: current.isActive('bold'), italic: current.isActive('italic'), link: current.isActive('link'),
      h2: current.isActive('heading', { level: 2 }), h3: current.isActive('heading', { level: 3 }),
      bullet: current.isActive('bulletList'), ordered: current.isActive('orderedList'), quote: current.isActive('blockquote'),
      image: current.isActive('image'), alt: String(current.getAttributes('image').alt ?? ''),
      undo: current.can().undo(), redo: current.can().redo(),
    },
  })
  const imageSelected = Boolean(state?.image)
  useEffect(() => {
    if (!askAlt.current || !imageSelected) return
    askAlt.current = false
    // No quadro seguinte: o diálogo da galeria devolve o foco ao botão quando fecha.
    requestAnimationFrame(() => altInput.current?.focus())
  }, [imageSelected])
  const linking = link !== null
  useEffect(() => { if (linking) linkInput.current?.focus() }, [linking])

  // As imagens entram juntas onde o ponteiro soltou ou logo depois do cursor (nunca no lugar do que está selecionado),
  // com a descrição vazia. Com uma só, ela fica selecionada para escrever a descrição em seguida.
  function insertImages(current: Editor, paths: string[], at?: number) {
    const nodes = paths.map(src => ({ type: 'image', attrs: { src, alt: '' } }))
    current.chain().focus().insertContentAt(at ?? current.state.selection.to, nodes).run()
    if (paths.length !== 1) return
    let found = -1
    current.state.doc.descendants((child, position) => { if (child.type.name === 'image' && child.attrs.src === paths[0]) found = position })
    askAlt.current = true
    if (found >= 0) current.commands.setNodeSelection(found)
  }
  async function addImages(files: File[], at?: number) {
    if (upload.busy || !editor) return
    const images = files.filter(file => file.type.startsWith('image/'))
    if (!images.length) {
      setUpload({ busy: false, error: 'Só imagens entram no texto: PNG, JPG, WebP, AVIF ou GIF.' })
      return
    }
    const paths: string[] = []
    let failure: string | undefined
    for (const [index, file] of images.entries()) {
      setUpload({ busy: true, text: images.length > 1 ? `Reduzindo e enviando a imagem ${index + 1} de ${images.length}…` : 'Reduzindo e enviando a imagem…' })
      try {
        paths.push((await uploadImage(file)).path)
      } catch (error) {
        failure = images.length > 1 ? `${file.name}: ${apiMessage(error)}` : apiMessage(error)
        break
      }
    }
    // As que subiram antes de uma falha entram mesmo assim (já estão no bucket).
    if (paths.length) insertImages(editor, paths, at)
    setUpload({ busy: false, error: failure, text: !failure && paths.length > 1 ? `${paths.length} imagens no texto. Clique em cada uma para escrever a descrição.` : undefined })
  }
  useEffect(() => { dropRef.current = (files, at) => void addImages(files, at) })

  function pickFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    if (files.length) void addImages(files)
  }
  function applyLink() {
    if (!editor || link === null) return
    const href = link.trim()
    if (!href) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else if (editor.state.selection.empty && !editor.isActive('link')) {
      editor.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    }
    setLink(null)
  }
  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files')

  const tool = (label: string, icon: ReactNode, run: () => void, pressed?: boolean, disabled = false) =>
    <button type="button" className="tool" title={label} aria-label={label} aria-pressed={pressed} disabled={disabled || mode === 'markdown'} onClick={run}>{icon}</button>
  const icon = { size: 18, stroke: 1.75, 'aria-hidden': true } as const
  const chain = () => editor!.chain().focus()

  return <div className={`rich-editor${dropping ? ' is-dropping' : ''}`}
    onDragOver={event => { if (mode === 'visual' && hasFiles(event)) { event.preventDefault(); setDropping(true) } }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false) }}
    onDrop={() => setDropping(false)}>
    <div className="markdown-toolbar" role="toolbar" aria-label="Formatação" aria-controls="campo-body">
      {tool('Subtítulo', <IconH2 {...icon} />, () => chain().toggleHeading({ level: 2 }).run(), state?.h2)}
      {tool('Subtítulo menor', <IconH3 {...icon} />, () => chain().toggleHeading({ level: 3 }).run(), state?.h3)}
      {tool('Negrito (Ctrl+B)', <IconBold {...icon} />, () => chain().toggleBold().run(), state?.bold)}
      {tool('Itálico (Ctrl+I)', <IconItalic {...icon} />, () => chain().toggleItalic().run(), state?.italic)}
      {tool('Link', <IconLink {...icon} />, () => setLink(String(editor?.getAttributes('link').href ?? '')), state?.link)}
      {tool('Lista', <IconList {...icon} />, () => chain().toggleBulletList().run(), state?.bullet)}
      {tool('Lista numerada', <IconListNumbers {...icon} />, () => chain().toggleOrderedList().run(), state?.ordered)}
      {tool('Citação', <IconBlockquote {...icon} />, () => chain().toggleBlockquote().run(), state?.quote)}
      {tool('Divisória', <IconSeparatorHorizontal {...icon} />, () => chain().setHorizontalRule().run())}
      {tool('Desfazer (Ctrl+Z)', <IconArrowBackUp {...icon} />, () => chain().undo().run(), undefined, !state?.undo)}
      {tool('Refazer', <IconArrowForwardUp {...icon} />, () => chain().redo().run(), undefined, !state?.redo)}
      <button type="button" className="tool tool-text" title="Galeria" disabled={upload.busy || mode === 'markdown'} onClick={() => setGallery(true)}>
        <IconLibraryPhoto {...icon} /><span>Galeria</span>
      </button>
      <label className={`tool tool-text${mode === 'markdown' ? ' is-disabled' : ''}`} title="Imagem">
        <IconPhoto {...icon} /><span>{upload.busy ? 'Enviando…' : 'Imagem'}</span>
        <input className="sr-only" type="file" accept={acceptedImages} multiple disabled={upload.busy || mode === 'markdown'} onChange={pickFiles} aria-label="Enviar imagens para o texto" />
      </label>
      <button type="button" className="tool tool-text" aria-pressed={mode === 'markdown'} title="Ver e editar o Markdown" onClick={() => setMode(mode === 'markdown' ? 'visual' : 'markdown')}>
        <IconMarkdown {...icon} /><span>Markdown</span>
      </button>
    </div>
    {link !== null && <div className="editor-bar" role="group" aria-label="Link">
      <label htmlFor={`${ids}-link`}>Endereço do link</label>
      <input ref={linkInput} id={`${ids}-link`} type="url" value={link} onChange={event => setLink(event.target.value)} placeholder="https://"
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applyLink() } if (event.key === 'Escape') setLink(null) }} />
      <button className="button button-secondary" type="button" onClick={applyLink}>{link.trim() ? 'Aplicar' : 'Tirar o link'}</button>
      <button className="text-button" type="button" onClick={() => { setLink(null); editor?.commands.focus() }}>Cancelar</button>
    </div>}
    {mode === 'visual' && state?.image && <div className="editor-bar" role="group" aria-label="Imagem selecionada">
      <label htmlFor={`${ids}-alt`}>Descrição da imagem</label>
      <input ref={altInput} id={`${ids}-alt`} type="text" value={state.alt} placeholder="O que a imagem mostra, para quem não vê"
        onChange={event => editor?.chain().updateAttributes('image', { alt: event.target.value }).run()} />
    </div>}
    {gallery && <ImageGallery purpose="body" postId={postId} current={imagePathsIn(value, cover)} onPick={image => { picked.current = image.path }}
      onClose={() => {
        setGallery(false)
        const path = picked.current
        picked.current = null
        if (path && editor) insertImages(editor, [path])
      }} />}
    <div hidden={mode !== 'visual'} className="rich-frame" aria-invalid={problem ? true : undefined}>
      <EditorContent editor={editor} />
    </div>
    {mode === 'markdown' && <>
      <label className="sr-only" htmlFor="campo-body-markdown">Texto em Markdown</label>
      <textarea id="campo-body-markdown" className="markdown-input" value={value} onChange={event => onChange(event.target.value)} spellCheck
        aria-invalid={problem ? true : undefined} aria-describedby="ajuda-body" />
    </>}
    <p className={`field-help${upload.error ? ' field-help-error' : ''}`} id="ajuda-body" role="status">{upload.error ?? upload.text ?? (dropping
      ? 'Solte para enviar a imagem ao bucket e pôr no texto.'
      : mode === 'markdown'
        ? 'Markdown direto: subtítulo com ##, **negrito**, _itálico_ e [link](https://…). HTML não funciona, como no site.'
        : 'Os botões ligam e desligam: clique de novo para tirar. Imagens: arraste, cole (Ctrl+V) ou use Imagem e Galeria; clique na imagem para escrever a descrição.')}</p>
    {problem && <p className="field-error" id="erro-body">{problem}</p>}
  </div>
}
