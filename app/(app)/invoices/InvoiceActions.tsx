"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { InvoiceStatus } from "@/lib/invoices";
import { primaryButton, secondaryButton } from "../clients/ClientDialog";
import {
  deleteDraft,
  issueInvoice,
  markPaid,
  rotatePayLink,
  voidInvoice,
  type InvoiceActionState,
} from "./actions";

const OPS = {
  issue: issueInvoice,
  rotate: rotatePayLink,
  paid: markPaid,
  void: voidInvoice,
  delete: deleteDraft,
};
type Op = keyof typeof OPS;

const CONFIRM: Partial<Record<Op, string>> = {
  delete: "Delete this draft? This can't be undone.",
  issue: "Issue this invoice? It gets a number, its lines are locked and it counts toward this month's invoices. Save any edits first.",
  paid: "Record the remaining balance as paid outside LedgerFlow (cash, bank transfer…)? The payment link stops working.",
  void: "Void this invoice? Its payment link stops working and it can't be paid any more.",
};

// The link is shown only right after it is created: the database keeps just
// a hash of it.
// Rendered only in the browser, after an action returned a token.
function PayLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/pay/${token}`;

  return (
    <div className="flex flex-col gap-2 rounded-[16px] border border-[#bfdbfe] bg-[#eff6ff] p-4">
      <p className="text-sm font-semibold text-[#0F172A]">Payment link for your client</p>
      <p className="text-xs text-[#475569]">
        Copy it now and send it to your client. For security it won&apos;t be shown again; you can create a new one any time.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          readOnly
          aria-label="Payment link"
          value={url}
          onFocus={(e) => e.target.select()}
          className="min-w-0 flex-1 rounded-[12px] border border-[#E2E8F0] bg-white px-3 py-2 font-code-num text-xs text-[#0F172A]"
        />
        <button
          type="button"
          className={secondaryButton}
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          }}
        >
          <span aria-hidden className="material-symbols-outlined text-[18px]">{copied ? "check" : "content_copy"}</span>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

// One panel for the whole life of an invoice. It stays mounted while the
// page re-renders from draft to issued, so the token returned by "Issue"
// survives that refresh.
export function InvoiceActions({
  id,
  status,
  canPayOnline,
}: {
  id: string;
  status: InvoiceStatus;
  canPayOnline: boolean;
}) {
  const [state, formAction, pending] = useActionState<InvoiceActionState, FormData>(
    async (prev, formData) => {
      const op = String(formData.get("op")) as Op;
      const next = await OPS[op](prev, formData);
      // Keep the latest link until a newer one replaces it.
      return { ...next, token: next.token ?? prev.token };
    },
    {},
  );

  const button = (op: Op, label: React.ReactNode, className: string) => (
    <button
      type="submit"
      name="op"
      value={op}
      disabled={pending}
      className={className}
      onClick={(e) => {
        const message = op === "rotate" && state.token ? "Create a new link? The current one will stop working." : CONFIRM[op];
        if (message && !window.confirm(message)) e.preventDefault();
      }}
    >
      {label}
    </button>
  );

  if (status === "paid" || status === "void") {
    return null;
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      {status === "issued" && state.token && canPayOnline && <PayLink key={state.token} token={state.token} />}
      {status === "issued" && state.token && !canPayOnline && (
        <p className="rounded-[12px] bg-[#F1F5F9] px-4 py-3 text-sm text-[#475569]">
          Invoice issued. Online payment isn&apos;t set up yet —{" "}
          <Link href="/settings/payments" className="font-semibold underline">connect Stripe</Link> to send a payment link.
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {status === "draft" && (
          <>
            {button("delete", "Delete draft", secondaryButton)}
            {button(
              "issue",
              <>
                <span aria-hidden className="material-symbols-outlined text-[18px]">send</span>
                {pending ? "Working…" : "Issue invoice"}
              </>,
              primaryButton,
            )}
          </>
        )}
        {status === "issued" && (
          <>
            {button("void", "Void", `${secondaryButton} text-[#93000a]`)}
            {button("paid", "Mark as paid", secondaryButton)}
            {canPayOnline &&
              button(
                "rotate",
                <>
                  <span aria-hidden className="material-symbols-outlined text-[18px]">link</span>
                  {state.token ? "New payment link" : "Get payment link"}
                </>,
                primaryButton,
              )}
          </>
        )}
      </div>

      {state.error && (
        <div role="alert" className="rounded-[12px] border border-[#ffb4ab] bg-[#ffdad6] px-4 py-3 text-sm text-[#93000a]">
          {state.error}
          {state.limitReached && (
            <>
              {" "}
              <Link href="/settings/billing" className="font-semibold underline">Upgrade your plan</Link>
            </>
          )}
        </div>
      )}
    </form>
  );
}
