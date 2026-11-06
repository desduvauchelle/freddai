import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { LoaderCircle, Paperclip } from 'lucide-react';
import type { Attachment, BackgroundTask, Message } from '../desktop/types';
import { MessageMarkdown } from './MessageMarkdown';
import { BackgroundTasks } from './BackgroundTasks';
import { ToolActivity } from './ToolActivity';
import { ReasoningBlock } from './ReasoningBlock';
import { groupTranscript, placeBackgroundTasks } from './transcript';
import './ThreadTranscript.css';

/** An outgoing message that the host has not yet echoed back in the thread's messages. */
export type PendingOutgoing = { id: string; text: string; attachments?: readonly Attachment[]; status?: string; sending?: boolean };

export type ThreadTranscriptProps = {
  messages: readonly Message[];
  /** `comfortable` is the Mac layout; `compact` adapts spacing, bubble width and tap targets for a phone. */
  density?: 'comfortable' | 'compact';
  /** Outgoing messages shown after the transcript with their own status line ("Sending…"). */
  pending?: readonly PendingOutgoing[];
  /** Attachment chip content. The Mac supplies a previewing label; the default is a plain name. */
  renderAttachment?: (file: Attachment) => ReactNode;
  /** Background sub-agents, shown beside their launch tool activity while running and after completion. */
  tasks?: readonly BackgroundTask[];
  /** The agent is working: the trailing reasoning block shows as live "Thinking…". */
  active?: boolean;
  /** Trailing content such as errors, permission requests and live activity. */
  children?: ReactNode;
};

/** Ids that appeared since the last commit. Empty on first render and when the thread changes (first id differs), so only appended items ease in. */
function useEntering(ids: readonly string[], pendingTexts: readonly string[]) {
  const seen = useRef<{ ids: Set<string>; first?: string; pending: Set<string> } | null>(null);
  const prev = seen.current;
  const fresh = new Set<string>();
  if (prev && prev.first === ids[0]) for (const id of ids) if (!prev.ids.has(id)) fresh.add(id);
  useEffect(() => {
    seen.current = { ids: new Set(ids), first: ids[0], pending: new Set(pendingTexts) };
  });
  return { fresh, echoed: prev?.pending ?? new Set<string>() };
}

const defaultAttachment = (file: Attachment) => <><Paperclip size={12} /><span>{file.name}</span></>;

/** The single transcript renderer for the Mac and iPhone threads: grouped tool activity, user bubbles, assistant markdown. */
export function ThreadTranscript({ messages, density = 'comfortable', pending = [], renderAttachment = defaultAttachment, tasks = [], active = false, children }: ThreadTranscriptProps) {
  const chips = (files?: readonly Attachment[]) => files?.map(f => <span className="attachment-chip" key={f.id}>{renderAttachment(f)}</span>);
  const items = groupTranscript(messages);
  const { placed, unplaced } = placeBackgroundTasks(items, tasks);
  const { fresh, echoed } = useEntering(
    [...items.map(i => i.kind === 'tools' ? i.id : i.message.id), ...pending.map(p => p.id)],
    pending.map(p => p.text),
  );
  return <div className="thread-transcript" data-density={density}>
    {items.map((item, index) => {
      if (item.kind === 'message' && item.message.role === 'reasoning') {
        return item.message.text.trim() ? <ReasoningBlock key={item.id} message={item.message} live={active && index === items.length - 1} className={fresh.has(item.id) ? 'transcript-enter' : undefined} /> : null;
      }
      if (item.kind === 'tools') return <Fragment key={item.id}><ToolActivity messages={item.messages} className={fresh.has(item.id) ? 'transcript-enter' : undefined} /><BackgroundTasks tasks={placed.get(item.id) ?? []} /></Fragment>;
      const m = item.message;
      const enter = fresh.has(m.id) && !(m.role === 'user' && echoed.has(m.text));
      return <article
        key={m.id}
        data-role={m.role}
        aria-label={m.role === 'user' ? 'Your message' : m.role === 'notice' ? 'Freddai notice' : 'Assistant message'}
        className={`${m.role === 'user' ? 'chat-user' : 'chat-assistant'}${enter ? ' transcript-enter' : ''}`}
      >
        {m.role === 'notice' && <strong>Freddai</strong>}
        <div className="native-message">
          {chips(m.attachments)}
          <MessageMarkdown text={m.text} />
          {m.delivery && <small role="status">{m.delivery}</small>}
        </div>
      </article>;
    })}
    <BackgroundTasks tasks={unplaced} />
    {pending.map(p => <article key={p.id} data-role="user" aria-label="Your message" className={`chat-user${fresh.has(p.id) ? ' transcript-enter' : ''}`}>
      <div className="native-message">
        {chips(p.attachments)}
        <MessageMarkdown text={p.text} />
        {p.status && <small role="status" className={p.sending ? "outgoing-sending" : undefined}>{p.sending && <LoaderCircle size={14} aria-hidden="true" />}{p.status}</small>}
      </div>
    </article>)}
    {children}
  </div>;
}
