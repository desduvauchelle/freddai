import { useId, useState } from 'react';
import { ChevronDown, ListOrdered, Paperclip, Pause, Play, X } from 'lucide-react';
import { Button } from '@freddai/ui/components/button';
import type { CompanionThread } from './companion';

type QueueAction = 'pause' | 'resume' | 'delete' | 'clear';
export function MessageQueue({ messages, paused, error, disabled, onAction }: {
  messages: NonNullable<CompanionThread['queue']>; paused?: boolean; error?: string | null;
  disabled: boolean; onAction: (action: QueueAction, message?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  if (!messages.length) return null;
  return <section className="companion-queue" aria-label="Message queue" data-paused={!!paused}>
    <div className="companion-queue-header">
      <button type="button" className="companion-queue-toggle" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(value => !value)}>
        <ListOrdered size={18} aria-hidden="true"/>
        <span><strong>{paused ? 'Queue paused' : 'Up next'} <small>· {messages.length} {messages.length === 1 ? 'message' : 'messages'}</small></strong>
          <span className="companion-queue-preview">{messages[0].prompt || 'Attachment'}</span></span>
        <ChevronDown size={16} aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }}/>
      </button>
      <Button type="button" variant="ghost" size="icon" aria-label={paused ? 'Resume queued messages' : 'Pause queued messages'} title={paused ? 'Resume queue' : 'Pause queue'} disabled={disabled} onClick={() => onAction(paused ? 'resume' : 'pause')}>
        {paused ? <Play size={17}/> : <Pause size={17}/>}
      </Button>
    </div>
    <div id={listId} hidden={!expanded}>
      <p className="companion-queue-help">{paused ? 'Messages stay here until you resume.' : 'Sends in order when the current turn finishes.'}</p>
      <ol className="companion-queue-list">{messages.map((message, index) => <li key={message.id}>
        <span className="companion-queue-number" aria-hidden="true">{index + 1}</span>
        <div><p>{message.prompt || 'Attachment'}</p>{message.attachments > 0 && <small><Paperclip size={12} aria-hidden="true"/>{message.attachments} {message.attachments === 1 ? 'file' : 'files'}</small>}</div>
        <Button type="button" variant="ghost" size="icon" aria-label={`Remove queued message ${index + 1}`} disabled={disabled} onClick={() => onAction('delete', message.id)}><X size={16}/></Button>
      </li>)}</ol>
      <Button type="button" variant="ghost" className="companion-queue-clear" disabled={disabled} onClick={() => onAction('clear')}>Clear queue</Button>
    </div>
    {error && <p className="companion-queue-error" role="alert">{error}</p>}
  </section>;
}
