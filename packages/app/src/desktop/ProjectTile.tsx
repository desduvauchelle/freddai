import { Activity, Check, CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Dot, labelStatus } from './ThreadStatus';
import { threadListStatus } from './types';
import './home.css';

/** Shared project card presentation; each client supplies its own transport actions. */
export function ProjectTile({ project, hasThreads, counts, recent, actions, onOpen, onOpenThread, children, openLabel }: {
  openLabel?: string;
  project: { name: string; color: string }; hasThreads: boolean;
  counts: { working: number; done: number; needs: number; failed: number };
  recent: { id: string; title: string; status: ReturnType<typeof threadListStatus> }[];
  actions: ReactNode; onOpen: () => void; onOpenThread: (id: string) => void; children?: ReactNode;
}) {
  return <article className="home-tile" aria-label={`Project ${project.name}`}>
    <header>
      <span className="home-project-dot" style={{ background: project.color }} aria-hidden="true" />
      <button type="button" className="home-tile-open" title={hasThreads ? `Open latest thread in ${project.name}` : `New thread in ${project.name}`} aria-label={openLabel ?? (hasThreads ? `Open latest thread in ${project.name}` : `Create first thread in ${project.name}`)} onClick={onOpen}><strong role={openLabel ? "heading" : undefined} aria-level={openLabel ? 3 : undefined} style={{ color: project.color }}>{project.name}</strong></button>
      {actions}
    </header>
    <ul className="home-counts" aria-label="Thread status">
      <li data-kind="working" data-active={counts.working > 0} aria-label={`${counts.working} working`} title={`${counts.working} working`}><Activity size={12} aria-hidden="true" />{counts.working}</li>
      <li data-kind="done" data-active={counts.done > 0} aria-label={`${counts.done} done today`} title={`${counts.done} done today`}><Check size={12} aria-hidden="true" />{counts.done}</li>
      <li data-kind="needs" data-active={counts.needs > 0} aria-label={`${counts.needs} needs you`} title={`${counts.needs} needs you`}><CircleAlert size={12} aria-hidden="true" />{counts.needs}</li>
      {counts.failed > 0 && <li data-kind="failed" aria-label={`${counts.failed} failed today`} title={`${counts.failed} failed today`}><CircleAlert size={12} aria-hidden="true" />{counts.failed}</li>}
    </ul>
    {!!recent.length && <ul className="home-recent" aria-label={`Recent threads in ${project.name}`}>
      {recent.map(thread => <li key={thread.id}><button type="button" onClick={() => onOpenThread(thread.id)} title={`${thread.title || 'Untitled thread'} · ${labelStatus(thread.status)}`}><Dot status={thread.status} /><span>{thread.title || 'Untitled thread'}</span></button></li>)}
    </ul>}
    {children}
  </article>;
}
