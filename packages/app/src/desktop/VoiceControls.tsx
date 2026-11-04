import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Loader2, Mic } from "lucide-react";
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

/** Press-and-hold microphone button for a composer tools row. Renders nothing unless dictation is ready. */
export function MicButton({ target, onText }: { target: boolean; onText: (text: string, button: HTMLElement) => void }) {
  const snap = useVoice(), held = useRef(false), [mine, setMine] = useState(false);
  const status = snap.status;
  if (!status?.ready) return null;
  const here = mine || (snap.source === "hotkey" && target);
  const mode = here && snap.phase === "recording" ? "recording" : here && snap.phase === "transcribing" ? "transcribing" : "idle";
  const busyElsewhere = mode === "idle" && (snap.phase === "recording" || snap.phase === "transcribing");
  function begin() {
    if (held.current) return;
    held.current = true; setMine(true);
    void voice.start("button").then(ok => { if (!ok && held.current) { held.current = false; setMine(false); } });
  }
  async function end(button: HTMLElement) {
    if (!held.current) return;
    held.current = false;
    const text = await voice.stop();
    setMine(false);
    if (text) onText(text, button);
  }
  function abort() { if (held.current) { held.current = false; setMine(false); void voice.cancel(); } }
  const label = mode === "recording" ? "Recording — release to transcribe" : mode === "transcribing" ? "Transcribing…" : "Dictate";
  return <Button
    type="button" variant="ghost" size="icon" className="composer-mic" data-state={mode}
    aria-label={label} title={`Hold to talk (${shortcutLabel(status.shortcut)})`} disabled={busyElsewhere}
    onPointerDown={(e: PointerEvent<HTMLButtonElement>) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture?.(e.pointerId); begin(); }}
    onPointerUp={(e: PointerEvent<HTMLButtonElement>) => { void end(e.currentTarget); }}
    onPointerCancel={abort}
    onLostPointerCapture={abort}
    onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!e.repeat) begin(); } }}
    onKeyUp={(e: KeyboardEvent<HTMLButtonElement>) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); void end(e.currentTarget); } }}
    onBlur={abort}
    onClick={e => e.preventDefault()}
  >{mode === "transcribing" ? <Loader2 size={18} className="animate-spin" /> : <Mic size={18} />}</Button>;
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
