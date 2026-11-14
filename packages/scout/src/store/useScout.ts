import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../api";
import type { ScoutState } from "../api";
import type { ScoutActions } from "../contracts";

export const SCOUT_POLL_MS = 2000;

type ErrorOrigin = "poll" | "action";

/** Scout store: loads `scout_state` on mount, polls every 2s while the window is visible,
 *  and replaces state with the ScoutState every mutating command returns. Results with a
 *  lower `revision` than the current state are ignored (a slow poll never undoes an action).
 *  Errors are stored in `error` (rendered by the shell's ErrorBar) and rethrown. */
export function useScout(): { state: ScoutState | null; error: string | null; actions: ScoutActions } {
  const [state, setState] = useState<ScoutState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<ScoutState | null>(null);
  const errorOrigin = useRef<ErrorOrigin | null>(null);
  const live = useRef(true);

  const accept = useCallback((next: ScoutState) => {
    if (!live.current) return;
    const prev = current.current;
    if (prev && next.revision < prev.revision) return;
    current.current = next;
    setState(next);
  }, []);

  const fail = useCallback((origin: ErrorOrigin, e: unknown): Error => {
    const err = e instanceof Error ? e : new Error(String(e));
    if (live.current) {
      errorOrigin.current = origin;
      setError(err.message);
    }
    return err;
  }, []);

  const clear = useCallback((origin: ErrorOrigin) => {
    // A successful poll only clears a poll failure; it must not hide a failed action.
    if (!live.current || errorOrigin.current === null) return;
    if (origin === "poll" && errorOrigin.current !== "poll") return;
    errorOrigin.current = null;
    setError(null);
  }, []);

  const poll = useCallback(async () => {
    try {
      accept(await api.scoutState());
      clear("poll");
    } catch (e) {
      fail("poll", e);
    }
  }, [accept, clear, fail]);

  const perform = useCallback(async (call: () => Promise<ScoutState>) => {
    try {
      accept(await call());
      clear("action");
    } catch (e) {
      throw fail("action", e);
    }
  }, [accept, clear, fail]);

  useEffect(() => {
    live.current = true;
    void poll();
    let timer: ReturnType<typeof setInterval> | null = null;
    const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
    const start = () => { if (!timer) timer = setInterval(() => void poll(), SCOUT_POLL_MS); };
    const stopTimer = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVisibility = () => {
      if (visible()) { void poll(); start(); } else stopTimer();
    };
    if (visible()) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      live.current = false;
      stopTimer();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [poll]);

  const actions = useMemo<ScoutActions>(() => ({
    workspaceSave: workspace => perform(() => api.scoutWorkspaceSave(workspace)),
    workspaceDelete: id => perform(() => api.scoutWorkspaceDelete(id)),
    workspaceReorder: ids => perform(() => api.scoutWorkspaceReorder(ids)),
    projectSave: project => perform(() => api.scoutProjectSave(project)),
    projectDelete: id => perform(() => api.scoutProjectDelete(id)),
    projectMove: (id, workspace, index) => perform(() => api.scoutProjectMove(id, workspace, index)),
    itemSave: item => perform(() => api.scoutItemSave(item)),
    itemDelete: id => perform(() => api.scoutItemDelete(id)),
    itemMove: (id, lane, index) => perform(() => api.scoutItemMove(id, lane, index)),
    ruleSave: rule => perform(() => api.scoutRuleSave(rule)),
    ruleDelete: id => perform(() => api.scoutRuleDelete(id)),
    sourceSave: source => perform(() => api.scoutSourceSave(source)),
    sourceDelete: id => perform(() => api.scoutSourceDelete(id)),
    settingsSave: settings => perform(() => api.scoutSettingsSave(settings)),
    importFreddai: () => perform(() => api.scoutImportFreddai()),
    sampleData: load => perform(() => api.scoutSampleData(load)),
    refresh: () => perform(() => api.scoutState()),
  }), [perform]);

  return { state, error, actions };
}
