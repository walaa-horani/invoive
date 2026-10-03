"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { callFunction } from "@/lib/supabase/call-function";

// Sends the client to Stripe Checkout. Only the link token goes to the
// server; the amount is decided there.
export function PayButton({ token, label }: { token: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const result = await callFunction("pay-invoice", { token });
          if (result.ok && typeof result.data.url === "string") {
            window.location.assign(result.data.url);
            return;
          }
          setError(String(result.data.error ?? "Could not start the payment. Please try again."));
          setBusy(false);
        }}
        className="inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-[#0F172A] px-6 py-3.5 text-base font-semibold text-white transition-all hover:-translate-y-px hover:bg-[#1E293B] active:translate-y-0 disabled:opacity-60 disabled:hover:translate-y-0"
      >
        <span aria-hidden className="material-symbols-outlined text-[20px]">lock</span>
        {busy ? "Opening secure checkout…" : label}
      </button>
      {error && (
        <p role="alert" className="text-sm text-[#93000a]">
          {error}
        </p>
      )}
    </div>
  );
}

// After Checkout: the webhook marks the invoice paid, usually within seconds.
// This only re-reads the page; it never marks anything itself.
export function PaymentReturn() {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (tries > 30) {
        clearInterval(timer);
        setGaveUp(true);
        return;
      }
      router.refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <div role="status" className="rounded-[12px] border border-[#bfdbfe] bg-[#eff6ff] px-4 py-3 text-sm text-[#1e3a8a]">
      {gaveUp
        ? "We haven't received the payment confirmation yet. If you completed the payment, it will show here shortly — refresh this page in a minute."
        : "Confirming your payment…"}
    </div>
  );
}
