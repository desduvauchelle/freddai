import { useState } from "react";
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
  queue = { ...queue, messages: queue.messages.filter(message => !isBackgroundWake(message)) };
  if (!queue.messages.length) return null;
  const state = queue.paused ? "Paused" : active ? "Waiting for current turn" : "Ready";
  return <section className="message-queue" aria-label="Message queue">
    <span className="sr-only" role="status">{queue.messages.length} queued · {state}</span>
    {queue.error && <p role="alert" className="message-queue-error">{queue.error}</p>}
    <ScrollArea viewportProps={{ style: { maxHeight: 156 }, "aria-label": "Queued messages" }}><ol role="list">{queue.messages.map(message => <li key={message.id}>
      <CornerDownRight className="message-queue-icon" aria-hidden="true"/>
      <div className="message-queue-preview" title={message.prompt}>
        {editing === message.id ? <form onSubmit={async e => { e.preventDefault(); if (await onAction("edit", message.id, draft)) setEditing(null); }}>
          <textarea autoFocus aria-label="Edit queued message" value={draft} onChange={e => setDraft(e.target.value)} disabled={disabled}/>
          <button type="submit" aria-label="Save queued message" disabled={disabled || !draft.trim()}>Save</button>
          <button type="button" disabled={disabled} onClick={() => setEditing(null)}>Cancel</button>
        </form> : <p>{message.prompt}</p>}
      </div>
      <div className="message-queue-actions">
        <button type="button" aria-label="Steer instead" title={canSteer && active ? "Send now: steer or interrupt and continue the current turn" : "Steering requires an active turn"} disabled={disabled || pendingIds?.has(message.id) || !active || !canSteer} onClick={() => void onAction("steer", message.id)}><CornerUpLeft size={13}/><span className="message-queue-action-label">Steer</span></button>
        <button type="button" aria-label="Edit queued message" title="Edit queued message" disabled={disabled || pendingIds?.has(message.id)} onClick={() => { setEditing(message.id); setDraft(message.prompt); }}><Pencil size={13}/></button>
        <button type="button" aria-label={`Delete queued message: ${message.prompt.slice(0, 60)}`} title="Delete queued message" disabled={disabled || pendingIds?.has(message.id)} onClick={() => onAction("delete", message.id)}><Trash2 size={13}/></button>

      </div>
    </li>)}</ol></ScrollArea>
  </section>;
}
