// Copies a Stripe subscription into public.tenant_subscriptions.
//
// Used by stripe-webhook (one event at a time) and reconcile-subscriptions
// (periodic repair). Both follow the same order:
//   1. take a sync ticket from the database,
//   2. read the subscription from Stripe (never from an event payload),
//   3. call public.apply_subscription_state with that ticket.
// A higher ticket always carries a snapshot at least as new, so the database
// keeps the latest Stripe state whatever order deliveries arrive in.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { stripe, type Stripe } from './stripe.ts'

export class IgnoredEvent extends Error {}

const toIso = (unixSeconds: number | null | undefined) =>
  unixSeconds == null ? null : new Date(unixSeconds * 1000).toISOString()

export async function takeSyncTicket(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.rpc('stripe_sync_ticket')
  if (error) throw new Error(`stripe_sync_ticket: ${error.message}`)
  return Number(data)
}

export function retrieveSubscription(subscriptionId: string) {
  return stripe.subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice'] })
}

export function subscriptionIdOf(invoice: Stripe.Invoice): string | null {
  // Since API 2025-03-31.basil the subscription lives under invoice.parent.
  const subscription = invoice.parent?.subscription_details?.subscription
  if (!subscription) return null
  return typeof subscription === 'string' ? subscription : subscription.id
}

// A real payment: Stripe says paid AND something was charged. A trial's
// opening invoice is $0 and still 'paid'; a 100%-off promotion code keeps
// subtotal > 0, so it counts.
export function isConfirmedPayment(invoice: Stripe.Invoice) {
  return invoice.status === 'paid' && invoice.subtotal > 0
}

export function paidAtOf(invoice: Stripe.Invoice) {
  return toIso(invoice.status_transitions?.paid_at) ?? new Date().toISOString()
}

// Re-fetches the invoice and returns its subscription and payment time, or
// throws IgnoredEvent if it does not prove a payment for a subscription.
export async function confirmInvoicePayment(invoiceId: string) {
  const invoice = await stripe.invoices.retrieve(invoiceId)
  if (!isConfirmedPayment(invoice)) {
    throw new IgnoredEvent(`invoice ${invoice.id} is ${invoice.status} with subtotal ${invoice.subtotal}: not a payment`)
  }
  const subscriptionId = subscriptionIdOf(invoice)
  if (!subscriptionId) throw new IgnoredEvent(`invoice ${invoice.id} is not for a subscription`)
  return { subscriptionId, paidAt: paidAtOf(invoice) }
}

export async function applySnapshot(
  db: SupabaseClient,
  opts: {
    ticket: number
    subscription: Stripe.Subscription
    eventId: string | null
    eventType: string
    paymentConfirmedAt: string | null
  },
): Promise<string> {
  const { subscription } = opts

  // Plans are single-item subscriptions; anything else is a setup error.
  if (subscription.items.data.length !== 1) {
    throw new Error(`subscription ${subscription.id} has ${subscription.items.data.length} items, expected 1`)
  }
  const item = subscription.items.data[0]
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id
  const latestInvoice = typeof subscription.latest_invoice === 'object' ? subscription.latest_invoice : null
  const latestInvoiceId = typeof subscription.latest_invoice === 'string'
    ? subscription.latest_invoice
    : latestInvoice?.id ?? null

  const { data, error } = await db.rpc('apply_subscription_state', {
    p_event_id: opts.eventId,
    p_event_type: opts.eventType,
    p_sync_seq: opts.ticket,
    p_customer_id: customerId,
    p_subscription_id: subscription.id,
    p_price_id: item.price.id,
    p_status: subscription.status,
    // Since API 2025-03-31.basil the billing period lives on the item.
    p_current_period_start: toIso(item.current_period_start),
    p_current_period_end: toIso(item.current_period_end),
    p_cancel_at_period_end: subscription.cancel_at_period_end,
    p_cancel_at: toIso(subscription.cancel_at),
    p_canceled_at: toIso(subscription.canceled_at),
    p_ended_at: toIso(subscription.ended_at),
    p_latest_invoice_id: latestInvoiceId,
    p_latest_invoice_status: latestInvoice?.status ?? null,
    p_next_payment_attempt: toIso(latestInvoice?.next_payment_attempt),
    p_payment_confirmed_at: opts.paymentConfirmedAt,
  })
  if (error) throw new Error(`apply_subscription_state: ${error.message}`)

  const result = data as string
  if (result === 'applied_replaced_live_subscription' || result === 'ignored_duplicate_live_subscription') {
    console.error(
      `DUPLICATE PAID SUBSCRIPTION for customer ${customerId}: ${subscription.id} and the stored subscription ` +
        'are both paid. Cancel and refund the extra one in the Stripe Dashboard.',
    )
  }
  return result
}
