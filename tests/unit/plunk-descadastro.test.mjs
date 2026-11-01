import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// O link do rodapé dos e-mails do Plunk vai para a página de preferências do site pelo Traefik (deploy/plunk/compose.yaml,
// 2026-11-01). A regra só é aplicada na VPS, então a expressão é conferida aqui contra os endereços que o Plunk 0.17.0
// gera: o compose escapa `$` como `$$`, e o Traefik (Go) troca `${1}` pelo grupo, como o `$1` do JavaScript.
const compose = readFileSync(new URL('../../deploy/plunk/compose.yaml', import.meta.url), 'utf8')
const label = name => {
  const line = compose.split(/\r?\n/).find(l => l.trim().startsWith(`${name}:`))
  assert.ok(line, `rótulo ${name} no compose`)
  return line.slice(line.indexOf(':') + 1).trim().replace(/^'(.*)'$/, '$1').replaceAll('$$', '$')
}

const router = label('traefik.http.routers.plunk-descadastro.rule')
const regex = new RegExp(label('traefik.http.middlewares.plunk-descadastro.redirectregex.regex'))
const replacement = label('traefik.http.middlewares.plunk-descadastro.redirectregex.replacement').replace(/\$\{(\d)\}/g, '$$$1')
const path = new RegExp(/PathRegexp\(`([^`]+)`\)/.exec(router)[1])
const redirect = url => (regex.test(url) ? url.replace(regex, replacement) : null)

const contact = '0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e'
const email = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

test('o rodapé do Plunk leva à página de preferências com o contato e o e-mail', () => {
  assert.match(router, /Host\(`email\.keytotwo\.com\.br`\)/)
  assert.equal(redirect(`https://email.keytotwo.com.br/unsubscribe/${contact}?e=${email}`), `https://keytotwo.com.br/email/preferencias?contato=${contact}&e=${email}`)
  // Link antigo, sem o e-mail, ou com outra coisa na query: só o contato (a página trata o e vazio como ausente).
  assert.equal(redirect(`https://email.keytotwo.com.br/unsubscribe/${contact}`), `https://keytotwo.com.br/email/preferencias?contato=${contact}&e=`)
  assert.equal(redirect(`https://email.keytotwo.com.br/unsubscribe/${contact}?utm=x`), `https://keytotwo.com.br/email/preferencias?contato=${contact}&e=`)
  assert.equal(redirect(`https://email.keytotwo.com.br/unsubscribe/${contact}?utm=x&e=${email}`), `https://keytotwo.com.br/email/preferencias?contato=${contact}&e=${email}`)
  // O e-mail que não é UUID não passa adiante.
  assert.equal(redirect(`https://email.keytotwo.com.br/unsubscribe/${contact}?e=<script>`), `https://keytotwo.com.br/email/preferencias?contato=${contact}&e=`)
})

test('só a página de descadastro de um contato sai do painel do Plunk', () => {
  assert.ok(path.test(`/unsubscribe/${contact}`))
  for (const other of ['/', '/auth/login', `/manage/${contact}`, `/subscribe/${contact}`, '/unsubscribe/', '/unsubscribe/abc', `/unsubscribe/${contact}/x`]) {
    assert.equal(path.test(other), false, other)
  }
})
