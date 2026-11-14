import { useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CircleAlert, X } from "lucide-react";
import { Button } from "@freddai/ui/components/button";
import type { Database, PermissionMode } from "../types";
import { bugWalk, formatClock, isBugWalkMode, isPipelinePhase, permissionProblem, useBugWalk, type BugWalkStore } from "./bugWalk";
import { closePill, openPill } from "./pillWindow";
import { RecordingCard } from "./RecordingCard";
import { ProgressCard } from "./ProgressCard";
import { SendSheet } from "./SendSheet";
import "./bug-walk.css";

const SETTINGS_URL = { "screen-recording": "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture", microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone" } as const;

/** Mounted once in the main window: owns the event subscription, the pill window, the send sheet, the progress card and banners. */
export function BugWalkHost({ enabled, db, defaultPermission, sheetOpen = true, onOpenThread, onOpenVoiceSettings, store = bugWalk }: {
  enabled: boolean; db: Pick<Database, "accounts" | "projects" | "sessions" | "preferences">; defaultPermission: PermissionMode; sheetOpen?: boolean;
  onOpenThread: (sessionId: string) => void; onOpenVoiceSettings: () => void; store?: BugWalkStore;
}) {
  const { walk, orphans, startError, pillError } = useBugWalk(store);
  useEffect(() => {
    if (!enabled) return;
    let off = () => {}, gone = false;
    store.attach().then(unlisten => { if (gone) unlisten(); else off = unlisten; }).catch(e => console.error("[bug-walk] listen failed", e));
    void store.loadOrphans();
    // The hotkey starts in the last used mode (Zone or App), which Rust keeps in settings.last_mode.
    store.settings.get().then(s => { const mode = s?.last_mode; if (!gone && isBugWalkMode(mode)) store.setLastMode(mode); }).catch(e => console.error("[bug-walk] settings load failed", e));
    return () => { gone = true; off(); };
  }, [enabled, store]);
  const recording = walk?.phase === "recording" && !!walk.region;
  useEffect(() => {
    if (!enabled) return;
    if (recording && walk) {
      store.setPillError(null);
      openPill(walk).catch(e => { console.error("[bug-walk] pill failed", e); store.setPillError(e instanceof Error ? e.message : String(e)); });
    } else void closePill().catch(() => {});
  }, [enabled, recording]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!enabled) return null;
  const problem = permissionProblem(startError);
  const orphan = !walk ? orphans[0] : undefined;
  const showCard = !!walk && (isPipelinePhase(walk.phase) || walk.phase === "done" || walk.phase === "error");
  const showRecording = !!walk && (walk.phase === "recording" || walk.phase === "selecting");
  if (!problem && !startError && !orphan && !walk && !pillError) return null;
  return <>
    <div className="bug-walk-dock">
      {pillError && showRecording && <div className="bug-walk-banner" role="alert">Floating Stop button unavailable: {pillError}</div>}
      {showRecording && walk && <RecordingCard walk={walk} store={store} />}
      {startError && <section className="bug-walk-card" data-state="error" role="alert" aria-label="Bug walk could not start">
        <header><CircleAlert size={15} aria-hidden="true" /><strong>{problem ? (problem.kind === "screen-recording" ? "Screen Recording permission needed" : "Microphone permission needed") : "Bug walk problem"}</strong>
          <button type="button" className="bug-walk-close" aria-label="Dismiss" onClick={() => store.clearStartError()}><X size={13} aria-hidden="true" /></button></header>
        <p className="bug-walk-error">{problem ? problem.hint || "Allow Freddai in System Settings, then try again." : startError}</p>
        {problem && <div className="bug-walk-actions"><Button type="button" size="sm" onClick={() => void openUrl(SETTINGS_URL[problem.kind]).catch(e => console.error("[bug-walk] open settings failed", e))}>Open System Settings</Button></div>}
      </section>}
      {orphan && <section className="bug-walk-card" data-state="orphan" role="status" aria-label="Unfinished bug walk">
        <header><strong>Unfinished bug walk from {new Date(orphan.started_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })} ({formatClock(orphan.duration_s)})</strong></header>
        <div className="bug-walk-actions">
          <Button type="button" variant="ghost" size="sm" onClick={() => void store.discardOrphan(orphan.id)}>Discard</Button>
          <Button type="button" size="sm" onClick={() => store.openOrphan(orphan)}>Send</Button>
        </div>
      </section>}
      {showCard && walk && <ProgressCard walk={walk} store={store} accounts={db.accounts} onOpenThread={onOpenThread} />}
    </div>
    {walk?.phase === "stopped" && <SendSheet walk={walk} db={db} defaultPermission={defaultPermission} open={sheetOpen} onOpenVoiceSettings={onOpenVoiceSettings} store={store} />}
  </>;
}
