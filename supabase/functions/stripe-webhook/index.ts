// Stripe webhook: mirrors subscription state into public.tenant_subscriptions.
//
// - Signature verified with STRIPE_WEBHOOK_SECRET.
// - The subscription is re-fetched from Stripe so out-of-order deliveries
//   always apply the latest state. This happens before any DB transaction.
// - public.apply_subscription_state is idempotent on event.id and runs as a
//   single transaction. Any error returns 500 so Stripe retries.
import { withSupabase } from 'npm:@supabase/server@1.8.1'
import { cryptoProvider, requireEnv, stripe, type Stripe } from '../_shared/stripe.ts'

const webhookSecret = requireEnv('STRIPE_WEBHOOK_SECRET')

const SUBSCRIPTION_EVENTS = new Set<string>([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
])

export default {
  fetch: withSupabase({ auth: 'none' }, async (req, ctx) => {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

    const signature = req.headers.get('stripe-signature') ?? ''
    const body = await req.text()

    let event: Stripe.Event
    try {
      event = await stripe.webhooks.constructEventAsync(
        body,
        signature,
        webhookSecret,
        undefined,
        cryptoProvider,
      )
    } catch (err) {
      console.error('Stripe signature verification failed:', err)
      return new Response('bad signature', { status: 400 })
    }

    if (!SUBSCRIPTION_EVENTS.has(event.type)) {
      return Response.json({ received: true, ignored: event.type })
    }

    try {
      const eventSubscription = event.data.object as Stripe.Subscription
      const subscription = await stripe.subscriptions.retrieve(eventSubscription.id)

      // Plans are single-item subscriptions; anything else is a setup error.
      if (subscription.items.data.length !== 1) {
        throw new Error(
          `subscription ${subscription.id} has ${subscription.items.data.length} items, expected 1`,
        )
      }
      const item = subscription.items.data[0]
      const customerId = typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer.id

      const { data, error } = await ctx.supabaseAdmin.rpc('apply_subscription_state', {
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
      })
      if (error) throw new Error(`apply_subscription_state: ${error.message}`)

      return Response.json({ received: true, result: data })
    } catch (err) {
      console.error(`Failed to process ${event.type} ${event.id}:`, err)
      return new Response('processing failed', { status: 500 })
    }
  }),
}
