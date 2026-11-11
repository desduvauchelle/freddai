import type { ReactNode } from 'react';
import { formatProjectName } from '../projectName';
import { Dot, labelStatus } from './ThreadStatus';
import { threadListStatus } from './types';
import './home.css';

/** Shared project card presentation; each client supplies its own transport actions. */
export function ProjectTile({ project, hasThreads, recent, actions, onOpen, onOpenThread, children, openLabel, uppercase }: {
  uppercase?: boolean;
  openLabel?: string;
  project: { name: string; color: string }; hasThreads: boolean;
  recent: { id: string; title: string; status: ReturnType<typeof threadListStatus> }[];
  actions: ReactNode; onOpen: () => void; onOpenThread: (id: string) => void; children?: ReactNode;
}) {
  return <article className="home-tile" aria-label={`Project ${project.name}`}>
    <header>
      <button type="button" className="home-tile-open" title={openLabel ? (hasThreads ? `Open latest thread in ${project.name}` : `New thread in ${project.name}`) : `Show threads in ${project.name}`} aria-label={openLabel ?? `Show threads in ${project.name}`} onClick={onOpen}><strong role={openLabel ? "heading" : undefined} aria-level={openLabel ? 3 : undefined} style={{ color: project.color }}>{formatProjectName(project.name, uppercase)}</strong></button>
      {actions}
    </header>
    {!!recent.length && <ul className="home-recent" aria-label={`Recent threads in ${project.name}`}>
      {recent.map(thread => <li key={thread.id}><button type="button" onClick={() => onOpenThread(thread.id)} title={`${thread.title || 'Untitled thread'} · ${labelStatus(thread.status)}`}><Dot status={thread.status} /><span>{thread.title || 'Untitled thread'}</span></button></li>)}
    </ul>}
    {children}
  </article>;
}
