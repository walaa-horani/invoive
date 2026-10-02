"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; message?: string };

function credentials(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return null;
  return { email, password };
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const creds = credentials(formData);
  if (!creds) return { error: "Enter your email and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(creds);
  if (error) return { error: error.message };

  redirect(safeNext(formData.get("next")));
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const creds = credentials(formData);
  if (!creds) return { error: "Enter your email and password." };
  if (creds.password.length < 8) return { error: "Use at least 8 characters for your password." };

  const next = safeNext(formData.get("next"));
  const origin = (await headers()).get("origin") ?? "";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...creds,
    options: { emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}` },
  });
  if (error) return { error: error.message };

  // Email confirmation on: no session until the link is clicked.
  if (!data.session) return { message: "Check your email for a confirmation link." };
  redirect(next);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
