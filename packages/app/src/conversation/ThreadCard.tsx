import { CircleAlert, CircleCheck, LoaderCircle, MessageSquare, ShieldQuestion } from 'lucide-react';
import { useThreadLinks, type ThreadLinkStatus } from './ThreadLinksContext';
import './ThreadCard.css';

const statusLabel: Record<ThreadLinkStatus, string> = { running: 'Running', waiting: 'Needs approval', done: 'Done', failed: 'Failed', interrupted: 'Stopped', unknown: '' };

function StatusIcon({ status }: { status: ThreadLinkStatus }) {
  if (status === 'running') return <LoaderCircle size={12} aria-hidden="true" className="thread-card-spinner" />;
  if (status === 'waiting') return <ShieldQuestion size={12} aria-hidden="true" />;
  if (status === 'done') return <CircleCheck size={12} aria-hidden="true" />;
  if (status === 'failed' || status === 'interrupted') return <CircleAlert size={12} aria-hidden="true" />;
  return null;
}

/** Live card for another thread: title, project and status. The whole card opens the thread. Shared by Mac and iPhone. */
export function ThreadCard({ threadId, label, titleHint, error }: { threadId?: string; label?: string; titleHint?: string; error?: string }) {
  const links = useThreadLinks();
  const info = threadId ? links?.threadInfo(threadId) : undefined;
  const status: ThreadLinkStatus = info?.status ?? (error ? 'failed' : 'unknown');
  const title = info?.title || titleHint || 'Thread';
  const detail = info?.error || error;
  const body = <>
    <MessageSquare size={15} aria-hidden="true" className="thread-card-icon" />
    <span className="thread-card-text">
      {label && <small className="thread-card-label">{label}</small>}
      <strong title={title}>{title}</strong>
      {(info?.projectName || detail) && <small className="thread-card-meta">{detail || info?.projectName}</small>}
    </span>
    {statusLabel[status] && <span className="thread-card-status" data-status={status} role="status"><StatusIcon status={status} />{statusLabel[status]}</span>}
  </>;
  if (!threadId || !links) return <div className="thread-card" data-status={status} data-static="true">{body}</div>;
  return <button type="button" className="thread-card" data-status={status} aria-label={`Open thread: ${title}`} onClick={() => links.openThread(threadId)}>{body}</button>;
}
