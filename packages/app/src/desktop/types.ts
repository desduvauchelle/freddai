export const providerName = (provider: string) => ({codex:"Codex",claude:"Claude Code",antigravity:"Antigravity CLI",gemini:"Gemini CLI (legacy)",grok:"Grok",opencode:"OpenCode",cursor:"Cursor CLI"}[provider] || provider);
export type Account = {
  id: string;
  name: string;
  provider: "codex" | "claude" | "gemini" | "antigravity" | "grok" | "opencode" | "cursor";
  config_home?: string;
  color: string;
};
export type Project = {
  id: string;
  name: string;
  path: string;
  color: string;
  policy: "inherit" | "fixed" | "last";
  account: string | null;
  last: string | null;
};
export type Preferences = {
  new_thread_policy?: "last_selected" | "project" | "default" | null;
  last_selected?: string | null;
  use_worktree?: boolean;
  prefer_last: boolean;
  fallback: string | null;
  last: string | null;
};
export type Attachment = { id: string; name: string; bytes: number; mime: string; sha256: string };
export type PermissionMode = "ask" | "bypass";
export type LaunchOptions = { permission_mode?: PermissionMode | null; scheduled?: boolean; update_agent_controls?: boolean; worktree?: boolean; model?: string | null; effort?: string | null; attachments?: string[]; request_id?: string };
export type Message = { delivery?: string; id: string; role: string; text: string; attachments?: Attachment[] };
export type Pending = {
  id?: string | number;
  method?: string;
  request_id?: string;
  params?: Record<string, unknown>;
  request?: {
    subtype: string;
    tool_name: string;
    input: Record<string, unknown>;
  };
};
export type Session = {
  archived?: boolean;
  deleted_at?: number | null;
  execution_project?: string | null;
  usage?: import("./conversation-usage").ConversationUsage | null;
  id: string;
  project: string;
  account: string;
  title: string;
  status: string;
  updated: number;
  last_user_message_at?: number | null;
  /** Host-stored read cursor shared with the iPhone: the `updated` value last seen. */
  read_at?: number | null;
  provider_id: string | null;
  working_dir?: string | null;
  options?: LaunchOptions;
  messages: Message[];
  pending: Pending | null;
  error: string | null;
};
export type Schedule = { id: string; name: string; project: string; account: string; routing: string; cron: string; timezone: string; prompt: string; enabled: boolean; options: LaunchOptions; next_due: number; runs: {id: string; due: number; state: string; session: string | null; reason: string | null}[] };
export type ThreadQueue = { session: string; paused: boolean; error: string | null; messages: { id: string; prompt: string; options: LaunchOptions }[] };
export type Database = {
  queues?: ThreadQueue[];
  host_update_pending?: boolean;
  schedules?: Schedule[];
  accounts: Account[];
  projects: Project[];
  sessions: Session[];
  preferences: Preferences;
};
export const empty: Database = {
  accounts: [],
  projects: [],
  sessions: [],
  preferences: { prefer_last: false, fallback: null, last: null },
};
export const busy = (s?: Session) =>
  !!s && ["starting", "running", "waiting"].includes(s.status);
export function resolveAccount(db: Database, project?: Project): string {
  if (db.preferences.new_thread_policy === "default") return db.preferences.fallback || "";
  if (db.preferences.new_thread_policy === "last_selected" && db.preferences.last_selected)
    return db.preferences.last_selected;
  const global =
    (!db.preferences.new_thread_policy && db.preferences.prefer_last
      ? db.preferences.last || db.preferences.fallback
      : db.preferences.fallback) || "";
  return project?.policy === "fixed"
    ? project.account || ""
    : project?.policy === "last"
      ? project.last || global
      : global;
}

export function accountLabel(db: Database, id: string): string {
  const account = db.accounts.find((a) => a.id === id);
  return account
    ? `${providerName(account.provider)} · ${account.name}`
    : "No account configured";
}


export function threadVisibility(thread: Session, filter: string): boolean {
  if (thread.deleted_at != null) return filter === "deleted";
  if (thread.archived || thread.status === "archived") return filter === "archived";
  return filter !== "archived" && filter !== "deleted";
}
export function threadCapabilities(thread: Session, hasAccount: boolean) {
  const deleted = thread.deleted_at != null;
  const archived = !!thread.archived || thread.status === "archived";
  return {
    stop: busy(thread) && !deleted,
    resume: !busy(thread) && !deleted && !archived && !!thread.provider_id && hasAccount,
    review: !!thread.pending && !deleted,
    change: !busy(thread) && !deleted,
    archive: !deleted && thread.status !== "archived",
    delete: !deleted,
    restore: deleted,
  };
}

export function threadListStatus(thread: Pick<Session, "id" | "status" | "updated">, read: Record<string, number>): string {
  return thread.status === "done" && (read[thread.id] ?? -1) < thread.updated ? "unread" : thread.status;
}

/**
 * Status rule for the live (top) section of a project's thread list. A thread is live when any holds:
 * running/starting/waiting, a pending approval/input request, queued follow-ups, an unread completed reply,
 * a failed run whose latest update has not been viewed, or it is the selected thread.
 * Everything else goes under "Show older threads". Read cursors (`read[id] >= updated`) record viewing.
 */
export function threadIsLive(thread: Pick<Session, "id" | "status" | "updated"> & { pending?: unknown }, read: Record<string, number>, selected: string, queued = 0): boolean {
  return selected === thread.id || ["starting", "running", "waiting"].includes(thread.status) || !!thread.pending || queued > 0 ||
    threadListStatus(thread, read) === "unread" || (thread.status === "failed" && (read[thread.id] ?? -1) < thread.updated);
}

export function threadInActiveList(thread: Pick<Session, "id" | "status" | "updated"> & { pending?: unknown }, read: Record<string, number>, selected: string, hideRead: boolean, filter: string, queued = 0): boolean {
  return !hideRead || ["done", "failed", "archived", "deleted"].includes(filter) || threadIsLive(thread, read, selected, queued);
}

export const OLDER_PAGE_SIZE = 10;

/** Day-separator label for a timestamp: "" for today, "Yesterday", else "Mon, Oct 27" (+ year when not current). */
export function dayBucketLabel(timestamp: number, now: number = Date.now()): string {
  const day = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const date = day(timestamp), today = day(now);
  const diff = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (diff <= 0) return "";
  if (diff === 1) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** Groups already-sorted threads into consecutive local-day buckets by last user message. */
export function groupThreadsByDay<T extends Pick<Session, "updated" | "last_user_message_at">>(threads: T[], now: number = Date.now()): { label: string; threads: T[] }[] {
  const groups: { label: string; threads: T[] }[] = [];
  for (const thread of threads) {
    const label = dayBucketLabel(thread.last_user_message_at ?? thread.updated, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.threads.push(thread);
    else groups.push({ label, threads: [thread] });
  }
  return groups;
}

// updated remains the activity/read cursor; list order follows user sends.
export function compareThreadRecency(a: Pick<Session, "id" | "updated" | "last_user_message_at">, b: Pick<Session, "id" | "updated" | "last_user_message_at">): number {
  return (b.last_user_message_at ?? b.updated) - (a.last_user_message_at ?? a.updated) || a.id.localeCompare(b.id);
}
