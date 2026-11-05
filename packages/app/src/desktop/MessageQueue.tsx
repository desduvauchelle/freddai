import { useState } from "react";
import { PopoverDetails } from "./PopoverDetails";
import { CornerDownRight, Pencil, CornerUpLeft, MoreHorizontal, Pause, Play, Trash2 } from "lucide-react";
import { ScrollArea } from "@freddai/ui/components/scroll-area";
import type { ThreadQueue } from "./types";

export function MessageQueue({ queue, active, disabled, canSteer, onAction }: {
  queue: ThreadQueue;
  active: boolean;
  disabled: boolean;
  canSteer: boolean;
  onAction: (action: string, message?: string, prompt?: string) => Promise<unknown> | void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  if (!queue.messages.length) return null;
  const state = queue.paused ? "Paused" : active ? "Waiting for current turn" : "Ready";
  const toggleLabel = queue.paused ? "Resume queue" : "Pause queue";
  return <section className="message-queue" aria-label="Queued messages">
    <span className="sr-only" role="status">{queue.messages.length} queued · {state}</span>
    {queue.error && <p role="alert" className="message-queue-error">{queue.error}</p>}
    <ScrollArea viewportProps={{ style: { maxHeight: 156 }, "aria-label": "Queued messages" }}><ol role="list">{queue.messages.map((message, index) => <li key={message.id}>
      <CornerDownRight className="message-queue-icon" aria-hidden="true"/>
      <div className="message-queue-preview" title={message.prompt}>
        {editing === message.id ? <form onSubmit={async e => { e.preventDefault(); if (await onAction("edit", message.id, draft)) setEditing(null); }}>
          <textarea autoFocus aria-label="Edit queued message" value={draft} onChange={e => setDraft(e.target.value)} disabled={disabled}/>
          <button type="submit" aria-label="Save queued message" disabled={disabled || !draft.trim()}>Save</button>
          <button type="button" disabled={disabled} onClick={() => setEditing(null)}>Cancel</button>
        </form> : <p>{message.prompt}</p>}
      </div>
      <div className="message-queue-actions">
        <button type="button" aria-label="Steer instead" title={canSteer && active ? "Send now: steer or interrupt and continue the current turn" : "Steering requires an active turn"} disabled={disabled || !active || !canSteer} onClick={() => void onAction("steer", message.id)}><CornerUpLeft size={13}/><span className="message-queue-action-label">Steer</span></button>
        <button type="button" aria-label="Edit queued message" title="Edit queued message" disabled={disabled} onClick={() => { setEditing(message.id); setDraft(message.prompt); }}><Pencil size={13}/></button>
        {index === 0 && <button type="button" aria-label={toggleLabel} title={`${toggleLabel} · ${state}`} disabled={disabled} onClick={() => onAction(queue.paused ? "resume" : "pause")}>
          {queue.paused ? <Play size={13}/> : <Pause size={13}/>}<span className="message-queue-action-label">{queue.paused ? "Resume" : "Pause"}</span>
        </button>}
        <button type="button" aria-label={`Delete queued message: ${message.prompt.slice(0, 60)}`} title="Delete queued message" disabled={disabled} onClick={() => onAction("delete", message.id)}><Trash2 size={13}/></button>
        <PopoverDetails className="message-queue-menu">
          <summary aria-label={`More actions for queued message ${index + 1}`} title="Message details and queue actions"><MoreHorizontal size={15}/></summary>
          <div className="message-queue-menu-panel">
            <strong>Queued message {index + 1} of {queue.messages.length} · {state}</strong>
            <ScrollArea viewportProps={{ style: { maxHeight: 160 }, "aria-label": "Queued message details" }}><p>{message.prompt}</p></ScrollArea>
            {!!message.options.attachments?.length && <p>{message.options.attachments.length} attachment(s)</p>}
            <button type="button" disabled={disabled} onClick={() => onAction(queue.paused ? "resume" : "pause")}>{toggleLabel}</button>
            <button type="button" disabled={disabled} onClick={() => onAction("clear")}>Clear queue</button>
          </div>
        </PopoverDetails>
      </div>
    </li>)}</ol></ScrollArea>
  </section>;
}
