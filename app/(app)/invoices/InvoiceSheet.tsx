import { formatDate, formatMoney } from "@/lib/billing/format";

export type SheetItem = {
  description: string;
  quantity: number;
  unit_amount: number;
  tax_rate_bps: number;
  amount: number;
};

export type SheetInvoice = {
  number: string | null;
  currency: string;
  issue_date: string | null;
  due_date: string | null;
  notes: string | null;
  subtotal: number;
  tax_total: number;
  total: number;
  amount_paid: number;
  client_email?: string | null;
};

// Read-only invoice document: the workspace's invoice page and the client's
// public pay page.
export function InvoiceSheet({
  invoice,
  clientName,
  lines,
  businessName,
}: {
  invoice: SheetInvoice;
  clientName: string;
  lines: SheetItem[];
  businessName?: string;
}) {
  return (
    <article className="rounded-[24px] border border-[#E2E8F0] bg-white p-5 md:p-10 shadow-[0_1px_3px_0_rgba(15,23,42,0.05),0_1px_2px_-1px_rgba(15,23,42,0.05)]">
      <div className="flex flex-wrap justify-between gap-6">
        <div>
          {businessName && <p className="font-headline-sm text-[#0F172A]">{businessName}</p>}
          <p className="text-xs font-semibold uppercase tracking-wider text-[#64748B] mt-1">Billed to</p>
          <p className="font-medium text-[#0F172A]">{clientName}</p>
          {invoice.client_email && <p className="text-sm text-[#64748B]">{invoice.client_email}</p>}
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm">
          <dt className="text-[#64748B]">Invoice</dt>
          <dd className="font-code-num text-[#0F172A]">{invoice.number ?? "Draft"}</dd>
          <dt className="text-[#64748B]">Issued</dt>
          <dd className="font-code-num text-[#0F172A]">{formatDate(invoice.issue_date)}</dd>
          <dt className="text-[#64748B]">Due</dt>
          <dd className="font-code-num text-[#0F172A]">{formatDate(invoice.due_date)}</dd>
        </dl>
      </div>

      <table className="mt-8 w-full text-left text-sm">
        <thead className="border-b border-[#E2E8F0] text-xs font-semibold uppercase tracking-wider text-[#64748B]">
          <tr>
            <th scope="col" className="py-2">Description</th>
            <th scope="col" className="hidden py-2 text-right sm:table-cell">Qty</th>
            <th scope="col" className="hidden py-2 text-right sm:table-cell">Price</th>
            <th scope="col" className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F1F5F9]">
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="py-3 text-[#0F172A]">
                {l.description}
                <span className="block text-xs text-[#64748B] sm:hidden">
                  {Number(l.quantity)} × {formatMoney(l.unit_amount, invoice.currency)}
                </span>
                {l.tax_rate_bps > 0 && <span className="block text-xs text-[#64748B]">Tax {l.tax_rate_bps / 100}%</span>}
              </td>
              <td className="hidden py-3 text-right font-code-num text-[#64748B] sm:table-cell">{Number(l.quantity)}</td>
              <td className="hidden py-3 text-right font-code-num text-[#64748B] sm:table-cell">{formatMoney(l.unit_amount, invoice.currency)}</td>
              <td className="py-3 text-right font-code-num text-[#0F172A]">{formatMoney(l.amount, invoice.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ml-auto mt-6 flex max-w-xs flex-col gap-2 text-sm">
        <div className="flex justify-between text-[#64748B]"><dt>Subtotal</dt><dd className="font-code-num">{formatMoney(invoice.subtotal, invoice.currency)}</dd></div>
        <div className="flex justify-between text-[#64748B]"><dt>Tax</dt><dd className="font-code-num">{formatMoney(invoice.tax_total, invoice.currency)}</dd></div>
        <div className="flex justify-between border-t border-[#E2E8F0] pt-2 font-semibold text-[#0F172A]"><dt>Total</dt><dd className="font-code-num">{formatMoney(invoice.total, invoice.currency)}</dd></div>
        {invoice.amount_paid > 0 && (
          <div className="flex justify-between text-[#059669]"><dt>Paid</dt><dd className="font-code-num">−{formatMoney(Math.min(invoice.amount_paid, invoice.total), invoice.currency)}</dd></div>
        )}
      </dl>

      {invoice.notes && <p className="mt-8 whitespace-pre-line border-t border-[#E2E8F0] pt-4 text-sm text-[#475569]">{invoice.notes}</p>}
    </article>
  );
}
