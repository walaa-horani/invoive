"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { callFunction, type CallResult } from "@/lib/supabase/call-function";
import { primaryButton } from "../../clients/ClientDialog";

// Countries where Stripe accounts can accept card payments (common ones).
// Stripe has the final say and its refusal is shown as-is.
const COUNTRIES: [string, string][] = [
  ["AE", "United Arab Emirates"], ["AT", "Austria"], ["AU", "Australia"], ["BE", "Belgium"], ["BG", "Bulgaria"],
  ["BR", "Brazil"], ["CA", "Canada"], ["CH", "Switzerland"], ["CY", "Cyprus"], ["CZ", "Czech Republic"],
  ["DE", "Germany"], ["DK", "Denmark"], ["EE", "Estonia"], ["ES", "Spain"], ["FI", "Finland"], ["FR", "France"],
  ["GB", "United Kingdom"], ["GI", "Gibraltar"], ["GR", "Greece"], ["HK", "Hong Kong"], ["HR", "Croatia"],
  ["HU", "Hungary"], ["IE", "Ireland"], ["IT", "Italy"], ["JP", "Japan"], ["LI", "Liechtenstein"],
  ["LT", "Lithuania"], ["LU", "Luxembourg"], ["LV", "Latvia"], ["MT", "Malta"], ["MX", "Mexico"],
  ["MY", "Malaysia"], ["NL", "Netherlands"], ["NO", "Norway"], ["NZ", "New Zealand"], ["PL", "Poland"],
  ["PT", "Portugal"], ["RO", "Romania"], ["SE", "Sweden"], ["SG", "Singapore"], ["SI", "Slovenia"],
  ["SK", "Slovakia"], ["TH", "Thailand"], ["US", "United States"],
];

// Sends the owner/admin to Stripe-hosted onboarding, and re-syncs the
// account status when Stripe sends them back.
export function ConnectStripe({
  tenantId,
  label,
  onboarding,
  needsCountry = false,
}: {
  tenantId: string;
  label: string;
  onboarding?: "return" | "refresh";
  // No Stripe account yet: Stripe needs the business country to create one.
  needsCountry?: boolean;
}) {
  const router = useRouter();
  // Coming back from Stripe starts busy: the effect below takes over.
  const [busy, setBusy] = useState(Boolean(onboarding));
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);
  const [country, setCountry] = useState("");

  const onboard = () => callFunction("connect-onboarding", { tenant_id: tenantId, action: "onboard", country });

  function follow(result: CallResult) {
    if (result.ok && typeof result.data.url === "string") {
      window.location.assign(result.data.url);
      return;
    }
    setError(String(result.data.error ?? "Could not open Stripe. Please try again."));
    setBusy(false);
  }

  function start() {
    if (needsCountry && !country) {
      setError("Choose the country your business is based in.");
      return;
    }
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
    <div className="flex flex-col items-start gap-3">
      {needsCountry && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[#0F172A]">Where is your business based?</span>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            disabled={busy}
            className="w-72 max-w-full rounded-[12px] border border-[#E2E8F0] bg-white px-3 py-2.5 text-[15px] text-[#0F172A] outline-none hover:border-[#CBD5E1] focus:border-[#2563EB] focus:ring-2 focus:ring-[#3B82F6]/30"
          >
            <option value="">Choose a country</option>
            {COUNTRIES.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
          <span className="text-xs text-[#64748B]">Stripe uses this to set up your account. It can&apos;t be changed later.</span>
        </label>
      )}
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
