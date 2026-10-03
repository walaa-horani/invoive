// Stripe Connect webhook: client payments on tenants' connected accounts, and
// the state of those accounts.
//
// Two event destinations point here, each with its own signing secret:
//   STRIPE_CONNECT_WEBHOOK_SECRET       "Connected accounts" scope, snapshot
//                                       events: checkout.session.*, charge.*,
//                                       account.application.deauthorized.
//   STRIPE_CONNECT_THIN_WEBHOOK_SECRET  "Your account" scope, thin events
//                                       v2.core.account[...] (Accounts v2).
//
// Security / correctness:
// - The raw body is verified (HMAC, 5-minute tolerance) before anything else;
//   wrong-mode events are rejected.
// - The payload is never trusted. A snapshot event only says WHICH session
//   and WHICH account; the session is re-read from that account after taking
//   a sync ticket, and public.apply_invoice_payment applies it only to the
//   attempt that stored this exact session id for this exact account. A
//   session the tenant creates by hand in its own Stripe account - with any
//   metadata - changes no invoice (result 'orphan').
// - Idempotent per event id; out-of-order deliveries lose to newer tickets.
// - Processing errors return 500 so Stripe retries; reconcile-invoice-payments
//   repairs what still slips through.
import { withSupabase } from 'npm:@supabase/server@1.8.1'
import { cryptoProvider, requireEnv, type Stripe, stripe } from '../_shared/stripe.ts'
import { sessionIdForPaymentIntent, syncCheckoutSession, syncConnectAccount } from '../_shared/invoice-payments.ts'

const snapshotSecret = requireEnv('STRIPE_CONNECT_WEBHOOK_SECRET')
const thinSecret = requireEnv('STRIPE_CONNECT_THIN_WEBHOOK_SECRET')
const isLiveKey = /^(sk|rk)_live_/.test(requireEnv('STRIPE_SECRET_KEY'))
const SIGNATURE_TOLERANCE_SECONDS = 300

const SESSION_EVENTS = new Set<string>([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
])

const CHARGE_EVENTS = new Set<string>([
  'charge.refunded',
  'charge.refund.updated',
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
])

const ACCOUNT_EVENTS = new Set<string>(['account.updated', 'account.application.deauthorized'])

function idOf(value: string | { id: string } | null | undefined) {
  return typeof value === 'string' ? value : value?.id ?? null
}

async function handleSnapshot(db: Parameters<typeof syncCheckoutSession>[0], event: Stripe.Event) {
  const account = event.account
  if (!account) return 'ignored: not a connected-account event'
  const ref = { id: event.id, type: event.type }

  if (SESSION_EVENTS.has(event.type)) {
    const session = event.data.object as Stripe.Checkout.Session
    return syncCheckoutSession(db, account, session.id, ref)
  }

  if (CHARGE_EVENTS.has(event.type)) {
    const object = event.data.object as Stripe.Charge | Stripe.Dispute | Stripe.Refund
    const paymentIntent = idOf(object.payment_intent as string | { id: string } | null)
    if (!paymentIntent) return 'ignored: no payment intent'
    const sessionId = await sessionIdForPaymentIntent(account, paymentIntent)
    if (!sessionId) return 'ignored: payment did not come from Checkout'
    return syncCheckoutSession(db, account, sessionId, ref)
  }

  if (ACCOUNT_EVENTS.has(event.type)) {
    return syncConnectAccount(db, account, {
      event: ref,
      disconnected: event.type === 'account.application.deauthorized',
    })
  }

  return `ignored: ${event.type}`
}

export default {
  fetch: withSupabase({ auth: 'none' }, async (req, ctx) => {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

    const signature = req.headers.get('stripe-signature')
    if (!signature) return new Response('missing stripe-signature header', { status: 400 })
    const body = await req.text()
    const db = ctx.supabaseAdmin

    // Snapshot event from a connected account?
    let event: Stripe.Event | null = null
    try {
      event = await stripe.webhooks.constructEventAsync(
        body, signature, snapshotSecret, SIGNATURE_TOLERANCE_SECONDS, cryptoProvider)
    } catch {
      event = null
    }

    if (event) {
      if (event.livemode !== isLiveKey) return new Response('wrong mode', { status: 400 })
      try {
        const result = await handleSnapshot(db, event)
        return Response.json({ received: true, result })
      } catch (err) {
        console.error(`Failed to process ${event.type} ${event.id} (${event.account}):`, err)
        return new Response('processing failed', { status: 500 })
      }
    }

    // Otherwise it must be a thin v2 event signed with the other secret.
    let notification: Awaited<ReturnType<typeof stripe.parseEventNotificationAsync>>
    try {
      notification = await stripe.parseEventNotificationAsync(
        body, signature, thinSecret, SIGNATURE_TOLERANCE_SECONDS, cryptoProvider)
    } catch (err) {
      console.error('Stripe signature verification failed for both Connect secrets:', err)
      return new Response('bad signature', { status: 400 })
    }

    if (notification.livemode !== isLiveKey) return new Response('wrong mode', { status: 400 })
    if (!notification.type.startsWith('v2.core.account')) {
      return Response.json({ received: true, ignored: notification.type })
    }
    const accountId = (notification as { related_object?: { id?: string } | null }).related_object?.id
    if (!accountId?.startsWith('acct_')) return Response.json({ received: true, ignored: 'no account' })

    try {
      const result = await syncConnectAccount(db, accountId, {
        event: { id: notification.id, type: notification.type },
        disconnected: notification.type === 'v2.core.account.closed',
      })
      return Response.json({ received: true, result })
    } catch (err) {
      console.error(`Failed to process ${notification.type} ${notification.id}:`, err)
      return new Response('processing failed', { status: 500 })
    }
  }),
}
