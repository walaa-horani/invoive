import type { Metadata } from "next";
import Link from "next/link";
import { BILLING_ROLES, getActiveWorkspace, getSession } from "@/lib/workspace";
import { CreateWorkspaceForm } from "../workspaces/CreateWorkspaceForm";
import { secondaryButton } from "../../clients/ClientDialog";
import { ConnectStripe } from "./ConnectStripe";

export const metadata: Metadata = { title: "Payments — LedgerFlow" };

type Account = { status: "pending" | "enabled" | "restricted" | "disconnected"; charges_enabled: boolean; updated_at: string };

const STATUS: Record<Account["status"] | "none", { title: string; body: string; tone: string; icon: string }> = {
  none: {
    title: "Not connected",
    body: "Connect your own Stripe account so clients can pay your invoices by card. Money goes straight to your Stripe balance.",
    tone: "bg-[#F1F5F9] text-[#475569]",
    icon: "link_off",
  },
  pending: {
    title: "Setup not finished",
    body: "Stripe still needs some details before you can accept payments.",
    tone: "bg-[#fff4e5] text-[#623f00]",
    icon: "pending",
  },
  restricted: {
    title: "Action needed",
    body: "Stripe needs more information. Card payments are paused until it's provided.",
    tone: "bg-[#ffdad6] text-[#93000a]",
    icon: "error",
  },
  enabled: {
    title: "Connected",
    body: "Clients can pay your invoices by card. Payouts, refunds and disputes are handled in your Stripe Dashboard.",
    tone: "bg-[#ecfdf5] text-[#047857]",
    icon: "check_circle",
  },
  disconnected: {
    title: "Disconnected",
    body: "This Stripe account was disconnected or closed. Clients can't pay online until a new one is connected — contact support.",
    tone: "bg-[#ffdad6] text-[#93000a]",
    icon: "link_off",
  },
};

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ onboarding?: string }> }) {
  const { onboarding } = await searchParams;
  const { supabase } = await getSession();
  const { active } = await getActiveWorkspace();
  if (!active) return <CreateWorkspaceForm first />;

  const [account, feature, entitlement] = await Promise.all([
    supabase.from("tenant_payment_accounts").select("status, charges_enabled, updated_at").eq("tenant_id", active.id).maybeSingle(),
    supabase.from("tenant_features").select("feature").eq("tenant_id", active.id).eq("feature", "online_payments").maybeSingle(),
    supabase.from("tenant_entitlements").select("effective_plan").eq("tenant_id", active.id).limit(1).maybeSingle(),
  ]);
  for (const result of [account, feature, entitlement]) {
    if (result.error) throw new Error(result.error.message);
  }
  const plan = (entitlement.data?.effective_plan as string | null | undefined) ?? null;
  const fee = plan
    ? await supabase.from("plans").select("name, payment_fee_bps").eq("code", plan).maybeSingle()
    : { data: null, error: null };
  if (fee.error) throw new Error(fee.error.message);

  const row = account.data as Account | null;
  const state = STATUS[row?.status ?? "none"];
  const canManage = BILLING_ROLES.has(active.role);
  const hasFeature = Boolean(feature.data);
  const feeBps = (fee.data?.payment_fee_bps as number | undefined) ?? null;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="font-headline-md md:font-headline-lg text-[#0F172A]">Payments</h1>
        <p className="font-body-sm text-[#64748B] mt-1">{active.name} · let clients pay invoices online</p>
      </div>

      <section className="rounded-[24px] border border-[#E2E8F0] bg-white p-6 md:p-8 shadow-[0_1px_3px_0_rgba(15,23,42,0.05),0_1px_2px_-1px_rgba(15,23,42,0.05)]">
        <div className="flex items-start gap-4">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${state.tone}`}>
            <span aria-hidden className="material-symbols-outlined text-[24px]">{state.icon}</span>
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="font-headline-sm text-[#0F172A]">Stripe · {state.title}</h2>
            <p className="text-sm text-[#475569]">{state.body}</p>
            {feeBps !== null && feeBps > 0 && (
              <p className="text-sm text-[#64748B]">
                LedgerFlow fee on your {fee.data?.name} plan: <span className="font-code-num text-[#0F172A]">{feeBps / 100}%</span> of each
                online payment, plus Stripe&apos;s own processing fees.
              </p>
            )}
          </div>
        </div>

        <div className="mt-6">
          {!hasFeature ? (
            <p className="text-sm text-[#475569]">
              Online payments need an active plan.{" "}
              <Link href="/settings/billing" className="font-semibold underline">Choose a plan</Link>
            </p>
          ) : !canManage ? (
            <p className="text-sm text-[#64748B]">Only the workspace owner or an admin can connect Stripe.</p>
          ) : row?.status === "disconnected" ? null : (
            <ConnectStripe
              tenantId={active.id}
              label={!row ? "Connect Stripe" : row.status === "enabled" ? "Update details in Stripe" : "Finish setup in Stripe"}
              onboarding={onboarding === "return" || onboarding === "refresh" ? onboarding : undefined}
              needsCountry={!row}
            />
          )}
        </div>
      </section>

      {row && row.status !== "disconnected" && (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-[#E2E8F0] bg-white p-6 md:p-8">
          <div className="flex flex-col gap-1">
            <h2 className="font-headline-sm text-[#0F172A]">Payments, payouts and balance</h2>
            <p className="max-w-md text-sm text-[#475569]">
              Every client payment lands in your own Stripe account. See payments, refunds, disputes, fees and payouts in
              your Stripe Dashboard — sign in with the Stripe login you created during setup.
            </p>
          </div>
          {/* The tenant's own full Stripe Dashboard: access is controlled by Stripe's login, not by LedgerFlow. */}
          <a
            href="https://dashboard.stripe.com/"
            target="_blank"
            rel="noopener noreferrer"
            className={secondaryButton}
          >
            Open Stripe Dashboard
            <span aria-hidden className="material-symbols-outlined text-[18px]">open_in_new</span>
          </a>
        </section>
      )}
    </div>
  );
}
