"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type CreateWorkspaceState = { error?: string };

// The database does the work (public.create_tenant): it takes the user from
// the session, creates the workspace and makes them its owner atomically.
export async function createWorkspace(_prev: CreateWorkspaceState, formData: FormData): Promise<CreateWorkspaceState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give your workspace a name." };
  if (name.length > 200) return { error: "Keep the name under 200 characters." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_tenant", { p_name: name });
  if (error) {
    return {
      error:
        error.code === "42501"
          ? "Your session expired. Sign in again."
          : error.code === "22023" || error.code === "P0001"
          ? error.message
          : "Could not create the workspace. Please try again.",
    };
  }

  redirect(`/settings/billing?tenant=${data as string}`);
}
