/** Mirrors `UpdateState` in apps/native/src-tauri/src/updater.rs (serde tag "state"). */
export type AppUpdateState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string; notes?: string | null; manual: boolean }
  | { state: "downloading"; version: string; downloaded: number; total?: number | null }
  | { state: "ready_to_restart"; version: string }
  | { state: "local_build"; published: string }
  | { state: "error"; message: string };

export const UPDATER_STATE_EVENT = "updater://state";
export const UP_TO_DATE_NOTICE = "Freddai is up to date.";

export type UpdateAction = "install" | "restart" | "open_release" | "retry";
export interface UpdateBanner { text: string; action?: { kind: UpdateAction; label: string }; busy?: boolean; error?: boolean }

export function downloadPercent(downloaded: number, total?: number | null): number | null {
  return total && total > 0 ? Math.min(100, Math.floor((Math.min(downloaded, total) * 100) / total)) : null;
}

/** The banner for the current updater state, or null when there is nothing to show. */
export function updateBanner(s: AppUpdateState): UpdateBanner | null {
  switch (s.state) {
    case "available":
      return s.manual
        ? { text: `Freddai ${s.version} is available.`, action: { kind: "open_release", label: "Open release page" } }
        : { text: `Freddai ${s.version} is available.`, action: { kind: "install", label: "Update & restart" } };
    case "downloading": {
      const pct = downloadPercent(s.downloaded, s.total);
      return { text: `Downloading Freddai ${s.version}${pct === null ? "…" : ` (${pct}%)`}`, busy: true };
    }
    case "ready_to_restart":
      return { text: `Freddai ${s.version} is installed.`, action: { kind: "restart", label: "Restart" } };
    case "error":
      return { text: s.message, error: true, action: { kind: "retry", label: "Try again" } };
    default:
      return null;
  }
}

/** A manual check that finds nothing should say so; automatic checks stay silent when up to date. */
export function manualCheckNotice(result: AppUpdateState): string | null {
  if (result.state === "local_build") return `Local build \u2014 published version is ${result.published}`;
  return result.state === "idle" ? UP_TO_DATE_NOTICE : null;
}
