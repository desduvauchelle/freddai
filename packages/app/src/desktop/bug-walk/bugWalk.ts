/** Bug walk client store: one source of truth for the active walk, wrapping the Rust commands and the two events.
 * Rust owns the pipeline; this module only issues commands and mirrors `bug-walk://state`. */
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PermissionMode } from "../types";

export type BugWalkPhase = "selecting" | "recording" | "stopped" | "transcribing" | "analyzing" | "framing" | "launching" | "done" | "cancelled" | "error";
/** "zone": drag a region of the screen (a plain click = whole display). "app": click an app window to record just it. */
export type BugWalkMode = "zone" | "app";
/** What was recorded. `kind` is absent for walks made before window mode (= region). */
export type BugWalkRegion = { x: number; y: number; width: number; height: number; scale: number; kind?: "region" | "window"; window_id?: number; bundle_id?: string; app_name?: string; title?: string };
export type BugWalkOrigin = { project?: string; thread?: string };
export type BugWalkSplit = "single" | "per_item";
export type BugWalkSendOpts = { project: string; account: string; model?: string | null; effort?: string | null; speed?: string | null; permission_mode: PermissionMode; reply_to_thread?: string | null; /** "per_item" starts one thread per bug; ignored by Rust when replying in a thread. */ split?: BugWalkSplit };
export type BugWalkStateEvent = {
  id: string; phase: BugWalkPhase; region?: BugWalkRegion; elapsed_s?: number; level?: number; session_id?: string; session_ids?: string[]; /** `launching` progress when starting one thread per bug. */ launched?: number; total?: number; error?: string; transcript?: string; reason?: string;
};
export type BugWalkOrphan = { id: string; started_at: number; duration_s: number };
export type BugWalkSettings = { shortcut: string; enabled: boolean; last_split?: BugWalkSplit; /** Rust saves it on every start; the hotkey reuses it. */ last_mode?: BugWalkMode };
/** What `bug_walk_settings_get` returns: `error` is set when the saved shortcut could not be registered at startup. */
export type BugWalkSettingsView = BugWalkSettings & { error?: string };
export type BugWalk = {
  id: string; phase: BugWalkPhase; region?: BugWalkRegion; /** Target mode chosen at start (drives the selecting hint). */ mode?: BugWalkMode;
  /** Last elapsed seconds reported by Rust (or the final duration once stopped). */
  elapsed: number;
  /** Epoch ms when recording began; the pill derives a live clock from it. */
  startedAt: number | null;
  level: number; error?: string; transcript?: string; /** Set when the recorder stopped itself (30-minute limit). */ notice?: string; sessionId?: string; sessionIds?: string[]; launched?: number; total?: number; origin?: BugWalkOrigin;
  /** Options used by the last send, so the error card can resend the transcript with the same choices. */
  sendOpts?: BugWalkSendOpts;
  /** True for a walk reopened from a crash (no live recording). */
  orphan?: boolean;
};
export type BugWalkSnapshot = { walk: BugWalk | null; orphans: BugWalkOrphan[]; startError: string | null; /** Set when the floating pill window could not be created or reported an error. */ pillError: string | null };
export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
export type Listen = (event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>;

export const DEFAULT_SHORTCUT = "CommandOrControl+Shift+R";
export const PIPELINE_PHASES: BugWalkPhase[] = ["transcribing", "analyzing", "framing", "launching"];
export const isPipelinePhase = (phase: BugWalkPhase) => PIPELINE_PHASES.includes(phase);
export const isBugWalkMode = (v: unknown): v is BugWalkMode => v === "zone" || v === "app";
/** "App: Safari — Inbox" or "Zone 1280×720". */
export function targetLabel(region: BugWalkRegion): string {
  if (region.kind === "window") {
    const app = region.app_name || "App window";
    return `App: ${region.title ? `${app} — ${region.title}` : app}`;
  }
  return `Zone ${Math.round(region.width)}×${Math.round(region.height)}`;
}
export const PHASE_LABELS: Record<string, string> = { transcribing: "Transcribing", analyzing: "Analyzing", framing: "Grabbing frames", launching: "Starting thread" };

export type PermissionProblem = { kind: "screen-recording" | "microphone"; hint: string };
/** Rust prefixes permission failures with `screen-recording-permission` or `microphone-permission` followed by a hint. */
export function permissionProblem(error: string | null): PermissionProblem | null {
  if (!error) return null;
  const match = /^(screen-recording|microphone)-permission:?\s*(.*)$/s.exec(error.trim());
  return match ? { kind: match[1] as PermissionProblem["kind"], hint: match[2].trim() } : null;
}
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
export function elapsedSeconds(walk: Pick<BugWalk, "startedAt" | "elapsed" | "phase">, now: number): number {
  return walk.phase === "recording" && walk.startedAt ? Math.max(walk.elapsed, (now - walk.startedAt) / 1000) : walk.elapsed;
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createBugWalk(call: Invoke = invoke as Invoke, subscribe: Listen = listen as unknown as Listen, now: () => number = Date.now) {
  let snap: BugWalkSnapshot = { walk: null, orphans: [], startError: null, pillError: null };
  const listeners = new Set<() => void>();
  let pendingOrigin: BugWalkOrigin | undefined, pendingMode: BugWalkMode | undefined, starting = false;
  /** Seeded from settings by the host; updated on every start. The hotkey uses it. */
  let lastMode: BugWalkMode = "zone";
  /** Walks the user cancelled: late events (level ticks) for them must not resurrect a walk. */
  const discarded = new Set<string>();
  function set(patch: Partial<BugWalkSnapshot>) { snap = { ...snap, ...patch }; listeners.forEach(l => l()); }
  function patchWalk(patch: Partial<BugWalk>) { if (snap.walk) set({ walk: { ...snap.walk, ...patch } }); }
  const fail = (what: string, e: unknown) => { console.error(`[bug-walk] ${what}`, e); return message(e); };

  /** Applies one `bug-walk://state` event. Exposed for tests; the listener calls it. */
  function applyState(ev: BugWalkStateEvent) {
    // Startup events without a walk (shortcut registration failed) are a notice, never an active walk.
    if (!ev.id) { if (ev.phase === "error") set({ startError: ev.error || "Bug walk is unavailable." }); return; }
    if (discarded.has(ev.id)) return;
    const cur = snap.walk;
    // A late level tick must not pull a stopped or sending walk back to recording.
    if (cur && cur.id === ev.id && ev.phase === "recording" && cur.phase !== "recording" && cur.phase !== "selecting") return;
    if (cur && cur.id !== ev.id) {
      // A late event from a walk we already left (e.g. cancelled): ignore unless we are idle on a finished card.
      if (cur.phase !== "done" && cur.phase !== "cancelled") return;
    }
    if (ev.phase === "cancelled") { if (!cur || cur.id === ev.id) set({ walk: null }); return; }
    const base: BugWalk = cur && cur.id === ev.id ? cur : { id: ev.id, phase: ev.phase, elapsed: 0, startedAt: null, level: 0, origin: pendingOrigin, mode: pendingMode };
    const next: BugWalk = { ...base, phase: ev.phase };
    if (ev.region) next.region = ev.region;
    if (typeof ev.elapsed_s === "number") next.elapsed = ev.elapsed_s;
    if (typeof ev.level === "number") next.level = ev.level;
    if (ev.session_id) next.sessionId = ev.session_id;
    if (ev.session_ids?.length) next.sessionIds = ev.session_ids;
    if (typeof ev.launched === "number") next.launched = ev.launched;
    if (typeof ev.total === "number") next.total = ev.total;
    if (ev.transcript !== undefined) next.transcript = ev.transcript;
    if (ev.reason === "max-duration") next.notice = "Recording stopped at the 30-minute limit.";
    if (ev.reason === "writer-failed") next.notice = "The screen video could not be saved; only the audio was kept.";
    if (ev.phase === "error") next.error = ev.error || "The bug walk failed.";
    else if (ev.error) next.error = ev.error;
    if (ev.phase === "recording" && next.startedAt === null) next.startedAt = now() - next.elapsed * 1000;
    if (ev.phase === "stopped" && next.startedAt !== null && !(typeof ev.elapsed_s === "number")) next.elapsed = Math.max(next.elapsed, (now() - next.startedAt) / 1000);
    if (ev.phase === "stopped" || isPipelinePhase(ev.phase)) next.level = 0;
    set({ walk: next });
  }

  async function start(origin?: BugWalkOrigin, mode: BugWalkMode = lastMode): Promise<boolean> {
    if (starting || (snap.walk && snap.walk.phase !== "done" && snap.walk.phase !== "cancelled")) return false;
    starting = true; pendingOrigin = origin; pendingMode = mode; lastMode = mode;
    set({ startError: null, pillError: null, walk: null });
    try {
      // Rust persists `mode` as settings.last_mode.
      const { id, cancelled } = await call<{ id: string; cancelled?: boolean }>("bug_walk_start", { origin: origin ?? null, mode });
      // Esc during region selection: no walk, no pill. The `cancelled` event usually cleared it already.
      if (cancelled) { discarded.add(id); set({ walk: null }); return false; }
      // Events may have created the walk already; keep their phase, only ensure origin and id.
      if (!snap.walk || snap.walk.id !== id) set({ walk: { id, phase: "selecting", elapsed: 0, startedAt: null, level: 0, origin, mode } });
      else patchWalk({ origin, mode });
      return true;
    } catch (e) {
      set({ walk: null, startError: fail("start failed", e) });
      return false;
    } finally { starting = false; pendingOrigin = undefined; pendingMode = undefined; }
  }
  async function stop() {
    const walk = snap.walk; if (!walk || walk.phase !== "recording") return;
    try {
      const r = await call<{ id: string; duration_s: number; region?: BugWalkRegion }>("bug_walk_stop", { id: walk.id });
      if (snap.walk?.id === walk.id && snap.walk.phase === "recording") patchWalk({ phase: "stopped", elapsed: r.duration_s, level: 0, region: r.region ?? snap.walk.region });
    } catch (e) { patchWalk({ phase: "error", error: fail("stop failed", e) }); }
  }
  async function cancel() {
    const walk = snap.walk; if (!walk) return;
    set({ walk: null }); discarded.add(walk.id);
    try { await call<void>("bug_walk_cancel", { id: walk.id }); } catch (e) { set({ startError: `Couldn't discard the recording: ${fail("cancel failed", e)}` }); }
    if (walk.orphan) void loadOrphans();
  }
  async function send(opts: BugWalkSendOpts) {
    const walk = snap.walk; if (!walk) return;
    patchWalk({ sendOpts: opts, phase: "transcribing", error: undefined });
    try { await call<void>("bug_walk_send", { id: walk.id, opts }); }
    catch (e) { patchWalk({ phase: "error", error: fail("send failed", e) }); }
  }
  async function sendTranscript(opts?: BugWalkSendOpts) {
    const walk = snap.walk; const base = opts ?? walk?.sendOpts; if (!walk || !base) return;
    // A raw transcript has no items to split, so it is always one thread.
    const used: BugWalkSendOpts = { ...base, split: "single" };
    patchWalk({ sendOpts: used, phase: "launching", error: undefined });
    try { await call<void>("bug_walk_send_transcript", { id: walk.id, opts: used }); }
    catch (e) { patchWalk({ phase: "error", error: fail("send transcript failed", e) }); }
  }
  function dismiss() {
    if (!snap.walk || (snap.walk.phase !== "done" && snap.walk.phase !== "error")) return;
    set({ walk: null });
    // A recorder that died keeps its audio on disk as an unfinished walk: offer it right away.
    void loadOrphans();
  }
  function clearStartError() { set({ startError: null }); }
  function setPillError(error: string | null) { set({ pillError: error }); }
  async function loadOrphans() {
    try { const list = await call<BugWalkOrphan[]>("bug_walk_orphans"); set({ orphans: Array.isArray(list) ? list : [] }); }
    catch (e) { console.error("[bug-walk] orphans failed", e); }
  }
  function openOrphan(orphan: BugWalkOrphan) {
    if (snap.walk) return;
    set({ walk: { id: orphan.id, phase: "stopped", elapsed: orphan.duration_s, startedAt: null, level: 0, orphan: true }, orphans: snap.orphans.filter(o => o.id !== orphan.id) });
  }
  async function discardOrphan(id: string) {
    set({ orphans: snap.orphans.filter(o => o.id !== id) });
    try { await call<void>("bug_walk_cancel", { id }); } catch (e) { set({ startError: `Couldn't discard the unfinished walk: ${fail("discard orphan failed", e)}` }); }
  }
  function setLastMode(mode: BugWalkMode) { lastMode = mode; }
  function getLastMode() { return lastMode; }
  /** Global shortcut (last used mode): start when idle, stop while recording, ignore otherwise (including an error card that still holds a transcript). */
  function onHotkey() {
    const w = snap.walk;
    if (!w || w.phase === "done" || w.phase === "cancelled") void start(undefined, lastMode);
    else if (w.phase === "recording") void stop();
  }
  /** Seeds a walk in another window (the recording pill) from its URL params. */
  function seed(walk: Pick<BugWalk, "id" | "startedAt"> & Partial<BugWalk>) {
    set({ walk: { phase: "recording", elapsed: 0, level: 0, ...walk } });
  }
  /** Subscribes to both events. Returns the unlisten function. */
  async function attach(options: { hotkey?: boolean } = {}): Promise<() => void> {
    const offs = [await subscribe("bug-walk://state", e => applyState(e.payload as BugWalkStateEvent))];
    if (options.hotkey !== false) offs.push(await subscribe("bug-walk://hotkey", onHotkey));
    return () => offs.forEach(off => off());
  }
  return {
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    getSnapshot: () => snap,
    start, stop, cancel, send, sendTranscript, dismiss, clearStartError, setPillError, loadOrphans, openOrphan, discardOrphan, onHotkey, applyState, seed, attach, setLastMode, getLastMode,
    settings: {
      get: () => call<BugWalkSettingsView>("bug_walk_settings_get"),
      set: (settings: BugWalkSettings) => call<void>("bug_walk_settings_set", { settings }),
    },
  };
}
export type BugWalkStore = ReturnType<typeof createBugWalk>;

export const bugWalk = createBugWalk();
export function useBugWalk(store: BugWalkStore = bugWalk): BugWalkSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** "CommandOrControl+Shift+R" → "⌘⇧R" for menus. Unknown parts pass through. */
export function prettyShortcut(accelerator: string): string {
  const names: Record<string, string> = { commandorcontrol: "⌘", cmdorctrl: "⌘", command: "⌘", cmd: "⌘", super: "⌘", meta: "⌘", control: "⌃", ctrl: "⌃", alt: "⌥", option: "⌥", shift: "⇧" };
  return accelerator.split("+").map(p => names[p.trim().toLowerCase()] ?? p.trim().toUpperCase()).join("");
}
