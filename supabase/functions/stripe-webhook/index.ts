// Stripe webhook: mirrors subscription state into public.tenant_subscriptions.
//
// Security / correctness guarantees:
// - Authenticity: the raw body is verified against STRIPE_WEBHOOK_SECRET
//   (HMAC-SHA256, 5-minute timestamp tolerance against replays) before
//   anything else is parsed. Events from the wrong mode (test vs live) are
//   rejected.
// - Never trusts the payload: the subscription (and invoice) are re-fetched
//   from Stripe, so out-of-order or replayed deliveries apply current state.
//   Stripe calls happen before any DB transaction.
// - Idempotent: public.apply_subscription_state records event.id in the same
//   transaction as the state change; a redelivered event is a no-op. This
//   handler only reads from Stripe - it never charges or creates anything.
// - Payment-gated: a plan is only granted once an `invoice.paid` event is
//   confirmed by re-fetching the invoice with status 'paid'.
// - Any processing error returns 500 so Stripe retries.
import { withSupabase } from 'npm:@supabase/server@1.8.1'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { cryptoProvider, requireEnv, stripe, type Stripe } from '../_shared/stripe.ts'

const webhookSecret = requireEnv('STRIPE_WEBHOOK_SECRET')
const isLiveKey = /^(sk|rk)_live_/.test(requireEnv('STRIPE_SECRET_KEY'))
const SIGNATURE_TOLERANCE_SECONDS = 300

const SUBSCRIPTION_EVENTS = new Set<string>([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
])

class IgnoredEvent extends Error {}

function subscriptionIdOf(invoice: Stripe.Invoice): string | null {
  // Since API 2025-03-31.basil the subscription lives under invoice.parent.
  const subscription = invoice.parent?.subscription_details?.subscription
  if (!subscription) return null
  return typeof subscription === 'string' ? subscription : subscription.id
}

// Returns when the invoice was paid, or throws IgnoredEvent if the event does
// not prove a payment for a subscription.
async function confirmInvoicePayment(eventInvoice: Stripe.Invoice) {
  const invoice = await stripe.invoices.retrieve(eventInvoice.id!)
  if (invoice.status !== 'paid') {
    throw new IgnoredEvent(`invoice ${invoice.id} is ${invoice.status}, not paid`)
  }
  // A trial's opening invoice is $0 and still 'paid' - that is not a payment.
  // (A 100%-off promotion code keeps subtotal > 0, so it does count.)
  if (invoice.subtotal <= 0) {
    throw new IgnoredEvent(`invoice ${invoice.id} had nothing to charge (trial or $0 invoice)`)
  }
  const subscriptionId = subscriptionIdOf(invoice)
  if (!subscriptionId) {
    throw new IgnoredEvent(`invoice ${invoice.id} is not for a subscription`)
  }
  const paidAt = invoice.status_transitions?.paid_at
  return {
    subscriptionId,
    paidAt: new Date((paidAt ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  }
}

async function applySubscription(
  db: SupabaseClient,
  event: Stripe.Event,
  subscriptionId: string,
  paymentConfirmedAt: string | null,
) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId)

  // Plans are single-item subscriptions; anything else is a setup error.
  if (subscription.items.data.length !== 1) {
    throw new Error(`subscription ${subscription.id} has ${subscription.items.data.length} items, expected 1`)
  }
  const item = subscription.items.data[0]
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer.id

  const { data, error } = await db.rpc('apply_subscription_state', {
    p_event_id: event.id,
    p_event_type: event.type,
    p_event_created: new Date(event.created * 1000).toISOString(),
    p_customer_id: customerId,
    p_subscription_id: subscription.id,
    p_price_id: item.price.id,
    p_status: subscription.status,
    // Since API 2025-03-31.basil the billing period lives on the item.
    p_current_period_end: new Date(item.current_period_end * 1000).toISOString(),
    p_cancel_at_period_end: subscription.cancel_at_period_end,
    p_payment_confirmed_at: paymentConfirmedAt,
  })
  if (error) throw new Error(`apply_subscription_state: ${error.message}`)

  if (data === 'applied_replaced_live_subscription') {
    // Two paid subscriptions for one tenant: they are being charged twice.
    console.error(
      `DUPLICATE PAID SUBSCRIPTION for customer ${customerId}: ${subscription.id} replaced an earlier ` +
        'paid subscription. Cancel and refund the extra one in the Stripe Dashboard.',
    )
  }
  return data as string
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
      let result: string
      if (SUBSCRIPTION_EVENTS.has(event.type)) {
        const subscription = event.data.object as Stripe.Subscription
        result = await applySubscription(ctx.supabaseAdmin, event, subscription.id, null)
      } else if (event.type === 'invoice.paid') {
        const { subscriptionId, paidAt } = await confirmInvoicePayment(event.data.object as Stripe.Invoice)
        result = await applySubscription(ctx.supabaseAdmin, event, subscriptionId, paidAt)
      } else {
        return Response.json({ received: true, ignored: event.type })
      }
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
