import { productUsageCards, type ProductUsageCard } from "./product-usage";
import { threadListStatus } from '../desktop/types';
import type { CompanionSnapshot, CompanionThread, ThreadFilter } from './companion';
import { COMPANION_RECENT_PAGING, asThreadNavView, selectRecentThreads, type ThreadNavView } from '../recentThreads';
import type { Outgoing } from './outbox';
import { companionStatusRead, groupCompanionThreads, selectThreads, scopeCompanion } from './companion';

/** Compact, serializable model pushed to the native thread drawer (`set_threads`). JS stays the source of truth. */
export type NativeThread = { scheduled?: boolean; pinned?: boolean; id: string; title: string; status: string; unread: boolean; faded: boolean; updatedAt: number };
export type NativeThreadGroup = { project: string; label: string; color: string; canStart: boolean; kind?: 'commander'; threads: NativeThread[]; olderRemaining: number; olderLabel: string; olderExpanded: boolean };
/** A flat "Recent" row: the usual thread row plus the owning project's name/colour for the small tag. */
export type NativeRecentThread = NativeThread & { projectLabel: string; projectColor: string };
export type NativeRecent = { threads: NativeRecentThread[]; remaining: number; expanded: boolean };
export type NativeOption = { id: string; label: string };
export type NativeThreadsModel = {
  productUsage?: ProductUsageCard[];
  groups: NativeThreadGroup[];
  canReorderProjects?: boolean;
  /** Which list the drawer shows; owned by JS (`freddai.companion.threadNavView`) and echoed back via `setView`. */
  view: ThreadNavView;
  /** Computed with the shared `selectRecentThreads` helper so Swift/Kotlin never re-implement ordering or paging. */
  recent: NativeRecent;
  /** Always-visible "Recent" section at the bottom of the Projects view (5, +10), independent of `recent`. */
  recentSection: NativeRecent;
  selectedId: string;
  filters: { workspace?: string; project: string; status: ThreadFilter; query: string };
  workspaceOptions?: NativeOption[];
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

export function nativeThread(thread: CompanionThread, read: Record<string, number>): NativeThread {
  const listStatus = threadListStatus(thread, read);
  return {
    id: thread.id,
    pinned: thread.pinned,
    scheduled: thread.scheduled === true,
    title: thread.title,
    // A pending approval/input request needs the user even when the run reports another status.
    status: thread.pending && !['failed', 'interrupted'].includes(thread.status) ? 'waiting' : thread.status,
    unread: listStatus === 'unread',
    faded: companionThreadFaded(thread, read),
    updatedAt: thread.last_user_message_at ?? thread.updated,
  };
}

/**
 * Rows for messages that are still being delivered as a NEW thread, so a dashboard card shows them immediately.
 * Un-acknowledged items are `sending` (or `queued` when blocked/offline/failing); acknowledged ones the snapshot does not list yet keep showing under the real thread id.
 */
export function pendingThreads(project: string, outbox: Outgoing[], snapshotIds: ReadonlySet<string>, connected: boolean, now: number): NativeThread[] {
  return outbox.filter(m => m.project === project && !m.replyTo && (m.thread === '' || (m.acknowledged && !snapshotIds.has(m.thread))))
    .reverse().map(m => {
      const text = m.prompt.trim().replace(/\s+/g, ' ');
      const acknowledged = m.acknowledged && m.thread !== '';
      return { id: acknowledged ? m.thread : `outbox:${m.id}`, title: text.length > 60 ? `${text.slice(0, 59)}…` : text,
        status: acknowledged ? 'starting' : m.blocked || m.deliveryError || !connected ? 'queued' : 'sending',
        unread: false, faded: false, updatedAt: now };
    });
}

const isCommanderGroup = (group: { project?: { kind?: string | null } }) => group.project?.kind === 'commander';

/** Builds the drawer model with the same selection, grouping and paging logic as the web list. */
export function buildThreadsModel(input: {
  workspace?: string; canManageWorkspaces?: boolean; data: CompanionSnapshot; read: Record<string, number>; selected: string; project: string; query: string; filter: ThreadFilter; olderPages: Record<string, number>; view?: ThreadNavView; recentPages?: number; sectionPages?: number;
}): NativeThreadsModel {
  const { selected, project, query, filter, olderPages } = input;
  const data = scopeCompanion(input.data, input.workspace || "");
  const read = companionStatusRead(data, input.read);
  const threads = selectThreads(data, project, query, filter, 'recent', read);
  const groups = groupCompanionThreads(data, threads, { read, selected, filter, pages: olderPages, includeEmpty: !query.trim() && filter === 'all', project });
  const recentRows = (pick: ReturnType<typeof selectRecentThreads<CompanionThread>>): NativeRecent => ({
    threads: pick.threads.map(t => {
      const owner = data.projects.find(p => p.id === t.project);
      return { ...nativeThread(t, read), projectLabel: owner?.name || 'Project', projectColor: owner?.color || '' };
    }),
    remaining: pick.remaining,
    expanded: pick.expanded,
  });
  return {
    productUsage: productUsageCards(input.data.productUsage),
    view: input.view ?? 'projects',
    recent: recentRows(selectRecentThreads(threads, input.recentPages ?? 0, COMPANION_RECENT_PAGING)),
    recentSection: recentRows(selectRecentThreads(threads, input.sectionPages ?? 0)),
    groups: [...groups].sort((a, b) => Number(isCommanderGroup(b)) - Number(isCommanderGroup(a))).map(group => ({
      project: group.id,
      label: group.project?.name || 'Project',
      color: group.project?.color || '',
      canStart: !!group.project?.canStart,
      ...(group.project && 'kind' in group.project && group.project.kind === 'commander' ? { kind: 'commander' as const } : {}),
      threads: [...group.active, ...group.older].map(t => nativeThread(t, read)),
      olderRemaining: group.remaining,
      olderLabel: group.pageCount ? `Show more (${group.remaining})` : `Show older threads (${group.remaining})`,
      olderExpanded: group.pageCount > 0,
    })),
    selectedId: selected,
    filters: { ...(input.workspace !== undefined ? { workspace: input.workspace } : {}), project, status: filter, query },
    workspaceOptions: [{ id: "", label: "All workspaces" }, ...(data.workspaces || []).map(w => ({ id: w.id, label: w.name })), ...(input.canManageWorkspaces ? [{ id: "__manage_workspaces", label: "Manage workspaces…" }] : [])],
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
  setWorkspace?(workspace: string): void;
  workspace?: string;
  setFilters(project: string, status: ThreadFilter): void;
  newThread(project: string): void;
  showOlder(project: string): void;
  showLess?(project: string): void;
  setView?(view: ThreadNavView): void;
  recentPage?(action: 'more' | 'less', section?: boolean): void;
};
/** Maps raw native event payloads onto state changes, tolerating malformed payloads. */
export function createThreadEventHandlers(actions: ThreadEventActions) {
  return {
    selectThread: (payload: { id?: unknown }) => { if (typeof payload?.id === 'string' && payload.id) actions.selectThread(payload.id); },
    search: (payload: { query?: unknown }) => actions.setQuery(typeof payload?.query === 'string' ? payload.query : ''),
    setFilter: (payload: { workspace?: unknown; project?: unknown; status?: unknown }) => {
      if (typeof payload?.workspace === 'string') {
        actions.setWorkspace?.(payload.workspace); return;
      }
      actions.setFilters(typeof payload?.project === 'string' ? payload.project : '', asThreadFilter(payload?.status));
    },
    newThread: (payload: { project?: unknown }) => actions.newThread(typeof payload?.project === 'string' ? payload.project : ''),
    showOlder: (payload: { project?: unknown }) => { if (typeof payload?.project === 'string') actions.showOlder(payload.project); },
    showLess: (payload: { project?: unknown }) => { if (typeof payload?.project === 'string') actions.showLess?.(payload.project); },
    setView: (payload: { view?: unknown }) => actions.setView?.(asThreadNavView(payload?.view)),
    recentPage: (payload: { action?: unknown; section?: unknown }) => { if (payload?.action === 'more' || payload?.action === 'less') actions.recentPage?.(payload.action, payload.section === 'bottom'); },
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
