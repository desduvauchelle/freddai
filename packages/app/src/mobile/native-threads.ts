import { OLDER_PAGE_SIZE, threadListStatus } from '../desktop/types';
import type { CompanionSnapshot, CompanionThread, ThreadFilter } from './companion';
import { companionStatusRead, groupCompanionThreads, selectThreads } from './companion';

/** Compact, serializable model pushed to the native thread drawer (`set_threads`). JS stays the source of truth. */
export type NativeThread = { id: string; title: string; status: string; unread: boolean; faded: boolean; updatedAt: number };
export type NativeThreadGroup = { project: string; label: string; color: string; canStart: boolean; threads: NativeThread[]; olderRemaining: number; olderLabel: string };
export type NativeOption = { id: string; label: string };
export type NativeThreadsModel = {
  groups: NativeThreadGroup[];
  selectedId: string;
  filters: { project: string; status: ThreadFilter; query: string };
  projectOptions: NativeOption[];
  statusOptions: NativeOption[];
};

export const STATUS_OPTIONS: NativeOption[] = [
  { id: 'all', label: 'All threads' }, { id: 'attention', label: 'Needs you' }, { id: 'running', label: 'Running' }, { id: 'done', label: 'Finished' },
];

const FILTER_IDS = new Set<string>(STATUS_OPTIONS.map(o => o.id));
export const asThreadFilter = (value: unknown): ThreadFilter => (typeof value === 'string' && FILTER_IDS.has(value) ? value as ThreadFilter : 'all');

export function companionThreadFaded(thread: CompanionThread, read: Record<string, number>): boolean {
  return threadListStatus(thread, read) === 'done' && !thread.pending && thread.queued === 0;
}

function nativeThread(thread: CompanionThread, read: Record<string, number>): NativeThread {
  const listStatus = threadListStatus(thread, read);
  return {
    id: thread.id,
    title: thread.title,
    // A pending approval/input request needs the user even when the run reports another status.
    status: thread.pending && !['failed', 'interrupted'].includes(thread.status) ? 'waiting' : thread.status,
    unread: listStatus === 'unread',
    faded: companionThreadFaded(thread, read),
    updatedAt: thread.last_user_message_at ?? thread.updated,
  };
}

/** Builds the drawer model with the same selection, grouping and paging logic as the web list. */
export function buildThreadsModel(input: {
  data: CompanionSnapshot; read: Record<string, number>; selected: string; project: string; query: string; filter: ThreadFilter; olderPages: Record<string, number>;
}): NativeThreadsModel {
  const { data, selected, project, query, filter, olderPages } = input;
  const read = companionStatusRead(data, input.read);
  const threads = selectThreads(data, project, query, filter, 'recent', read);
  const groups = groupCompanionThreads(data, threads, { read, selected, filter, pages: olderPages, includeEmpty: !query.trim() && filter === 'all', project });
  return {
    groups: groups.map(group => ({
      project: group.id,
      label: group.project?.name || 'Project',
      color: group.project?.color || '',
      canStart: !!group.project?.canStart,
      threads: [...group.active, ...group.older].map(t => nativeThread(t, read)),
      olderRemaining: group.remaining,
      olderLabel: group.pageCount ? `Show ${Math.min(OLDER_PAGE_SIZE, group.remaining)} more (${group.remaining})` : `Show older threads (${group.remaining})`,
    })),
    selectedId: selected,
    filters: { project, status: filter, query },
    projectOptions: [{ id: '', label: 'All projects' }, ...data.projects.map(p => ({ id: p.id, label: p.name }))],
    statusOptions: data.threadList?.ignoreUnread ? STATUS_OPTIONS.map(option => ({ ...option, label: option.id === "running" ? "Working" : option.id === "done" ? "Done" : option.label })) : STATUS_OPTIONS,
  };
}

/** Wraps a sender so the 1 s snapshot poll only crosses the IPC bridge when the serialized value changed. */
export function createChangeSender<T>(send: (value: T) => Promise<void>): (value: T) => Promise<boolean> {
  let last: string | null = null;
  return async value => {
    const serialized = JSON.stringify(value);
    if (serialized === last) return false;
    last = serialized;
    try { await send(value); return true; }
    catch (e) { if (last === serialized) last = null; throw e; }
  };
}

export const bumpOlderPage = (pages: Record<string, number>, project: string): Record<string, number> => ({ ...pages, [project]: (pages[project] || 0) + 1 });

export type ThreadEventActions = {
  selectThread(id: string): void;
  setQuery(query: string): void;
  setFilters(project: string, status: ThreadFilter): void;
  newThread(project: string): void;
  showOlder(project: string): void;
};
/** Maps raw native event payloads onto state changes, tolerating malformed payloads. */
export function createThreadEventHandlers(actions: ThreadEventActions) {
  return {
    selectThread: (payload: { id?: unknown }) => { if (typeof payload?.id === 'string' && payload.id) actions.selectThread(payload.id); },
    search: (payload: { query?: unknown }) => actions.setQuery(typeof payload?.query === 'string' ? payload.query : ''),
    setFilter: (payload: { project?: unknown; status?: unknown }) => actions.setFilters(typeof payload?.project === 'string' ? payload.project : '', asThreadFilter(payload?.status)),
    newThread: (payload: { project?: unknown }) => actions.newThread(typeof payload?.project === 'string' ? payload.project : ''),
    showOlder: (payload: { project?: unknown }) => { if (typeof payload?.project === 'string') actions.showOlder(payload.project); },
  };
}

export type ThreadActionHandlers = { stop(): void; archive(): void; delete(): void; review(): void };
/** Routes native thread-menu events onto the same handlers the web "Thread actions" menu uses; unknown actions are ignored. */
export function createThreadActionHandler(handlers: ThreadActionHandlers) {
  return (payload: { action?: unknown }) => {
    switch (payload?.action) {
      case 'stop': return handlers.stop();
      case 'archive': return handlers.archive();
      case 'delete': return handlers.delete();
      case 'review': return handlers.review();
    }
  };
}

/** Run-state word shown in the native bar: pending decision wins over the reported status. */
export function nativeRunState(thread: { status: string; pending?: unknown } | undefined): 'running' | 'waiting' | 'failed' | '' {
  if (!thread) return '';
  if (thread.status === 'failed') return 'failed';
  if (thread.pending || thread.status === 'waiting') return 'waiting';
  if (thread.status === 'running' || thread.status === 'starting') return 'running';
  return '';
}
