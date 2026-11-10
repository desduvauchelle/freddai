import type { ReactNode } from 'react';
import { useThreadLinks } from './ThreadLinksContext';
import './ThreadCard.css';

const LINK = /^freddai:\/\/thread\/([A-Za-z0-9_-]+)\/?$/;
/** The thread id in a `freddai://thread/<id>` link, or undefined for any other href. */
export const threadLinkId = (href: string) => LINK.exec(href)?.[1];

/** Inline chip for a thread link inside assistant prose. Without a host it is plain text, so the link never looks clickable when it is inert. */
export function ThreadChip({ threadId, title, children }: { threadId: string; title?: string; children: ReactNode }) {
  const links = useThreadLinks();
  const info = links?.threadInfo(threadId);
  const bare = typeof children === 'string' && children.startsWith('freddai://');
  const label = bare ? info?.title || 'Thread' : children;
  if (!links) return <span title={title}>{label}</span>;
  return <button type="button" className="thread-chip" data-status={info?.status ?? 'unknown'} title={title ?? info?.title} onClick={() => links.openThread(threadId)}>
    <span>{label}</span><span className="thread-chip-dot" aria-hidden="true" />
  </button>;
}
