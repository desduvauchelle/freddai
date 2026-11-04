import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { manualCheckNotice, UPDATER_STATE_EVENT, type AppUpdateState, type UpdateAction } from "./app-update";

/** Native updater state plus actions. `beforeRestart` persists in-memory composer drafts, which a restart would lose. */
export function useAppUpdate(native: boolean, beforeRestart: () => void) {
  const [state, setState] = useState<AppUpdateState>({ state: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!native) return;
    let stop: (() => void) | undefined, cancelled = false;
    invoke<AppUpdateState>("updater_state").then(s => { if (!cancelled) setState(s); }).catch(e => console.error("updater_state failed", e));
    listen<AppUpdateState>(UPDATER_STATE_EVENT, e => setState(e.payload)).then(un => { if (cancelled) un(); else stop = un; });
    return () => { cancelled = true; stop?.(); };
  }, [native]);
  const check = useCallback(async () => {
    setNotice(null);
    try {
      const result = await invoke<AppUpdateState>("check_for_updates");
      setState(result);
      setNotice(manualCheckNotice(result));
    } catch (e) { setState({ state: "error", message: `Couldn't check for updates: ${e}` }); }
  }, []);
  const run = useCallback(async (kind: UpdateAction) => {
    try {
      if (kind === "retry") return await check();
      if (kind === "open_release" && state.state === "available") return await invoke("open_release_page", { version: state.version });
      if (kind === "install") await invoke("install_update");
      if (kind === "install" || kind === "restart") { beforeRestart(); await invoke("restart_app"); }
    } catch (e) {
      // install_update already moved the native state to "error"; surface other failures here.
      setState(prev => prev.state === "error" ? prev : { state: "error", message: String(e) });
    }
  }, [check, state, beforeRestart]);
  return { state, notice, dismissNotice: () => setNotice(null), check, run };
}
