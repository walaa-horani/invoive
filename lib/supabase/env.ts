// Public values only: the project URL and the publishable key are safe in the
// browser. Every authorization decision is made by Postgres RLS and the Edge
// Functions, never by this app.
export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example)",
    );
  }
  return { url, key };
}
