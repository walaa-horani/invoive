"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { callFunction, type CallResult } from "@/lib/supabase/call-function";
import { primaryButton } from "../../clients/ClientDialog";

// Sends the owner/admin to Stripe-hosted onboarding, and re-syncs the
// account status when Stripe sends them back.
export function ConnectStripe({
  tenantId,
  label,
  onboarding,
}: {
  tenantId: string;
  label: string;
  onboarding?: "return" | "refresh";
}) {
  const router = useRouter();
  // Coming back from Stripe starts busy: the effect below takes over.
  const [busy, setBusy] = useState(Boolean(onboarding));
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  const onboard = () => callFunction("connect-onboarding", { tenant_id: tenantId, action: "onboard" });

  function follow(result: CallResult) {
    if (result.ok && typeof result.data.url === "string") {
      window.location.assign(result.data.url);
      return;
    }
    setError(String(result.data.error ?? "Could not open Stripe. Please try again."));
    setBusy(false);
  }

  function start() {
    setBusy(true);
    setError(null);
    void onboard().then(follow);
  }

  useEffect(() => {
    if (!onboarding || handled.current) return;
    handled.current = true;
    if (onboarding === "refresh") {
      // The onboarding link expired: get a fresh one.
      void callFunction("connect-onboarding", { tenant_id: tenantId, action: "onboard" }).then((result) => {
        if (result.ok && typeof result.data.url === "string") {
          window.location.assign(result.data.url);
          return;
        }
        setError(String(result.data.error ?? "Could not open Stripe. Please try again."));
        setBusy(false);
      });
      return;
    }
    void callFunction("connect-onboarding", { tenant_id: tenantId, action: "refresh" }).then((result) => {
      if (!result.ok) setError(String(result.data.error ?? "Could not check your Stripe account."));
      setBusy(false);
      router.replace("/settings/payments");
      router.refresh();
    });
  }, [onboarding, router, tenantId]);

  return (
    <div className="flex flex-col items-start gap-2">
      <button type="button" onClick={start} disabled={busy} className={primaryButton}>
        {busy ? "Opening Stripe…" : label}
      </button>
      {error && (
        <p role="alert" className="text-sm text-[#93000a]">
          {error}
        </p>
      )}
    </div>
  );
}
