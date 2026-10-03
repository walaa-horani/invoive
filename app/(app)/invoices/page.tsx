import type { Metadata } from "next";
import Link from "next/link";
import { formatDate, formatMoney } from "@/lib/billing/format";
import { STATUS_META, type InvoiceStatus } from "@/lib/invoices";
import { EDITOR_ROLES, getActiveWorkspace, getSession } from "@/lib/workspace";
import { CreateWorkspaceForm } from "../settings/workspaces/CreateWorkspaceForm";
import { primaryButton } from "../clients/ClientDialog";

export const metadata: Metadata = { title: "Invoices — LedgerFlow" };

const PAGE_SIZE = 200;
const VIEWS = ["all", "draft", "issued", "paid", "void"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABELS: Record<View, string> = { all: "All", draft: "Drafts", issued: "Unpaid", paid: "Paid", void: "Void" };

type Row = {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  currency: string;
  total: number;
  amount_paid: number;
  due_date: string | null;
  created_at: string;
  client_name: string | null;
  clients: { name: string } | null;
};

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view: rawView } = await searchParams;
  const view: View = VIEWS.includes(rawView as View) ? (rawView as View) : "all";

  const { supabase } = await getSession();
  const { active } = await getActiveWorkspace();
  if (!active) return <CreateWorkspaceForm first />;

  let list = supabase
    .from("invoices")
    .select("id, number, status, currency, total, amount_paid, due_date, created_at, client_name, clients(name)")
    .eq("tenant_id", active.id)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (view !== "all") list = list.eq("status", view);

  const [invoices, quota] = await Promise.all([
    list,
    supabase
      .from("tenant_entitlements")
      .select("effective_plan, effective_limit, used")
      .eq("tenant_id", active.id)
      .eq("metric", "invoices_issued")
      .maybeSingle(),
  ]);
  if (invoices.error) throw new Error(`invoices: ${invoices.error.message}`);
  if (quota.error) throw new Error(`tenant_entitlements: ${quota.error.message}`);

  const rows = (invoices.data ?? []) as unknown as Row[];
  const limit = quota.data ? (quota.data.effective_limit as number | null) : 0;
  const used = (quota.data?.used ?? 0) as number;
  const canEdit = EDITOR_ROLES.has(active.role);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-headline-md md:font-headline-lg text-[#0F172A]">Invoices</h1>
          <p className="font-body-sm text-[#64748B] mt-1">
            {active.name} ·{" "}
            <span className="font-code-num text-[#0F172A]">{limit === null ? used : `${used} / ${limit}`}</span> issued this month
            {limit === null ? " · unlimited" : ""}
          </p>
        </div>
        {canEdit && (
          <Link href="/invoices/new" className={primaryButton}>
            <span aria-hidden className="material-symbols-outlined text-[18px]">add</span>
            New invoice
          </Link>
        )}
      </div>

      {canEdit && limit !== null && used >= limit && (
        <div className="rounded-[12px] border border-[#ffddb3] bg-[#fff4e5] px-4 py-3 text-sm text-[#623f00]">
          You&apos;ve issued all {limit} invoices included this month. Drafts are still free.{" "}
          <Link href="/settings/billing" className="font-semibold underline">Upgrade your plan</Link> to issue more.
        </div>
      )}

      <nav aria-label="Invoice status" className="inline-flex w-fit flex-wrap rounded-[12px] bg-[#F1F5F9] p-1">
        {VIEWS.map((key) => (
          <Link
            key={key}
            href={key === "all" ? "/invoices" : `/invoices?view=${key}`}
            aria-current={view === key ? "page" : undefined}
            className={`rounded-lg px-4 py-1.5 text-sm transition-colors ${
              view === key
                ? "bg-white font-semibold text-[#0F172A] shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
                : "text-[#64748B] hover:text-[#0F172A]"
            }`}
          >
            {VIEW_LABELS[key]}
          </Link>
        ))}
      </nav>

      <div className="overflow-hidden rounded-[24px] border border-[#E2E8F0] bg-white shadow-[0_1px_3px_0_rgba(15,23,42,0.05),0_1px_2px_-1px_rgba(15,23,42,0.05)]">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#eff4ff]">
              <span aria-hidden className="material-symbols-outlined text-[24px] text-[#2563EB]">receipt_long</span>
            </div>
            <h2 className="font-headline-sm text-[#0F172A]">{view === "all" ? "No invoices yet" : `No ${VIEW_LABELS[view].toLowerCase()} invoices`}</h2>
            <p className="mt-1 max-w-sm text-sm text-[#64748B]">
              Create a draft, add line items, then issue it to get a payment link for your client.
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-[#F1F5F9] text-xs font-semibold uppercase tracking-wider text-[#64748B]">
              <tr>
                <th scope="col" className="px-5 py-3">Invoice</th>
                <th scope="col" className="hidden px-5 py-3 sm:table-cell">Due</th>
                <th scope="col" className="px-5 py-3">Status</th>
                <th scope="col" className="px-5 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {rows.map((inv) => {
                const overdue = inv.status === "issued" && inv.due_date !== null && inv.due_date < today;
                const meta = STATUS_META[inv.status];
                return (
                  <tr key={inv.id} className="hover:bg-[#F8FAFC]">
                    <td className="px-5 py-4">
                      <Link href={`/invoices/${inv.id}`} className="font-medium text-[#0F172A] hover:underline">
                        {inv.number ?? "Draft"}
                      </Link>
                      <div className="text-[#64748B]">{inv.client_name ?? inv.clients?.name ?? "—"}</div>
                    </td>
                    <td className="hidden px-5 py-4 font-code-num text-[#64748B] sm:table-cell">{formatDate(inv.due_date)}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${overdue ? "bg-[#ffdad6] text-[#93000a]" : meta.className}`}>
                        {overdue ? "Overdue" : meta.label}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right font-code-num text-[#0F172A]">{formatMoney(inv.total, inv.currency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {rows.length === PAGE_SIZE && <p className="text-xs text-[#64748B]">Showing the latest {PAGE_SIZE}.</p>}
    </div>
  );
}
