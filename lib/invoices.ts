// Invoice types and display helpers shared by server pages and client forms.
// Amounts are integer minor units (cents); the database computes every total.

export type InvoiceStatus = "draft" | "issued" | "paid" | "void";
export type Currency = "usd" | "eur" | "gbp" | "cad" | "aud";

export const CURRENCIES: Currency[] = ["usd", "eur", "gbp", "cad", "aud"];

export const STATUS_META: Record<InvoiceStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-[#F1F5F9] text-[#475569]" },
  issued: { label: "Unpaid", className: "bg-[#fff4e5] text-[#623f00]" },
  paid: { label: "Paid", className: "bg-[#ecfdf5] text-[#047857]" },
  void: { label: "Void", className: "bg-[#F1F5F9] text-[#94A3B8] line-through" },
};

export type AttemptStatus =
  | "open"
  | "succeeded"
  | "failed"
  | "expired"
  | "needs_review"
  | "refunded"
  | "partially_refunded"
  | "disputed";

export const ATTEMPT_LABELS: Record<AttemptStatus, string> = {
  open: "Checkout started",
  succeeded: "Paid",
  failed: "Failed",
  expired: "Not completed",
  needs_review: "Needs review — amount differs",
  refunded: "Refunded",
  partially_refunded: "Partially refunded",
  disputed: "Disputed",
};

export type DraftItem = { description: string; quantity: string; unitPrice: string; taxPercent: string };

// "12.5" -> 1250. Null when not a valid non-negative amount with ≤ 2 decimals.
export function toMinorUnits(value: string): number | null {
  const trimmed = value.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const amount = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(amount) ? amount : null;
}

// "7.5" (%) -> 750 basis points.
export function toBasisPoints(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const bps = Math.round(Number(trimmed) * 100);
  return bps <= 10000 ? bps : null;
}

// Same rounding as the database's generated columns; preview only.
export function lineTotals(item: { quantity: number; unitAmount: number; taxBps: number }) {
  const amount = Math.round(item.quantity * item.unitAmount);
  return { amount, tax: Math.round((amount * item.taxBps) / 10000) };
}
