import { useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usageErrorSummary, usageSummary, type UsageLine, type UsageWindow } from "./usage";
import type { Account } from "./types";
import { reportUsageResult, useAccountAuthStore } from "./accountAuth";
import { isAuthError } from "./reconnect";

export type Usage = { windows: UsageWindow[]; checked_at: number };
export type UsageEntry = { usage?: Usage; error?: string };

/** Module-level store so the footer and every account picker read one polled copy of usage. */
let values: Record<string, UsageEntry> = {};
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const snapshot = () => values;
const emit = () => listeners.forEach(l => l());
export function setAccountUsage(id: string, update: (prev: UsageEntry | undefined) => UsageEntry) {
  values = { ...values, [id]: update(values[id]) };
  emit();
}
/** Test helper: replace the whole store. */
export function resetAccountUsage(next: Record<string, UsageEntry> = {}) { values = next; emit(); }

const pct = (l: UsageLine) => l.remaining === null ? "??" : `${Math.round(l.remaining)}%`;

/** Polls `account_usage` every 120 s and on `freddai:usage-refresh`. Mount once. */
export function useAccountUsagePoller(accounts: Account[], native: boolean) {
  const ids = accounts.map(a => a.id).join("|");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(n => n + 1);
    window.addEventListener("freddai:usage-refresh", refresh);
    return () => window.removeEventListener("freddai:usage-refresh", refresh);
  }, []);
  useEffect(() => {
    if (!native) return;
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      await Promise.all(accounts.map(async a => {
        try { const usage = await invoke<Usage>("account_usage", { account: a.id }); if (!disposed) { reportUsageResult(a.id, null); setAccountUsage(a.id, () => ({ usage })); } }
        catch (e) { if (!disposed) { reportUsageResult(a.id, String(e)); setAccountUsage(a.id, prev => ({ ...prev, error: String(e) })); } }
      }));
      if (!disposed) timer = setTimeout(refresh, 120000);
    }
    void refresh(); return () => { disposed = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, native, revision]);
}

export type AccountUsageView = {
  remaining: number | null; stale: boolean;
  rows: { key: string; name: string; label?: string; text: string }[];
  /** Full one-line usage text (rows joined, or the empty/error/retrieving text). */
  text: string; isError: boolean; detail: string; ariaText: string; error?: string;
};

export function useAccountUsageView(): (account: Account) => AccountUsageView {
  const all = useSyncExternalStore(subscribe, snapshot);
  const authOf = useAccountAuthStore();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  return (a: Account): AccountUsageView => {
    const raw = all[a.id], usage = raw?.usage;
    // The shared auth state wins: an old auth error is dropped once the account is known valid, and expired is shown whenever the store says so.
    const auth = authOf(a.id);
    const staleAuthError = !!raw?.error && isAuthError(raw.error) && auth.status === "valid";
    const result = staleAuthError ? { ...raw, error: undefined } : raw;
    const summary = usageSummary(usage?.windows || [], now);
    const stale = !!result?.error || (!!usage && now - usage.checked_at > 300000);
    const suffix = stale ? " · last known" : "";
    const lines: { key: string; name: string; line: UsageLine; label?: string }[] = [];
    if (summary.weekly) lines.push({ key: "week", name: "Week", line: summary.weekly });
    if (!lines.length && summary.limiting && summary.limiting.kind !== "session") lines.push({ key: "limit", name: summary.limiting.label, line: summary.limiting, label: summary.limiting.label });
    const errorText = auth.status === "expired" && ["claude", "codex", "antigravity", "copilot"].includes(a.provider) ? "Sign-in expired · reconnect" : usageErrorSummary(result?.error, a.provider);
    const rows = lines.map(r => ({ key: r.key, name: r.name, label: r.label, text: `${pct(r.line)} left · ${r.line.relativeReset}${suffix}` }));
    const visible = rows.length ? rows.map((r, i) => `${lines[i].label ? `${lines[i].label} · ` : ""}${r.text}`).join("; ") : (usage ? "Usage unavailable" : (result?.error || auth.status === "expired" ? errorText : "Retrieving usage"));
    const ariaText = lines.length ? lines.map(r => `${pct(r.line)} left · ${r.line.relativeReset} (${r.name})${suffix}`).join("; ") : visible;
    const detail = summary.lines.map(l => `${l.label}: ${pct(l)} left · ${l.resetText}`).join("\n");
    return { remaining: summary.limiting?.remaining ?? null, stale, rows, text: visible, isError: !!result?.error, detail, ariaText, error: result?.error };
  };
}
