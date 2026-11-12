/** Typed client for the Commander-in-Chief Tauri commands (contract: snake_case JSON). All calls go through here so tests mock one module. */
import { invoke } from "@tauri-apps/api/core";

export type CommanderStatus = { needs_you: number; running: number; done_today: number };
export type CommanderState = {
  project: { id: string; name: string; path: string; objective: string | null; account: string | null; model: string | null };
  thread_id: string | null;
  status: CommanderStatus;
  /** Set when "latest" model resolution fell back to the provider default; must be shown to the user. */
  model_notice?: string | null;
};
export type TodoStatus = "open" | "in_progress" | "needs_review" | "done" | "dropped";
export type TodoOwner = "me" | "commander" | "thread";
export type Verification = { requirement: string; status: "met" | "missing" | "unclear"; evidence: string | null };
export type Todo = {
  id: string; title: string; description: string | null; project: string | null; owner: TodoOwner; thread: string | null;
  status: TodoStatus; due: string | null; check_back_at: string | null; verification: Verification[];
  completion_basis: "verified" | "user_confirmed" | null; completion_note: string | null;
  created_at: string; updated_at: string; history: { at: string; event: string; detail: string | null }[];
};
export type NoteSummary = { name: string; title: string; updated_at: string; preview: string };
export type Proposal = {
  id: string; tool: string; summary: string; project: string | null; arguments: Record<string, unknown>;
  status: "pending" | "approved" | "declined" | "failed"; result: string | null; error: string | null;
  thread: string | null; created_at: string; decided_at: string | null;
  caller_thread?: string | null; caller_project?: string | null; todo_id?: string | null;
};
export type Memory = {
  id: string; kind: "preference" | "fact" | "person" | "project"; text: string; confidence: number; pinned: boolean;
  status: "active" | "stale" | "forgotten"; project: string | null; source_thread: string | null; superseded_by?: string | null; created_at: string; updated_at: string;
};

export type ProfileFile = "soul" | "user";
export type ProfileRevision = { file: ProfileFile; at: string; by: "user" | "commander"; reason: string | null };
export type CommanderProfileData = { name: string; soul: string; user: string; prompt_preview: string; revisions: ProfileRevision[] };

export type CommanderAutonomy = { mode: "propose" | "budgeted"; maxConcurrent: number; dailyStartCap: number; allowedProjectIds: string[] };
export type CommanderHeartbeat = { enabled: boolean; intervalMinutes: number; activeStart: string; activeEnd: string };
export type CommanderSettings = { autonomy: CommanderAutonomy; heartbeat: CommanderHeartbeat };
export const DEFAULT_COMMANDER_SETTINGS: CommanderSettings = {
  autonomy: { mode: "propose", maxConcurrent: 2, dailyStartCap: 5, allowedProjectIds: [] },
  heartbeat: { enabled: false, intervalMinutes: 60, activeStart: "08:00", activeEnd: "20:00" },
};

export const commanderApi = {
  state: () => invoke<CommanderState>("commander_state"),
  todos: () => invoke<Todo[]>("commander_todos"),
  todoSave: (todo: Partial<Todo> & { id?: string }) => invoke<Todo>("commander_todo_save", { todo }),
  notes: () => invoke<NoteSummary[]>("commander_notes"),
  noteRead: (name: string) => invoke<{ name: string; body: string }>("commander_note_read", { name }),
  noteWrite: (name: string, body: string) => invoke<NoteSummary>("commander_note_write", { name, body }),
  proposals: () => invoke<Proposal[]>("commander_proposals"),
  proposalRespond: (id: string, approve: boolean, prompt?: string) =>
    invoke<Proposal>("commander_proposal_respond", prompt === undefined ? { id, approve } : { id, approve, prompt }),
  memory: () => invoke<Memory[]>("commander_memory"),
  memorySave: (memory: Partial<Memory> & { id?: string }) => invoke<Memory>("commander_memory_save", { memory }),
  objectiveSet: (project: string, objective: string | null) => invoke<void>("project_objective_set", { project, objective }),
  profile: () => invoke<CommanderProfileData>("commander_profile"),
  profileSave: (patch: { name?: string; soul?: string; user?: string; reason?: string }) => invoke<CommanderProfileData>("commander_profile_save", patch),
  revisionRestore: (file: ProfileFile, at: string) => invoke<CommanderProfileData>("commander_revision_restore", { file, at }),
  getCommanderSettings: () => invoke<CommanderSettings>("commander_settings_get"),
  /** Rejects with a message naming the failing field. */
  saveCommanderSettings: (settings: CommanderSettings) => invoke<CommanderSettings>("commander_settings_save", { settings }),
  settingsSet: (patch: { account?: string | null; model?: string | null }) => invoke<void>("commander_settings_set", patch),
};
export type CommanderApi = typeof commanderApi;
