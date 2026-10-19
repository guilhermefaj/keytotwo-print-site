// Direitos do titular contra o banco e o Auth locais (docs/api-contract.md 6.11, data-contract D-28). Ver integration-helpers.ts.
// A Stripe é simulada (stripe-fake.ts): a conta compra, exporta os dados, tenta excluir com checkout aberto e exclui depois de pagar.
import { assert, assertEquals } from '@std/assert'
import { API_URL, enabled, removeTestUsers, settle } from './integration-helpers.ts'
import { buyer, call, deliver, pay, sessionObject, startCheckout } from './stripe-fake.ts'

const subject = (token: string) => JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub as string

Deno.test({
  name: 'integração LGPD: exportar, exclusão recusada com checkout aberto, exclusão com pedido pago e usuário fora do Auth',
  ignore: !enabled || Deno.env.get('KT_STRIPE') === '1',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    try {
      const { email, token } = await buyer('lgpd')
      const session = await startCheckout(token)

      await t.step('checkout aberto: a exclusão é recusada e nada muda', async () => {
        const blocked = await call('/account/delete', token, 'POST', { confirmation: 'EXCLUIR' })
        assertEquals([blocked.status, blocked.body.error.code, blocked.body.error.details], [409, 'ACCOUNT_DELETION_BLOCKED', { reason: 'checkout_open' }])
        assertEquals((await call('/account', token)).status, 200)
      })

      await t.step('depois do pagamento, a cópia dos dados traz conta, pedido, biblioteca e e-mail de entrega', async () => {
        pay(session)
        const paid = await deliver('checkout.session.completed', sessionObject(session))
        assertEquals([paid.status, paid.body.outcome], [200, 'applied'])
        await settle()
        const exported = await call('/account/export', token)
        assertEquals(exported.status, 200)
        assertEquals(exported.body.account.email, email)
        assertEquals(exported.body.orders.map((o: { status: string }) => o.status), ['paid'])
        assert(exported.body.library.length > 0, 'biblioteca vazia na cópia')
        assert(exported.body.emails.some((e: { kind: string }) => e.kind === 'delivery'), 'sem o e-mail de entrega na cópia')
      })

      await t.step('exclusão: 200, o usuário sai do Auth e a sessão antiga não lê mais nada', async () => {
        const deleted = await call('/account/delete', token, 'POST', { confirmation: 'EXCLUIR' })
        assertEquals([deleted.status, deleted.body], [200, { deleted: true }])
        const admin = await fetch(`${API_URL}/auth/v1/admin/users/${subject(token)}`, { headers: { apikey: Deno.env.get('SECRET_KEY') ?? '' } })
        await admin.body?.cancel()
        assertEquals(admin.status, 404)
        // Sessão assinada com chave assimétrica continua válida até expirar, mas o banco já não acha a conta (KT009 → 403);
        // com validação no Auth, a sessão cai na hora (401).
        const account = await call('/account', token)
        assert([401, 403].includes(account.status), `GET /account depois da exclusão: HTTP ${account.status}`)
      })

      await t.step('contestação depois da exclusão: o webhook segue tratando o pedido anonimizado', async () => {
        const dispute = await deliver('charge.dispute.created', { id: `dp_${crypto.randomUUID().slice(0, 8)}`, object: 'dispute', payment_intent: `pi_${session.id.slice(8)}`, reason: 'fraudulent', status: 'needs_response' })
        assertEquals([dispute.status, dispute.body.outcome], [200, 'applied'])
      })
    } finally {
      await removeTestUsers()
    }
  },
})
