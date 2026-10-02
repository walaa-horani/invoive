// Shared by the user-facing billing functions (create-checkout-session,
// change-plan): request validation, caller authorization, price lookup and
// the per-tenant plan-change lease.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { requireEnv } from './stripe.ts'

export const appUrl = requireEnv('APP_URL').replace(/\/+$/, '')

export const billingCors = {
  headers: {
    'Access-Control-Allow-Origin': appUrl,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  },
}

const PLAN_CODES = new Set(['starter', 'growth', 'agency'])
const BILLING_ROLES = new Set(['owner', 'admin'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Thrown for any expected refusal; the handler turns it into a JSON response.
export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly extra: Record<string, unknown> = {}) {
    super(message)
  }
}

export function errorResponse(status: number, message: string, extra: Record<string, unknown> = {}) {
  return Response.json({ error: message, ...extra }, { status })
}

// Parses { tenant_id, plan_code, ... }. The client only ever names a plan,
// never a price.
export async function readBillingRequest(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    throw new HttpError(400, 'invalid JSON body')
  }
  const tenantId = body?.tenant_id
  const planCode = body?.plan_code
  if (typeof tenantId !== 'string' || !UUID_RE.test(tenantId)) {
    throw new HttpError(400, 'tenant_id must be a UUID')
  }
  if (typeof planCode !== 'string' || !PLAN_CODES.has(planCode)) {
    throw new HttpError(400, 'plan_code must be starter, growth or agency')
  }
  return { body, tenantId, planCode }
}

// Caller must be the tenant's owner or an admin. Returns the tenant and the
// current Stripe price of the requested plan (from public.plan_prices, which
// is synced from Supabase secrets).
export async function loadBillingContext(db: SupabaseClient, userId: string, tenantId: string, planCode: string) {
  const [member, tenant, price] = await Promise.all([
    db.from('tenant_members').select('role').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle(),
    db.from('tenants').select('id, name, stripe_customer_id').eq('id', tenantId).maybeSingle(),
    db.from('plan_prices')
      .select('stripe_price_id, unit_amount, currency')
      .eq('plan_code', planCode)
      .eq('is_current', true)
      .maybeSingle(),
  ])
  for (const result of [member, tenant, price]) {
    if (result.error) throw result.error
  }

  if (!member.data || !BILLING_ROLES.has(member.data.role)) {
    throw new HttpError(403, 'only the tenant owner or an admin can manage billing')
  }
  if (!tenant.data) throw new HttpError(404, 'tenant not found')
  if (!price.data) throw new HttpError(503, `no current Stripe price for ${planCode}; run sync-plan-prices`)

  return {
    tenant: tenant.data as { id: string; name: string; stripe_customer_id: string | null },
    price: price.data as { stripe_price_id: string; unit_amount: number; currency: string },
  }
}

// Runs fn while holding the tenant's plan-change lease, so two billing
// requests for one tenant never interleave their Stripe calls. The lease
// expires on its own if this instance dies.
export async function withPlanChangeLease<T>(db: SupabaseClient, tenantId: string, fn: () => Promise<T>) {
  const holder = crypto.randomUUID()
  const { data: acquired, error } = await db.rpc('acquire_plan_change_lease', {
    p_tenant_id: tenantId,
    p_holder: holder,
    p_ttl_seconds: 120,
  })
  if (error) throw new Error(`acquire_plan_change_lease: ${error.message}`)
  if (!acquired) throw new HttpError(409, 'another billing change for this tenant is in progress; try again shortly')

  try {
    return await fn()
  } finally {
    const { error: releaseError } = await db.rpc('release_plan_change_lease', { p_tenant_id: tenantId, p_holder: holder })
    if (releaseError) console.error(`release_plan_change_lease for ${tenantId}:`, releaseError)
  }
}
