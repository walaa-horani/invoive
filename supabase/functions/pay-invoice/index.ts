// Starts an online payment of one invoice by the tenant's client.
//
// Public endpoint: the caller is whoever holds the invoice's pay link, so the
// request carries ONLY that token. Everything Stripe is asked to charge
// (balance due, currency, the tenant's connected account, the platform fee)
// comes from public.begin_invoice_payment, which also locks the invoice,
// reuses a still-open session and rate-limits attempts.
//
// The Checkout Session is created ON the tenant's connected account (direct
// charge) with the attempt id as idempotency key and client_reference_id.
// Nothing here marks an invoice paid: only stripe-connect-webhook and
// reconcile-invoice-payments do, from Stripe's own state.
import { withSupabase } from 'npm:@supabase/server@1.8.1'
import { appUrl, billingCors, errorResponse } from '../_shared/billing-context.ts'
import { stripe } from '../_shared/stripe.ts'

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
// Stripe's minimum; also bounds how long a voided invoice stays payable.
const SESSION_TTL_SECONDS = 30 * 60

const REFUSALS: Record<string, [number, string]> = {
  PT404: [404, 'This payment link is not valid. Ask the sender for a new one.'],
  PT409: [409, 'This invoice cannot be paid online right now.'],
  PT429: [429, 'Too many payment attempts. Please try again in an hour.'],
}

type Begin = {
  attempt_id: string
  reused: boolean
  checkout_url?: string
  stripe_account_id: string
  amount: number
  currency: string
  application_fee_amount: number
  invoice_number: string
  business_name: string
  client_email: string | null
  superseded: { checkout_session_id: string; stripe_account_id: string }[]
}

export default {
  fetch: withSupabase({ auth: 'none', cors: billingCors }, async (req, ctx) => {
    if (req.method !== 'POST') return errorResponse(405, 'method not allowed')

    let token: unknown
    try {
      token = (await req.json())?.token
    } catch {
      return errorResponse(400, 'invalid JSON body')
    }
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
      return errorResponse(404, REFUSALS.PT404[1])
    }

    const db = ctx.supabaseAdmin
    const { data, error } = await db.rpc('begin_invoice_payment', { p_token: token })
    if (error) {
      const refusal = REFUSALS[error.code ?? '']
      if (refusal) return errorResponse(refusal[0], refusal[1], { reason: error.details ?? null })
      console.error('begin_invoice_payment failed:', error)
      return errorResponse(500, 'could not start the payment')
    }
    const attempt = data as Begin
    if (attempt.reused && attempt.checkout_url) return Response.json({ url: attempt.checkout_url })

    // Best effort: a superseded session must not stay payable next to the new one.
    await Promise.all(attempt.superseded.map((s) =>
      stripe.checkout.sessions.expire(s.checkout_session_id, {}, { stripeAccount: s.stripe_account_id })
        .catch((err) => console.warn(`could not expire ${s.checkout_session_id}:`, err?.message ?? err))
    ))

    let createdSessionId: string | null = null
    try {
      // The account can lose card payments between our last sync and now.
      const account = await stripe.v2.core.accounts.retrieve(attempt.stripe_account_id, {
        include: ['configuration.merchant'],
      })
      if (account.closed || account.configuration?.merchant?.capabilities?.card_payments?.status !== 'active') {
        await db.rpc('fail_payment_attempt', { p_attempt_id: attempt.attempt_id })
        return errorResponse(409, REFUSALS.PT409[1], { reason: 'payments_unavailable' })
      }

      const returnUrl = `${appUrl}/pay/${token}?return=1`
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          client_reference_id: attempt.attempt_id,
          customer_email: attempt.client_email ?? undefined,
          line_items: [{
            quantity: 1,
            price_data: {
              currency: attempt.currency,
              unit_amount: attempt.amount,
              product_data: { name: `Invoice ${attempt.invoice_number}`, description: attempt.business_name },
            },
          }],
          payment_intent_data: {
            application_fee_amount: attempt.application_fee_amount > 0 ? attempt.application_fee_amount : undefined,
            description: `Invoice ${attempt.invoice_number}`,
            // For people reading the tenant's Dashboard. Never used to match payments.
            metadata: { invoice_number: attempt.invoice_number, attempt_id: attempt.attempt_id },
          },
          metadata: { invoice_number: attempt.invoice_number, attempt_id: attempt.attempt_id },
          expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
          success_url: returnUrl,
          cancel_url: `${appUrl}/pay/${token}`,
        },
        { stripeAccount: attempt.stripe_account_id, idempotencyKey: `invoice-attempt-${attempt.attempt_id}` },
      )
      createdSessionId = session.id

      const { data: attached, error: attachError } = await db.rpc('attach_checkout_session', {
        p_attempt_id: attempt.attempt_id,
        p_session_id: session.id,
        p_url: session.url,
        p_expires_at: new Date(session.expires_at * 1000).toISOString(),
      })
      if (attachError) throw new Error(`attach_checkout_session: ${attachError.message}`)
      if (!attached) {
        // Another request superseded this attempt while Stripe was answering.
        await stripe.checkout.sessions.expire(session.id, {}, { stripeAccount: attempt.stripe_account_id })
          .catch(() => {})
        return errorResponse(409, 'A newer payment was started for this invoice. Please try again.')
      }
      return Response.json({ url: session.url })
    } catch (err) {
      console.error(`pay-invoice attempt ${attempt.attempt_id} failed:`, err)
      // A session we could not record must not stay payable: its payment
      // would match no attempt.
      if (createdSessionId) {
        await stripe.checkout.sessions.expire(createdSessionId, {}, { stripeAccount: attempt.stripe_account_id })
          .catch((expireErr) => console.error(`UNRECORDED SESSION ${createdSessionId} still open:`, expireErr))
      }
      await db.rpc('fail_payment_attempt', { p_attempt_id: attempt.attempt_id })
      return errorResponse(502, 'The payment provider is unavailable. Please try again shortly.')
    }
  }),
}
