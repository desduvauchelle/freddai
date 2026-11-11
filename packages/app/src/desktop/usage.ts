import { isAuthError } from "./reconnect";
export type UsageWindowKind = "session" | "weekly" | "other";
export type UsageWindow = { label: string; window?: UsageWindowKind; used_percent: number; resets_at: number | null };

export function remainingPercent(used: number | null | undefined): number | null {
  return typeof used === "number" && Number.isFinite(used) ? Math.max(0, Math.min(100, 100 - used)) : null;
}

export function limitingWindow(windows: UsageWindow[]) {
  return windows.filter(window => remainingPercent(window.used_percent) !== null).reduce<UsageWindow | undefined>((selected, window) =>
    !selected || window.used_percent > selected.used_percent ? window : selected, undefined);
}

export function resetCountdown(seconds: number | null | undefined, now: number) {
  if (seconds == null || !Number.isFinite(seconds)) return "Reset unavailable";
  const minutes = Math.ceil((seconds * 1000 - now) / 60000);
  if (minutes <= 0) return "Reset due · updating";
  const duration = minutes < 60 ? `${minutes}m` : minutes < 1440
    ? `${Math.floor(minutes / 60)}h`
    : `${Math.floor(minutes / 1440)}d`;
  return `${duration} until reset`;
}

export function windowKind(w: UsageWindow): UsageWindowKind {
  if (w.window === "session" || w.window === "weekly" || w.window === "other") return w.window;
  if (/session|5-hour|5h|hour window|minute window/i.test(w.label)) return "session";
  if (/week|7-day|day window/i.test(w.label)) return "weekly";
  return "other";
}

export type UsageLine = { kind: UsageWindowKind; label: string; remaining: number | null; resetsAt: number | null; resetText: string; relativeReset: string };

const clock = (d: Date) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

export function resetLabel(resetsAt: number | null | undefined, now: number): string {
  if (resetsAt == null || !Number.isFinite(resetsAt)) return "reset unknown";
  const ms = resetsAt * 1000 - now;
  if (ms <= 0) return "resetting now";
  const date = new Date(resetsAt * 1000);
  if (ms <= 86400000) return `resets ${clock(date)}`;
  if (ms <= 7 * 86400000) return `resets ${new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date)} ${clock(date)}`;
  return `resets ${date.getDate()} ${new Intl.DateTimeFormat(undefined, { month: "short" }).format(date)}`;
}

/** Compact time until reset for the footer: "6 days", "14 hours", "45 min". */
export function relativeResetLabel(resetsAt: number | null | undefined, now: number): string {
  if (resetsAt == null || !Number.isFinite(resetsAt)) return "reset unknown";
  const ms = resetsAt * 1000 - now;
  if (ms <= 0) return "resetting now";
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (ms >= 86400000) return plural(Math.floor(ms / 86400000), "day");
  if (ms >= 3600000) return plural(Math.floor(ms / 3600000), "hour");
  return `${Math.max(1, Math.floor(ms / 60000))} min`;
}

const lowest = (lines: UsageLine[]) => lines.reduce<UsageLine | null>((a, l) =>
  l.remaining === null ? a : !a || l.remaining < (a.remaining as number) ? l : a, null);

function isUnscoped(label: string) {
  return !/ only/i.test(label) && !/^(gemini|claude & gpt|argon)\b/i.test(label);
}

export function usageSummary(windows: UsageWindow[], now: number) {
  const order = { session: 0, weekly: 1, other: 2 } as const;
  const lines: UsageLine[] = windows.map(w => ({
    kind: windowKind(w), label: w.label, remaining: remainingPercent(w.used_percent),
    resetsAt: w.resets_at ?? null, resetText: resetLabel(w.resets_at, now), relativeReset: relativeResetLabel(w.resets_at, now),
  })).map((l, i) => ({ l, i })).sort((a, b) => order[a.l.kind] - order[b.l.kind] || a.i - b.i).map(x => x.l);
  const session = lowest(lines.filter(l => l.kind === "session"));
  const weeklies = lines.filter(l => l.kind === "weekly");
  const unscoped = weeklies.filter(l => isUnscoped(l.label));
  const weekly = lowest(unscoped.length ? unscoped : weeklies);
  return { session, weekly, limiting: lowest(lines), lines };
}

export function usageErrorSummary(error: string | null | undefined, provider: string): string {
  if (/not supported/i.test(error ?? "") || !["claude", "codex", "antigravity", "copilot"].includes(provider)) return "Usage not supported";
  if (isAuthError(error) || /expired|reconnect/i.test(error ?? "")) return "Sign-in expired · reconnect";
  if (/rate limit/i.test(error ?? "")) return "Rate limited · retry later";
  if (/timed out/i.test(error ?? "")) return "Usage timed out";
  return "Usage unavailable";
}
