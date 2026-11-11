import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isAuthError } from "./reconnect";

/** Single frontend source of truth for per-account sign-in state. Every surface (Settings rows, usage cards,
 * the sidebar footer, thread errors) reads this and never keeps its own copy.
 * Feeds: `auth_check` (live), usage reads (success -> valid, auth error -> expired), reconnect success (re-check). */
export type AuthStatus = "valid" | "expired" | "unverified" | "checking" | "unknown";
export type AccountAuth = { status: AuthStatus; message: string; checkedAt: number | null };

const UNKNOWN: AccountAuth = { status: "unknown", message: "", checkedAt: null };
const entries = new Map<string, AccountAuth>();
const listeners = new Set<() => void>();
const inflight = new Map<string, Promise<AccountAuth>>();
/** Last non-checking status, so a recovery is detected across a "checking" step. */
const settled = new Map<string, AuthStatus>();
let version = 0;

export const getAccountAuth = (id: string): AccountAuth => entries.get(id) ?? UNKNOWN;
function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function put(id: string, next: AccountAuth) {
  const prev = getAccountAuth(id);
  if (prev.status === next.status && prev.message === next.message && prev.checkedAt === next.checkedAt) return;
  const before = settled.get(id);
  if (next.status !== "checking") settled.set(id, next.status);
  entries.set(id, next);
  version++;
  listeners.forEach(l => l());
  // Another surface (footer) may still hold an old auth error: tell it to re-read usage once the account recovers.
  if (next.status === "valid" && (before === "expired" || before === "unverified") && typeof window !== "undefined")
    window.dispatchEvent(new Event("freddai:usage-refresh"));
}
/** Subscribe to one account's auth state. */
export function useAccountAuth(id: string): AccountAuth {
  useSyncExternalStore(subscribe, () => version);
  return getAccountAuth(id);
}
/** Subscribe once and read any account (for lists where a hook per row is not possible). */
export function useAccountAuthStore(): (id: string) => AccountAuth {
  useSyncExternalStore(subscribe, () => version);
  return getAccountAuth;
}
export const needsReconnect = (a: AccountAuth) => a.status === "expired" || a.status === "unverified";

/** A usage read finished for this account. Success proves the sign-in; an auth error means it expired; other errors say nothing about auth. */
export function reportUsageResult(id: string, error: string | null | undefined) {
  if (!error) put(id, { status: "valid", message: "", checkedAt: Date.now() });
  else if (isAuthError(error)) put(id, { status: "expired", message: "Sign-in expired", checkedAt: Date.now() });
}

/** Live check through the host (`auth_check`): validates the token for Codex, credentials for others. Never throws. */
export function checkAccountAuth(id: string): Promise<AccountAuth> {
  const running = inflight.get(id);
  if (running) return running;
  const prev = getAccountAuth(id);
  put(id, { ...prev, status: "checking" });
  const job = (async (): Promise<AccountAuth> => {
    let next: AccountAuth;
    try {
      const check = await invoke<{ state: string; error?: string }>("auth_check", { account: id });
      const at = Date.now();
      if (check.state === "valid") next = { status: "valid", message: "", checkedAt: at };
      else if (check.state === "expired") next = { status: "expired", message: "Sign-in expired", checkedAt: at };
      else if (check.state === "unverified") {
        console.error("[auth_check] could not verify sign-in", id, check.error);
        next = { status: "unverified", message: `Couldn't verify sign-in${check.error ? `: ${check.error}` : ""}`, checkedAt: at };
      } else next = { status: "expired", message: "Sign-in required", checkedAt: at };
    } catch (e) {
      console.error("[auth_check] failed", id, e);
      next = { status: "unverified", message: `Could not check sign-in: ${String(e)}`, checkedAt: Date.now() };
    }
    put(id, next);
    return next;
  })().finally(() => { inflight.delete(id); });
  inflight.set(id, job);
  return job;
}

/** After a successful login: verify live (the login flow only proves credentials exist), then refresh usage surfaces. */
export async function reportLoginSuccess(id: string): Promise<AccountAuth> {
  const state = await checkAccountAuth(id);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("freddai:usage-refresh"));
  return state;
}

/** Test helper. */
export function resetAccountAuth() { entries.clear(); inflight.clear(); settled.clear(); version++; listeners.forEach(l => l()); }
