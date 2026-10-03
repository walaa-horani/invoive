// Repairs client payments whose webhook was missed: re-reads every online
// payment attempt still 'open' 10+ minutes after it started, from the
// tenant's connected account, through the same path as the webhook.
//
// Server-only (secret key). Run on a schedule (pg_cron, e.g. every 15
// minutes) and on demand: POST {}.
import { withSupabase } from 'npm:@supabase/server@1.8.1'
import { syncCheckoutSession } from '../_shared/invoice-payments.ts'

const BATCH = 100

export default {
  fetch: withSupabase({ auth: 'secret' }, async (req, ctx) => {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

    const db = ctx.supabaseAdmin
    const { data, error } = await db.rpc('invoice_payments_to_reconcile', { p_limit: BATCH })
    if (error) {
      console.error('invoice_payments_to_reconcile failed:', error)
      return Response.json({ error: 'could not list payments' }, { status: 500 })
    }

    const rows = (data ?? []) as { attempt_id: string; stripe_account_id: string; checkout_session_id: string }[]
    const results: Record<string, string> = {}
    let failed = 0
    for (const row of rows) {
      try {
        results[row.attempt_id] = await syncCheckoutSession(db, row.stripe_account_id, row.checkout_session_id, null)
      } catch (err) {
        failed++
        results[row.attempt_id] = 'error'
        console.error(`reconcile attempt ${row.attempt_id} (${row.checkout_session_id}) failed:`, err)
      }
    }
    return Response.json({ checked: rows.length, failed, results }, { status: failed ? 500 : 200 })
  }),
}
