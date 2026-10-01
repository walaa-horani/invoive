// Stripe webhook: mirrors subscription state into public.tenant_subscriptions.
//
// Security / correctness guarantees:
// - Authenticity: the raw body is verified against STRIPE_WEBHOOK_SECRET
//   (HMAC-SHA256, 5-minute timestamp tolerance against replays) before
//   anything else is parsed. Events from the wrong mode (test vs live) are
//   rejected.
// - Never trusts the payload: the event only says WHICH subscription changed.
//   Its state is re-fetched from Stripe after taking a sync ticket, so
//   out-of-order, delayed or replayed deliveries all converge on Stripe's
//   current state (see _shared/subscription-sync.ts). Stripe calls happen
//   before any DB transaction.
// - Mirrors Revenue Recovery without re-implementing it: Stripe decides
//   active / past_due / canceled from the Dashboard settings and the database
//   stores that status verbatim.
// - Idempotent: public.apply_subscription_state records event.id in the same
//   transaction as the state change; a redelivered event is a no-op. This
//   handler only reads from Stripe - it never charges or creates anything.
// - Payment-gated: a plan is only granted once an `invoice.paid` event is
//   confirmed by re-fetching the invoice with status 'paid'.
// - Any processing error returns 500 so Stripe retries; reconcile-subscriptions
//   repairs anything that still slips through.
import { withSupabase } from 'npm:@supabase/server@1.8.1'
import { cryptoProvider, requireEnv, type Stripe, stripe } from '../_shared/stripe.ts'
import {
  applySnapshot,
  confirmInvoicePayment,
  IgnoredEvent,
  retrieveSubscription,
  subscriptionIdOf,
  takeSyncTicket,
} from '../_shared/subscription-sync.ts'

const webhookSecret = requireEnv('STRIPE_WEBHOOK_SECRET')
const isLiveKey = /^(sk|rk)_live_/.test(requireEnv('STRIPE_SECRET_KEY'))
const SIGNATURE_TOLERANCE_SECONDS = 300

// Status, plan, period or cancellation changed.
const SUBSCRIPTION_EVENTS = new Set<string>([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
])

// Revenue Recovery steps that may not change subscription.status (a second
// failed retry stays past_due) but do change the latest invoice / next retry.
const INVOICE_SYNC_EVENTS = new Set<string>([
  'invoice.payment_failed',
  'invoice.payment_action_required',
  'invoice.marked_uncollectible',
  'invoice.voided',
])

// Which subscription the event is about, and whether it proves a payment.
async function resolveTarget(event: Stripe.Event) {
  if (SUBSCRIPTION_EVENTS.has(event.type)) {
    return { subscriptionId: (event.data.object as Stripe.Subscription).id, paidAt: null }
  }
  if (event.type === 'invoice.paid') {
    return await confirmInvoicePayment((event.data.object as Stripe.Invoice).id!)
  }
  if (INVOICE_SYNC_EVENTS.has(event.type)) {
    const subscriptionId = subscriptionIdOf(event.data.object as Stripe.Invoice)
    if (!subscriptionId) throw new IgnoredEvent('invoice is not for a subscription')
    return { subscriptionId, paidAt: null }
  }
  return null
}

export default {
  fetch: withSupabase({ auth: 'none' }, async (req, ctx) => {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

    const signature = req.headers.get('stripe-signature')
    if (!signature) return new Response('missing stripe-signature header', { status: 400 })

    // Must be the exact raw bytes Stripe signed: read as text, never re-serialize.
    const body = await req.text()

    let event: Stripe.Event
    try {
      event = await stripe.webhooks.constructEventAsync(
        body,
        signature,
        webhookSecret,
        SIGNATURE_TOLERANCE_SECONDS,
        cryptoProvider,
      )
    } catch (err) {
      console.error('Stripe signature verification failed:', err)
      return new Response('bad signature', { status: 400 })
    }

    if (event.livemode !== isLiveKey) {
      console.error(`Rejected ${event.livemode ? 'live' : 'test'} event ${event.id} on a ${isLiveKey ? 'live' : 'test'} deployment`)
      return new Response('wrong mode', { status: 400 })
    }

    try {
      const target = await resolveTarget(event)
      if (!target) return Response.json({ received: true, ignored: event.type })

      // Ticket first, then read: see _shared/subscription-sync.ts.
      const ticket = await takeSyncTicket(ctx.supabaseAdmin)
      const subscription = await retrieveSubscription(target.subscriptionId)
      const result = await applySnapshot(ctx.supabaseAdmin, {
        ticket,
        subscription,
        eventId: event.id,
        eventType: event.type,
        paymentConfirmedAt: target.paidAt,
      })
      return Response.json({ received: true, result })
    } catch (err) {
      if (err instanceof IgnoredEvent) {
        console.warn(`Ignoring ${event.type} ${event.id}: ${err.message}`)
        return Response.json({ received: true, ignored: err.message })
      }
      console.error(`Failed to process ${event.type} ${event.id}:`, err)
      return new Response('processing failed', { status: 500 })
    }
  }),
}
