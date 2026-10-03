"use server";

import { revalidatePath } from "next/cache";
import { getActiveWorkspace, getSession } from "@/lib/workspace";

// Every write is checked again by the database: RLS (workspace membership and
// role), column privileges, and the active_clients quota trigger. These
// actions only shape input and translate the database's answer.

export type ClientActionState = {
  ok?: boolean;
  error?: string;
  // The plan's active-client limit refused the write.
  limitReached?: boolean;
  // Bumped on every success so a dialog can close itself.
  done?: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function readFields(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const company = String(formData.get("company") ?? "").trim();
  if (!name) return { error: "Enter the client's name." } as const;
  if (name.length > 200) return { error: "Keep the name under 200 characters." } as const;
  if (email && (email.length > 320 || !EMAIL_RE.test(email))) return { error: "Enter a valid email address." } as const;
  if (company.length > 200) return { error: "Keep the company name under 200 characters." } as const;
  return { fields: { name, email: email || null, company: company || null } } as const;
}

function explain(error: { code?: string; message: string }): ClientActionState {
  switch (error.code) {
    case "PT402":
      return { error: "You've reached your plan's active-client limit.", limitReached: true };
    case "42501":
      return { error: "You don't have permission to change clients in this workspace." };
    case "23514":
      return { error: "Some details aren't valid. Check the name and email." };
    default:
      console.error("clients write failed:", error);
      return { error: "Something went wrong. Please try again." };
  }
}

function refresh(prev: ClientActionState): ClientActionState {
  revalidatePath("/clients");
  revalidatePath("/settings/billing");
  return { ok: true, done: (prev.done ?? 0) + 1 };
}

export async function addClient(prev: ClientActionState, formData: FormData): Promise<ClientActionState> {
  const parsed = readFields(formData);
  if ("error" in parsed) return { error: parsed.error, done: prev.done };

  const { supabase } = await getSession();
  const { active } = await getActiveWorkspace();
  if (!active) return { error: "Create a workspace first.", done: prev.done };

  const { error } = await supabase.from("clients").insert({ tenant_id: active.id, ...parsed.fields });
  return error ? { ...explain(error), done: prev.done } : refresh(prev);
}

export async function editClient(prev: ClientActionState, formData: FormData): Promise<ClientActionState> {
  const id = String(formData.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Unknown client.", done: prev.done };
  const parsed = readFields(formData);
  if ("error" in parsed) return { error: parsed.error, done: prev.done };

  const { supabase } = await getSession();
  const { active } = await getActiveWorkspace();
  if (!active) return { error: "Create a workspace first.", done: prev.done };

  const { data, error } = await supabase
    .from("clients")
    .update(parsed.fields)
    .eq("id", id)
    .eq("tenant_id", active.id)
    .select("id");
  if (error) return { ...explain(error), done: prev.done };
  if (!data?.length) return { error: "That client no longer exists or you can't edit it.", done: prev.done };
  return refresh(prev);
}

export async function setClientStatus(prev: ClientActionState, formData: FormData): Promise<ClientActionState> {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!UUID_RE.test(id) || (status !== "active" && status !== "archived")) {
    return { error: "Unknown client.", done: prev.done };
  }

  const { supabase } = await getSession();
  const { active } = await getActiveWorkspace();
  if (!active) return { error: "Create a workspace first.", done: prev.done };

  const { data, error } = await supabase
    .from("clients")
    .update({ status })
    .eq("id", id)
    .eq("tenant_id", active.id)
    .select("id");
  if (error) return { ...explain(error), done: prev.done };
  if (!data?.length) return { error: "That client no longer exists or you can't change it.", done: prev.done };
  return refresh(prev);
}
