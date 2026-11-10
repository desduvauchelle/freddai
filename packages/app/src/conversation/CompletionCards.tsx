import { useState } from 'react';
import { ThreadCard } from './ThreadCard';
import { completionThreads } from './systemNotice';
import './CompletionCards.css';

type Notice = { id: string; prompt: string };
export const isCompletionNotice = (message: Notice) => message.id.startsWith('commander-completions-') || completionThreads(message.prompt).length > 0;

/** Completion notifications are passive; actions prepare a draft, never start an agent. */
export function CompletionCards({ notices, disabled, onPrepare, onDismiss }: {
  notices: readonly Notice[]; disabled?: boolean;
  onPrepare?: (prompt: string) => Promise<void> | void;
  onDismiss?: (id: string) => Promise<unknown> | void;
}) {
  const [prepared, setPrepared] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  async function prepare(prompt: string, key: string) {
    setWorking(true); setError('');
    try { await onPrepare?.(prompt); setPrepared(key); }
    catch (e) { setError(String(e)); }
    finally { setWorking(false); }
  }
  if (!notices.length) return null;
  return <div className="completion-cards">{notices.map(notice => {
    const threads = completionThreads(notice.prompt);
    return <section className="completion-card" key={notice.id} aria-label="Thread completion">
      <header><strong>{threads.length > 1 ? 'Threads finished' : 'Thread finished'}</strong>{onDismiss && <button type="button" disabled={disabled || working} onClick={async () => { setError(''); try { await onDismiss(notice.id); } catch (e) { setError(String(e)); } }}>Dismiss</button>}</header>
      {threads.map(thread => <div key={thread.id} className="completion-card-thread">
        <ThreadCard threadId={thread.id} titleHint={thread.title} label={thread.status === 'failed' ? 'Ended with an error' : 'Completed'} />
        {onPrepare && <div className="completion-card-actions">
          <button type="button" disabled={disabled || working} onClick={() => void prepare(`Summarize the result of thread "${thread.title}" (${thread.id}). Read its saved transcript and report the outcome and anything needing my attention.`, thread.id)}>Summarize</button>
          <button type="button" disabled={disabled || working} onClick={() => void prepare(`Review thread "${thread.title}" (${thread.id}) and suggest a useful follow-up. Ask me before starting new work.`, thread.id)}>Follow up</button>
        </div>}
        {prepared === thread.id && <p role="status">Added to your draft. Review and send when ready.</p>}
      </div>)}
      {!threads.length && <p>Completion details are unavailable. You can dismiss this notification.</p>}
      {onPrepare && <small>Nothing runs until you send a message.</small>}
    </section>;
  })}{error && <p role="alert">{error}</p>}</div>;
}
