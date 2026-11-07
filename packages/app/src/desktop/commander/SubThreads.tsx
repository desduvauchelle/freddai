import { compareThreadRecency } from '../types';

export type SubThread = { id: string; title: string; project: string; status: string; updated: number; last_user_message_at?: number | null };
export function SubThreads({ threads, projects, onOpenThread }: {
  threads: readonly SubThread[]; projects: readonly { id: string; name: string }[]; onOpenThread: (id: string) => void;
}) {
  return <div className="commander-stack">
    {!threads.length && <p className="commander-empty">No sub-threads yet.</p>}
    <ul className="commander-list" aria-label="Commander sub-threads">{[...threads].sort(compareThreadRecency).map(t => <li key={t.id} className="commander-todo">
      <button type="button" className="commander-link" onClick={() => onOpenThread(t.id)}>{t.title}</button>
      <span className="commander-chip">{projects.find(p => p.id === t.project)?.name ?? 'Project'}</span>
      <span className="commander-chip" data-muted>{t.status}</span>
    </li>)}</ul>
  </div>;
}
