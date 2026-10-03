import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Workspace } from "@/lib/workspace";
import type { PlanCode, PlanFeature, UsageMetric } from "./format";

// Everything the billing page shows, read as the signed-in user: RLS limits
// tenant data to the user's own tenants, and the catalog is public. Nothing
// here is trusted for decisions - plan changes are re-checked by the
// change-plan Edge Function against Stripe.

export type Plan = {
  code: PlanCode;
  name: string;
  rank: number;
  price: { amount: number; currency: string } | null;
  limits: Record<UsageMetric, number | null>;
  features: PlanFeature[];
};

export type Subscription = {
  plan_code: PlanCode;
  stripe_price_id: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancel_at: string | null;
  payment_confirmed_at: string | null;
  next_payment_attempt: string | null;
  pending_plan_code: PlanCode | null;
  pending_update_expires_at: string | null;
  scheduled_plan_code: PlanCode | null;
  scheduled_change_at: string | null;
};

export type Usage = {
  metric: UsageMetric;
  effective_limit: number | null;
  used: number;
};

export type BillingPageData = {
  tenants: Workspace[];
  tenant: Workspace;
  plans: Plan[];
  subscription: Subscription | null;
  subscriptionPrice: { amount: number; currency: string } | null;
  effectivePlan: PlanCode | null;
  usage: Usage[];
};

const SUBSCRIPTION_COLUMNS =
  "plan_code, stripe_price_id, status, current_period_end, cancel_at_period_end, cancel_at, payment_confirmed_at, next_payment_attempt, pending_plan_code, pending_update_expires_at, scheduled_plan_code, scheduled_change_at";

function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data as T;
}

export async function loadBillingPage(
  supabase: SupabaseClient,
  tenant: Workspace,
  tenants: Workspace[],
): Promise<BillingPageData> {
  const [plans, limits, features, prices, subscription, usage] = await Promise.all([
    supabase.from("plans").select("code, name, rank").order("rank"),
    supabase.from("plan_limits").select("plan_code, metric, max_value"),
    supabase.from("plan_features").select("plan_code, feature"),
    supabase.from("plan_prices").select("plan_code, unit_amount, currency").eq("is_current", true),
    supabase
      .from("tenant_subscriptions")
      .select(SUBSCRIPTION_COLUMNS)
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
    supabase.from("tenant_entitlements").select("metric, effective_plan, effective_limit, used").eq("tenant_id", tenant.id),
  ]);

  const limitRows = must(limits, "plan_limits") as { plan_code: PlanCode; metric: UsageMetric; max_value: number | null }[];
  const featureRows = must(features, "plan_features") as { plan_code: PlanCode; feature: PlanFeature }[];
  const priceRows = must(prices, "plan_prices") as { plan_code: PlanCode; unit_amount: number; currency: string }[];

  const catalog: Plan[] = (must(plans, "plans") as { code: PlanCode; name: string; rank: number }[]).map((p) => {
    const price = priceRows.find((r) => r.plan_code === p.code);
    return {
      ...p,
      price: price ? { amount: price.unit_amount, currency: price.currency } : null,
      limits: Object.fromEntries(
        limitRows.filter((l) => l.plan_code === p.code).map((l) => [l.metric, l.max_value]),
      ) as Record<UsageMetric, number | null>,
      features: featureRows.filter((f) => f.plan_code === p.code).map((f) => f.feature),
    };
  });

  const sub = must(subscription, "tenant_subscriptions") as Subscription | null;

  // Grandfathered subscribers pay their own (older) price, not the current one.
  let subscriptionPrice: BillingPageData["subscriptionPrice"] = null;
  if (sub) {
    const own = must(
      await supabase.from("plan_prices").select("unit_amount, currency").eq("stripe_price_id", sub.stripe_price_id).maybeSingle(),
      "plan_prices",
    ) as { unit_amount: number; currency: string } | null;
    subscriptionPrice = own ? { amount: own.unit_amount, currency: own.currency } : null;
  }

  const usageRows = must(usage, "tenant_entitlements") as (Usage & { effective_plan: PlanCode | null })[];

  return {
    tenants,
    tenant,
    plans: catalog,
    subscription: sub,
    subscriptionPrice,
    effectivePlan: usageRows[0]?.effective_plan ?? null,
    usage: usageRows.map(({ metric, effective_limit, used }) => ({ metric, effective_limit, used })),
  };
}
