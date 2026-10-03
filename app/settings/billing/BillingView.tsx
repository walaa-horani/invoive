import Link from "next/link";
import {
  FEATURE_LABELS,
  FEATURE_ORDER,
  formatDate,
  formatLimit,
  formatMoney,
  METRIC_LABELS,
  METRIC_ORDER,
} from "@/lib/billing/format";
import type { BillingPageData, Plan } from "@/lib/billing/load";
import { CheckoutReturn } from "./CheckoutReturn";
import { PlanAction } from "./PlanAction";

const BILLING_ROLES = new Set(["owner", "admin"]);

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-[#85f8c4]/40 text-[#005236]" },
  past_due: { label: "Payment retrying", className: "bg-[#ffddb3] text-[#623f00]" },
  incomplete: { label: "Payment processing", className: "bg-[#eff4ff] text-[#0051d5]" },
  trialing: { label: "Trial", className: "bg-[#eff4ff] text-[#0051d5]" },
  canceled: { label: "Canceled", className: "bg-[#e5e7eb] text-[#45464d]" },
  incomplete_expired: { label: "Expired", className: "bg-[#e5e7eb] text-[#45464d]" },
  unpaid: { label: "Unpaid", className: "bg-[#ffdad6] text-[#93000a]" },
  paused: { label: "Paused", className: "bg-[#e5e7eb] text-[#45464d]" },
};

// Presentation only; app/settings/billing/page.tsx loads the data.
export function BillingView({ data, checkout }: { data: BillingPageData; checkout?: string }) {
  const canManage = BILLING_ROLES.has(data.tenant.role);
  const currentPlan = data.plans.find((p) => p.code === data.effectivePlan) ?? null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-headline text-3xl font-bold text-[#0b1c30] tracking-tight">Billing</h1>
          <p className="text-sm text-[#45464d] mt-1">
            Plan and usage for <strong className="text-[#0b1c30]">{data.tenant.name}</strong>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.tenants.length > 1 && <TenantSwitcher data={data} />}
          <Link
            href="/settings/workspaces/new"
            className="inline-flex items-center gap-1 text-sm font-medium px-3 py-1.5 rounded-lg border border-[#E2E8F0] bg-white text-[#0F172A] hover:border-[#CBD5E1] hover:bg-[#F8FAFC]"
          >
            <span aria-hidden className="material-symbols-outlined text-[18px]">add</span>
            New workspace
          </Link>
        </div>
      </div>

      {checkout === "success" && <CheckoutReturn activated={currentPlan !== null} />}
      {checkout === "canceled" && (
        <div className="rounded-xl bg-[#eff4ff] border border-[#dce9ff] px-4 py-3 text-sm text-[#0b1c30]">
          Checkout was canceled. Nothing was charged.
        </div>
      )}

      {!canManage && (
        <div className="rounded-xl bg-[#eff4ff] border border-[#dce9ff] px-4 py-3 text-sm text-[#45464d]">
          Only the workspace owner or an admin can change the plan.
        </div>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-6">
        <CurrentPlanCard data={data} currentPlan={currentPlan} canManage={canManage} />
        <UsageCard data={data} hasPlan={currentPlan !== null} />
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="font-headline text-xl font-bold text-[#0b1c30]">
            {currentPlan ? "Change plan" : "Choose a plan"}
          </h2>
          <p className="text-sm text-[#45464d] mt-1">
            Upgrades start immediately and you pay only the prorated difference. Downgrades start at your next
            renewal, so you keep what you&apos;ve paid for.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
          {data.plans.map((plan) => (
            <PlanCard key={plan.code} plan={plan} data={data} currentPlan={currentPlan} canManage={canManage} />
          ))}
        </div>
      </section>
    </div>
  );
}

function CurrentPlanCard({
  data,
  currentPlan,
  canManage,
}: {
  data: BillingPageData;
  currentPlan: Plan | null;
  canManage: boolean;
}) {
  const sub = data.subscription;
  const badge = sub ? STATUS_BADGES[sub.status] ?? { label: sub.status, className: "bg-[#e5e7eb] text-[#45464d]" } : null;
  const planName = (code: string | null) => data.plans.find((p) => p.code === code)?.name ?? code;

  return (
    <div className="bg-white rounded-2xl border border-[#dce9ff] shadow-[0_2px_12px_rgba(0,0,0,0.03)] p-6 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="text-xs uppercase tracking-wider text-[#76777d] font-bold">Current plan</span>
          <h2 className="font-headline text-2xl font-bold text-[#0b1c30] mt-1">
            {currentPlan?.name ?? "No active plan"}
          </h2>
        </div>
        {badge && (
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${badge.className}`}>
            {badge.label}
          </span>
        )}
      </div>

      {currentPlan && data.subscriptionPrice && (
        <p className="text-sm text-[#45464d]">
          <span className="font-code-num text-xl font-bold text-[#0b1c30]">
            {formatMoney(data.subscriptionPrice.amount, data.subscriptionPrice.currency)}
          </span>
          /month
          {sub?.current_period_end && !sub.cancel_at_period_end && !sub.cancel_at && (
            <> · renews {formatDate(sub.current_period_end)}</>
          )}
        </p>
      )}

      {!currentPlan && (
        <p className="text-sm text-[#45464d]">
          {sub?.status === "incomplete"
            ? "Your first payment is still processing. Your plan will appear here once it's confirmed."
            : "Your workspace is read-only. Choose a plan below to keep adding clients, invoices and team members."}
        </p>
      )}

      {sub?.status === "past_due" && (
        <Notice tone="warning">
          Your last payment failed.{" "}
          {sub.next_payment_attempt
            ? `Stripe will retry on ${formatDate(sub.next_payment_attempt)}.`
            : "Stripe will retry automatically."}{" "}
          Your plan stays active while it retries — check the payment email from Stripe to update your card.
        </Notice>
      )}

      {sub && (sub.cancel_at_period_end || sub.cancel_at) && currentPlan && (
        <Notice tone="warning">
          Your subscription ends on {formatDate(sub.cancel_at ?? sub.current_period_end)}. Plan changes are
          unavailable until it&apos;s resumed.
        </Notice>
      )}

      {sub?.pending_plan_code && (
        <Notice tone="info">
          Your upgrade to {planName(sub.pending_plan_code)} is waiting for payment confirmation (until{" "}
          {formatDate(sub.pending_update_expires_at)}). You stay on {currentPlan?.name ?? "your plan"} until then.
        </Notice>
      )}

      {sub?.scheduled_plan_code && sub.scheduled_change_at && currentPlan && (
        <Notice tone="info">
          <div className="flex flex-col gap-3">
            <span>
              You&apos;ll switch to <strong>{planName(sub.scheduled_plan_code)}</strong> on{" "}
              {formatDate(sub.scheduled_change_at)}. Until then you keep everything in {currentPlan.name}.
            </span>
            {canManage && (
              <div className="max-w-[240px]">
                <PlanAction
                  tenantId={data.tenant.id}
                  planCode={currentPlan.code}
                  planName={currentPlan.name}
                  currentPlanName={currentPlan.name}
                  mode="change"
                  label={`Keep ${currentPlan.name}`}
                  variant="secondary"
                />
              </div>
            )}
          </div>
        </Notice>
      )}
    </div>
  );
}

function UsageCard({ data, hasPlan }: { data: BillingPageData; hasPlan: boolean }) {
  const usage = METRIC_ORDER.map((metric) => data.usage.find((u) => u.metric === metric)).filter((u) => u !== undefined);

  return (
    <div className="bg-white rounded-2xl border border-[#dce9ff] shadow-[0_2px_12px_rgba(0,0,0,0.03)] p-6 flex flex-col gap-5">
      <span className="text-xs uppercase tracking-wider text-[#76777d] font-bold">Usage</span>
      {usage.map(({ metric, used, effective_limit }) => {
        const { label } = METRIC_LABELS[metric];
        // Without a plan everything is read-only; the plan card already says
        // so, so show plain counts instead of a wall of "over limit" bars.
        if (!hasPlan) {
          return (
            <div key={metric} className="flex items-baseline justify-between text-sm">
              <span className="text-[#45464d]">{label}</span>
              <span className="font-code-num font-semibold text-[#0b1c30]">{used}</span>
            </div>
          );
        }
        const over = effective_limit !== null && used > effective_limit;
        const full = effective_limit !== null && used >= effective_limit;
        const pct = effective_limit === null ? 0 : effective_limit === 0 ? 100 : Math.min(100, (used / effective_limit) * 100);
        return (
          <div key={metric} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-[#45464d]">{label}</span>
              <span className="font-code-num font-semibold text-[#0b1c30]">
                {used} {effective_limit === null ? <span className="text-[#76777d]">/ unlimited</span> : `/ ${effective_limit}`}
              </span>
            </div>
            <div
              className="h-2 rounded-full bg-[#eff4ff] overflow-hidden"
              role="progressbar"
              aria-label={label}
              aria-valuenow={used}
              aria-valuemin={0}
              aria-valuemax={effective_limit ?? undefined}
            >
              <div
                className={`h-full rounded-full ${full ? "bg-[#ba1a1a]" : pct >= 80 ? "bg-[#f59e0b]" : "bg-[#0051d5]"}`}
                style={{ width: effective_limit === null ? "100%" : `${pct}%`, opacity: effective_limit === null ? 0.15 : 1 }}
              />
            </div>
            {over && (
              <span className="text-xs text-[#ba1a1a]">
                Over your plan&apos;s limit. Existing items are kept, but you can&apos;t add new ones.
              </span>
            )}
            {!over && full && <span className="text-xs text-[#ba1a1a]">Limit reached.</span>}
          </div>
        );
      })}
    </div>
  );
}

function PlanCard({
  plan,
  data,
  currentPlan,
  canManage,
}: {
  plan: Plan;
  data: BillingPageData;
  currentPlan: Plan | null;
  canManage: boolean;
}) {
  const sub = data.subscription;
  const isCurrent = currentPlan?.code === plan.code;
  const action = planAction(plan, data, currentPlan, canManage);

  return (
    <div
      className={`flex flex-col rounded-2xl p-6 bg-white transition-shadow ${
        isCurrent
          ? "border-2 border-[#0051d5] shadow-[0_12px_36px_-6px_rgba(0,81,213,0.18)]"
          : "border border-[#dce9ff] shadow-[0_2px_12px_rgba(0,0,0,0.03)]"
      }`}
    >
      <div className="flex items-center justify-between">
        <h3 className="font-headline text-lg font-bold text-[#0b1c30]">{plan.name}</h3>
        {isCurrent && (
          <span className="bg-[#0051d5] text-white text-xs px-2.5 py-0.5 rounded-full font-semibold">Current</span>
        )}
        {!isCurrent && sub?.scheduled_plan_code === plan.code && (
          <span className="bg-[#eff4ff] text-[#0051d5] text-xs px-2.5 py-0.5 rounded-full font-semibold">
            From {formatDate(sub.scheduled_change_at)}
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-1 my-4">
        {plan.price ? (
          <>
            <span className="font-code-num text-4xl font-extrabold text-[#0b1c30] tracking-tight">
              {formatMoney(plan.price.amount, plan.price.currency)}
            </span>
            <span className="text-sm text-[#45464d]">/month</span>
          </>
        ) : (
          <span className="text-sm text-[#76777d]">Price unavailable</span>
        )}
      </div>

      <div className="bg-[#f8f9ff] border border-[#e5eeff] rounded-xl p-4 mb-5 flex flex-col gap-2 text-xs">
        {METRIC_ORDER.map((metric) => (
          <div key={metric} className="flex items-center justify-between">
            <span className="text-[#45464d]">{METRIC_LABELS[metric].label}</span>
            <span className="font-code-num font-semibold text-[#0b1c30]">
              {/* NULL = unlimited; a missing row fails closed to 0, like the database. */}
              {formatLimit(metric in plan.limits ? plan.limits[metric] : 0, METRIC_LABELS[metric].unit)}
              {METRIC_LABELS[metric].monthly && plan.limits[metric] !== null ? "/mo" : ""}
            </span>
          </div>
        ))}
      </div>

      <ul className="flex flex-col gap-2 text-xs mb-6 flex-1">
        {FEATURE_ORDER.map((feature) => {
          const included = plan.features.includes(feature);
          return (
            <li key={feature} className={`flex items-center gap-2 ${included ? "text-[#0b1c30]" : "text-[#a0a3ad]"}`}>
              <span
                aria-hidden
                className={`material-symbols-outlined text-[16px] ${included ? "text-[#069669]" : "text-[#c6c6cd]"}`}
              >
                {included ? "check_circle" : "remove"}
              </span>
              <span className={included ? "" : "line-through"}>{FEATURE_LABELS[feature]}</span>
              <span className="sr-only">{included ? "included" : "not included"}</span>
            </li>
          );
        })}
      </ul>

      {action.kind === "button" ? (
        <PlanAction
          tenantId={data.tenant.id}
          planCode={plan.code}
          planName={plan.name}
          currentPlanName={currentPlan?.name ?? null}
          mode={action.mode}
          label={action.label}
          variant={action.variant}
          disabled={action.disabled}
        />
      ) : (
        <div className="w-full text-center text-sm font-semibold py-3 px-4 rounded-xl bg-[#f8f9ff] text-[#76777d] border border-[#e5eeff]">
          {action.label}
        </div>
      )}
      {action.kind === "button" && action.hint && <p className="text-xs text-[#76777d] mt-2 text-center">{action.hint}</p>}
    </div>
  );
}

type CardAction =
  | { kind: "label"; label: string }
  | {
      kind: "button";
      mode: "subscribe" | "change";
      label: string;
      variant: "primary" | "secondary" | "dark";
      disabled: boolean;
      hint?: string;
    };

// What the card offers. Purely presentational: change-plan and
// create-checkout-session re-check everything against Stripe.
function planAction(plan: Plan, data: BillingPageData, currentPlan: Plan | null, canManage: boolean): CardAction {
  const sub = data.subscription;

  if (!currentPlan) {
    if (sub?.status === "incomplete") return { kind: "label", label: "Payment processing" };
    return {
      kind: "button",
      mode: "subscribe",
      label: `Subscribe to ${plan.name}`,
      variant: "primary",
      disabled: !canManage,
    };
  }

  if (plan.code === currentPlan.code) return { kind: "label", label: "Your current plan" };
  if (sub?.pending_plan_code === plan.code) return { kind: "label", label: "Awaiting payment" };
  if (sub?.scheduled_plan_code === plan.code) return { kind: "label", label: "Scheduled" };

  const upgrade = plan.rank > currentPlan.rank;
  const blockedReason =
    sub?.status !== "active"
      ? "Available once your payment is up to date."
      : sub.cancel_at_period_end || sub.cancel_at
      ? "Resume your subscription to change plans."
      : sub.pending_plan_code
      ? "Finish the pending upgrade first."
      : undefined;

  return {
    kind: "button",
    mode: "change",
    label: upgrade ? `Upgrade to ${plan.name}` : `Downgrade to ${plan.name}`,
    variant: upgrade ? "primary" : "secondary",
    disabled: !canManage || blockedReason !== undefined,
    hint: blockedReason ?? (upgrade ? "Starts now · prorated" : `Starts ${formatDate(sub?.current_period_end)}`),
  };
}

function Notice({ tone, children }: { tone: "info" | "warning"; children: React.ReactNode }) {
  const styles =
    tone === "warning" ? "bg-[#fff4e5] border-[#ffddb3] text-[#623f00]" : "bg-[#eff4ff] border-[#dce9ff] text-[#0b1c30]";
  return <div className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}

function TenantSwitcher({ data }: { data: BillingPageData }) {
  return (
    <nav aria-label="Workspaces" className="flex flex-wrap gap-2">
      {data.tenants.map((t) => (
        <Link
          key={t.id}
          href={`/settings/billing?tenant=${t.id}`}
          aria-current={t.id === data.tenant.id ? "page" : undefined}
          className={`text-sm px-3 py-1.5 rounded-lg border ${
            t.id === data.tenant.id
              ? "bg-[#0051d5] border-[#0051d5] text-white"
              : "bg-white border-[#dce9ff] text-[#45464d] hover:text-[#0b1c30]"
          }`}
        >
          {t.name}
        </Link>
      ))}
    </nav>
  );
}
