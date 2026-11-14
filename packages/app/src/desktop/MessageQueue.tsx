import { MessageInput } from "../conversation/MessageComposer";
import { useEffect, useRef, useState } from "react";
import { stripVoiceCall } from "../conversation/voiceCallMarkup";
import "./MessageQueue.css";
import { CornerDownRight, Pencil, CornerUpLeft, Trash2 } from "lucide-react";
import { ScrollArea } from "@freddai/ui/components/scroll-area";
import type { ThreadQueue } from "./types";

type QueuedMessage = ThreadQueue["messages"][number];
type Row = { message: QueuedMessage; leaving: boolean };
/** Keep in sync with the exit animation duration in MessageQueue.css. */
const LEAVE_MS = 180;

/** Merge the live queue with rows still animating out so a removed row stays mounted in place. */
function mergeRows(old: Row[], visible: QueuedMessage[]): Row[] {
  const byId = new Map(visible.map(message => [message.id, message]));
  const seen = new Set<string>();
  const next: Row[] = [];
  for (const row of old) {
    const live = byId.get(row.message.id);
    if (live) { next.push({ message: live, leaving: false }); seen.add(live.id); }
    else next.push({ message: row.message, leaving: true });
  }
  for (const message of visible) if (!seen.has(message.id)) next.push({ message, leaving: false });
  return next;
}
const sameRows = (a: Row[], b: Row[]) => a.length === b.length && a.every((row, i) => row.message === b[i].message && row.leaving === b[i].leaving);
import { isBackgroundWake } from "../conversation/systemNotice";

export function MessageQueue({ queue, active, disabled, canSteer, pendingIds, onAction }: {
  queue: ThreadQueue;
  active: boolean;
  disabled: boolean;
  canSteer: boolean;
  pendingIds?: ReadonlySet<string>;
  onAction: (action: string, message?: string, prompt?: string) => Promise<unknown> | void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [localError, setLocalError] = useState<string | null>(null);
  const visible = queue.messages.filter(message => !isBackgroundWake(message) && !hidden.has(message.id));
  const [rows, setRows] = useState<Row[]>(() => mergeRows([], visible));
  const merged = mergeRows(rows, visible);
  if (!sameRows(rows, merged)) setRows(merged);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    for (const row of rows) {
      const id = row.message.id;
      if (row.leaving && !timers.current.has(id)) timers.current.set(id, setTimeout(() => {
        timers.current.delete(id);
        setRows(old => old.filter(r => !(r.leaving && r.message.id === id)));
      }, LEAVE_MS));
      else if (!row.leaving && timers.current.has(id)) { clearTimeout(timers.current.get(id)); timers.current.delete(id); }
    }
  }, [rows]);
  useEffect(() => () => { for (const timer of timers.current.values()) clearTimeout(timer); timers.current.clear(); }, []);
  if (!merged.length) return null;
  const sectionLeaving = !visible.length;
  // Delete is never gated by `disabled` (a running turn must not block it): hide optimistically, restore and surface the error on failure.
  const remove = async (ids: string[]) => {
    setLocalError(null);
    setHidden(old => new Set([...old, ...ids]));
    for (const id of ids) {
      try { await onAction("delete", id); }
      catch (error) {
        console.error(JSON.stringify({ event: "message_queue.delete_failed", id, error: String(error) }));
        setHidden(old => { const next = new Set(old); next.delete(id); return next; });
        setLocalError(`Could not delete queued message: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  const count = visible.length;
  const state = queue.paused ? "Paused" : active ? "Waiting for current turn" : "Ready";
  return <section className={sectionLeaving ? "message-queue message-queue-leaving" : "message-queue"} aria-label="Message queue" aria-hidden={sectionLeaving || undefined}>
    <span className={queue.paused ? "message-queue-state" : "sr-only"} role="status">{count} queued · {state}</span>
    {(localError || queue.error) && <p role="alert" className="message-queue-error">{localError ?? queue.error}</p>}
    <ScrollArea viewportProps={{ style: { maxHeight: 156 }, "aria-label": "Queued messages" }}><ol role="list">{merged.map(({ message, leaving }) => <li key={message.id} className={leaving ? "message-queue-leaving" : undefined} aria-hidden={leaving || undefined} inert={leaving || undefined}>
      <CornerDownRight className="message-queue-icon" aria-hidden="true"/>
      <div className="message-queue-preview" title={stripVoiceCall(message.prompt).text}>
        {editing === message.id ? <form onSubmit={async e => { e.preventDefault(); if (await onAction("edit", message.id, draft)) setEditing(null); }}>
          <MessageInput autoFocus aria-label="Edit queued message" value={draft} onValueChange={setDraft} disabled={disabled}/>
          <button type="submit" aria-label="Save queued message" disabled={disabled || !draft.trim()}>Save</button>
          <button type="button" disabled={disabled} onClick={() => setEditing(null)}>Cancel</button>
        </form> : <p>{(() => { const { text, voice } = stripVoiceCall(message.prompt); return <>{voice && <span className="message-queue-badge">voice</span>}{text.trim() || "(empty)"}</>; })()}</p>}
      </div>
      <div className="message-queue-actions">
        <button type="button" aria-label={active ? "Steer instead" : count === 1 ? "Send now" : "Resume queue"} title={active ? "Send now: steer or interrupt and continue the current turn" : "Send queued messages in order"} disabled={leaving || disabled || pendingIds?.has(message.id) || (active && !canSteer)} onClick={() => void onAction(active ? "steer" : "resume", active ? message.id : undefined)}><CornerUpLeft size={16} aria-hidden="true"/></button>
        <button type="button" aria-label="Edit queued message" title="Edit queued message" disabled={leaving || disabled || pendingIds?.has(message.id)} onClick={() => { setEditing(message.id); setDraft(message.prompt); }}><Pencil size={16} aria-hidden="true"/></button>
        <button type="button" disabled={leaving} aria-label={`Delete queued message: ${message.prompt.slice(0, 60)}`} title="Delete queued message" onClick={() => void remove([message.id])}><Trash2 size={16} aria-hidden="true"/></button>
      </div>
    </li>)}</ol></ScrollArea>
  </section>;
}
