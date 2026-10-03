import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, formatMoney } from "@/lib/billing/format";
import {
  ATTEMPT_LABELS,
  STATUS_META,
  type AttemptStatus,
  type Currency,
  type InvoiceStatus,
} from "@/lib/invoices";
import { EDITOR_ROLES, getActiveWorkspace, getSession } from "@/lib/workspace";
import { InvoiceActions } from "../InvoiceActions";
import { InvoiceEditor } from "../InvoiceEditor";
import { InvoiceSheet, type SheetItem } from "../InvoiceSheet";

export const metadata: Metadata = { title: "Invoice — LedgerFlow" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Invoice = {
  id: string;
  client_id: string;
  number: string | null;
  status: InvoiceStatus;
  currency: Currency;
  issue_date: string | null;
  due_date: string | null;
  notes: string | null;
  subtotal: number;
  tax_total: number;
  total: number;
  amount_paid: number;
  client_name: string | null;
  client_email: string | null;
  issued_at: string | null;
  paid_at: string | null;
  voided_at: string | null;
  clients: { name: string; email: string | null } | null;
};

type Attempt = {
  id: string;
  method: "stripe" | "manual";
  status: AttemptStatus;
  amount: number;
  currency: string;
  application_fee_amount: number;
  amount_refunded: number;
  paid_at: string | null;
  created_at: string;
};

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const { supabase } = await getSession();
  const { active } = await getActiveWorkspace();
  if (!active) notFound();

  // RLS already limits this to the user's workspaces; the tenant filter keeps
  // the page consistent with the workspace picked in the header.
  const { data: invoiceData, error } = await supabase
    .from("invoices")
    .select(
      "id, client_id, number, status, currency, issue_date, due_date, notes, subtotal, tax_total, total, amount_paid, client_name, client_email, issued_at, paid_at, voided_at, clients(name, email)",
    )
    .eq("id", id)
    .eq("tenant_id", active.id)
    .maybeSingle();
  if (error) throw new Error(`invoices: ${error.message}`);
  if (!invoiceData) notFound();
  const invoice = invoiceData as unknown as Invoice;

  const [items, attempts, account, feature, clients] = await Promise.all([
    supabase
      .from("invoice_items")
      .select("description, quantity, unit_amount, tax_rate_bps, amount")
      .eq("invoice_id", id)
      .order("position"),
    supabase
      .from("invoice_payment_attempts")
      .select("id, method, status, amount, currency, application_fee_amount, amount_refunded, paid_at, created_at")
      .eq("invoice_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("tenant_payment_accounts").select("status, charges_enabled").eq("tenant_id", active.id).maybeSingle(),
    supabase.from("tenant_features").select("feature").eq("tenant_id", active.id).eq("feature", "online_payments").maybeSingle(),
    invoice.status === "draft"
      ? supabase.from("clients").select("id, name, status").eq("tenant_id", active.id).order("name")
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [items, attempts, account, feature, clients]) {
    if (result.error) throw new Error(result.error.message);
  }

  const lines = (items.data ?? []) as SheetItem[];
  const payments = (attempts.data ?? []) as Attempt[];
  const canEdit = EDITOR_ROLES.has(active.role);
  const canPayOnline = Boolean(feature.data) && account.data?.status === "enabled" && account.data.charges_enabled === true;
  const meta = STATUS_META[invoice.status];
  const clientName = invoice.client_name ?? invoice.clients?.name ?? "—";
  const balance = Math.max(invoice.total - invoice.amount_paid, 0);
  const paidOnVoid = invoice.status === "void" && payments.some((p) => p.status === "succeeded");
  const needsReview = payments.some((p) => p.status === "needs_review");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/invoices" className="text-sm text-[#64748B] hover:text-[#0F172A]">← Invoices</Link>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="font-headline-md md:font-headline-lg text-[#0F172A]">{invoice.number ?? "Draft invoice"}</h1>
            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.className}`}>{meta.label}</span>
          </div>
          <p className="font-body-sm text-[#64748B] mt-1">
            {clientName} · <span className="font-code-num text-[#0F172A]">{formatMoney(invoice.total, invoice.currency)}</span>
            {invoice.status === "issued" && invoice.amount_paid > 0 && <> · {formatMoney(balance, invoice.currency)} due</>}
          </p>
        </div>
      </div>

      {/* Same position for every status, so its state survives draft -> issued. */}
      {canEdit && <InvoiceActions id={invoice.id} status={invoice.status} canPayOnline={canPayOnline} />}

      {invoice.status === "issued" && canEdit && !canPayOnline && (
        <div className="rounded-[12px] border border-[#E2E8F0] bg-[#F1F5F9] px-4 py-3 text-sm text-[#475569]">
          To let your client pay this invoice by card,{" "}
          <Link href="/settings/payments" className="font-semibold underline">connect your Stripe account</Link>
          {feature.data ? "." : " on a plan with online payments."}
        </div>
      )}
      {paidOnVoid && (
        <div className="rounded-[12px] border border-[#ffddb3] bg-[#fff4e5] px-4 py-3 text-sm text-[#623f00]">
          A payment arrived after this invoice was voided. Refund it from your Stripe Dashboard.
        </div>
      )}
      {needsReview && (
        <div className="rounded-[12px] border border-[#ffb4ab] bg-[#ffdad6] px-4 py-3 text-sm text-[#93000a]">
          A payment was charged for a different amount than this invoice. It was not counted — check it in your Stripe Dashboard.
        </div>
      )}
      {invoice.amount_paid > invoice.total && (
        <div className="rounded-[12px] border border-[#ffddb3] bg-[#fff4e5] px-4 py-3 text-sm text-[#623f00]">
          This invoice was paid more than once ({formatMoney(invoice.amount_paid, invoice.currency)} received). Refund the extra payment from your Stripe Dashboard.
        </div>
      )}

      {invoice.status === "draft" && canEdit ? (
        <InvoiceEditor
          // Archived clients stay selectable only if the draft already uses them.
          clients={((clients.data ?? []) as { id: string; name: string; status: string }[]).filter(
            (c) => c.status === "active" || c.id === invoice.client_id,
          )}
          invoice={{
            id: invoice.id,
            client_id: invoice.client_id,
            currency: invoice.currency,
            issue_date: invoice.issue_date,
            due_date: invoice.due_date,
            notes: invoice.notes,
            items: lines.map((l) => ({
              description: l.description,
              quantity: String(Number(l.quantity)),
              unitPrice: (l.unit_amount / 100).toFixed(2),
              taxPercent: l.tax_rate_bps ? String(l.tax_rate_bps / 100) : "",
            })),
          }}
        />
      ) : (
        <InvoiceSheet invoice={invoice} clientName={clientName} lines={lines} />
      )}

      {payments.length > 0 && (
        <section className="rounded-[24px] border border-[#E2E8F0] bg-white p-5 md:p-8">
          <h2 className="font-headline-sm text-[#0F172A]">Payments</h2>
          <ul className="mt-4 divide-y divide-[#E2E8F0] text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <div className="font-medium text-[#0F172A]">
                    {p.method === "manual" ? "Marked as paid" : ATTEMPT_LABELS[p.status]}
                  </div>
                  <div className="text-xs text-[#64748B]">
                    {p.method === "manual" ? "Recorded manually" : "Card via Stripe"} · {formatDate(p.paid_at ?? p.created_at)}
                    {p.amount_refunded > 0 && <> · {formatMoney(p.amount_refunded, p.currency)} refunded</>}
                    {p.application_fee_amount > 0 && p.status !== "open" && p.status !== "expired" && p.status !== "failed" && (
                      <> · platform fee {formatMoney(p.application_fee_amount, p.currency)}</>
                    )}
                  </div>
                </div>
                <div className="font-code-num text-[#0F172A]">{formatMoney(p.amount, p.currency)}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
