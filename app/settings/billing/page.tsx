import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loadBillingPage } from "@/lib/billing/load";
import { createClient } from "@/lib/supabase/server";
import { BillingView, EmptyState } from "./BillingView";

export const metadata: Metadata = { title: "Billing — LedgerFlow" };

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; checkout?: string }>;
}) {
  const { tenant: requestedTenant, checkout } = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) redirect("/login?next=/settings/billing");

  const data = await loadBillingPage(supabase, auth.claims.sub, requestedTenant);
  if (!data) {
    return (
      <EmptyState
        title="No workspace yet"
        body="Your account isn't a member of any workspace. Ask a workspace owner to invite you."
      />
    );
  }

  return <BillingView data={data} checkout={checkout} />;
}
