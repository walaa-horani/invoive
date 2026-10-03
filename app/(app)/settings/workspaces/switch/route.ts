import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/safe-next";
import { listWorkspaces, WORKSPACE_COOKIE, WORKSPACE_COOKIE_OPTIONS } from "@/lib/workspace";

// Remembers the chosen workspace and returns to the page the user was on.
// Only workspaces the user belongs to are accepted.
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  const next = safeNext(request.nextUrl.searchParams.get("next"), "/clients");
  const response = NextResponse.redirect(new URL(next, request.nextUrl.origin));

  const workspaces = await listWorkspaces();
  if (id && workspaces.some((w) => w.id === id)) {
    response.cookies.set(WORKSPACE_COOKIE, id, WORKSPACE_COOKIE_OPTIONS);
  }
  return response;
}
