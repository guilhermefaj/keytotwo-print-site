import { useRef, useState, type FormEvent } from 'react'
import { profileCopy } from '../../content/account'
import { api, ApiError, apiErrorMessage, type Profile } from '../../lib/api'
import { adultBirthLimit, formatWhatsapp, nameMax, tidyName, toWhatsapp } from '../../lib/profile'

type Field = 'name' | 'birth_date' | 'whatsapp'
const FIELDS: readonly Field[] = ['name', 'birth_date', 'whatsapp']
const emptyProfile: Profile = { name: null, birth_date: null, whatsapp: null, saved: false }

/** Nome, data de nascimento e WhatsApp (PUT /account/profile), todos opcionais. O nome do Google vem preenchido. */
export function ProfileForm({ profile = emptyProfile, onSaved }: { profile?: Profile; onSaved: () => void }) {
  const [name, setName] = useState(profile.name ?? '')
  const [birth, setBirth] = useState(profile.birth_date ?? '')
  const [phone, setPhone] = useState(formatWhatsapp(profile.whatsapp))
  const [maxBirth] = useState(() => adultBirthLimit())
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const nameInput = useRef<HTMLInputElement>(null)
  const birthInput = useRef<HTMLInputElement>(null)
  const phoneInput = useRef<HTMLInputElement>(null)
  const inputs = { name: nameInput, birth_date: birthInput, whatsapp: phoneInput }
  const fromGoogle = !profile.saved && Boolean(profile.name) && name === profile.name

  // As mesmas regras do servidor, para avisar no campo antes de enviar.
  function check() {
    const found: Partial<Record<Field, string>> = {}
    const tidy = tidyName(name)
    if ([...tidy].length > nameMax) found.name = `Use até ${nameMax} letras no nome.`
    if (birthInput.current?.validity.badInput || (birth && birth < '1900-01-01')) found.birth_date = 'Confira a data de nascimento.'
    else if (birth > maxBirth) found.birth_date = 'A conta da KeyToTwo é só para maiores de 18 anos.'
    const whatsapp = phone.trim() ? toWhatsapp(phone) : null
    if (phone.trim() && !whatsapp) found.whatsapp = 'Confira o número: DDD e celular, como (11) 91234-5678. De outro país, comece com +.'
    return { found, body: { name: tidy || null, birth_date: birth || null, whatsapp } }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const { found, body } = check()
    setErrors(found); setError(''); setMessage('')
    const first = FIELDS.find(field => found[field])
    if (first) { inputs[first].current?.focus(); return }
    setBusy(true)
    try {
      const { profile: saved } = await api<{ profile: Profile }>('/account/profile', { method: 'PUT', body })
      setName(saved.name ?? ''); setBirth(saved.birth_date ?? ''); setPhone(formatWhatsapp(saved.whatsapp))
      setMessage(profileCopy.saved)
      onSaved()
    } catch (cause) {
      setError(cause instanceof ApiError && cause.code === 'INVALID_REQUEST' ? 'Confira os campos e tente de novo.' : apiErrorMessage(cause))
    } finally { setBusy(false) }
  }

  // A ajuda do campo e, quando há, o erro dele.
  const describedBy = (field: Field, help?: string) => [help, errors[field] ? `profile-${field}-error` : ''].filter(Boolean).join(' ') || undefined
  const fieldError = (field: Field) => errors[field] ? <p id={`profile-${field}-error`} className="field-error">{errors[field]}</p> : null

  return <form className="account-form profile-form" onSubmit={save} aria-busy={busy} noValidate>
    <div className="profile-field">
      <label htmlFor="profile-name">Nome</label>
      <input ref={nameInput} id="profile-name" name="name" autoComplete="name" value={name} onChange={event => setName(event.target.value)} disabled={busy}
        aria-invalid={errors.name ? true : undefined} aria-describedby={describedBy('name', fromGoogle ? 'profile-name-help' : undefined)} />
      {fromGoogle && <p id="profile-name-help" className="field-help">{profileCopy.fromGoogle}</p>}
      {fieldError('name')}
    </div>
    <div className="profile-field">
      <label htmlFor="profile-birth_date">Data de nascimento</label>
      <input ref={birthInput} id="profile-birth_date" name="birth_date" type="date" autoComplete="bday" min="1900-01-01" max={maxBirth} value={birth} onChange={event => setBirth(event.target.value)} disabled={busy}
        aria-invalid={errors.birth_date ? true : undefined} aria-describedby={describedBy('birth_date', 'profile-birth_date-help')} />
      <p id="profile-birth_date-help" className="field-help">{profileCopy.birthHelp}</p>
      {fieldError('birth_date')}
    </div>
    <div className="profile-field">
      <label htmlFor="profile-whatsapp">WhatsApp</label>
      <input ref={phoneInput} id="profile-whatsapp" name="whatsapp" type="tel" inputMode="tel" autoComplete="tel" placeholder="(11) 91234-5678" value={phone} disabled={busy}
        onChange={event => setPhone(event.target.value)} onBlur={() => { const whatsapp = toWhatsapp(phone); if (whatsapp) setPhone(formatWhatsapp(whatsapp)) }}
        aria-invalid={errors.whatsapp ? true : undefined} aria-describedby={describedBy('whatsapp', 'profile-whatsapp-help')} />
      <p id="profile-whatsapp-help" className="field-help">{profileCopy.whatsappHelp}</p>
      {fieldError('whatsapp')}
    </div>
    <p className="form-error" role="alert">{error}</p>
    <div className="form-actions"><button className="button button-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button></div>
    <p className="form-message" role="status">{message}</p>
  </form>
}
