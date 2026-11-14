import { useEffect, useState, type ReactNode } from "react";
import { Loader2, Mic, MicOff, Plus } from "lucide-react";
import { Dormouse } from "../Dormouse";
import { MASCOT_PRIORITY } from "../mascot-state";
import { MicButton } from "../VoiceControls";
import { useVoice } from "../voice";
import { useCommander } from "./useCommander";
import "./commander.css";

export const statusText = (s: { needs_you: number; running: number; done_today: number }) => `${s.needs_you} needs you · ${s.running} running · ${s.done_today} done`;

/** Dashboard presence: avatar circle + mic circle (bottom-left) + plus circle (bottom-right) + status pill. */
export function CommanderCluster({ onOpen, onSend, bugWalk }: {
  onOpen: () => void;
  /** Sends a message to Commander (existing thread, or a new one in the commander project). */
  onSend: (text: string) => Promise<void>;
  /** Optional bug-walk control (desktop native only), rendered as a third circle. */
  bugWalk?: ReactNode;
}) {
  const { state, error } = useCommander({ todos: false });
  const voice = useVoice();
  const [busy, setBusy] = useState(false), [sendError, setSendError] = useState(""), [sent, setSent] = useState("");
  useEffect(() => { if (!sent) return; const t = setTimeout(() => setSent(""), 4000); return () => clearTimeout(t); }, [sent]);
  const status = state?.status ?? { needs_you: 0, running: 0, done_today: 0 };
  const working = status.running > 0;
  const name = state?.project.name ?? "Commander";

  async function deliver(message: string) {
    setBusy(true); setSendError("");
    try { await onSend(message); setSent(`Sent to ${name}`); return true; }
    catch (e) { setSendError(e instanceof Error ? e.message : String(e)); return false; }
    finally { setBusy(false); }
  }
  const micReady = !!voice.status?.ready;

  return <section className="commander-cluster" aria-label={`${name} cluster`} data-working={working}>
    <div className="commander-circles">
      <div className="commander-avatar-circle" data-state={working ? "working" : "ready"}>
        <span className="commander-avatar-art" aria-hidden="true">
          <Dormouse size={108} priority={MASCOT_PRIORITY.hero} mood={working ? 2 : status.needs_you ? 4 : 0} label={working ? "Working" : "Ready"} pauseControl={false} antics />
        </span>
        <button type="button" className="commander-avatar-open" aria-label={`Open ${name}`} title={`Open ${name}`} onClick={onOpen} />
      </div>
      {micReady
        ? <div className="commander-circle commander-mic" data-pos="left"><MicButton target={false} label={`Dictate to ${name}`} className="commander-circle-button" onText={t => void deliver(t)} /></div>
        : <button type="button" className="commander-circle commander-mic commander-circle-button" data-pos="left" disabled
          aria-label={`Dictate to ${name}`} title="Dictation isn't ready. Set it up in Settings → Voice."><MicOff size={18} aria-hidden="true" /></button>}
      {bugWalk && <div className="commander-circle commander-bug-walk" data-pos="top-left">{bugWalk}</div>}
      <button type="button" className="commander-circle commander-plus commander-circle-button" data-pos="right"
        aria-label={`Message ${name}`} title={`Message ${name}`} onClick={onOpen}>
        <Plus size={18} aria-hidden="true" />
      </button>
    </div>
    <p className="commander-name">{name}</p>
    <button type="button" className="commander-pill" data-needs={status.needs_you > 0} onClick={onOpen}
      aria-label={`${name} status: ${statusText(status)}. Open ${name}`}>
      <span data-kind="needs">{status.needs_you} needs you</span><span data-kind="running">{status.running} running</span><span data-kind="done">{status.done_today} done</span>
    </button>
    {voice.phase === "recording" && <p className="commander-note" role="status"><Mic size={12} aria-hidden="true" />Listening…</p>}
    {voice.phase === "transcribing" && <p className="commander-note" role="status"><Loader2 size={12} className="animate-spin" aria-hidden="true" />Transcribing…</p>}
    {busy && <p className="commander-note" role="status">Sending…</p>}
    {sent && <p className="commander-note" role="status">{sent}</p>}
    {(error || sendError) && <p className="commander-error" role="alert">{sendError || `Couldn't reach ${name}: ${error}`}</p>}

  </section>;
}
