import type { Metadata } from "next";
import { cache } from "react";
import { InvoiceSheet, type SheetItem } from "@/app/(app)/invoices/InvoiceSheet";
import { Logo } from "@/components/Logo";
import { formatDate, formatMoney } from "@/lib/billing/format";
import { createClient } from "@/lib/supabase/server";
import { PaymentReturn, PayButton } from "./PayButton";

// Public page for the client who received a payment link. Everything comes
// from public.get_pay_invoice, which returns one invoice's display fields for
// a valid token and nothing otherwise. next.config.ts adds no-referrer,
// no-store and noindex headers for /pay.

type PayInvoice = {
  business_name: string;
  number: string;
  status: "issued" | "paid" | "void" | "draft";
  client_name: string | null;
  currency: string;
  issue_date: string | null;
  due_date: string | null;
  notes: string | null;
  subtotal: number;
  tax_total: number;
  total: number;
  amount_paid: number;
  amount_due: number;
  paid_at: string | null;
  can_pay: boolean;
  unavailable_reason: string | null;
  items: SheetItem[];
};

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const loadInvoice = cache(async (token: string) => {
  if (!TOKEN_RE.test(token)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_pay_invoice", { p_token: token });
  if (error) throw new Error(`get_pay_invoice: ${error.message}`);
  return (data ?? null) as PayInvoice | null;
});

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const invoice = await loadInvoice(token);
  return {
    title: invoice ? `Invoice ${invoice.number} from ${invoice.business_name}` : "Invoice link",
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer",
  };
}

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ return?: string }>;
}) {
  const [{ token }, { return: returned }] = await Promise.all([params, searchParams]);
  const invoice = await loadInvoice(token);

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 md:py-12">
        {!invoice ? (
          <div className="rounded-[24px] border border-[#E2E8F0] bg-white p-8 text-center">
            <h1 className="font-headline-md text-[#0F172A]">This link isn&apos;t valid</h1>
            <p className="mt-2 text-[#64748B]">It may have been replaced by a newer link. Ask the sender for a new one.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <p className="text-sm text-[#64748B]">Invoice from</p>
              <h1 className="font-headline-md md:font-headline-lg text-[#0F172A]">{invoice.business_name}</h1>
            </div>

            <section className="flex flex-col gap-4 rounded-[24px] border border-[#E2E8F0] bg-white p-6 md:p-8 shadow-[0_1px_3px_0_rgba(15,23,42,0.05),0_1px_2px_-1px_rgba(15,23,42,0.05)]">
              {invoice.status === "paid" ? (
                <div className="flex items-center gap-3">
                  <span aria-hidden className="material-symbols-outlined text-[32px] text-[#059669]">check_circle</span>
                  <div>
                    <p className="font-headline-sm text-[#0F172A]">Paid — thank you!</p>
                    <p className="text-sm text-[#64748B]">
                      {formatMoney(invoice.total, invoice.currency)} received
                      {invoice.paid_at ? ` on ${formatDate(invoice.paid_at)}` : ""}.
                    </p>
                  </div>
                </div>
              ) : invoice.status === "void" ? (
                <p className="text-[#475569]">This invoice was cancelled by {invoice.business_name}. Nothing is due.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <p className="text-sm text-[#64748B]">Amount due</p>
                      <p className="font-code-num text-3xl font-semibold text-[#0F172A]">
                        {formatMoney(invoice.amount_due, invoice.currency)}
                      </p>
                    </div>
                    {invoice.due_date && <p className="text-sm text-[#64748B]">Due {formatDate(invoice.due_date)}</p>}
                  </div>
                  {returned === "1" && <PaymentReturn />}
                  {invoice.can_pay ? (
                    <PayButton token={token} label={`Pay ${formatMoney(invoice.amount_due, invoice.currency)}`} />
                  ) : (
                    <p className="rounded-[12px] bg-[#F1F5F9] px-4 py-3 text-sm text-[#475569]">
                      Online payment isn&apos;t available for this invoice right now. Please contact {invoice.business_name}.
                    </p>
                  )}
                  <p className="text-xs text-[#94A3B8]">
                    Payments are processed securely by Stripe. Your card details never reach {invoice.business_name} or LedgerFlow.
                  </p>
                </>
              )}
            </section>

            <InvoiceSheet invoice={invoice} clientName={invoice.client_name ?? ""} lines={invoice.items} />
          </>
        )}
        <div className="flex items-center justify-center gap-2 text-xs text-[#94A3B8]">
          Powered by <Logo />
        </div>
      </div>
    </div>
  );
}
