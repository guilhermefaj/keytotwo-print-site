import { handleStripeWebhook } from './handler.ts'

Deno.serve(handleStripeWebhook)
