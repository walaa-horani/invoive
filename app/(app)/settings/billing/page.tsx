import type { Metadata } from "next";
import { loadBillingPage } from "@/lib/billing/load";
import { getActiveWorkspace, getSession } from "@/lib/workspace";
import { CreateWorkspaceForm } from "../workspaces/CreateWorkspaceForm";
import { BillingView } from "./BillingView";

export const metadata: Metadata = { title: "Billing — LedgerFlow" };

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; checkout?: string }>;
}) {
  const { tenant: requestedTenant, checkout } = await searchParams;
  const { supabase } = await getSession();
  const { workspaces, active } = await getActiveWorkspace(requestedTenant);
  // First visit: no workspace yet, so create one here.
  if (!active) return <CreateWorkspaceForm first />;

  const data = await loadBillingPage(supabase, active, workspaces);
  return <BillingView data={data} checkout={checkout} />;
}
