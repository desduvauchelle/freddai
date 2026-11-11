export interface FolderListing { path: string; parent: string | null; folders: { name: string; path: string }[] }
import { isCommanderThread } from "../commanderThreads";
import { statusReadCursors } from "../desktop/status-read-cursors";
import { bucketThreads, compareThreadRecency, OLDER_PAGE_SIZE, RECENT_FINISHED_DEFAULT, threadListStatus } from '../desktop/types.ts';
import type { ConversationUsage } from '../desktop/conversation-usage';
import type { Model } from '../desktop/agent-selection';
import type { BackgroundTask, Message, Pending, Attachment, Workspace } from '../desktop/types';

// Intentionally excludes account credentials, filesystem paths and settings.
export type CompanionProject = { id: string; name: string; color: string; canStart: boolean; provider?: string; defaultAssistant?: string; assistants?: { id: string; name: string; provider: string }[]; kind?: 'commander' | null; objective?: string | null };
export type CompanionThread = { scheduled?: boolean; origin?: { kind: string; thread?: string | null; project?: string | null } | null; pinned?: boolean; id: string; project: string; title: string; status: string; updated: number; read_at?: number | null; last_user_message_at?: number | null; messages: Message[]; messagesLoaded?: boolean; tasks?: BackgroundTask[]; canReply: boolean; queued: number; error: string | null; pending?: Pending | null; provider?: string; queuePaused?: boolean; queueError?: string | null; options?: ComposerOptions; usage?: ConversationUsage | null; queue?: { id: string; prompt: string; attachments: number }[] };
export type CompanionProductUsage = { error?: string | null; id: string; name: string; provider: string; color: string; usage?: { windows: import("../desktop/usage").UsageWindow[]; checked_at: number } | null };
export type CompanionSnapshot = { productUsage?: CompanionProductUsage[]; canReorderProjects?: boolean; workspaces?: Workspace[]; schedules?: import("../desktop/types").Schedule[]; projects: CompanionProject[]; threads: CompanionThread[]; threadList?: { projectOrder?: string[]; grouped?: boolean; hideRead?: boolean; ignoreUnread?: boolean; recentFinished?: number } };
export type ComposerOptions = { model?: string | null; effort?: string | null; permission_mode?: 'ask' | 'bypass' | null; attachments?: string[]; update_agent_controls?: boolean };
/** Commander-in-Chief operations proxied to the Mac. The state omits the folder path; memory and settings stay desktop-only. */
type DesktopCommanderState = import('../desktop/commander/api').CommanderState;
export type CompanionCommanderState = Omit<DesktopCommanderState, 'project'> & { project: Omit<DesktopCommanderState['project'], 'path'> };
export type CommanderClient = {
  state(): Promise<CompanionCommanderState>;
  proposals(): Promise<import('../desktop/commander/api').Proposal[]>;
  respond(input: { id: string; approve: boolean; prompt?: string }): Promise<import('../desktop/commander/api').Proposal>;
  todos(): Promise<import('../desktop/commander/api').Todo[]>;
  saveTodo(todo: Partial<import('../desktop/commander/api').Todo> & { id?: string }): Promise<import('../desktop/commander/api').Todo>;
  notes(): Promise<import('../desktop/commander/api').NoteSummary[]>;
  readNote(name: string): Promise<{ name: string; body: string }>;
  writeNote(name: string, body: string): Promise<import('../desktop/commander/api').NoteSummary>;
};
export type ComposerTarget = { thread?: string; project?: string; assistant?: string };
export type CompanionClient = {
  commander?: CommanderClient;
  updateProjectOrganization?(project: string, name: string, color: string): Promise<void>;
  projectFolders?(operation: "browse_folders" | "create_folder", input: { path?: string; name?: string }): Promise<FolderListing>;
  addProject?(path: string): Promise<{ id: string }>;
  moveProject?(project: string, target: string, after: boolean): Promise<string[]>;
  saveWorkspaces?(workspaces: Workspace[]): Promise<void>;
  generatedFile?(thread: string, href: string, offset: number): Promise<import("../conversation/GeneratedFile").FileChunk>;
  scheduleCommand?: import("../desktop/ScheduleManager").ScheduleCommand;
  /** Google accounts and triggers on the paired Mac. Connecting accounts and the client secret stay Mac-only. */
  googleCommand?: import("../google").GoogleCommand;
  summaries?: import("../desktop/DaySummaries").DaySummariesClient;
  transcribeAudio?(audio: Blob): Promise<{ text: string }>;
  models?(target: ComposerTarget): Promise<Model[]>;
  attach?(file: File): Promise<Attachment>;
  /** Uploads a file the native composer copied to the app's tmp dir; Rust reads it by path and runs the chunked upload. */
  attachPath?(file: { path: string; name: string; mime: string }): Promise<Attachment>;
  /** Whether the Mac has voice dictation enabled and its model ready. */
  voice?(): Promise<{ enabled: boolean; ready: boolean }>;
  /** Uploads a dictation recording the native composer saved to the tmp dir; the Mac transcribes it and the file is deleted. */
  transcribe?(file: { path: string }): Promise<{ text: string; durationMs: number; model: string }>;
  resume?(input: { thread: string; requestId: string }): Promise<void>;
  queue?(input: { thread: string; action: 'pause' | 'resume' | 'delete' | 'clear' | 'steer' | 'edit'; message?: string; prompt?: string }): Promise<void>;
  action?(input: { thread: string; action: 'stop' | 'archive' | 'delete' | 'pin' | 'unpin' }): Promise<void>;
  markRead?(input: { thread: string; at: number }): Promise<void>;
  mergeRead?(cursors: Record<string, number>): Promise<void>;
  /** Sends Wake-on-LAN packets for the Mac on the local network; resolves with the datagram count. Rejects with a user-readable reason. */
  wake?(): Promise<number>;
  /** Whether the Mac has reported its wake details to this phone yet. */
  hasWakeInfo?(): Promise<boolean>;
  snapshot(signal: AbortSignal, thread?: string): Promise<CompanionSnapshot>;
  start(input: { assistant?: string; project: string; prompt: string; requestId: string; options?: ComposerOptions }): Promise<string>;
  respond(input: { thread: string; requestId: string; allow: boolean; answers: Record<string, unknown> }): Promise<void>;
  reply(input: { thread: string; prompt: string; requestId: string; options?: ComposerOptions }): Promise<void>;
};
/** Scope navigation only; the original snapshot still owns open conversations. */
export function scopeCompanion(snapshot: CompanionSnapshot, workspace: string): CompanionSnapshot {
  const selected = snapshot.workspaces?.find(w => w.id === workspace);
  if (!selected) return snapshot;
  const projects = snapshot.projects.filter(p => selected.projects.includes(p.id));
  const ids = new Set(projects.map(p => p.id));
  return { ...snapshot, projects, threads: snapshot.threads.filter(t => ids.has(t.project)) };
}
export type ThreadFilter = 'all' | 'attention' | 'running' | 'done';
export type ThreadSort = 'recent' | 'oldest' | 'title';
/** Apply the Mac's presentation preference without changing shared read history. */
export function companionStatusRead(snapshot: CompanionSnapshot, read: Record<string, number>) {
  return statusReadCursors(snapshot.threads, read, snapshot.threadList?.ignoreUnread === true);
}
export function selectThreads(snapshot: CompanionSnapshot, project: string, query: string, filter: ThreadFilter, sort: ThreadSort, read: Record<string, number> = {}) {
  read = companionStatusRead(snapshot, read);
  const search = query.trim().toLocaleLowerCase();
  const names = new Map(snapshot.projects.map(p => [p.id, p.name]));
  return snapshot.threads.filter(t => !isCommanderThread(t, snapshot.projects.find(p => p.kind === "commander")?.id) && (!project || t.project === project)
    && `${t.title} ${names.get(t.project) || ''}`.toLocaleLowerCase().includes(search)
    && (filter === 'all' || filter === 'attention' && ['waiting', 'error', 'failed', 'interrupted', 'unread'].includes(threadListStatus(t, read))
      || filter === 'running' && ['starting', 'running'].includes(t.status)
      || filter === 'done' && threadListStatus(t, read) === 'done'))
    .sort((a, b) => (sort === 'title' ? a.title.localeCompare(b.title) : sort === 'oldest' ? -compareThreadRecency(a, b) : compareThreadRecency(a, b)) || a.id.localeCompare(b.id));
}
export function groupCompanionThreads(snapshot: CompanionSnapshot, threads: CompanionThread[], options: {
  read: Record<string, number>; selected: string; filter: ThreadFilter; pages: Record<string, number>;
  includeEmpty?: boolean; project?: string;
}) {
  const settings = snapshot.threadList;
  const grouped = settings?.grouped ?? true;
  const buckets = bucketThreads(threads, {
    read: companionStatusRead(snapshot, options.read), selected: options.selected, filter: options.filter,
    hideRead: settings?.hideRead ?? true, recentCount: settings?.recentFinished ?? RECENT_FINISHED_DEFAULT,
    scope: grouped ? 'grouped' : 'flat', queued: t => t.queued,
  });
  const defaults = [...new Set([
    ...threads.map(t => t.project),
    ...(options.includeEmpty ? snapshot.projects.filter(p => (!options.project || p.id === options.project) ).map(p => p.id) : []),
  ])];
  const order = grouped ? [...new Set([...(settings?.projectOrder ?? []), ...defaults])].filter(id => defaults.includes(id)) : [''];
  return order.map(id => {
    const belongs = (t: CompanionThread) => !grouped || t.project === id;
    const recent = buckets.recent.filter(belongs), older = buckets.older.filter(belongs);
    const pageCount = options.pages[id] || 0;
    const shownOlder = older.slice(0, pageCount * OLDER_PAGE_SIZE);
    return { id, project: grouped ? snapshot.projects.find(p => p.id === id) : { id: '', name: 'All threads', color: '', canStart: false }, active: [...buckets.active.filter(belongs), ...recent],
      older: shownOlder, remaining: older.length - shownOlder.length, pageCount };
  });
}

export const disconnectedClient: CompanionClient = {
  async snapshot() { throw new Error('Your Mac is not connected. Remote connectivity is not available in this first build.'); },
  async start() { throw new Error('Connect to your Mac before starting a thread.'); },
  async respond() { throw new Error('Connect to your Mac before answering a request.'); },
  async reply() { throw new Error('Connect to your Mac before sending a reply.'); },
};
