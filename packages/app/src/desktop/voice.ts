/** Push-to-talk dictation: shared controller (settings status + recording state machine) and pure helpers.
 * Settings live on the Mac side (shared with the phone companion); this module only talks to it through Tauri commands. */
import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";

export type VoiceShortcut = "AltRight" | "MetaRight" | "ControlRight" | "AltLeft";
export type VoiceModel = {
  id: string; name: string; description: string; languageLabel: string; sizeBytes: number; recommended: boolean; installed: boolean;
  download: null | { downloadedBytes: number; totalBytes: number; error: string | null };
};
export type VoiceStatus = {
  enabled: boolean; activeModel: string | null; shortcut: VoiceShortcut; language: string; removeFillerWords: boolean; ready: boolean; recording: boolean; models: VoiceModel[];
};
export type VoiceSettingsPatch = Partial<Pick<VoiceStatus, "enabled" | "activeModel" | "shortcut" | "language" | "removeFillerWords">>;
export type VoicePhase = "idle" | "recording" | "transcribing" | "error";
export type VoiceSource = "hotkey" | "button";
export type VoiceSnapshot = {
  status: VoiceStatus | null; statusError: string | null;
  phase: VoicePhase; source: VoiceSource | null; error: string | null; notice: string | null;
};
export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export const SHORTCUT_OPTIONS: { value: VoiceShortcut; label: string }[] = [
  { value: "AltRight", label: "Right Option" },
  { value: "MetaRight", label: "Right Command" },
  { value: "ControlRight", label: "Right Control" },
  { value: "AltLeft", label: "Left Option" },
];
export const LANGUAGE_OPTIONS = [
  { value: "auto", label: "Auto-detect" }, { value: "en", label: "English" }, { value: "fr", label: "French" },
  { value: "es", label: "Spanish" }, { value: "de", label: "German" }, { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" }, { value: "nl", label: "Dutch" }, { value: "ja", label: "Japanese" }, { value: "zh", label: "Chinese" },
];
export const NO_SPEECH_NOTICE = "Didn't catch that";

export function shortcutLabel(code: string): string { return SHORTCUT_OPTIONS.find(o => o.value === code)?.label ?? code; }
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
export function downloadPercent(d: { downloadedBytes: number; totalBytes: number }): number {
  return d.totalBytes > 0 ? Math.min(100, Math.floor((d.downloadedBytes / d.totalBytes) * 100)) : 0;
}
/** Appends dictated text to a draft with a single separating space when needed. */
export function joinDictation(previous: string, text: string): string {
  if (!previous || /\s$/.test(previous)) return previous + text;
  return `${previous} ${text}`;
}
/** Focuses a composer with the caret after its last character. */
export function focusEnd(el: HTMLTextAreaElement | null | undefined) {
  if (!el) return;
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
}

export type HoldAction = "start" | "stop" | "cancel" | "ignore";
/** Pure hold-to-talk key logic. `held` is whether the shortcut key is currently down and recording was started by it. */
export function holdKeyAction(event: { type: "keydown" | "keyup"; code: string; repeat: boolean }, shortcut: string, held: boolean): HoldAction {
  if (event.type === "keydown") {
    if (event.code === shortcut) return event.repeat || held ? "ignore" : "start";
    return held ? "cancel" : "ignore";
  }
  return event.code === shortcut && held ? "stop" : "ignore";
}

function message(e: unknown): string { return e instanceof Error ? e.message : String(e); }

export function createVoice(call: Invoke) {
  let snap: VoiceSnapshot = { status: null, statusError: null, phase: "idle", source: null, error: null, notice: null };
  const listeners = new Set<() => void>();
  let startResult: Promise<boolean> | null = null, cancelRequested = false, noticeTimer: ReturnType<typeof setTimeout> | undefined;
  function set(patch: Partial<VoiceSnapshot>, detail?: unknown) {
    if (patch.phase && patch.phase !== snap.phase) console.info("[voice]", snap.phase, "→", patch.phase, detail ?? "");
    snap = { ...snap, ...patch };
    listeners.forEach(l => l());
  }
  function fail(e: unknown) { set({ phase: "error", source: null, error: message(e) }, message(e)); }
  function showNotice(text: string) {
    clearTimeout(noticeTimer);
    set({ notice: text });
    noticeTimer = setTimeout(() => set({ notice: null }), 3000);
  }
  // Errors from actions stay visible until the next action succeeds; a background refresh only clears its own errors.
  let errorCommand = "";
  async function status(command: string, args?: Record<string, unknown>) {
    try {
      const next = await call<VoiceStatus>(command, args);
      const keep = command === "voice_status" && errorCommand !== "voice_status";
      set(keep ? { status: next } : { status: next, statusError: null });
    } catch (e) { console.error("[voice]", command, e); errorCommand = command; set({ statusError: message(e) }); }
  }
  async function start(source: VoiceSource): Promise<boolean> {
    if (snap.phase === "recording" || snap.phase === "transcribing" || startResult) return false;
    cancelRequested = false;
    set({ phase: "recording", source, error: null, notice: null }, source);
    const result = startResult = call<void>("voice_start_recording").then(() => true, e => { fail(e); return false; });
    const ok = await result;
    startResult = null;
    if (ok && cancelRequested) {
      cancelRequested = false;
      try { await call<void>("voice_cancel_recording"); } catch (e) { fail(e); }
    }
    return ok;
  }
  /** Stops recording and returns the transcript (null when nothing usable). Waits for a pending start first. */
  async function stop(): Promise<string | null> {
    if (snap.phase !== "recording") return null;
    if (startResult) {
      const ok = await startResult;
      if (!ok || snap.phase !== "recording") return null;
    }
    set({ phase: "transcribing" });
    try {
      const result = await call<{ text: string; durationMs: number; model: string }>("voice_stop_recording");
      const text = (result.text ?? "").trim();
      set({ phase: "idle", source: null }, { chars: text.length, durationMs: result.durationMs, model: result.model });
      if (!text) { showNotice(NO_SPEECH_NOTICE); return null; }
      return text;
    } catch (e) { fail(e); return null; }
  }
  async function cancel() {
    if (snap.phase !== "recording") return;
    set({ phase: "idle", source: null }, "cancel");
    if (startResult) { cancelRequested = true; return; }
    try { await call<void>("voice_cancel_recording"); } catch (e) { fail(e); }
  }
  return {
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
    getSnapshot: () => snap,
    start, stop, cancel,
    clearError() { if (snap.phase === "error") set({ phase: "idle", error: null }); },
    refresh: () => status("voice_status"),
    updateSettings: (settings: VoiceSettingsPatch) => status("voice_update_settings", { settings }),
    downloadModel: (id: string) => status("voice_download_model", { id }),
    cancelDownload: (id: string) => status("voice_cancel_download", { id }),
    deleteModel: (id: string) => status("voice_delete_model", { id }),
  };
}
export type VoiceController = ReturnType<typeof createVoice>;

export const voice = createVoice(invoke);
export function useVoice(controller: VoiceController = voice): VoiceSnapshot {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}
