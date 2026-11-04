import type { ReactNode } from 'react';
import { Paperclip } from 'lucide-react';
import type { Attachment, Message } from '../desktop/types';
import { MessageMarkdown } from './MessageMarkdown';
import { ToolActivity } from './ToolActivity';
import { groupTranscript } from './transcript';
import './ThreadTranscript.css';

/** An outgoing message that the host has not yet echoed back in the thread's messages. */
export type PendingOutgoing = { id: string; text: string; attachments?: readonly Attachment[]; status?: string };

export type ThreadTranscriptProps = {
  messages: readonly Message[];
  /** `comfortable` is the Mac layout; `compact` adapts spacing, bubble width and tap targets for a phone. */
  density?: 'comfortable' | 'compact';
  /** Outgoing messages shown after the transcript with their own status line ("Sending…", "Queued on your Mac"). */
  pending?: readonly PendingOutgoing[];
  /** Attachment chip content. The Mac supplies a previewing label; the default is a plain name. */
  renderAttachment?: (file: Attachment) => ReactNode;
  /** Trailing content such as errors, permission requests and live activity. */
  children?: ReactNode;
};

const defaultAttachment = (file: Attachment) => <><Paperclip size={12} /><span>{file.name}</span></>;

/** The single transcript renderer for the Mac and iPhone threads: grouped tool activity, user bubbles, assistant markdown. */
export function ThreadTranscript({ messages, density = 'comfortable', pending = [], renderAttachment = defaultAttachment, children }: ThreadTranscriptProps) {
  const chips = (files?: readonly Attachment[]) => files?.map(f => <span className="attachment-chip" key={f.id}>{renderAttachment(f)}</span>);
  return <div className="thread-transcript" data-density={density}>
    {groupTranscript(messages).map(item => {
      if (item.kind === 'tools') return <ToolActivity key={item.id} messages={item.messages} />;
      const m = item.message;
      return <article
        key={m.id}
        data-role={m.role}
        aria-label={m.role === 'user' ? 'Your message' : m.role === 'notice' ? 'Freddai notice' : 'Assistant message'}
        className={m.role === 'user' ? 'chat-user' : 'chat-assistant'}
      >
        {m.role === 'notice' && <strong>Freddai</strong>}
        <div className="native-message">
          {chips(m.attachments)}
          <MessageMarkdown text={m.text} />
          {m.delivery && <small role="status">{m.delivery}</small>}
        </div>
      </article>;
    })}
    {pending.map(p => <article key={p.id} data-role="user" aria-label="Your message" className="chat-user">
      <div className="native-message">
        {chips(p.attachments)}
        <MessageMarkdown text={p.text} />
        {p.status && <small role="status">{p.status}</small>}
      </div>
    </article>)}
    {children}
  </div>;
}
