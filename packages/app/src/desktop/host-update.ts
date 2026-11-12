/** Shown while an older background host still serves the app; the native layer retries the idle upgrade on its own. */
export const HOST_UPDATE_NOTICE = "Update ready — applies automatically when running threads finish.";

export const RESTART_NOW_LABEL = "Restart now";

const RUNNING = ["starting", "running", "waiting"];

export function runningThreadCount(db: { sessions?: { status: string }[] } | null | undefined): number {
  return (db?.sessions ?? []).filter(s => RUNNING.includes(s.status)).length;
}

export function hostUpdateNotice(db: { host_update_pending?: boolean; sessions?: { status: string }[] } | null | undefined): string | null {
  if (!db?.host_update_pending) return null;
  const n = runningThreadCount(db);
  return n > 0 ? `Update ready. Restart now to apply — interrupts ${n} running ${n === 1 ? "thread" : "threads"}.` : HOST_UPDATE_NOTICE;
}

/** A poll can fail briefly while the host restarts during an upgrade; only a sustained failure is worth an error banner. */
export const POLL_FAILURES_BEFORE_ERROR = 3;

export function shouldSurfacePollError(consecutiveFailures: number): boolean {
  return consecutiveFailures >= POLL_FAILURES_BEFORE_ERROR;
}

/** An older host rejects options the new frontend offers; say so instead of showing the bare host error. */
export function launchErrorMessage(error: string, db: { host_update_pending?: boolean } | null | undefined): string {
  if (!db?.host_update_pending) return error;
  if (!error.startsWith("Unsupported ") && error !== "Invalid model configuration") return error;
  return `${error}. The background host has not restarted since the last update, so this option is not available yet. Use "Restart now" in the update banner.`;
}
