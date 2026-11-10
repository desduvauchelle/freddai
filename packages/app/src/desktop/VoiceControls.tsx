import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Loader2, Mic, Send, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import "./VoiceControls.css";
import { Button } from "@freddai/ui/components/button";
import { holdKeyAction, shortcutLabel, useVoice, voice } from "./voice";

/** Hold-to-talk on the configured key. `canListen` gates it (no dialog/settings open); `onText` receives a non-empty transcript. */
export function useHoldToTalk({ canListen, onText }: { canListen: () => boolean; onText: (text: string) => void }) {
  const { status } = useVoice();
  const ready = !!status?.ready, shortcut = status?.shortcut ?? "AltRight";
  const latest = useRef({ canListen, onText });
  latest.current = { canListen, onText };
  useEffect(() => {
    if (!ready) return;
    let held = false;
    const release = () => { if (held) { held = false; void voice.cancel(); } };
    const down = (e: globalThis.KeyboardEvent) => {
      const action = holdKeyAction({ type: "keydown", code: e.code, repeat: e.repeat }, shortcut, held);
      if (action === "start") {
        if (e.isComposing || !document.hasFocus() || !latest.current.canListen() || document.querySelector('[role="menu"], [role="dialog"], .attachment-preview')) return;
        held = true;
        void voice.start("hotkey").then(ok => { if (!ok) held = false; });
      } else if (action === "cancel") release();
    };
    const up = (e: globalThis.KeyboardEvent) => {
      if (holdKeyAction({ type: "keyup", code: e.code, repeat: false }, shortcut, held) !== "stop") return;
      held = false;
      void voice.stop().then(text => { if (text) latest.current.onText(text); });
    };
    const hidden = () => { if (document.visibilityState === "hidden") release(); };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", hidden);
      release();
    };
  }, [ready, shortcut]);
}

/** Shared tap-to-record / hold-to-talk control for every desktop entry point. */
export function MicButton({ target, onText, className = "", label: idleLabel = "Dictate", variant = "ghost", disabled = false, onListening }: { target: boolean; onText: (text: string, button: HTMLElement) => void; className?: string; label?: string; variant?: "default" | "ghost"; disabled?: boolean; onListening?: (listening: boolean) => void }) {
  const snap = useVoice(), active = useRef(false), pressed = useRef<number | null>(null);
  const [mine, setMine] = useState(false), [elapsed, setElapsed] = useState(0), [levels, setLevels] = useState<number[]>([]);
  const button = useRef<HTMLButtonElement>(null);
  const here = mine || (snap.source === "hotkey" && target);
  const recording = here && snap.phase === "recording", transcribing = here && snap.phase === "transcribing";
  const latestText = useRef(onText); latestText.current = onText;
  const mode = recording ? "recording" : transcribing ? "transcribing" : "idle";
  useEffect(() => { onListening?.(recording); return () => onListening?.(false); }, [recording, onListening]);
  function abort() { pressed.current = null; if (active.current) { active.current = false; setMine(false); void voice.cancel(); } }
  useEffect(() => {
    const hide = () => { if (document.visibilityState === "hidden") abort(); };
    const escape = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape" && active.current) { e.preventDefault(); abort(); } };
    window.addEventListener("blur", abort); window.addEventListener("keydown", escape);
    document.addEventListener("visibilitychange", hide);
    return () => { window.removeEventListener("blur", abort); window.removeEventListener("keydown", escape); document.removeEventListener("visibilitychange", hide); if (active.current) void voice.cancel(); };
  }, []);
  useEffect(() => { if (disabled) abort(); }, [disabled]);
  useEffect(() => {
    if (!recording) return;
    let alive = true, pending = false;
    const started = Date.now(); setElapsed(0); setLevels([]);
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
      if (pending) return;
      pending = true;
      void invoke<number>("voice_recording_level").then(level => { if (alive) setLevels(old => [...old.slice(-23), level]); }).catch(() => {}).finally(() => { pending = false; });
    }, 100);
    return () => { alive = false; clearInterval(timer); };
  }, [recording]);
  async function end() {
    if (!active.current) return;
    active.current = false; pressed.current = null;
    const origin = button.current;
    const text = await voice.stop(); setMine(false);
    if (text && origin) latestText.current(text, origin);
  }
  function begin() {
    if (disabled || active.current || snap.phase === "recording" || snap.phase === "transcribing") return;
    active.current = true; setMine(true);
    void voice.start("button").then(ok => { if (!ok) { active.current = false; pressed.current = null; setMine(false); } });
  }
  function release() {
    const start = pressed.current; pressed.current = null;
    if (start !== null && Date.now() - start >= 300) void end();
  }
  if (!snap.status?.ready) return null;
  return <span className="desktop-recording-control" data-state={mode}>
    <Button ref={button} type="button" variant={variant} size="icon" className={`composer-mic ${className}`} data-state={mode}
      aria-label={recording ? "Recording — tap Send or Cancel" : transcribing ? "Transcribing…" : idleLabel}
      title={`Tap to record · Hold to talk (${shortcutLabel(snap.status.shortcut)})`}
      disabled={disabled || transcribing || (!here && (snap.phase === "recording" || snap.phase === "transcribing"))}
      onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
        if (e.button !== 0 || active.current) return;
        e.currentTarget.setPointerCapture?.(e.pointerId); pressed.current = Date.now(); begin();
      }}
      onPointerUp={release}
      onPointerMove={e => { if (pressed.current === null) return; const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left - 32 || e.clientX > r.right + 32 || e.clientY < r.top - 32 || e.clientY > r.bottom + 32) abort(); }}
      onPointerCancel={abort} onLostPointerCapture={() => { if (pressed.current !== null) abort(); }}
      onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!e.repeat) { if (active.current) void end(); else { pressed.current = Date.now(); begin(); } } } }}
      onKeyUp={(e: KeyboardEvent<HTMLButtonElement>) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); release(); } }}
      onClick={e => { e.preventDefault(); if (e.detail === 0 && !active.current && !transcribing) begin(); }}
    >{transcribing ? <Loader2 size={18} className="animate-spin" /> : <Mic size={18} />}</Button>
    {mine && (recording || transcribing) && <span className="desktop-recording-pill" role="group" aria-label="Voice recording">
      {recording && <button type="button" aria-label="Cancel recording" title="Cancel recording (Escape)" onClick={abort}><X size={16} /></button>}
      <span className="desktop-recording-time" role="timer">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>
      <span className="desktop-recording-wave" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <i key={i} style={{ height: `${3 + 21 * Math.min(1, (levels[i] ?? 0) * 4)}px` }} />)}</span>
      {recording ? <button type="button" aria-label="Send recording" title="Send recording" onClick={() => void end()}><Send size={16} /></button> : <span role="status">Transcribing…</span>}
    </span>}
  </span>;
}

/** Inline listening / transcribing / error line shown inside the composer that dictation targets. */
export function VoiceNotice({ target }: { target: boolean }) {
  const snap = useVoice();
  if (!target) return null;
  if (snap.phase === "error" && snap.error) return <div className="voice-notice voice-notice-error" role="alert">
    <span>{snap.error}</span><Button type="button" variant="ghost" size="sm" onClick={() => voice.clearError()}>Dismiss</Button>
  </div>;
  const text = snap.phase === "recording" ? "Listening…" : snap.phase === "transcribing" ? "Transcribing…" : snap.notice;
  return text ? <div className="voice-notice" role="status">{text}</div> : null;
}
