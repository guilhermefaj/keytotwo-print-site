// P-15: trigger de senha (data-contract 2.10, D-18) com o GoTrue real e o Mailpit. Ver integration-helpers.ts.
// Regra: senha definida antes da 1ª confirmação do e-mail não vale; a senha criada depois da confirmação vale.
import { assert, assertEquals } from '@std/assert'
import {
  authClient, code, createConfirmedWithPasswordAtOnce, createUser, enabled, lastMail, removeTestUsers, sleep, testEmail, verifyLink,
} from './integration-helpers.ts'

const loginWorks = async (email: string, password: string) => {
  const { data, error } = await authClient().signInWithPassword({ email, password })
  return !error && Boolean(data.session)
}

Deno.test({
  name: 'P-15: senha antes da confirmação, cadastro por código, recuperação, código depois de senha e troca de e-mail',
  ignore: !enabled,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const started = Date.now() - 1000
    const victim = testEmail('p15-vitima')
    const attackerPassword = `Atacante${crypto.randomUUID().slice(0, 6)}1`

    try {
      // Preparação do caso 1: o cadastro do atacante dispara o e-mail de confirmação para a vítima.
      const signUp = await authClient().signUp({ email: victim, password: attackerPassword })
      assertEquals([signUp.error?.code ?? null, Boolean(signUp.data.session)], [null, false])

      await t.step('3. cadastro legítimo: código confirma, a senha criada depois vale', async () => {
        const email = testEmail('p15-legitimo')
        const client = authClient()
        assertEquals((await client.signInWithOtp({ email, options: { shouldCreateUser: true } })).error, null)
        const verified = await client.verifyOtp({ email, token: code(await lastMail(email, started)), type: 'email' })
        assert(verified.data.session, 'código não criou sessão')
        const password = `Legitimo${crypto.randomUUID().slice(0, 6)}1`
        assertEquals((await client.updateUser({ password })).error, null)
        assert(await loginWorks(email, password), 'senha criada depois da confirmação não vale')

        // 5. código depois de senha: entrar por código de novo não apaga a senha.
        const otpAgain = Date.now() - 1000
        const second = authClient()
        assertEquals((await second.signInWithOtp({ email })).error, null)
        assert((await second.verifyOtp({ email, token: code(await lastMail(email, otpAgain)), type: 'email' })).data.session)
        assert(await loginWorks(email, password), 'a senha caiu depois de um login por código')
      })

      await t.step('4. recuperação de senha: a nova vale e a antiga não', async () => {
        const email = testEmail('p15-recuperacao')
        const oldPassword = `Antiga${crypto.randomUUID().slice(0, 6)}1`
        await createUser(email, { password: oldPassword })
        assert(await loginWorks(email, oldPassword), 'usuário confirmado criado pelo admin perdeu a senha')
        const asked = Date.now() - 1000
        const client = authClient()
        assertEquals((await client.resetPasswordForEmail(email)).error, null)
        const mail = await lastMail(email, asked)
        assertEquals(mail.subject, 'Redefina sua senha da KeyToTwo')
        assert((await client.verifyOtp({ email, token: code(mail), type: 'recovery' })).data.session)
        const newPassword = `Nova${crypto.randomUUID().slice(0, 6)}1`
        assertEquals((await client.updateUser({ password: newPassword })).error, null)
        assert(await loginWorks(email, newPassword), 'a nova senha não vale')
        assert(!(await loginWorks(email, oldPassword)), 'a senha antiga continua valendo')
      })

      await t.step('6. troca de e-mail confirmada nos dois endereços: senha e confirmação mantidas', async () => {
        const email = testEmail('p15-troca')
        const newEmail = testEmail('p15-troca-novo')
        const password = `Troca${crypto.randomUUID().slice(0, 6)}1`
        await createUser(email, { password })
        const client = authClient()
        assert((await client.signInWithPassword({ email, password })).data.session)
        const asked = Date.now() - 1000
        assertEquals((await client.updateUser({ email: newEmail })).error, null)
        for (const address of [email, newEmail]) {
          const res = await fetch(verifyLink(await lastMail(address, asked)), { redirect: 'manual' })
          await res.body?.cancel()
          assert(res.status === 303 || res.status === 302, `link de troca de e-mail respondeu ${res.status}`)
        }
        assert(await loginWorks(newEmail, password), 'a senha não vale no e-mail novo')
        assert(!(await loginWorks(email, password)), 'o e-mail antigo continua entrando')
      })

      await t.step('7. admin: senha enviada na criação já confirmada não vale; definida depois, vale', async () => {
        const atOnce = testEmail('p15-admin-junto')
        const password = `Admin${crypto.randomUUID().slice(0, 6)}1`
        await createConfirmedWithPasswordAtOnce(atOnce, password)
        assert(!(await loginWorks(atOnce, password)), 'a trigger não zerou a senha da criação já confirmada')
        const later = testEmail('p15-admin-depois')
        await createUser(later, { password })
        assert(await loginWorks(later, password), 'senha definida depois da confirmação não vale')
      })

      await t.step('1 e 2. senha cadastrada antes da confirmação não vale; a criada depois vale', async () => {
        // O código só sai 60 s depois do e-mail de confirmação do cadastro do atacante.
        await sleep(Math.max(0, started + 62_000 - Date.now()))
        const asked = Date.now() - 1000
        const client = authClient()
        assertEquals((await client.signInWithOtp({ email: victim })).error, null)
        const verified = await client.verifyOtp({ email: victim, token: code(await lastMail(victim, asked)), type: 'email' })
        assert(verified.data.session, 'o código da vítima não criou sessão')
        assert(!(await loginWorks(victim, attackerPassword)), 'TOMADA DE CONTA: a senha do atacante passou a valer')
        const victimPassword = `Vitima${crypto.randomUUID().slice(0, 6)}1`
        assertEquals((await client.updateUser({ password: victimPassword })).error, null)
        assert(await loginWorks(victim, victimPassword), 'a senha criada pela vítima não vale')
      })
    } finally {
      const cleanup = await removeTestUsers()
      console.log(`usuários de teste removidos: ${cleanup.removed}; mantidos pelo banco: ${cleanup.kept}`)
    }
  },
})
