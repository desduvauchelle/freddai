import type { BugWalkVideo } from './native-shell';

export type { BugWalkVideo };
export type BugWalkSplit = 'single' | 'per_item';
export type BugWalkPermission = 'ask' | 'bypass';
/** Options the Mac's bug_walk_begin receives. Model and effort stay on the Mac's defaults. */
export type BugWalkSendOpts = { project: string; account?: string; permission_mode: BugWalkPermission; split: BugWalkSplit; reply_to_thread?: string };
export type BugWalkPhase = 'stopped' | 'transcribing' | 'analyzing' | 'framing' | 'launching' | 'done' | 'error' | 'missing';
export type BugWalkStatus = { id: string; phase: BugWalkPhase; reason?: string; sessions?: string[]; device?: string };

export const MISSING_GRACE_MS = 5 * 60_000;
export const POLL_MS = 2000;

const LABELS: Record<BugWalkPhase, string> = {
  stopped: 'Waiting for your Mac…',
  transcribing: 'Transcribing…',
  analyzing: 'Analysing…',
  framing: 'Picking frames…',
  launching: 'Opening thread…',
  done: 'Done',
  error: 'Failed',
  missing: "The Mac hasn't picked this up yet. Is Freddai open on your Mac?",
};

/** Human label for a status. Failures include the Mac's reason. */
export function phaseLabel(status: Pick<BugWalkStatus, 'phase' | 'reason'>): string {
  if (status.phase === 'error') return status.reason ? `Failed: ${status.reason}` : 'Failed';
  return LABELS[status.phase] ?? 'Working…';
}

/** Polling ends on done/error, and on missing once the grace period since the send has passed. */
export function pollingFinished(status: Pick<BugWalkStatus, 'phase'>, sinceSendMs: number): boolean {
  if (status.phase === 'done' || status.phase === 'error') return true;
  return status.phase === 'missing' && sinceSendMs >= MISSING_GRACE_MS;
}

export function progressPercent(sent: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((sent / total) * 100)));
}

export function deviceLabel(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent, touchPoints: number = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints): string {
  return /iPad/.test(ua) || (touchPoints > 1 && /Macintosh/.test(ua)) ? 'iPad' : 'iPhone';
}

export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
