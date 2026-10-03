// Mirrors client payments (Checkout Sessions on tenants' connected accounts)
// and the connected accounts themselves into the database.
//
// Same rules as subscription-sync.ts: take a sync ticket, THEN read the
// current state from Stripe, then hand it to a SECURITY DEFINER function
// that skips anything older than what it already has. The event payload only
// says WHICH object changed; its content is never trusted.
//
// Every read on a connected account passes `stripeAccount` explicitly. The
// database matches a session to an invoice only through the session id it
// stored for that exact account, so a session created (or forged) directly
// in a tenant's own Stripe account can never touch any invoice.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { type Stripe, stripe } from './stripe.ts'
import { takeSyncTicket } from './subscription-sync.ts'

async function disputeStatusOf(charge: Stripe.Charge | null, stripeAccount: string) {
  if (!charge?.disputed) return null
  const { data } = await stripe.disputes.list({ charge: charge.id, limit: 1 }, { stripeAccount })
  return data[0]?.status ?? 'needs_response'
}

// Re-reads one Checkout Session from the connected account and applies it.
export async function syncCheckoutSession(
  db: SupabaseClient,
  stripeAccount: string,
  sessionId: string,
  event: { id: string; type: string } | null,
) {
  const ticket = await takeSyncTicket(db)
  const session = await stripe.checkout.sessions.retrieve(
    sessionId,
    { expand: ['payment_intent.latest_charge'] },
    { stripeAccount },
  )
  const intent = typeof session.payment_intent === 'object' ? session.payment_intent : null
  const charge = intent && typeof intent.latest_charge === 'object' ? intent.latest_charge : null

  const { data, error } = await db.rpc('apply_invoice_payment', {
    p_sync_seq: ticket,
    p_event_id: event?.id ?? null,
    p_event_type: event?.type ?? 'reconcile',
    p_account_id: stripeAccount,
    p_session_id: session.id,
    p_session_status: session.status,
    p_payment_status: session.payment_status,
    p_amount_total: session.amount_total,
    p_currency: session.currency,
    p_payment_intent_id: intent?.id ?? (typeof session.payment_intent === 'string' ? session.payment_intent : null),
    p_payment_intent_status: intent?.status ?? null,
    p_amount_refunded: charge?.amount_refunded ?? 0,
    p_dispute_status: await disputeStatusOf(charge, stripeAccount),
    p_paid_at: charge?.created ? new Date(charge.created * 1000).toISOString() : null,
  })
  if (error) throw new Error(`apply_invoice_payment: ${error.message}`)
  return data as string
}

// The Checkout Session that produced a PaymentIntent (for charge.* events).
export async function sessionIdForPaymentIntent(stripeAccount: string, paymentIntentId: string) {
  const { data } = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 }, { stripeAccount })
  return data[0]?.id ?? null
}

// Re-reads a connected account (Accounts v2) and mirrors whether it can take
// card payments.
export async function syncConnectAccount(
  db: SupabaseClient,
  accountId: string,
  opts: { event?: { id: string; type: string } | null; disconnected?: boolean } = {},
) {
  const ticket = await takeSyncTicket(db)
  let disconnected = opts.disconnected ?? false
  let cardPayments: string | null = null
  let requirementsDue = false
  let currency: string | null = null

  if (!disconnected) {
    const account = await stripe.v2.core.accounts.retrieve(accountId, {
      include: ['configuration.merchant', 'requirements', 'defaults'],
    })
    disconnected = account.closed === true
    cardPayments = account.configuration?.merchant?.capabilities?.card_payments?.status ?? null
    requirementsDue = (account.requirements?.entries ?? []).some((entry) =>
      entry.awaiting_action_from === 'user' &&
      (entry.minimum_deadline.status === 'currently_due' || entry.minimum_deadline.status === 'past_due')
    )
    currency = account.defaults?.currency ?? null
  }

  const { data, error } = await db.rpc('apply_connect_account', {
    p_sync_seq: ticket,
    p_account_id: accountId,
    p_card_payments_status: cardPayments,
    p_details_submitted: !requirementsDue,
    p_requirements_due: requirementsDue,
    p_default_currency: currency,
    p_disconnected: disconnected,
    p_event_id: opts.event?.id ?? null,
    p_event_type: opts.event?.type ?? null,
  })
  if (error) throw new Error(`apply_connect_account: ${error.message}`)
  return data as string
}
