"use client";

import { FunctionsHttpError } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatDate, formatMoney } from "@/lib/billing/format";
import { createClient } from "@/lib/supabase/client";

type Preview =
  | { kind: "upgrade"; amount_due: number; currency: string; proration_date: number }
  | { kind: "downgrade"; effective_at: string; renewal_unit_amount: number; currency: string }
  | { kind: "cancel_scheduled_change"; scheduled_change_at: string | null };

type Outcome =
  | { status: "applied" | "scheduled" | "scheduled_change_canceled"; effective_at?: string }
  | { status: "requires_payment"; hosted_invoice_url: string | null; expires_at: string };

type CallResult = { ok: true; data: Record<string, unknown> } | { ok: false; status: number; data: Record<string, unknown> };

// The Edge Functions decide everything; this component only shows what they
// return. The user's JWT is attached by the Supabase client.
async function callFunction(name: string, body: Record<string, unknown>): Promise<CallResult> {
  const { data, error } = await createClient().functions.invoke(name, { body });
  if (!error) return { ok: true, data };
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    const payload = await response.json().catch(() => ({ error: "Something went wrong." }));
    return { ok: false, status: response.status, data: payload };
  }
  return { ok: false, status: 0, data: { error: "Network error. Check your connection and try again." } };
}

const buttonStyles = {
  primary: "bg-[#0051d5] hover:bg-[#003ea8] text-white shadow-md",
  secondary: "bg-[#eff4ff] hover:bg-[#dce9ff] text-[#0b1c30] border border-[#dce9ff]",
  dark: "bg-[#0f172a] hover:bg-[#1e293b] text-white",
};

export function PlanAction({
  tenantId,
  planCode,
  planName,
  currentPlanName,
  mode,
  label,
  variant = "primary",
  disabled = false,
}: {
  tenantId: string;
  planCode: string;
  planName: string;
  currentPlanName: string | null;
  mode: "subscribe" | "change";
  label: string;
  variant?: keyof typeof buttonStyles;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function close() {
    setOpen(false);
    setPreview(null);
    setOutcome(null);
    setError(null);
  }

  async function loadPreview() {
    setBusy(true);
    setError(null);
    const result = await callFunction("change-plan", { tenant_id: tenantId, plan_code: planCode, action: "preview" });
    setBusy(false);
    if (result.ok) setPreview(result.data as Preview);
    else setError(String(result.data.error ?? "Could not load this change."));
  }

  async function start() {
    if (mode === "subscribe") {
      setBusy(true);
      setError(null);
      const result = await callFunction("create-checkout-session", { tenant_id: tenantId, plan_code: planCode });
      if (result.ok && typeof result.data.url === "string") {
        window.location.assign(result.data.url);
        return;
      }
      setBusy(false);
      setError(String(result.data.error ?? "Could not start checkout."));
      setOpen(true);
      return;
    }
    setOpen(true);
    await loadPreview();
  }

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { tenant_id: tenantId, plan_code: planCode, action: "confirm" };
    if (preview.kind === "upgrade") {
      body.proration_date = preview.proration_date;
      body.expected_amount_due = preview.amount_due;
    }
    const result = await callFunction("change-plan", body);
    setBusy(false);

    if (result.ok) {
      setOutcome(result.data as Outcome);
      router.refresh();
      return;
    }
    const reason = result.data.reason;
    if (reason === "amount_changed" && preview.kind === "upgrade") {
      // Show the new amount; the user confirms again before anything is charged.
      setPreview({ ...preview, amount_due: Number(result.data.amount_due) });
      setError("The amount changed since you opened this. Please review the new amount.");
    } else if (reason === "preview_expired") {
      setError("This quote expired. Here is an updated one.");
      await loadPreview();
    } else {
      setError(String(result.data.error ?? "Could not change your plan."));
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={start}
        disabled={disabled || busy}
        className={`w-full font-semibold text-sm py-3 px-4 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${buttonStyles[variant]}`}
      >
        {busy && !open ? "Please wait…" : label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1c30]/40 px-4"
          onClick={(e) => e.target === e.currentTarget && !busy && close()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`plan-dialog-${planCode}`}
            className="w-full max-w-md bg-white rounded-2xl border border-[#dce9ff] shadow-xl p-6 flex flex-col gap-4"
          >
            <h2 id={`plan-dialog-${planCode}`} className="font-headline text-lg font-bold text-[#0b1c30]">
              {dialogTitle(mode, preview, planName)}
            </h2>

            {busy && !preview && !error && <p className="text-sm text-[#45464d]">Calculating…</p>}

            {!outcome && preview && <PreviewDetails preview={preview} planName={planName} currentPlanName={currentPlanName} />}

            {outcome && <OutcomeDetails outcome={outcome} planName={planName} />}

            {error && (
              <p role="alert" className="text-sm text-[#ba1a1a] bg-[#ffdad6]/50 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="text-sm font-semibold px-4 py-2.5 rounded-xl text-[#45464d] hover:bg-[#eff4ff] disabled:opacity-50"
              >
                {outcome ? "Done" : "Cancel"}
              </button>
              {!outcome && preview && (
                <button
                  type="button"
                  onClick={confirm}
                  disabled={busy}
                  className="text-sm font-semibold px-4 py-2.5 rounded-xl bg-[#0051d5] hover:bg-[#003ea8] text-white shadow-md disabled:opacity-60"
                >
                  {busy ? "Working…" : confirmLabel(preview)}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function dialogTitle(mode: "subscribe" | "change", preview: Preview | null, planName: string) {
  if (mode === "subscribe") return `Subscribe to ${planName}`;
  if (preview?.kind === "downgrade") return `Switch to ${planName}`;
  if (preview?.kind === "cancel_scheduled_change") return `Stay on ${planName}`;
  return `Upgrade to ${planName}`;
}

function confirmLabel(preview: Preview) {
  if (preview.kind === "upgrade") {
    return preview.amount_due > 0 ? `Pay ${formatMoney(preview.amount_due, preview.currency)} and upgrade` : "Upgrade now";
  }
  if (preview.kind === "downgrade") return "Schedule change";
  return "Keep my plan";
}

function PreviewDetails({
  preview,
  planName,
  currentPlanName,
}: {
  preview: Preview;
  planName: string;
  currentPlanName: string | null;
}) {
  if (preview.kind === "upgrade") {
    return (
      <div className="flex flex-col gap-3 text-sm text-[#45464d]">
        <div className="flex items-baseline justify-between bg-[#f8f9ff] border border-[#e5eeff] rounded-xl p-4">
          <span>Due today</span>
          <span className="font-code-num text-2xl font-bold text-[#0b1c30]">
            {formatMoney(preview.amount_due, preview.currency)}
          </span>
        </div>
        <p>
          {planName} starts right away. You pay only the difference for the rest of this billing period, prorated
          to the second. Your renewal date stays the same.
        </p>
        <p className="text-xs text-[#76777d]">
          If the payment can&apos;t be completed, you stay on {currentPlanName ?? "your current plan"} and nothing
          changes.
        </p>
      </div>
    );
  }
  if (preview.kind === "downgrade") {
    return (
      <div className="flex flex-col gap-3 text-sm text-[#45464d]">
        <div className="flex items-baseline justify-between bg-[#f8f9ff] border border-[#e5eeff] rounded-xl p-4">
          <span>Due today</span>
          <span className="font-code-num text-2xl font-bold text-[#0b1c30]">
            {formatMoney(0, preview.currency)}
          </span>
        </div>
        <p>
          You keep {currentPlanName ?? "your current plan"} until <strong>{formatDate(preview.effective_at)}</strong>.
          From then on you&apos;ll pay {formatMoney(preview.renewal_unit_amount, preview.currency)}/month for {planName}.
        </p>
        <p className="text-xs text-[#76777d]">
          Nothing is deleted. If you&apos;re over a {planName} limit when it starts, existing items stay, but you
          can&apos;t add new ones until you&apos;re under the limit. You can cancel this change any time before then.
        </p>
      </div>
    );
  }
  return (
    <p className="text-sm text-[#45464d]">
      Cancel the scheduled change{preview.scheduled_change_at ? ` on ${formatDate(preview.scheduled_change_at)}` : ""} and
      keep {planName}. Nothing is charged.
    </p>
  );
}

function OutcomeDetails({ outcome, planName }: { outcome: Outcome; planName: string }) {
  if (outcome.status === "requires_payment") {
    return (
      <div className="flex flex-col gap-3 text-sm text-[#45464d]">
        <p>
          Your bank needs you to confirm this payment. You&apos;re still on your current plan; {planName} starts as
          soon as the payment goes through.
        </p>
        {outcome.hosted_invoice_url && (
          <a
            href={outcome.hosted_invoice_url}
            target="_blank"
            rel="noopener noreferrer"
            className="self-start text-sm font-semibold px-4 py-2.5 rounded-xl bg-[#0051d5] hover:bg-[#003ea8] text-white shadow-md"
          >
            Complete payment
          </a>
        )}
        <p className="text-xs text-[#76777d]">This upgrade offer expires {formatDate(outcome.expires_at)}.</p>
      </div>
    );
  }
  const message =
    outcome.status === "applied"
      ? `You're now on ${planName}. Your new limits apply immediately.`
      : outcome.status === "scheduled"
      ? `Done. You'll switch to ${planName} on ${formatDate(outcome.effective_at)}.`
      : `The scheduled change is canceled. You'll stay on ${planName}.`;
  return (
    <p role="status" className="text-sm text-[#005236] bg-[#85f8c4]/30 rounded-lg px-3 py-2">
      {message}
    </p>
  );
}
