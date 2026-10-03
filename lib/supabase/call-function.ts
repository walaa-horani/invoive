import { FunctionsHttpError } from "@supabase/supabase-js";
import { createClient } from "./client";

export type CallResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; data: Record<string, unknown> };

// Calls an Edge Function from the browser. The Edge Functions decide
// everything; callers only show what they return. The user's JWT (if signed
// in) is attached by the Supabase client.
export async function callFunction(name: string, body: Record<string, unknown>): Promise<CallResult> {
  const { data, error } = await createClient().functions.invoke(name, { body });
  if (!error) return { ok: true, data };
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    const payload = await response.json().catch(() => ({ error: "Something went wrong." }));
    return { ok: false, status: response.status, data: payload };
  }
  return { ok: false, status: 0, data: { error: "Network error. Check your connection and try again." } };
}
