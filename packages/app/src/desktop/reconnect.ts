/** Mirrors `is_auth_error` in crates/core/src/usage.rs: provider errors meaning the stored sign-in is no longer valid. */
const AUTH_NEEDLES = ["refresh token was already used", "token_expired", "401", "unauthorized", "sign in again", "log out and sign in", "sign-in expired", "sign-in needed", "authentication required", "not logged in", "returned no account"];
export function isAuthError(message: string | null | undefined): boolean {
  const m = (message || "").toLowerCase();
  return AUTH_NEEDLES.some(n => m.includes(n));
}
/** Providers whose browser sign-in Freddai can re-run on an existing account (`login` command). */
export const canReconnect = (provider: string) => provider === "codex" || provider === "grok";
