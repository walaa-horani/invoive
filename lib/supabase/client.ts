import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

// Browser client: shares the session cookies set by the server, and sends the
// user's JWT when invoking Edge Functions.
export function createClient() {
  const { url, key } = supabaseEnv();
  return createBrowserClient(url, key);
}
