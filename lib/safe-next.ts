// Post-sign-in destination. Only same-site paths are allowed, so a crafted
// ?next= can never send the user to another origin.
export function safeNext(value: unknown, fallback = "/clients") {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
}
