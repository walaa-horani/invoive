// Upgrades and downgrades for existing subscribers.
//
// POST { tenant_id, plan_code, action: 'preview' }
// POST { tenant_id, plan_code, action: 'confirm', proration_date, expected_amount_due }
//
// - Upgrade: immediate. The prorated difference for the rest of the period is
//   invoiced and charged at once (proration_behavior=always_invoice) with
//   payment_behavior=pending_if_incomplete: if the charge fails or needs 3-D
//   Secure, Stripe keeps the old price and the new plan applies only once that
//   invoice is paid (the webhook picks it up). Never a plan without payment.
// - Downgrade: at the end of the period already paid for, via a Subscription
//   Schedule with proration_behavior=none. No credit, no refund, nothing
//   charged mid-cycle. Choosing the current plan again cancels it.
// - Exact amount: 'preview' asks Stripe for the proration at a server-chosen
//   proration_date. 'confirm' re-previews at that same date and refuses if the
//   amount differs from what the user saw, then charges with that date.
// - No double charge: a confirm runs under the per-tenant lease (one billing
//   change at a time) on freshly loaded Stripe state, and the charge carries a
//   Stripe idempotency key per (subscription, price, proration_date).
// - Immediate limits: the snapshot Stripe returns is applied to
//   public.tenant_subscriptions before responding. Scheduled downgrades are
//   enforced by the database from scheduled_change_at onward.
// - Never trusts the client: plan code only, prices from plan_prices, current
//   state re-fetched from Stripe.
import { withSupabase } from 'npm:@supabase/server@1.8.1'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  billingCors,
  errorResponse,
  HttpError,
  loadBillingContext,
  readBillingRequest,
  withPlanChangeLease,
} from '../_shared/billing-context.ts'
import { type Stripe, stripe } from '../_shared/stripe.ts'
import {
  applySnapshot,
  retrieveSubscription,
  scheduledChangeOf,
  SNAPSHOT_EXPAND,
  takeSyncTicket,
} from '../_shared/subscription-sync.ts'

// How long a preview's price stays valid for confirm.
const PREVIEW_TTL_SECONDS = 15 * 60

const toIso = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString()
const nowSeconds = () => Math.floor(Date.now() / 1000)
const idOf = (value: string | { id: string } | null) => (value == null || typeof value === 'string' ? value : value.id)

type Context = {
  db: SupabaseClient
  tenantId: string
  customerId: string
  subscription: Stripe.Subscription
  item: Stripe.SubscriptionItem
  target: { planCode: string; priceId: string; unitAmount: number; currency: string }
}

// Loads the subscription from Stripe and refuses anything but a healthy,
// paid, single-plan subscription that belongs to this tenant.
async function loadSubscription(db: SupabaseClient, tenantId: string, customerId: string | null) {
  const { data: row, error } = await db
    .from('tenant_subscriptions')
    .select('stripe_subscription_id, payment_confirmed_at')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw error
  if (!row || !customerId) throw new HttpError(409, 'tenant has no subscription; start one with checkout')
  if (!row.payment_confirmed_at) throw new HttpError(409, 'the first payment has not been confirmed yet')

  const subscription = await retrieveSubscription(row.stripe_subscription_id)
  if (idOf(subscription.customer) !== customerId) {
    throw new Error(`subscription ${subscription.id} does not belong to customer ${customerId}`)
  }
  if (subscription.status !== 'active') {
    throw new HttpError(
      409,
      subscription.status === 'past_due' || subscription.status === 'unpaid'
        ? 'a payment is overdue; update your payment method before changing plans'
        : `subscription is ${subscription.status}; plans can only be changed on an active subscription`,
    )
  }
  if (subscription.cancel_at_period_end || subscription.cancel_at) {
    throw new HttpError(409, 'subscription is set to cancel; resume it before changing plans')
  }
  if (subscription.pending_update) {
    const invoice = typeof subscription.latest_invoice === 'object' ? subscription.latest_invoice : null
    throw new HttpError(409, 'a previous upgrade is waiting for payment', {
      hosted_invoice_url: invoice?.hosted_invoice_url ?? null,
      expires_at: toIso(subscription.pending_update.expires_at),
    })
  }
  if (subscription.items.data.length !== 1) {
    throw new Error(`subscription ${subscription.id} has ${subscription.items.data.length} items, expected 1`)
  }
  return { subscription, item: subscription.items.data[0] }
}

async function planRanks(db: SupabaseClient, priceId: string) {
  const [plans, current] = await Promise.all([
    db.from('plans').select('code, rank'),
    db.from('plan_prices').select('plan_code').eq('stripe_price_id', priceId).maybeSingle(),
  ])
  if (plans.error) throw plans.error
  if (current.error) throw current.error
  if (!current.data) throw new HttpError(503, `current Stripe price ${priceId} is not mapped; run sync-plan-prices`)
  const ranks = new Map((plans.data ?? []).map((p) => [p.code as string, p.rank as number]))
  return { currentPlan: current.data.plan_code as string, ranks }
}

// Stripe's own snapshot is written before we answer, so the very next request
// is checked against the new plan.
async function syncNow(ctx: Context, ticket: number, subscription?: Stripe.Subscription) {
  await applySnapshot(ctx.db, {
    ticket,
    subscription: subscription ?? await retrieveSubscription(ctx.subscription.id),
    eventId: null,
    eventType: 'change_plan',
    paymentConfirmedAt: null,
  })
}

function upgradePreview(ctx: Context, prorationDate: number) {
  return stripe.invoices.createPreview({
    customer: ctx.customerId,
    subscription: ctx.subscription.id,
    subscription_details: {
      items: [{ id: ctx.item.id, price: ctx.target.priceId }],
      proration_behavior: 'always_invoice',
      proration_date: prorationDate,
    },
  })
}

async function releaseSchedule(scheduleId: string | null) {
  if (!scheduleId) return
  try {
    await stripe.subscriptionSchedules.release(scheduleId)
  } catch (err) {
    // Already released / completed: nothing left to undo.
    if ((err as Stripe.errors.StripeError)?.type !== 'StripeInvalidRequestError') throw err
  }
}

async function upgrade(ctx: Context, body: Record<string, unknown>, confirm: boolean) {
  if (!confirm) {
    const prorationDate = nowSeconds()
    const preview = await upgradePreview(ctx, prorationDate)
    return {
      kind: 'upgrade',
      plan_code: ctx.target.planCode,
      amount_due: preview.amount_due,
      currency: preview.currency,
      proration_date: prorationDate,
      effective: 'now',
    }
  }

  const prorationDate = body.proration_date
  const expectedAmount = body.expected_amount_due
  if (
    typeof prorationDate !== 'number' || !Number.isInteger(prorationDate) ||
    prorationDate > nowSeconds() || prorationDate < nowSeconds() - PREVIEW_TTL_SECONDS
  ) {
    throw new HttpError(409, 'preview expired; preview the change again', { reason: 'preview_expired' })
  }
  if (typeof expectedAmount !== 'number' || !Number.isInteger(expectedAmount)) {
    throw new HttpError(400, 'expected_amount_due must be the amount_due returned by preview')
  }

  // Same date => same proration. Anything that changed since (a coupon
  // expired, credit was used) shows up here instead of on the card.
  const preview = await upgradePreview(ctx, prorationDate)
  if (preview.amount_due !== expectedAmount) {
    throw new HttpError(409, 'the price changed since the preview; review it again', {
      reason: 'amount_changed',
      amount_due: preview.amount_due,
    })
  }

  // An upgrade replaces any downgrade scheduled for the period end.
  await releaseSchedule(idOf(ctx.subscription.schedule))

  const ticket = await takeSyncTicket(ctx.db)
  const updated = await stripe.subscriptions.update(
    ctx.subscription.id,
    {
      items: [{ id: ctx.item.id, price: ctx.target.priceId }],
      proration_behavior: 'always_invoice',
      proration_date: prorationDate,
      payment_behavior: 'pending_if_incomplete',
      expand: SNAPSHOT_EXPAND,
    },
    { idempotencyKey: `plan-change-${ctx.subscription.id}-${ctx.target.priceId}-${prorationDate}` },
  )
  await syncNow(ctx, ticket, updated)

  if (updated.pending_update) {
    // Payment failed or needs authentication: still on the old plan.
    const invoice = typeof updated.latest_invoice === 'object' ? updated.latest_invoice : null
    return {
      status: 'requires_payment',
      plan_code: ctx.target.planCode,
      hosted_invoice_url: invoice?.hosted_invoice_url ?? null,
      expires_at: toIso(updated.pending_update.expires_at),
    }
  }
  return { status: 'applied', plan_code: ctx.target.planCode }
}

function discountParams(phase: Stripe.SubscriptionSchedule.Phase | undefined) {
  return (phase?.discounts ?? []).map((d) =>
    d.discount ? { discount: idOf(d.discount)! }
    : d.promotion_code ? { promotion_code: idOf(d.promotion_code)! }
    : { coupon: idOf(d.coupon)! }
  )
}

async function downgrade(ctx: Context, confirm: boolean) {
  const periodEnd = ctx.item.current_period_end
  if (!confirm) {
    return {
      kind: 'downgrade',
      plan_code: ctx.target.planCode,
      effective_at: toIso(periodEnd),
      amount_due_now: 0,
      renewal_unit_amount: ctx.target.unitAmount,
      currency: ctx.target.currency,
    }
  }

  // No idempotency key needed: Stripe allows one schedule per subscription,
  // and this runs under the lease with freshly loaded state.
  let schedule = typeof ctx.subscription.schedule === 'object' ? ctx.subscription.schedule : null
  if (!schedule || !['active', 'not_started'].includes(schedule.status)) {
    schedule = await stripe.subscriptionSchedules.create({ from_subscription: ctx.subscription.id })
  }
  const currentPhase = schedule.phases.find((p) => p.start_date <= nowSeconds() && p.end_date > nowSeconds()) ??
    schedule.phases[0]
  const discounts = discountParams(currentPhase)
  const recurring = ctx.item.price.recurring

  // Phase 1 = what was paid for, untouched until the period ends.
  // Phase 2 = the lower plan from the next renewal; the schedule then
  // releases and the subscription simply continues on that price.
  await stripe.subscriptionSchedules.update(
    schedule.id,
    {
      end_behavior: 'release',
      proration_behavior: 'none',
      metadata: { tenant_id: ctx.tenantId },
      phases: [
        {
          start_date: currentPhase.start_date,
          end_date: periodEnd,
          items: [{ price: ctx.item.price.id, quantity: ctx.item.quantity ?? 1 }],
          discounts,
          proration_behavior: 'none',
        },
        {
          items: [{ price: ctx.target.priceId, quantity: 1 }],
          duration: { interval: recurring?.interval ?? 'month', interval_count: recurring?.interval_count ?? 1 },
          discounts,
          proration_behavior: 'none',
        },
      ],
    },
    { idempotencyKey: `plan-downgrade-${ctx.subscription.id}-${ctx.target.priceId}-${periodEnd}` },
  )

  const ticket = await takeSyncTicket(ctx.db)
  await syncNow(ctx, ticket)
  return { status: 'scheduled', plan_code: ctx.target.planCode, effective_at: toIso(periodEnd) }
}

async function cancelScheduledChange(ctx: Context, confirm: boolean) {
  const scheduled = scheduledChangeOf(ctx.subscription)
  if (!scheduled.priceId) throw new HttpError(409, 'already on this plan')
  if (!confirm) {
    return { kind: 'cancel_scheduled_change', plan_code: ctx.target.planCode, scheduled_change_at: scheduled.changeAt }
  }
  await releaseSchedule(scheduled.scheduleId)
  const ticket = await takeSyncTicket(ctx.db)
  await syncNow(ctx, ticket)
  return { status: 'scheduled_change_canceled', plan_code: ctx.target.planCode }
}

export default {
  fetch: withSupabase({ auth: 'user', cors: billingCors }, async (req, ctx) => {
    if (req.method !== 'POST') return errorResponse(405, 'method not allowed')

    try {
      const { body, tenantId, planCode } = await readBillingRequest(req)
      if (body.action !== 'preview' && body.action !== 'confirm') {
        throw new HttpError(400, "action must be 'preview' or 'confirm'")
      }
      const confirm = body.action === 'confirm'

      const db = ctx.supabaseAdmin
      const { tenant, price } = await loadBillingContext(db, ctx.userClaims!.id, tenantId, planCode)

      // Reads Stripe's current state and acts on it. A confirm runs entirely
      // under the tenant's lease, so the state it acts on can't change under it.
      const run = async () => {
        const { subscription, item } = await loadSubscription(db, tenantId, tenant.stripe_customer_id)
        const { currentPlan, ranks } = await planRanks(db, item.price.id)
        const change: Context = {
          db,
          tenantId,
          customerId: tenant.stripe_customer_id!,
          subscription,
          item,
          target: {
            planCode,
            priceId: price.stripe_price_id,
            unitAmount: price.unit_amount,
            currency: price.currency,
          },
        }
        const direction = Math.sign(ranks.get(planCode)! - ranks.get(currentPlan)!)
        return direction > 0
          ? await upgrade(change, body, confirm)
          : direction < 0
          ? await downgrade(change, confirm)
          : await cancelScheduledChange(change, confirm)
      }
      const result = confirm ? await withPlanChangeLease(db, tenantId, run) : await run()
      return Response.json(result)
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err.status, err.message, err.extra)
      if ((err as Stripe.errors.StripeError)?.type === 'StripeCardError') {
        return errorResponse(402, (err as Error).message, { reason: 'card_error' })
      }
      console.error('change-plan failed:', err)
      return errorResponse(500, 'could not change plan')
    }
  }),
}
