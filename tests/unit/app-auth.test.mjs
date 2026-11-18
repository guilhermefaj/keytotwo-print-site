import assert from 'node:assert/strict'
import test from 'node:test'
import { callbackState, passwordMeetsRules, readAppAuthParams, recoverFailure, recoverTokens } from '../../src/lib/app-auth.ts'
import { appSupabase } from '../../src/content/app-auth.ts'

// Páginas de conta do app KeyToTwo (2026-11-18): o que chega do Supabase do app no fim da URL.
const params = hash => readAppAuthParams('', hash)

test('a chave do app é só a publicável, do projeto do app', () => {
  assert.equal(appSupabase.url, 'https://wbvzrfzexcptlusxehvi.supabase.co')
  // Nunca a secreta (sb_secret_) nem a service_role (JWT): a página roda no navegador de qualquer pessoa.
  assert.match(appSupabase.publishableKey, /^sb_publishable_[A-Za-z0-9_-]{10,}$/)
})

test('/auth/callback escolhe a mensagem pelo fragmento; o erro vence', () => {
  assert.equal(callbackState(params('#access_token=a&refresh_token=b&expires_in=3600&token_type=bearer&type=signup')), 'signup')
  assert.equal(callbackState(params('#access_token=a&refresh_token=b')), 'signup')
  assert.equal(callbackState(params('#access_token=a&refresh_token=b&type=email_change')), 'email_change')
  assert.equal(callbackState(params('#message=Confirmation+link+accepted.+Please+proceed+to+confirm+link+sent+to+the+other+email')), 'message')
  assert.equal(callbackState(params('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')), 'error')
  assert.equal(callbackState(params('#error_code=otp_expired')), 'error')
  assert.equal(callbackState(params('#access_token=a&type=signup&error=access_denied')), 'error')
  assert.equal(callbackState(readAppAuthParams('?error=access_denied&error_code=otp_expired', '')), 'error')
  assert.equal(callbackState(params('')), 'empty')
  assert.equal(callbackState(params('#type=magiclink&access_token=a')), 'empty')
})

test('/auth/recover só abre o formulário com link de recuperação completo e sem erro', () => {
  assert.deepEqual(recoverTokens(params('#access_token=a&refresh_token=b&expires_in=3600&token_type=bearer&type=recovery')), { access_token: 'a', refresh_token: 'b' })
  assert.equal(recoverTokens(params('#error=access_denied&error_code=otp_expired')), null)
  assert.equal(recoverTokens(params('#access_token=a&refresh_token=b&type=signup')), null)
  assert.equal(recoverTokens(params('#access_token=a&type=recovery')), null)
  assert.equal(recoverTokens(params('#refresh_token=b&type=recovery')), null)
  assert.equal(recoverTokens(params('#access_token=a&refresh_token=b&type=recovery&error_code=otp_expired')), null)
  assert.equal(recoverTokens(params('')), null)
})

test('senha: 8+ com minúscula, maiúscula, número e um símbolo aceito pelo Supabase', () => {
  assert.equal(passwordMeetsRules('Abcdef1!'), true)
  assert.equal(passwordMeetsRules('Abc de1~xyz'), true)
  assert.equal(passwordMeetsRules('Abcde1!'), false, '7 caracteres')
  assert.equal(passwordMeetsRules('abcdef1!'), false, 'sem maiúscula')
  assert.equal(passwordMeetsRules('ABCDEF1!'), false, 'sem minúscula')
  assert.equal(passwordMeetsRules('Abcdefg!'), false, 'sem número')
  assert.equal(passwordMeetsRules('Abcdefg1'), false, 'sem símbolo')
  assert.equal(passwordMeetsRules('Abcdefg1 '), false, 'espaço não é símbolo para o Supabase')
  assert.equal(passwordMeetsRules(''), false)
})

test('erro do Supabase vira um caso da página, nunca o texto em inglês', () => {
  assert.equal(recoverFailure({ code: 'same_password', status: 422 }), 'same')
  assert.equal(recoverFailure({ code: 'weak_password', status: 422 }), 'weak')
  assert.equal(recoverFailure({ name: 'AuthWeakPasswordError', status: 422 }), 'weak')
  for (const error of [{ status: 401 }, { status: 403 }, { code: 'session_not_found', status: 404 }, { code: 'bad_jwt', status: 401 }, { name: 'AuthSessionMissingError', status: 400 }]) {
    assert.equal(recoverFailure(error), 'expired', JSON.stringify(error))
  }
  assert.equal(recoverFailure({ name: 'AuthRetryableFetchError', status: 0 }), 'other')
  assert.equal(recoverFailure(new TypeError('Failed to fetch')), 'other')
  assert.equal(recoverFailure(null), 'other')
})
