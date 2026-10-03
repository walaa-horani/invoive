import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// The workspace the user is looking at. The choice is remembered in a cookie
// (a UI preference only): every read and write is still limited by RLS to
// workspaces the user belongs to, and an unknown or foreign id in the cookie
// is simply ignored.

export const WORKSPACE_COOKIE = "lf_workspace";

export type Workspace = { id: string; name: string; role: "owner" | "admin" | "member" | "approver" };

export const EDITOR_ROLES = new Set(["owner", "admin", "member"]);
export const BILLING_ROLES = new Set(["owner", "admin"]);

// Deduplicated per request: the layout and the page both ask.
export const getSession = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return { supabase, userId: (data?.claims?.sub as string | undefined) ?? null };
});

export const listWorkspaces = cache(async (): Promise<Workspace[]> => {
  const { supabase, userId } = await getSession();
  if (!userId) return [];
  const { data, error } = await supabase
    .from("tenant_members")
    .select("tenant_id, role, tenants(name)")
    .eq("user_id", userId);
  if (error) throw new Error(`tenant_members: ${error.message}`);
  return ((data ?? []) as unknown as { tenant_id: string; role: Workspace["role"]; tenants: { name: string } | null }[])
    .map((m) => ({ id: m.tenant_id, name: m.tenants?.name ?? "Workspace", role: m.role }))
    .sort((a, b) => a.name.localeCompare(b.name));
});

// requested (?tenant=) wins, then the remembered choice, then the first.
export async function getActiveWorkspace(requested?: string | null) {
  const workspaces = await listWorkspaces();
  const remembered = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const active =
    workspaces.find((w) => w.id === requested) ?? workspaces.find((w) => w.id === remembered) ?? workspaces[0] ?? null;
  return { workspaces, active };
}

export const WORKSPACE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};
