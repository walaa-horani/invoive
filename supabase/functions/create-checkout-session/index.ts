// Starts a Stripe Checkout Session for a tenant's first subscription.
//
// - Caller must be signed in and be the tenant's owner or admin.
// - The client sends a plan code, never a price ID: the price is looked up in
//   public.plan_prices (synced from Supabase secrets).
// - Customers can enter promotion codes (e.g. LAUNCH20) on the Checkout page.
// - No double charges: Stripe itself is checked for an existing (or pending)
//   subscription, an open session for the same price is reused, other open
//   sessions are expired, and a per-minute idempotency key collapses
//   double-clicks into one session. Plan changes for existing subscribers go
//   through the change-plan function.
// - Nothing is written about the subscription here: it is recorded only by
//   the stripe-webhook function, and access is granted only after invoice.paid.
import { withSupabase } from 'npm:@supabase/server@1.8.1'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  appUrl,
  billingCors,
  errorResponse,
  HttpError,
  loadBillingContext,
  readBillingRequest,
  withPlanChangeLease,
} from '../_shared/billing-context.ts'
import { requireEnv, stripe } from '../_shared/stripe.ts'

// Any of these means the customer already has, or is about to have, a paid
// subscription. `incomplete` = first payment still processing (e.g. 3-D Secure).
const BLOCKING_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete'])

// Testing only: with STRIPE_TEST_CLOCKS=true and a test-mode key, every new
// customer gets its own Stripe test clock, so renewals and scheduled
// downgrades can be tried by advancing the clock in the Stripe Dashboard
// (Billing > Test clocks). Never used with a live key.
async function testClockFor(tenant: { id: string; name: string }) {
  if (Deno.env.get('STRIPE_TEST_CLOCKS') !== 'true' || !/^(sk|rk)_test_/.test(requireEnv('STRIPE_SECRET_KEY'))) {
    return undefined
  }
  const clock = await stripe.testHelpers.testClocks.create(
    { frozen_time: Math.floor(Date.now() / 1000), name: `${tenant.name} (${tenant.id.slice(0, 8)})` },
    { idempotencyKey: `tenant-clock-${tenant.id}` },
  )
  return clock.id
}

// Returns the tenant's Stripe customer, creating it once. The idempotency key
// makes concurrent requests for the same tenant get the same customer, and the
// conditional update keeps whichever ID was stored first.
async function ensureCustomer(db: SupabaseClient, tenant: { id: string; name: string }) {
  const customer = await stripe.customers.create(
    { name: tenant.name, metadata: { tenant_id: tenant.id }, test_clock: await testClockFor(tenant) },
    { idempotencyKey: `tenant-customer-${tenant.id}` },
  )

  const { data: claimed, error: claimError } = await db
    .from('tenants')
    .update({ stripe_customer_id: customer.id })
    .eq('id', tenant.id)
    .is('stripe_customer_id', null)
    .select('stripe_customer_id')
    .maybeSingle()
  if (claimError) throw claimError
  if (claimed) return claimed.stripe_customer_id as string

  const { data: current, error: readError } = await db
    .from('tenants')
    .select('stripe_customer_id')
    .eq('id', tenant.id)
    .single()
  if (readError) throw readError
  return current.stripe_customer_id as string
}

export default {
  fetch: withSupabase({ auth: 'user', cors: billingCors }, async (req, ctx) => {
    if (req.method !== 'POST') return errorResponse(405, 'method not allowed')

    try {
      const { tenantId, planCode } = await readBillingRequest(req)
      const db = ctx.supabaseAdmin
      const { tenant, price } = await loadBillingContext(db, ctx.userClaims!.id, tenantId, planCode)
      const priceId = price.stripe_price_id

      // One billing change per tenant at a time (shared with change-plan).
      const url = await withPlanChangeLease(db, tenantId, async () => {
        const customerId = tenant.stripe_customer_id ?? await ensureCustomer(db, tenant)

        // Ask Stripe, not our mirror: the webhook for a just-finished checkout
        // may not have arrived yet.
        const [subscriptions, openSessions] = await Promise.all([
          stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 }),
          stripe.checkout.sessions.list({ customer: customerId, status: 'open', limit: 100 }),
        ])
        const existing = subscriptions.data.find((s) => BLOCKING_SUBSCRIPTION_STATUSES.has(s.status))
        if (existing) {
          throw new HttpError(
            409,
            existing.status === 'incomplete'
              ? 'a payment for this tenant is still being processed; try again in a few minutes'
              : 'tenant already has a subscription; use change-plan to switch plans',
          )
        }

        // At most one open session per tenant, so two can never both be paid.
        const reusable = openSessions.data.find((s) => s.metadata?.price_id === priceId)
        if (reusable?.url) return reusable.url
        await Promise.all(openSessions.data.map((s) => stripe.checkout.sessions.expire(s.id)))

        const session = await stripe.checkout.sessions.create(
          {
            mode: 'subscription',
            customer: customerId,
            client_reference_id: tenantId,
            line_items: [{ price: priceId, quantity: 1 }],
            allow_promotion_codes: true,
            metadata: { tenant_id: tenantId, price_id: priceId },
            subscription_data: { metadata: { tenant_id: tenantId } },
            success_url: `${appUrl}/settings/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${appUrl}/settings/billing?checkout=canceled`,
          },
          // Concurrent requests (double-click, two tabs) within the same minute
          // get the same session back instead of a second one.
          { idempotencyKey: `checkout-${tenantId}-${priceId}-${Math.floor(Date.now() / 60_000)}` },
        )
        if (session.status !== 'open' || !session.url) {
          throw new HttpError(409, 'a checkout for this plan was just completed; refresh the billing page')
        }
        return session.url
      })

      return Response.json({ url })
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err.status, err.message, err.extra)
      console.error('create-checkout-session failed:', err)
      return errorResponse(500, 'could not start checkout')
    }
  }),
}
