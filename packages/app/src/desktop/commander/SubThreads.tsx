import { Loader2 } from "lucide-react";
import { compareThreadRecency } from '../types';

export type SubThread = { id: string; title: string; project: string; status: string; updated: number; last_user_message_at?: number | null };
export function SubThreads({ threads, projects, onOpenThread, hideEmpty = false }: {
  hideEmpty?: boolean;
  threads: readonly SubThread[]; projects: readonly { id: string; name: string }[]; onOpenThread: (id: string) => void;
}) {
  if (hideEmpty && !threads.length) return null;
  return <div className="commander-stack">
    {!threads.length && <p className="commander-empty">No sub-threads yet.</p>}
    <ul className="commander-list" aria-label="Commander sub-threads">{[...threads].sort(compareThreadRecency).map(t => <li key={t.id} className="commander-todo">
      <button type="button" className="commander-link" onClick={() => onOpenThread(t.id)}>{t.title}</button>
      <span className="commander-chip">{projects.find(p => p.id === t.project)?.name ?? 'Project'}</span>
      <span className="commander-chip" data-muted>{["starting", "running"].includes(t.status) && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}{t.status}</span>
    </li>)}</ul>
  </div>;
}
