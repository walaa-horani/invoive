// Repairs public.tenant_subscriptions from Stripe, for webhooks that were
// missed, failed for longer than Stripe's 3-day retry window, or arrived
// before this code was deployed.
//
// Server-only (secret key). Run on a schedule (pg_cron, e.g. hourly) and on
// demand: POST {} for every tenant, or {"tenant_id": "<uuid>"} for one.
//
// For each tenant with a Stripe customer: take a sync ticket, list the
// customer's subscriptions from Stripe, apply the most alive one through the
// same RPC as the webhook (no event id, so no idempotency record), and confirm
// payment from Stripe's paid invoices if the webhook never did.
import { withSupabase } from 'npm:@supabase/server@1.8.1'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { type Stripe, stripe } from '../_shared/stripe.ts'
import { applySnapshot, isConfirmedPayment, paidAtOf, SNAPSHOT_EXPAND, takeSyncTicket } from '../_shared/subscription-sync.ts'

const PAGE_SIZE = 200
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEAD = new Set<string>(['canceled', 'incomplete_expired'])
const PAYING = new Set<string>(['active', 'past_due'])

// The subscription the tenant row should show: alive before dead, then newest.
function pickSubscription(subscriptions: Stripe.Subscription[]) {
  return [...subscriptions].sort((a, b) =>
    Number(DEAD.has(a.status)) - Number(DEAD.has(b.status)) || b.created - a.created
  )[0]
}

async function latestConfirmedPaymentAt(subscriptionId: string) {
  for await (const invoice of stripe.invoices.list({ subscription: subscriptionId, status: 'paid', limit: 100 })) {
    if (isConfirmedPayment(invoice)) return paidAtOf(invoice)
  }
  return null
}

async function reconcileTenant(db: SupabaseClient, customerId: string) {
  const ticket = await takeSyncTicket(db)
  const { data: subscriptions } = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 100,
    expand: SNAPSHOT_EXPAND.map((field) => `data.${field}`),
  })
  if (subscriptions.length === 0) return 'no_subscription'

  const paying = subscriptions.filter((s) => PAYING.has(s.status))
  if (paying.length > 1) {
    console.error(
      `DUPLICATE PAID SUBSCRIPTION for customer ${customerId}: ${paying.map((s) => s.id).join(', ')}. ` +
        'Cancel and refund the extra one in the Stripe Dashboard.',
    )
  }

  const subscription = pickSubscription(subscriptions)
  const paidAt = PAYING.has(subscription.status) ? await latestConfirmedPaymentAt(subscription.id) : null
  return applySnapshot(db, {
    ticket,
    subscription,
    eventId: null,
    eventType: 'reconcile',
    paymentConfirmedAt: paidAt,
  })
}

export default {
  fetch: withSupabase({ auth: 'secret' }, async (req, ctx) => {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

    let tenantId: unknown = null
    try {
      const text = await req.text()
      tenantId = text ? JSON.parse(text)?.tenant_id ?? null : null
    } catch {
      return Response.json({ error: 'invalid JSON body' }, { status: 400 })
    }
    if (tenantId !== null && (typeof tenantId !== 'string' || !UUID_RE.test(tenantId))) {
      return Response.json({ error: 'tenant_id must be a UUID' }, { status: 400 })
    }

    const db = ctx.supabaseAdmin
    const results: Record<string, number> = {}
    const failures: { tenant_id: string; error: string }[] = []

    // Keyset pagination over tenants that have a Stripe customer.
    let after = '00000000-0000-0000-0000-000000000000'
    while (true) {
      let query = db
        .from('tenants')
        .select('id, stripe_customer_id')
        .not('stripe_customer_id', 'is', null)
        .gt('id', after)
        .order('id')
        .limit(PAGE_SIZE)
      if (tenantId) query = query.eq('id', tenantId)
      const { data: tenants, error } = await query
      if (error) return Response.json({ error: error.message }, { status: 500 })

      // Sequential on purpose: stays well under Stripe's rate limits.
      for (const tenant of tenants) {
        try {
          const result = await reconcileTenant(db, tenant.stripe_customer_id as string)
          results[result] = (results[result] ?? 0) + 1
        } catch (err) {
          console.error(`reconcile failed for tenant ${tenant.id}:`, err)
          failures.push({ tenant_id: tenant.id, error: err instanceof Error ? err.message : String(err) })
        }
      }
      if (tenants.length < PAGE_SIZE) break
      after = tenants[tenants.length - 1].id
    }

    return Response.json({ results, failures }, { status: failures.length ? 207 : 200 })
  }),
}
