import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EDITOR_ROLES, getActiveWorkspace, getSession } from "@/lib/workspace";
import { CreateWorkspaceForm } from "../../settings/workspaces/CreateWorkspaceForm";
import { primaryButton } from "../../clients/ClientDialog";
import { InvoiceEditor } from "../InvoiceEditor";

export const metadata: Metadata = { title: "New invoice — LedgerFlow" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { client } = await searchParams;
  const { supabase } = await getSession();
  const { active } = await getActiveWorkspace();
  if (!active) return <CreateWorkspaceForm first />;
  if (!EDITOR_ROLES.has(active.role)) redirect("/invoices");

  const { data, error } = await supabase
    .from("clients")
    .select("id, name")
    .eq("tenant_id", active.id)
    .eq("status", "active")
    .order("name");
  if (error) throw new Error(`clients: ${error.message}`);
  const clients = data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/invoices" className="text-sm text-[#64748B] hover:text-[#0F172A]">← Invoices</Link>
        <h1 className="font-headline-md md:font-headline-lg text-[#0F172A] mt-2">New invoice</h1>
        <p className="font-body-sm text-[#64748B] mt-1">Drafts are free and don&apos;t count toward your plan until you issue them.</p>
      </div>
      {clients.length === 0 ? (
        <div className="rounded-[24px] border border-[#E2E8F0] bg-white p-8 text-center">
          <p className="text-[#64748B]">Add a client first, then create an invoice for them.</p>
          <Link href="/clients" className={`${primaryButton} mt-4`}>Go to clients</Link>
        </div>
      ) : (
        <InvoiceEditor clients={clients} defaultClientId={clients.some((c) => c.id === client) ? client : undefined} />
      )}
    </div>
  );
}
