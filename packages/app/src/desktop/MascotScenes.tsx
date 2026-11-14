import { Pin, PinOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@freddai/ui/components/button";
import { ActivityControls } from "../conversation/ActivityControls";
import { Dormouse } from "./Dormouse";
import { MASCOT_PRIORITY, MASCOT_SIZES, mascotState, moodChip } from "./mascot-state";
import type { Session } from "./types";

/** Live activity at the end of this pane's transcript, including the first launch. */
export function ConversationActivity({ thread, onStop, onResume, onTogglePin, disabled }: { thread: Session; onStop?: () => void; onResume?: () => void; onTogglePin?: (pinned: boolean) => void; disabled?: boolean }) {
  const { mood, label } = mascotState(thread, []);
  const active = ["starting", "running", "waiting"].includes(thread.status);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active || thread.turn_started_at == null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, thread.id, thread.turn_started_at]);
  const seconds = Math.max(0, Math.floor((now - (thread.turn_started_at ?? now)) / 1000));
  const elapsed = seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
  const tokens = thread.usage?.context_tokens;
  if (mood === 0 || mood === 6) return null;
  const text = thread.pending ? "Waiting for your input…"
    : thread.status === "starting" ? "Starting…"
    : thread.status === "waiting" ? "Waiting for your input…"
    : mood === 2 ? "Working…" : label;
  const controls = <ActivityControls active={active} interrupted={thread.status === "interrupted"} onStop={onStop} onResume={onResume} disabled={disabled} />;
  return <aside className="conversation-activity" data-activity-state={thread.status}>
    <Dormouse size={44} priority={4} mood={mood} label={text} />
    {thread.status === "interrupted" && controls}
    <span role="status" aria-live="polite" aria-atomic="true">{text}</span>
    {active && <small className="turn-metrics" aria-live="off">
      {thread.turn_started_at != null && <span title="Elapsed since this turn started, including tools and waiting for input">{elapsed} elapsed</span>}
      {typeof tokens === "number" && Number.isFinite(tokens) && tokens >= 0 && <span title="Last provider-reported context usage; may update only after a response">{tokens.toLocaleString()} context tokens</span>}
    </small>}
    {onTogglePin && <Button type="button" size="icon" variant="ghost" className="activity-control activity-pin" aria-pressed={!!thread.pinned} aria-label={thread.pinned ? "Unpin thread" : "Pin thread"} title={thread.pinned ? "Unpin thread" : "Pin thread"} onClick={() => onTogglePin(!thread.pinned)}>
      {thread.pinned ? <PinOff size={16} aria-hidden="true" /> : <Pin size={16} aria-hidden="true" />}
    </Button>}
    {thread.status !== "interrupted" && controls}
  </aside>;
}

/** Dormouse beside a conversation's title. Mood comes from that pane's own thread; a quiet text chip names any non-idle state. */
export function ConversationMascot({ thread, sessions, read }: { thread: Session; sessions: readonly Session[]; read: Record<string, number> }) {
  const { mood, label } = mascotState(thread, sessions, read);
  return <Dormouse className="mascot-header" size={MASCOT_SIZES.header} priority={MASCOT_PRIORITY.header} mood={mood} label={label} />;
}
export function ConversationMascotChip({ thread, sessions, read }: { thread: Session; sessions: readonly Session[]; read: Record<string, number> }) {
  const chip = moodChip(mascotState(thread, sessions, read).mood);
  return chip ? <span className="mascot-chip" data-mascot-chip>{chip}</span> : null;
}

/** Large friendly dormouse that tops an empty state. Existing copy and controls stay beneath it. */
export function MascotHero({ line, size = MASCOT_SIZES.hero }: { line: string; size?: number }) {
  return <div className="mascot-hero">
    <Dormouse size={size} priority={MASCOT_PRIORITY.hero} mood={0} label="Ready" antics />
    <p className="mascot-hero-line">{line}</p>
  </div>;
}

/** Small dormouse that sits beside a pending approval so it is obvious the mouse is asking. */
export function ApprovalMouse() {
  return <Dormouse className="mascot-approval" size={MASCOT_SIZES.approval} priority={MASCOT_PRIORITY.approval} mood={4} label="Needs your input" pauseControl={false} />;
}
