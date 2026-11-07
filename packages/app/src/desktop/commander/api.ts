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
  settingsSet: (patch: { account?: string | null; model?: string | null }) => invoke<void>("commander_settings_set", patch),
};
export type CommanderApi = typeof commanderApi;
