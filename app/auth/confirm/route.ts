import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

// Target of the sign-up confirmation email. Handles both link styles:
// ?code= (default template, PKCE) and ?token_hash=&type= (custom template).
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNext(params.get("next"));
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;

  const supabase = await createClient();
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
    ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    : { error: new Error("missing confirmation code") };

  const target = request.nextUrl.clone();
  target.search = "";
  if (error) {
    target.pathname = "/login";
    target.searchParams.set("next", next);
    return NextResponse.redirect(target);
  }
  return NextResponse.redirect(new URL(next, request.nextUrl.origin));
}
