import { useState } from "react";
import { stripVoiceCall } from "../conversation/voiceCallMarkup";
import "./MessageQueue.css";
import { CornerDownRight, Pencil, CornerUpLeft, Trash2 } from "lucide-react";
import { ScrollArea } from "@freddai/ui/components/scroll-area";
import type { ThreadQueue } from "./types";
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
  queue = { ...queue, messages: queue.messages.filter(message => !isBackgroundWake(message) && !hidden.has(message.id)) };
  if (!queue.messages.length) return null;
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
  const state = queue.paused ? "Paused" : active ? "Waiting for current turn" : "Ready";
  return <section className="message-queue" aria-label="Message queue">
    <span className={queue.paused ? "message-queue-state" : "sr-only"} role="status">{queue.messages.length} queued · {state}</span>
    <button type="button" className="message-queue-clear" aria-label="Clear all queued messages" onClick={() => void remove(queue.messages.map(m => m.id))}>Clear all</button>
    {(localError || queue.error) && <p role="alert" className="message-queue-error">{localError ?? queue.error}</p>}
    <ScrollArea viewportProps={{ style: { maxHeight: 156 }, "aria-label": "Queued messages" }}><ol role="list">{queue.messages.map(message => <li key={message.id}>
      <CornerDownRight className="message-queue-icon" aria-hidden="true"/>
      <div className="message-queue-preview" title={stripVoiceCall(message.prompt).text}>
        {editing === message.id ? <form onSubmit={async e => { e.preventDefault(); if (await onAction("edit", message.id, draft)) setEditing(null); }}>
          <textarea autoFocus aria-label="Edit queued message" value={draft} onChange={e => setDraft(e.target.value)} disabled={disabled}/>
          <button type="submit" aria-label="Save queued message" disabled={disabled || !draft.trim()}>Save</button>
          <button type="button" disabled={disabled} onClick={() => setEditing(null)}>Cancel</button>
        </form> : <p>{(() => { const { text, voice } = stripVoiceCall(message.prompt); return <>{voice && <span className="message-queue-badge">voice</span>}{text.trim() || "(empty)"}</>; })()}</p>}
      </div>
      <div className="message-queue-actions">
        <button type="button" aria-label={active ? "Steer instead" : queue.messages.length === 1 ? "Send now" : "Resume queue"} title={active ? "Send now: steer or interrupt and continue the current turn" : "Send queued messages in order"} disabled={disabled || pendingIds?.has(message.id) || (active && !canSteer)} onClick={() => void onAction(active ? "steer" : "resume", active ? message.id : undefined)}><CornerUpLeft size={13}/><span className="message-queue-action-label">{active ? "Steer" : queue.messages.length === 1 ? "Send now" : "Resume queue"}</span></button>
        <button type="button" aria-label="Edit queued message" title="Edit queued message" disabled={disabled || pendingIds?.has(message.id)} onClick={() => { setEditing(message.id); setDraft(message.prompt); }}><Pencil size={13}/></button>
        <button type="button" aria-label={`Delete queued message: ${message.prompt.slice(0, 60)}`} title="Delete queued message" onClick={() => void remove([message.id])}><Trash2 size={13}/></button>

      </div>
    </li>)}</ol></ScrollArea>
  </section>;
}
