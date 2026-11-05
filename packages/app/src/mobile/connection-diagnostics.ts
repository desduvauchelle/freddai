import type { ConnectionStatus } from './connection-status';

const KEY = 'freddai.companion.connection-history.v1';
/** Bounded, device-local metadata only: no prompts, addresses, credentials or response bodies. */
export function recordConnection(status: ConnectionStatus, event: 'failure' | 'recovered' | 'connected', now: number): void {
  try {
    const previous: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
    const entries = Array.isArray(previous) ? previous.slice(-99) : [];
    entries.push({ at: new Date(now).toISOString(), event, kind: status.kind, failures: status.failureCount,
      outageMs: status.firstFailureAt === null ? 0 : Math.max(0, now - status.firstFailureAt), reason: status.attemptReason });
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch { /* Diagnostics must never interfere with reconnection. */ }
}
export function connectionHistory(): string {
  try { return localStorage.getItem(KEY) || '[]'; } catch { return 'unavailable'; }
}
