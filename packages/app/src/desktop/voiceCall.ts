/** Hands-free voice call: bundling / interrupt / speak state machine (framework-free, unit-testable) plus its Tauri binding and React hook. */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { VOICE_CALL_SUFFIX, extractSpoken, hasSpeech } from "../conversation/voiceCallMarkup";

export type CallMode = "interrupt" | "queue";
export type EngineState = "idle" | "listening" | "speech" | "transcribing" | "paused" | "error";
export const SEND_DELAY_MS = 700;

export type CallEvent =
  | { type: "state"; state: EngineState; error?: string }
  | { type: "speech-start" }
  | { type: "segment"; text: string }
  | { type: "tts-start" }
  | { type: "tts-end" };

export type CallIo = {
  start(): Promise<void>;
  stop(): Promise<void>;
  setListening(listening: boolean): Promise<void>;
  speak(text: string): Promise<void>;
  stopSpeaking(): Promise<void>;
  /** Subscribes to backend events; resolves to an unsubscribe function. */
  listen(handler: (event: CallEvent) => void): Promise<() => void>;
};
/** What the call needs from the thread it is attached to. Read through a getter so it is always the latest render's. */
export type CallThread = {
  isBusy(): boolean;
  /** The app's existing Stop action for the thread. */
  stopTurn(): Promise<void>;
  /** The app's existing send path (queues itself when the thread is busy). Rejects on failure. */
  sendText(text: string): Promise<void>;
  /** Best-effort: delete still-queued messages carrying the live-call instruction once the call is over. */
  purgeVoiceQueue?(): Promise<void>;
};
export type ThreadView = { busy: boolean; messages: { id: string; role: string; text: string }[] };
export type CallSnapshot = {
  active: boolean; engine: EngineState; error: string | null; pending: string;
  speaking: boolean; muted: boolean; speak: boolean; mode: CallMode;
  /** Epoch ms when the call began; null while no call is active. */
  startedAt: number | null;
};
/** Sees each transcribed segment first; 'consume' keeps it away from the thread (used by the dashboard command center). */
export type SegmentInterceptor = (text: string) => "consume" | "pass";
export type CallPrefs = { speak: boolean; mode: CallMode };

const PREFS_KEY = "freddai.voiceCall.prefs";
export function loadCallPrefs(): CallPrefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return { speak: parsed.speak === true, mode: parsed.mode === "queue" ? "queue" : "interrupt" };
  } catch { return { speak: false, mode: "interrupt" }; }
}
export function saveCallPrefs(prefs: CallPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (error) { console.error("voice_call.prefs_save_failed", error); }
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const TAG = "<voice-call>";

export class VoiceCallController {
  private s: CallSnapshot;
  private listeners = new Set<() => void>();
  private pendingParts: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unlisten: (() => void) | null = null;
  private generation = 0;
  private view: ThreadView = { busy: false, messages: [] };
  private engineError: string | null = null;
  private actionError: string | null = null;
  /** Set when a spoken-reply message was sent; `baseline` is the last tagged user message before it. */
  private awaiting: { baseline: string | null } | null = null;

  constructor(private io: CallIo, private getThread: () => CallThread, prefs: CallPrefs, private delayMs = SEND_DELAY_MS, private getInterceptor: () => SegmentInterceptor | undefined = () => undefined) {
    this.s = { active: false, engine: "idle", error: null, pending: "", speaking: false, muted: false, speak: prefs.speak, mode: prefs.mode, startedAt: null };
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.s;

  private set(patch: Partial<CallSnapshot>) {
    this.s = { ...this.s, ...patch, pending: this.pendingParts.join(" "), error: this.actionError ?? this.engineError };
    this.listeners.forEach(fn => fn());
  }
  private fail(where: string, error: unknown) {
    console.error(JSON.stringify({ event: "voice_call.error", where, error: message(error) }));
    this.actionError = `${where}: ${message(error)}`;
    this.set({});
  }
  private run(where: string, work: Promise<unknown>) { return work.catch(error => this.fail(where, error)); }

  async begin() {
    if (this.s.active) return;
    const token = ++this.generation;
    this.actionError = null; this.engineError = null;
    this.set({ active: true, engine: "idle", muted: false, startedAt: Date.now() });
    try {
      const off = await this.io.listen(event => this.handle(event));
      if (token !== this.generation) { off(); return; }
      this.unlisten = off;
      await this.io.start();
    } catch (error) {
      if (token !== this.generation) return;
      await this.io.stop().catch(() => {});
      this.fail("Could not start the call", error);
    }
  }

  async end() {
    if (!this.s.active) return;
    this.generation++;
    this.clearTimer();
    this.pendingParts = [];
    this.awaiting = null;
    this.unlisten?.(); this.unlisten = null;
    this.set({ active: false, speaking: false, engine: "idle", startedAt: null });
    const results = await Promise.allSettled([this.io.stop(), this.io.stopSpeaking()]);
    for (const r of results) if (r.status === "rejected") console.error(JSON.stringify({ event: "voice_call.end_failed", error: message(r.reason) }));
    try { await this.getThread().purgeVoiceQueue?.(); } catch (error) { console.warn(JSON.stringify({ event: "voice_call.queue_purge_failed", error: message(error) })); }
  }

  setSpeak(speak: boolean) { this.set({ speak }); saveCallPrefs({ speak, mode: this.s.mode }); }
  setMode(mode: CallMode) { this.set({ mode }); saveCallPrefs({ speak: this.s.speak, mode }); }
  dismissError() { this.actionError = null; this.engineError = null; this.set({}); }

  toggleMute() {
    const muted = !this.s.muted;
    this.set({ muted });
    if (!this.s.speaking) void this.run("Could not change the microphone", this.io.setListening(!muted));
  }

  stopSpeaking() {
    if (!this.s.speaking) return;
    void this.io.stopSpeaking().catch(error => this.fail("Could not stop speaking", error)).finally(() => this.finishSpeaking());
  }

  handle(event: CallEvent) {
    if (!this.s.active) return;
    switch (event.type) {
      case "state":
        this.engineError = event.state === "error" ? event.error || "The voice engine reported an error." : null;
        this.set({ engine: event.state });
        break;
      case "speech-start": this.onSpeechStart(); break;
      case "segment": this.onSegment(event.text); break;
      case "tts-start": this.set({ speaking: true }); break;
      case "tts-end": this.finishSpeaking(); break;
    }
  }

  private onSpeechStart() {
    this.clearTimer();
    if (this.s.speaking) this.stopSpeaking();
    if (this.s.mode === "interrupt" && this.getThread().isBusy()) {
      void this.getThread().stopTurn().catch(error => this.fail("Could not stop the agent", error));
    }
  }

  private onSegment(raw: string) {
    const text = raw.trim();
    if (!text) return;
    if (this.getInterceptor()?.(text) === "consume") return;
    this.pendingParts.push(text);
    this.set({});
    this.clearTimer();
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.delayMs);
  }

  private clearTimer() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }

  private lastTaggedUser(messages = this.view.messages) {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user" && messages[i].text.includes(TAG)) return i;
    return -1;
  }

  private async flush() {
    if (!this.pendingParts.length) return;
    const text = this.pendingParts.join(" ");
    if (!hasSpeech(text)) { this.pendingParts = []; this.set({}); return; }
    const speak = this.s.speak;
    const baseline = this.view.messages[this.lastTaggedUser()]?.id ?? null;
    this.pendingParts = [];
    this.awaiting = speak ? { baseline } : null;
    this.set({});
    try {
      await this.getThread().sendText(speak ? text + VOICE_CALL_SUFFIX : text);
      this.actionError = null;
      this.set({});
    } catch (error) {
      this.awaiting = null;
      this.fail(`Could not send "${text.slice(0, 60)}"`, error);
    }
  }

  /** Feed the thread's latest state; speaks the reply once the agent is idle and answered the last spoken-reply message. */
  observeThread(view: ThreadView) {
    this.view = view;
    if (!this.s.active || !this.awaiting || view.busy || this.s.speaking || this.timer || this.pendingParts.length) return;
    const index = this.lastTaggedUser(view.messages);
    if (index < 0 || view.messages[index].id === this.awaiting.baseline) return;
    const replies = view.messages.slice(index + 1).filter(m => m.role === "assistant" && m.text.trim());
    if (!replies.length) return;
    this.awaiting = null;
    const text = extractSpoken((replies.find(m => m.text.includes("<spoken>")) ?? replies[0]).text);
    if (text) void this.speakAloud(text);
  }

  /** Reads text aloud with the microphone paused, like a spoken reply. */
  speak(text: string) { return this.speakAloud(text); }

  private async speakAloud(text: string) {
    this.set({ speaking: true });
    try {
      await this.io.setListening(false);
      await this.io.speak(text);
    } catch (error) {
      this.fail("Could not read the reply aloud", error);
      this.finishSpeaking();
    }
  }

  private finishSpeaking() {
    if (!this.s.speaking) return;
    this.set({ speaking: false });
    if (this.s.active && !this.s.muted) void this.run("Could not resume the microphone", this.io.setListening(true));
  }
}

export const tauriCallIo: CallIo = {
  start: () => invoke("voice_call_start", {}),
  stop: () => invoke("voice_call_stop"),
  setListening: listening => invoke("voice_call_set_listening", { listening }),
  speak: text => invoke("voice_speak", { text }),
  stopSpeaking: () => invoke("voice_stop_speaking"),
  async listen(handler) {
    const offs = await Promise.all([
      listen<{ state: EngineState; error?: string }>("voice-call://state", e => handler({ type: "state", state: e.payload.state, error: e.payload.error })),
      listen("voice-call://speech-start", () => handler({ type: "speech-start" })),
      listen<{ text: string }>("voice-call://segment", e => handler({ type: "segment", text: e.payload.text })),
      listen("voice-tts://start", () => handler({ type: "tts-start" })),
      listen("voice-tts://end", () => handler({ type: "tts-end" })),
    ]);
    return () => offs.forEach(off => off());
  },
};

// Only one call at a time, app-wide: the active call's thread id lives in a tiny store.
let activeThread: string | null = null;
const registry = new Set<() => void>();
const setActiveThread = (id: string | null) => { activeThread = id; registry.forEach(fn => fn()); };
const subscribeActive = (fn: () => void) => { registry.add(fn); return () => { registry.delete(fn); }; };

export function useVoiceCall({ threadId, enabled, thread, view, io = tauriCallIo, prefs, onSegment }: { threadId: string; enabled: boolean; thread: CallThread; view: ThreadView; io?: CallIo; prefs?: CallPrefs; onSegment?: SegmentInterceptor }) {
  const latest = useRef(thread);
  latest.current = thread;
  const interceptor = useRef(onSegment);
  interceptor.current = onSegment;
  const controller = useRef<VoiceCallController | null>(null);
  const subscribe = (fn: () => void) => controller.current ? controller.current.subscribe(fn) : () => {};
  const snapshot = useSyncExternalStore(subscribe, () => controller.current?.getSnapshot() ?? null);
  const active = useSyncExternalStore(subscribeActive, () => activeThread);

  // The pane unmounts when the user leaves the thread: that ends the call.
  useEffect(() => () => {
    if (controller.current && activeThread === threadId) { void controller.current.end(); controller.current = null; setActiveThread(null); }
  }, [threadId]);

  useEffect(() => { controller.current?.observeThread(view); }, [view.busy, view.messages, snapshot?.active]);

  // Esc stops read-out.
  useEffect(() => {
    if (!snapshot?.speaking) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); controller.current?.stopSpeaking(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [snapshot?.speaking]);

  return {
    snapshot: snapshot && activeThread === threadId ? snapshot : null,
    canStart: enabled && (active === null || active === threadId),
    otherActive: active !== null && active !== threadId,
    controller: controller.current,
    speak(text: string) { return controller.current?.speak(text); },
    start() {
      if (!enabled || activeThread) return;
      const c = new VoiceCallController(io, () => latest.current, prefs ?? loadCallPrefs(), SEND_DELAY_MS, () => interceptor.current);
      controller.current = c;
      setActiveThread(threadId);
      c.observeThread(view);
      void c.begin();
    },
    end() {
      const c = controller.current;
      controller.current = null;
      setActiveThread(null);
      void c?.end();
    },
  };
}
