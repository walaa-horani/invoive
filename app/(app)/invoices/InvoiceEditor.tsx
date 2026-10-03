"use client";

import { useActionState, useState } from "react";
import { formatMoney } from "@/lib/billing/format";
import { CURRENCIES, lineTotals, toBasisPoints, toMinorUnits, type Currency, type DraftItem } from "@/lib/invoices";
import { primaryButton, secondaryButton } from "../clients/ClientDialog";
import { saveDraft, type InvoiceActionState } from "./actions";

export type EditorInvoice = {
  id: string;
  client_id: string;
  currency: Currency;
  issue_date: string | null;
  due_date: string | null;
  notes: string | null;
  items: DraftItem[];
};

const inputClass =
  "w-full rounded-[12px] border border-[#E2E8F0] bg-white px-3 py-2 text-[15px] text-[#0F172A] placeholder:text-[#94A3B8] outline-none transition-colors hover:border-[#CBD5E1] focus:border-[#2563EB] focus:ring-2 focus:ring-[#3B82F6]/30";
const labelClass = "text-sm font-medium text-[#0F172A]";

const emptyItem = (): DraftItem => ({ description: "", quantity: "1", unitPrice: "", taxPercent: "" });

// Totals here are a preview; the database computes the real ones on save.
export function InvoiceEditor({
  clients,
  invoice,
  defaultClientId,
}: {
  clients: { id: string; name: string }[];
  invoice?: EditorInvoice;
  defaultClientId?: string;
}) {
  const [state, action, pending] = useActionState<InvoiceActionState, FormData>(saveDraft, {});
  const [currency, setCurrency] = useState<Currency>(invoice?.currency ?? "usd");
  const [items, setItems] = useState<DraftItem[]>(invoice?.items.length ? invoice.items : [emptyItem()]);

  const update = (index: number, patch: Partial<DraftItem>) =>
    setItems((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const totals = items.reduce(
    (acc, row) => {
      const unitAmount = toMinorUnits(row.unitPrice) ?? 0;
      const quantity = Number(row.quantity) > 0 ? Number(row.quantity) : 0;
      const { amount, tax } = lineTotals({ quantity, unitAmount, taxBps: toBasisPoints(row.taxPercent) ?? 0 });
      return { subtotal: acc.subtotal + amount, tax: acc.tax + tax };
    },
    { subtotal: 0, tax: 0 },
  );

  return (
    <form
      action={action}
      className="flex flex-col gap-6 rounded-[24px] border border-[#E2E8F0] bg-white p-5 md:p-8 shadow-[0_1px_3px_0_rgba(15,23,42,0.05),0_1px_2px_-1px_rgba(15,23,42,0.05)]"
    >
      {invoice && <input type="hidden" name="id" value={invoice.id} />}
      <input type="hidden" name="items" value={JSON.stringify(items)} />

      <div className="grid gap-4 md:grid-cols-4">
        <label className="flex flex-col gap-1.5 md:col-span-2">
          <span className={labelClass}>Client</span>
          <select name="client_id" required defaultValue={invoice?.client_id ?? defaultClientId ?? ""} className={inputClass}>
            <option value="" disabled>Choose a client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Issue date</span>
          <input type="date" name="issue_date" defaultValue={invoice?.issue_date ?? ""} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Due date</span>
          <input type="date" name="due_date" defaultValue={invoice?.due_date ?? ""} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Currency</span>
          <select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} className={inputClass}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c.toUpperCase()}</option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className={`${labelClass} mb-2`}>Line items</legend>
        <div className="hidden grid-cols-[1fr_90px_130px_90px_40px] gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-[#64748B] md:grid">
          <span>Description</span>
          <span>Qty</span>
          <span>Price</span>
          <span>Tax %</span>
          <span className="sr-only">Remove</span>
        </div>
        {items.map((row, index) => (
          <div key={index} className="grid grid-cols-[1fr_1fr_1fr_40px] gap-2 border-b border-[#F1F5F9] pb-3 md:grid-cols-[1fr_90px_130px_90px_40px] md:border-0 md:pb-0">
            <input
              aria-label={`Line ${index + 1} description`}
              value={row.description}
              onChange={(e) => update(index, { description: e.target.value })}
              maxLength={500}
              placeholder="Design work"
              className={`${inputClass} col-span-4 md:col-span-1`}
            />
            <input
              aria-label={`Line ${index + 1} quantity`}
              inputMode="decimal"
              value={row.quantity}
              onChange={(e) => update(index, { quantity: e.target.value })}
              className={`${inputClass} font-code-num`}
            />
            <input
              aria-label={`Line ${index + 1} unit price`}
              inputMode="decimal"
              value={row.unitPrice}
              onChange={(e) => update(index, { unitPrice: e.target.value })}
              placeholder="0.00"
              className={`${inputClass} font-code-num`}
            />
            <input
              aria-label={`Line ${index + 1} tax percent`}
              inputMode="decimal"
              value={row.taxPercent}
              onChange={(e) => update(index, { taxPercent: e.target.value })}
              placeholder="0"
              className={`${inputClass} font-code-num`}
            />
            <button
              type="button"
              onClick={() => setItems((rows) => (rows.length === 1 ? [emptyItem()] : rows.filter((_, i) => i !== index)))}
              aria-label={`Remove line ${index + 1}`}
              className="flex items-center justify-center rounded-[12px] text-[#94A3B8] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
            >
              <span aria-hidden className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setItems((rows) => [...rows, emptyItem()])}
          disabled={items.length >= 100}
          className={`${secondaryButton} w-fit`}
        >
          <span aria-hidden className="material-symbols-outlined text-[18px]">add</span>
          Add line
        </button>
      </fieldset>

      <div className="grid gap-6 md:grid-cols-[1fr_280px]">
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>
            Notes <span className="font-normal text-[#64748B]">(optional, shown to your client)</span>
          </span>
          <textarea name="notes" rows={3} maxLength={2000} defaultValue={invoice?.notes ?? ""} placeholder="Thank you for your business." className={inputClass} />
        </label>
        <dl className="flex flex-col gap-2 self-end rounded-[16px] bg-[#F8FAFC] p-4 text-sm">
          <div className="flex justify-between text-[#64748B]">
            <dt>Subtotal</dt>
            <dd className="font-code-num">{formatMoney(totals.subtotal, currency)}</dd>
          </div>
          <div className="flex justify-between text-[#64748B]">
            <dt>Tax</dt>
            <dd className="font-code-num">{formatMoney(totals.tax, currency)}</dd>
          </div>
          <div className="flex justify-between border-t border-[#E2E8F0] pt-2 font-semibold text-[#0F172A]">
            <dt>Total</dt>
            <dd className="font-code-num">{formatMoney(totals.subtotal + totals.tax, currency)}</dd>
          </div>
        </dl>
      </div>

      {state.error && (
        <div role="alert" className="rounded-[12px] border border-[#ffb4ab] bg-[#ffdad6] px-4 py-3 text-sm text-[#93000a]">
          {state.error}
        </div>
      )}
      {state.ok && !pending && (
        <p role="status" className="text-sm text-[#059669]">Draft saved.</p>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Saving…" : invoice ? "Save draft" : "Create draft"}
        </button>
      </div>
    </form>
  );
}
