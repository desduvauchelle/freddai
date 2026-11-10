import { createContext, useContext, useMemo, type ReactNode } from 'react';

export type ThreadLinkStatus = 'running' | 'waiting' | 'done' | 'failed' | 'interrupted' | 'unknown';
export type ThreadLinkInfo = { title: string; projectName?: string; status: ThreadLinkStatus; error?: string };
export type ThreadLinks = { openThread: (id: string) => void; threadInfo: (id: string) => ThreadLinkInfo | undefined };

/** Lets transcript cards open other threads and read their live status. Absent outside the desktop and companion apps. */
export const ThreadLinksContext = createContext<ThreadLinks | undefined>(undefined);
export const useThreadLinks = () => useContext(ThreadLinksContext);

export type LinkableThread = { id: string; title: string; project: string; status: string; error?: string | null; pending?: unknown };

export function linkStatus(thread: Pick<LinkableThread, 'status' | 'pending'>): ThreadLinkStatus {
  if (thread.status === 'failed') return 'failed';
  if (thread.status === 'interrupted') return 'interrupted';
  if (thread.pending || thread.status === 'waiting') return 'waiting';
  if (thread.status === 'running' || thread.status === 'starting') return 'running';
  if (thread.status === 'done' || thread.status === 'archived') return 'done';
  return 'unknown';
}

/** Adapts an app's live thread and project lists, so cards re-render as polling refreshes them. */
export function ThreadLinksProvider({ threads, projects, onOpen, children }: {
  threads: readonly LinkableThread[]; projects: readonly { id: string; name: string }[]; onOpen: (id: string) => void; children: ReactNode;
}) {
  const value = useMemo<ThreadLinks>(() => {
    const byId = new Map(threads.map(t => [t.id, t]));
    const names = new Map(projects.map(p => [p.id, p.name]));
    return {
      openThread: onOpen,
      threadInfo: id => {
        const t = byId.get(id);
        return t && { title: t.title, projectName: names.get(t.project), status: linkStatus(t), error: t.error ?? undefined };
      },
    };
  }, [threads, projects, onOpen]);
  return <ThreadLinksContext.Provider value={value}>{children}</ThreadLinksContext.Provider>;
}
