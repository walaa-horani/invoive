"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// After Stripe Checkout the plan appears only once the webhook has confirmed
// the payment. Re-render from the server for a short while until it does.
export function CheckoutReturn({ activated }: { activated: boolean }) {
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);
  const waiting = !activated && attempts < 10;

  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => {
      setAttempts((n) => n + 1);
      router.refresh();
    }, 3000);
    return () => clearTimeout(timer);
  }, [waiting, attempts, router]);

  if (activated) {
    return (
      <div role="status" className="rounded-xl bg-[#85f8c4]/30 border border-[#85f8c4] px-4 py-3 text-sm text-[#005236]">
        Payment received. Your plan is active.
      </div>
    );
  }
  return (
    <div role="status" className="rounded-xl bg-[#eff4ff] border border-[#dce9ff] px-4 py-3 text-sm text-[#0b1c30]">
      {waiting
        ? "Confirming your payment with Stripe…"
        : "Your payment is still being confirmed. This page will show your plan as soon as it's done — refresh in a minute."}
    </div>
  );
}
