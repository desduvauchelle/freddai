/**
 * Pure state machine for the iPhone-to-Mac connection indicator.
 * Network-type failures only turn the connection `down` after they persist for CONNECTION_GRACE_MS;
 * auth/pairing-type failures are not retryable by waiting, so they turn it `down` immediately.
 * The status also records when we last connected, how often we have failed, and why, so the banner can explain itself.
 */
export const CONNECTION_GRACE_MS = 10_000;
/** Poll delays while the Mac is unreachable: back off instead of hammering a dead host every second. */
export const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 15_000];

export type ConnectionState = 'connecting' | 'ok' | 'down';
export type FailureKind = 'network' | 'auth' | 'protocol';
export type AttemptReason = 'poll' | 'manual' | 'foreground';
export type ConnectionStatus = {
  state: ConnectionState; firstFailureAt: number | null; kind: FailureKind | null; error: string;
  lastOkAt: number | null; lastAttemptAt: number | null; failureCount: number; attemptReason: AttemptReason;
  /** A manual "Try again" is in flight. */
  checking: boolean;
  /** Outcome of the most recent manual check; null until one finishes (cleared when the next starts). */
  manualResult: 'ok' | 'failed' | null;
};
export type ConnectionTransition = { from: ConnectionState; to: ConnectionState; reason: string; error: string; kind: FailureKind | null; failureCount: number; attemptReason: AttemptReason };
export type ConnectionStep = { status: ConnectionStatus; transition?: ConnectionTransition };

export const initialConnectionStatus: ConnectionStatus = {
  state: 'connecting', firstFailureAt: null, kind: null, error: '',
  lastOkAt: null, lastAttemptAt: null, failureCount: 0, attemptReason: 'poll', checking: false, manualResult: null,
};

/**
 * Errors come back from `companion_snapshot` as plain strings (src-tauri/src/mobile.rs, Mac relay/server).
 * Pairing/credential/certificate problems will not fix themselves; everything else is treated as a network blip.
 * "Invalid response from your Mac[: specifics]" means the Mac answered with something we cannot parse: a version/protocol mismatch.
 */
export function classifyError(message: string): FailureKind {
  if (/^\s*invalid response from your mac/i.test(message)) return 'protocol';
  if (/unlock your iphone/i.test(message)) return 'network';
  return /device revoked|pair this iphone|pairing credentials|no longer paired|certificate|unauthori[sz]ed|forbidden|\b40[13]\b/i.test(message) ? 'auth' : 'network';
}

/** The specifics after "Invalid response from your Mac:", or '' when there are none. */
export function protocolDetail(message: string): string {
  return message.replace(/^\s*invalid response from your mac[:\s-]*/i, '').trim();
}

/** Delay before the next poll: steady while healthy, exponential-ish backoff while failing. */
export function pollDelay(status: ConnectionStatus, visible: boolean): number {
  if (status.failureCount === 0) return visible ? 1_000 : 3_000;
  const delay = BACKOFF_MS[Math.min(status.failureCount, BACKOFF_MS.length) - 1];
  return visible ? delay : Math.max(delay, 3_000);
}

function step(from: ConnectionStatus, to: ConnectionStatus, reason: string): ConnectionStep {
  return to.state === from.state ? { status: to } : { status: to, transition: { from: from.state, to: to.state, reason, error: to.error, kind: to.kind, failureCount: to.failureCount, attemptReason: to.attemptReason } };
}

/** A check is starting. Manual checks flag `checking` so the UI can show progress. */
export function onAttempt(status: ConnectionStatus, reason: AttemptReason, now: number): ConnectionStatus {
  return { ...status, lastAttemptAt: now, attemptReason: reason, checking: reason === 'manual', manualResult: reason === 'manual' ? null : status.manualResult };
}

export function onSuccess(status: ConnectionStatus, now: number = Date.now()): ConnectionStep {
  const manualResult = status.checking ? 'ok' : status.manualResult;
  return step(status, { ...status, state: 'ok', firstFailureAt: null, kind: null, error: '', lastOkAt: now, failureCount: 0, checking: false, manualResult }, 'snapshot-ok');
}

export function onFailure(status: ConnectionStatus, error: string, now: number): ConnectionStep {
  const kind = classifyError(error);
  const firstFailureAt = status.firstFailureAt ?? now;
  const manualResult = status.checking ? 'failed' : status.manualResult;
  const next: ConnectionStatus = { ...status, firstFailureAt, kind, error, failureCount: status.failureCount + 1, checking: false, manualResult };
  if (status.state === 'down') return { status: next };
  if (kind === 'auth') return step(status, { ...next, state: 'down' }, 'auth-error');
  return onTick(next, now);
}

/** Re-evaluates the grace deadline without a new failure (timer fired while a request hangs). */
export function onTick(status: ConnectionStatus, now: number): ConnectionStep {
  if (status.state === 'down' || status.firstFailureAt === null) return { status };
  if (now - status.firstFailureAt >= CONNECTION_GRACE_MS) return step(status, { ...status, state: 'down' }, 'network-failure-persisted');
  return { status };
}

/** Milliseconds until a pending network failure turns the status `down`, or null if none is pending. */
export function graceRemaining(status: ConnectionStatus, now: number): number | null {
  if (status.state === 'down' || status.firstFailureAt === null) return null;
  return Math.max(0, CONNECTION_GRACE_MS - (now - status.firstFailureAt));
}

const REASONS: Record<FailureKind, string> = {
  network: 'Make sure Freddai is open on your Mac and both devices are online.',
  auth: "This iPhone's pairing was rejected — pair again.",
  protocol: 'Your Mac answered, but not in a way this app understands. Updating both apps usually fixes this.',
};

export function describeConnection(status: ConnectionStatus): { title: string; detail: string; pair: boolean; reason: string; details: string } {
  const kind = status.kind ?? 'network';
  return { title: "Can't reach your Mac", detail: status.error, pair: kind === 'auth', reason: REASONS[kind], details: kind === 'protocol' ? protocolDetail(status.error) : '' };
}

/** "just now", "12 min ago", "3 h ago", "2 d ago". */
export function formatAgo(from: number, now: number): string {
  const s = Math.max(0, Math.round((now - from) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

/** "Last connected 12 min ago · tried 5 times" (parts omitted when unknown). */
export function describeHistory(status: ConnectionStatus, now: number): string {
  const parts = [status.lastOkAt === null ? 'Not connected yet this session' : `Last connected ${formatAgo(status.lastOkAt, now)}`];
  if (status.failureCount > 0) parts.push(`tried ${status.failureCount} ${status.failureCount === 1 ? 'time' : 'times'}`);
  return parts.join(' · ');
}

/** Plain-text report for "Copy details". */
export function connectionReport(status: ConnectionStatus, now: number): string {
  const iso = (t: number | null) => (t === null ? 'never' : new Date(t).toISOString());
  return ['Freddai companion connection', `error: ${status.error || '(none)'}`, `kind: ${status.kind ?? 'none'}`, `state: ${status.state}`,
    `failureCount: ${status.failureCount}`, `lastConnectedAt: ${iso(status.lastOkAt)}`, `lastAttemptAt: ${iso(status.lastAttemptAt)}`, `firstFailureAt: ${iso(status.firstFailureAt)}`, `attemptReason: ${status.attemptReason}`, `reportedAt: ${iso(now)}`].join('\n');
}
