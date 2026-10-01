// Admin-only: copies the Stripe Price IDs held in Supabase secrets into
// public.plan_prices after validating them against Stripe.
//
// Invoke with the project's secret key (apikey header). Run after deploy and
// whenever a plan's price changes in Stripe.
import { withSupabase } from 'npm:@supabase/server@1.8.1'
import { requireEnv, stripe, type Stripe } from '../_shared/stripe.ts'

const PRICE_SECRETS = {
  starter: 'STRIPE_STARTER_PRICE_ID',
  growth: 'STRIPE_GROWTH_PRICE_ID',
  agency: 'STRIPE_AGENCY_PRICE_ID',
} as const

type PlanCode = keyof typeof PRICE_SECRETS

async function loadPrice(plan: PlanCode) {
  const priceId = requireEnv(PRICE_SECRETS[plan])
  const price = await stripe.prices.retrieve(priceId, { expand: ['product'] })
  const product = price.product as Stripe.Product

  const problems: string[] = []
  if (!price.active) problems.push('price is archived')
  if (price.type !== 'recurring') problems.push('price is not recurring')
  if (price.recurring?.interval !== 'month' || price.recurring.interval_count !== 1) {
    problems.push('price is not billed monthly')
  }
  if (price.unit_amount == null) problems.push('price has no fixed unit_amount')
  if (product.metadata?.plan_code !== plan) {
    problems.push(`product metadata plan_code is "${product.metadata?.plan_code ?? ''}", expected "${plan}"`)
  }
  if (problems.length > 0) {
    throw new Error(`${PRICE_SECRETS[plan]} (${priceId}): ${problems.join('; ')}`)
  }

  return {
    plan_code: plan,
    stripe_price_id: price.id,
    stripe_product_id: product.id,
    unit_amount: price.unit_amount,
    currency: price.currency,
  }
}

export default {
  fetch: withSupabase({ auth: 'secret' }, async (req, ctx) => {
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

    // Stripe calls happen before (and outside) the database transaction.
    const results = await Promise.allSettled(
      (Object.keys(PRICE_SECRETS) as PlanCode[]).map(loadPrice),
    )
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => String(r.reason?.message ?? r.reason))
    if (errors.length > 0) {
      return Response.json({ synced: false, errors }, { status: 422 })
    }

    const prices = results.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof loadPrice>>>).value)
    const { error } = await ctx.supabaseAdmin.rpc('sync_plan_prices', { p_prices: prices })
    if (error) {
      console.error('sync_plan_prices failed:', error)
      return Response.json({ synced: false, errors: [error.message] }, { status: 500 })
    }

    return Response.json({ synced: true, prices })
  }),
}
