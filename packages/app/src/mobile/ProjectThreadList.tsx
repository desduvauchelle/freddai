import { orderProjectThreads } from '../projectThreads';
import { useState } from 'react';
import { Button } from '@freddai/ui/components/button';
import { Dot } from '../desktop/ThreadStatus';
import { threadListStatus } from '../desktop/types';
import { companionStatusRead, type CompanionSnapshot } from './companion';
import { companionThreadFaded, pendingThreads } from './native-threads';
import type { Outgoing } from './outbox';

const PAGE = 20;

function relativeTime(at: number, now: number) {
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  if (minutes < 43200) return `${Math.round(minutes / 1440)}d`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The project's threads, pinned then active then recent. Header-less: the native sheet (or the web header) shows the project name. */
export function ProjectThreadList({ project, snapshot, outbox = [], read = {}, connected, now = Date.now(), onOpen, onNew }: {
  project: string; snapshot: CompanionSnapshot; outbox?: Outgoing[]; read?: Record<string, number>; connected: boolean; now?: number;
  onOpen: (id: string) => void; onNew: () => void;
}) {
  const [visible, setVisible] = useState(PAGE);
  const effectiveRead = companionStatusRead(snapshot, read);
  const pending = pendingThreads(project, outbox, new Set(snapshot.threads.map(t => t.id)), connected, now);
  const threads = snapshot.threads.filter(t => t.project === project && !['archived', 'deleted'].includes(t.status) && !pending.some(p => p.id === t.id));
  const rows = orderProjectThreads([
    ...pending.map(t => ({ id: t.id, title: t.title, status: t.status as string, listStatus: t.status as string, at: t.updatedAt, updated: t.updatedAt, queued: 1, faded: false })),
    ...threads.map(t => ({ ...t, listStatus: threadListStatus(t, effectiveRead) as string, at: t.updated, faded: companionThreadFaded(t, effectiveRead) })),
  ], effectiveRead, t => t.queued);
  if (!rows.length) return <div className="companion-project-empty"><p>No threads yet</p><Button onClick={onNew} disabled={!connected}>New thread</Button></div>;
  const shown = rows.slice(0, visible);
  return <div className="companion-project-threads" aria-label="Project threads">
    {shown.map(row => <button key={row.id} className="companion-row" data-faded={row.faded} onClick={() => row.id.startsWith('outbox:') ? onNew() : onOpen(row.id)}>
      <span className="companion-project-dot"><Dot status={row.listStatus} /></span>
      <span><strong title={row.title}>{row.title}</strong></span>
      {row.listStatus === 'unread' && <span className="companion-unread-dot" role="img" aria-label="Unread" />}
      <time dateTime={new Date(row.at).toISOString()}>{relativeTime(row.at, now)}</time>
    </button>)}
    {rows.length > visible && <Button variant="ghost" onClick={() => setVisible(v => v + PAGE)}>Show more</Button>}
    {visible > PAGE && rows.length > PAGE && <Button variant="ghost" onClick={() => setVisible(PAGE)}>Show less</Button>}
  </div>;
}
