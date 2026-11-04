/** Shown while an older background host still serves the app; the native layer retries the idle upgrade on its own. */
export const HOST_UPDATE_NOTICE = "Update ready — applies automatically when running threads finish.";

export function hostUpdateNotice(db: { host_update_pending?: boolean } | null | undefined): string | null {
  return db?.host_update_pending ? HOST_UPDATE_NOTICE : null;
}

/** A poll can fail briefly while the host restarts during an upgrade; only a sustained failure is worth an error banner. */
export const POLL_FAILURES_BEFORE_ERROR = 3;

export function shouldSurfacePollError(consecutiveFailures: number): boolean {
  return consecutiveFailures >= POLL_FAILURES_BEFORE_ERROR;
}
