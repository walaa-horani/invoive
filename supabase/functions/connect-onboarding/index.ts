// Connects a workspace's own Stripe account (Stripe Connect, Accounts v2) so
// its clients can pay invoices online.
//
// POST { tenant_id, action: 'onboard' | 'refresh' } as the workspace owner or
// an admin.
//   onboard - creates the connected account once per workspace (full Stripe
//             Dashboard; Stripe collects its fees from the account and carries
//             losses), records it, and returns a Stripe-hosted onboarding link.
//   refresh - re-reads the account from Stripe and mirrors its status (used
//             when the user comes back from onboarding).
// The account id is only ever created and stored here, never taken from a
// request, and the database refuses to attach one account to two workspaces.
import { withSupabase } from 'npm:@supabase/server@1.8.1'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { appUrl, billingCors, errorResponse, HttpError } from '../_shared/billing-context.ts'
import { syncConnectAccount } from '../_shared/invoice-payments.ts'
import { stripe } from '../_shared/stripe.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ADMIN_ROLES = new Set(['owner', 'admin'])

async function loadTenant(db: SupabaseClient, userId: string, tenantId: string) {
  const [member, tenant, account] = await Promise.all([
    db.from('tenant_members').select('role').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle(),
    db.from('tenants').select('id, name').eq('id', tenantId).maybeSingle(),
    db.from('tenant_payment_accounts').select('stripe_account_id').eq('tenant_id', tenantId).maybeSingle(),
  ])
  for (const result of [member, tenant, account]) {
    if (result.error) throw result.error
  }
  if (!member.data || !ADMIN_ROLES.has(member.data.role)) {
    throw new HttpError(403, 'only the workspace owner or an admin can set up payments')
  }
  if (!tenant.data) throw new HttpError(404, 'workspace not found')
  return {
    tenant: tenant.data as { id: string; name: string },
    accountId: (account.data?.stripe_account_id as string | undefined) ?? null,
  }
}

async function createAccount(db: SupabaseClient, tenant: { id: string; name: string }, email: string | undefined) {
  const account = await stripe.v2.core.accounts.create(
    {
      display_name: tenant.name,
      contact_email: email,
      dashboard: 'full',
      defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      metadata: { tenant_id: tenant.id },
    },
    { idempotencyKey: `connect-account-${tenant.id}` },
  )
  // Returns the account already registered if another request won the race.
  const { data, error } = await db.rpc('register_connect_account', {
    p_tenant_id: tenant.id,
    p_account_id: account.id,
  })
  if (error) throw new Error(`register_connect_account: ${error.message}`)
  return data as string
}

export default {
  fetch: withSupabase({ auth: 'user', cors: billingCors }, async (req, ctx) => {
    if (req.method !== 'POST') return errorResponse(405, 'method not allowed')

    try {
      let body: Record<string, unknown>
      try {
        body = await req.json()
      } catch {
        throw new HttpError(400, 'invalid JSON body')
      }
      const tenantId = body?.tenant_id
      const action = body?.action
      if (typeof tenantId !== 'string' || !UUID_RE.test(tenantId)) throw new HttpError(400, 'tenant_id must be a UUID')
      if (action !== 'onboard' && action !== 'refresh') throw new HttpError(400, 'action must be onboard or refresh')

      const db = ctx.supabaseAdmin
      const { tenant, accountId: existing } = await loadTenant(db, ctx.userClaims!.id, tenantId)

      if (action === 'refresh') {
        if (!existing) return Response.json({ status: 'not_connected' })
        const result = await syncConnectAccount(db, existing)
        return Response.json({ result })
      }

      const accountId = existing ?? await createAccount(db, tenant, ctx.userClaims!.email)
      const link = await stripe.v2.core.accountLinks.create({
        account: accountId,
        use_case: {
          type: 'account_onboarding',
          account_onboarding: {
            configurations: ['merchant'],
            refresh_url: `${appUrl}/settings/payments?onboarding=refresh`,
            return_url: `${appUrl}/settings/payments?onboarding=return`,
          },
        },
      })
      return Response.json({ url: link.url })
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err.status, err.message, err.extra)
      console.error('connect-onboarding failed:', err)
      return errorResponse(500, 'could not start Stripe onboarding')
    }
  }),
}
