import { Dormouse } from "./Dormouse";
import { MASCOT_PRIORITY, MASCOT_SIZES, mascotState, moodChip } from "./mascot-state";
import type { Session } from "./types";

/** Live activity at the end of this pane's transcript, including the first launch. */
export function ConversationActivity({ thread }: { thread: Session }) {
  const { mood, label } = mascotState(thread, []);
  if (mood === 0 || mood === 6) return null;
  const text = thread.pending ? "Waiting for your input…"
    : thread.status === "starting" ? "Starting…"
    : thread.status === "waiting" ? "Waiting for your input…"
    : mood === 2 ? "Working…" : label;
  return <aside className="conversation-activity" data-activity-state={thread.status}>
    <Dormouse size={44} priority={4} mood={mood} label={text} />
    <span role="status" aria-live="polite" aria-atomic="true">{text}</span>
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
export function MascotHero({ line }: { line: string }) {
  return <div className="mascot-hero">
    <Dormouse size={MASCOT_SIZES.hero} priority={MASCOT_PRIORITY.hero} mood={0} label="Ready" />
    <p className="mascot-hero-line">{line}</p>
  </div>;
}

/** Small dormouse that sits beside a pending approval so it is obvious the mouse is asking. */
export function ApprovalMouse() {
  return <Dormouse className="mascot-approval" size={MASCOT_SIZES.approval} priority={MASCOT_PRIORITY.approval} mood={4} label="Needs your input" pauseControl={false} />;
}
