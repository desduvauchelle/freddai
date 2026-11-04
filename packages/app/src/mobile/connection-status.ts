/**
 * Pure state machine for the iPhone-to-Mac connection indicator.
 * Network-type failures only turn the connection `down` after they persist for CONNECTION_GRACE_MS;
 * auth/pairing-type failures are not retryable by waiting, so they turn it `down` immediately.
 */
export const CONNECTION_GRACE_MS = 10_000;

export type ConnectionState = 'connecting' | 'ok' | 'down';
export type FailureKind = 'network' | 'auth';
export type ConnectionStatus = { state: ConnectionState; firstFailureAt: number | null; kind: FailureKind | null; error: string };
export type ConnectionTransition = { from: ConnectionState; to: ConnectionState; reason: string; error: string };
export type ConnectionStep = { status: ConnectionStatus; transition?: ConnectionTransition };

export const initialConnectionStatus: ConnectionStatus = { state: 'connecting', firstFailureAt: null, kind: null, error: '' };

/**
 * Errors come back from `companion_snapshot` as plain strings (src-tauri/src/mobile.rs, Mac relay/server).
 * Pairing/credential/certificate problems will not fix themselves; everything else is treated as a network blip.
 */
export function classifyError(message: string): FailureKind {
  if (/unlock your iphone/i.test(message)) return 'network';
  return /device revoked|pair this iphone|pairing credentials|no longer paired|certificate|unauthori[sz]ed|forbidden|\b40[13]\b/i.test(message) ? 'auth' : 'network';
}

function step(from: ConnectionStatus, to: ConnectionStatus, reason: string): ConnectionStep {
  return to.state === from.state ? { status: to } : { status: to, transition: { from: from.state, to: to.state, reason, error: to.error } };
}

export function onSuccess(status: ConnectionStatus): ConnectionStep {
  return step(status, { state: 'ok', firstFailureAt: null, kind: null, error: '' }, 'snapshot-ok');
}

export function onFailure(status: ConnectionStatus, error: string, now: number): ConnectionStep {
  const kind = classifyError(error);
  const firstFailureAt = status.firstFailureAt ?? now;
  const next: ConnectionStatus = { ...status, firstFailureAt, kind, error };
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

export function describeConnection(status: ConnectionStatus): { title: string; detail: string; pair: boolean } {
  if (status.kind === 'auth') return { title: 'This iPhone is no longer paired with your Mac', detail: status.error, pair: true };
  return { title: "Can't reach your Mac — retrying…", detail: status.error, pair: false };
}
