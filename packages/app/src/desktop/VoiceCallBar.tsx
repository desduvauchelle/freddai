import "./VoiceCallBar.css";
import { Mic, MicOff, PhoneOff, Volume2, VolumeX, Square, X } from "lucide-react";
import type { CallMode, CallSnapshot, VoiceCallController } from "./voiceCall";

export type CallPhase = "starting" | "listening" | "hearing" | "transcribing" | "working" | "speaking" | "paused" | "error";

export function callPhase(s: CallSnapshot, agentBusy: boolean): CallPhase {
  if (s.error || s.engine === "error") return "error";
  if (s.speaking) return "speaking";
  if (s.engine === "speech") return "hearing";
  if (s.engine === "transcribing") return "transcribing";
  if (s.muted || s.engine === "paused") return "paused";
  if (s.pending) return "hearing";
  if (agentBusy) return "working";
  if (s.engine === "listening") return "listening";
  return "starting";
}
const LABELS: Record<CallPhase, string> = {
  starting: "Starting call…", listening: "Listening", hearing: "Hearing you", transcribing: "Transcribing", working: "Agent working",
  speaking: "Speaking", paused: "Paused", error: "Error",
};

/** Compact call controls attached above the composer. */
export function VoiceCallBar({ call, snapshot, agentBusy, onEnd, compact = false, queueOnly = false }: { compact?: boolean; queueOnly?: boolean; call: VoiceCallController; snapshot: CallSnapshot; agentBusy: boolean; onEnd: () => void }) {
  const phase = callPhase(snapshot, agentBusy);
  return <section className="voice-call-bar" aria-label="Voice call" data-phase={phase}>
    <div className="voice-call-row">
      <span className="voice-call-state" role="status"><span className="voice-call-dot" aria-hidden="true" />{LABELS[phase]}</span>
      <span className="voice-call-spacer" />
      {snapshot.speaking && <button type="button" onClick={() => call.stopSpeaking()} title="Stop speaking (Esc)"><Square size={12} aria-hidden="true" />Stop speaking</button>}
      <button type="button" aria-pressed={snapshot.muted} aria-label={snapshot.muted ? "Unmute microphone" : "Mute microphone"} title={snapshot.muted ? "Unmute" : "Mute"} onClick={() => call.toggleMute()}>
        {snapshot.muted ? <MicOff size={14} aria-hidden="true" /> : <Mic size={14} aria-hidden="true" />}
      </button>
      {!compact && <button type="button" aria-pressed={snapshot.speak} aria-label="Speak replies" title="Read replies aloud" onClick={() => call.setSpeak(!snapshot.speak)}>
        {snapshot.speak ? <Volume2 size={14} aria-hidden="true" /> : <VolumeX size={14} aria-hidden="true" />}Speak
      </button>}
      {!compact && !queueOnly && <select aria-label="When I talk while the agent works" title="When I talk while the agent works" value={snapshot.mode} onChange={e => call.setMode(e.target.value as CallMode)}>
        <option value="interrupt">Interrupt</option>
        <option value="queue">Queue</option>
      </select>}
      <button type="button" className="voice-call-end" onClick={onEnd}><PhoneOff size={14} aria-hidden="true" />End call</button>
    </div>
    {snapshot.pending && <p className="voice-call-pending" title={snapshot.pending}>{snapshot.pending}</p>}
    {snapshot.error && <div className="voice-call-row" role="alert"><p className="voice-call-error">{snapshot.error}</p><button type="button" aria-label="Dismiss error" onClick={() => call.dismissError()}><X size={12} aria-hidden="true" /></button></div>}
  </section>;
}
