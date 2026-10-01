// Starts a Stripe Checkout Session for a tenant's first subscription.
//
// - Caller must be signed in and be the tenant's owner or admin.
// - The client sends a plan code, never a price ID: the price is looked up in
//   public.plan_prices (synced from Supabase secrets).
// - Customers can enter promotion codes (e.g. LAUNCH20) on the Checkout page.
// - No double charges: Stripe itself is checked for an existing (or pending)
//   subscription, an open session for the same price is reused, other open
//   sessions are expired, and a per-minute idempotency key collapses
//   double-clicks into one session. Plan changes go through the Billing Portal.
// - Nothing is written about the subscription here: it is recorded only by
//   the stripe-webhook function, and access is granted only after invoice.paid.
import { withSupabase } from 'npm:@supabase/server@1.8.1'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { requireEnv, stripe } from '../_shared/stripe.ts'

const appUrl = requireEnv('APP_URL').replace(/\/+$/, '')

const PLAN_CODES = new Set(['starter', 'growth', 'agency'])
const BILLING_ROLES = new Set(['owner', 'admin'])
// Any of these means the customer already has, or is about to have, a paid
// subscription. `incomplete` = first payment still processing (e.g. 3-D Secure).
const BLOCKING_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function errorResponse(status: number, message: string) {
  return Response.json({ error: message }, { status })
}

// Returns the tenant's Stripe customer, creating it once. The idempotency key
// makes concurrent requests for the same tenant get the same customer, and the
// conditional update keeps whichever ID was stored first.
async function ensureCustomer(db: SupabaseClient, tenant: { id: string; name: string }) {
  const customer = await stripe.customers.create(
    { name: tenant.name, metadata: { tenant_id: tenant.id } },
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
  fetch: withSupabase(
    {
      auth: 'user',
      cors: {
        headers: {
          'Access-Control-Allow-Origin': appUrl,
          'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
        },
      },
    },
    async (req, ctx) => {
      if (req.method !== 'POST') return errorResponse(405, 'method not allowed')

      let body: Record<string, unknown>
      try {
        body = await req.json()
      } catch {
        return errorResponse(400, 'invalid JSON body')
      }
      const tenantId = body?.tenant_id
      const planCode = body?.plan_code
      if (typeof tenantId !== 'string' || !UUID_RE.test(tenantId)) {
        return errorResponse(400, 'tenant_id must be a UUID')
      }
      if (typeof planCode !== 'string' || !PLAN_CODES.has(planCode)) {
        return errorResponse(400, 'plan_code must be starter, growth or agency')
      }

      try {
        const db = ctx.supabaseAdmin
        const userId = ctx.userClaims!.id

        const [member, tenant, price] = await Promise.all([
          db.from('tenant_members').select('role').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle(),
          db.from('tenants').select('id, name, stripe_customer_id').eq('id', tenantId).maybeSingle(),
          db.from('plan_prices').select('stripe_price_id').eq('plan_code', planCode).eq('is_current', true).maybeSingle(),
        ])
        for (const result of [member, tenant, price]) {
          if (result.error) throw result.error
        }

        if (!member.data || !BILLING_ROLES.has(member.data.role)) {
          return errorResponse(403, 'only the tenant owner or an admin can manage billing')
        }
        if (!tenant.data) return errorResponse(404, 'tenant not found')
        if (!price.data) {
          return errorResponse(503, `no current Stripe price for ${planCode}; run sync-plan-prices`)
        }

        const priceId: string = price.data.stripe_price_id
        const customerId = tenant.data.stripe_customer_id ?? await ensureCustomer(db, tenant.data)

        // Ask Stripe, not our mirror: the webhook for a just-finished checkout
        // may not have arrived yet.
        const [subscriptions, openSessions] = await Promise.all([
          stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 }),
          stripe.checkout.sessions.list({ customer: customerId, status: 'open', limit: 100 }),
        ])
        const existing = subscriptions.data.find((s) => BLOCKING_SUBSCRIPTION_STATUSES.has(s.status))
        if (existing) {
          return errorResponse(
            409,
            existing.status === 'incomplete'
              ? 'a payment for this tenant is still being processed; try again in a few minutes'
              : 'tenant already has a subscription; change plans in the billing portal',
          )
        }

        // At most one open session per tenant, so two can never both be paid.
        const reusable = openSessions.data.find((s) => s.metadata?.price_id === priceId)
        if (reusable?.url) return Response.json({ url: reusable.url })
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
          return errorResponse(409, 'a checkout for this plan was just completed; refresh the billing page')
        }

        return Response.json({ url: session.url })
      } catch (err) {
        console.error('create-checkout-session failed:', err)
        return errorResponse(500, 'could not start checkout')
      }
    },
  ),
}
