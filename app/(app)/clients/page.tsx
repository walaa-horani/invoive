import type { Metadata } from "next";
import { EDITOR_ROLES, getActiveWorkspace, getSession } from "@/lib/workspace";
import { CreateWorkspaceForm } from "../settings/workspaces/CreateWorkspaceForm";
import { ClientsView, type Client } from "./ClientsView";

export const metadata: Metadata = { title: "Clients — LedgerFlow" };

const PAGE_SIZE = 200;

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string }>;
}) {
  const { view: rawView, q: rawQuery } = await searchParams;
  const view = rawView === "archived" ? "archived" : "active";
  const query = (rawQuery ?? "").trim().slice(0, 100);

  const { supabase } = await getSession();
  const { active } = await getActiveWorkspace();
  if (!active) return <CreateWorkspaceForm first />;

  let list = supabase
    .from("clients")
    .select("id, name, email, company, status, created_at, archived_at")
    .eq("tenant_id", active.id)
    .eq("status", view)
    .order(view === "archived" ? "archived_at" : "created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (query) {
    // Drop characters that PostgREST's or-filter and ILIKE treat specially.
    const term = query.replace(/[\\%_,()*:."]/g, " ").trim();
    if (term) list = list.or(`name.ilike.*${term}*,email.ilike.*${term}*,company.ilike.*${term}*`);
  }

  const [clients, counts, quota] = await Promise.all([
    list,
    Promise.all(
      (["active", "archived"] as const).map((status) =>
        supabase.from("clients").select("id", { count: "exact", head: true }).eq("tenant_id", active.id).eq("status", status),
      ),
    ),
    supabase
      .from("tenant_entitlements")
      .select("effective_plan, effective_limit, used")
      .eq("tenant_id", active.id)
      .eq("metric", "active_clients")
      .maybeSingle(),
  ]);
  if (clients.error) throw new Error(`clients: ${clients.error.message}`);
  if (quota.error) throw new Error(`tenant_entitlements: ${quota.error.message}`);

  const [activeCount, archivedCount] = counts.map((c) => c.count ?? 0);
  return (
    <ClientsView
      workspaceName={active.name}
      view={view}
      query={query}
      rows={(clients.data ?? []) as Client[]}
      activeCount={activeCount}
      archivedCount={archivedCount}
      plan={(quota.data?.effective_plan as string | null | undefined) ?? null}
      // NULL = unlimited; no entitlement row at all fails closed to 0.
      limit={quota.data ? (quota.data.effective_limit as number | null) : 0}
      used={(quota.data?.used ?? 0) as number}
      canEdit={EDITOR_ROLES.has(active.role)}
      truncated={(clients.data ?? []).length === PAGE_SIZE}
    />
  );
}
