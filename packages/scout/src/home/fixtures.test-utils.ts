import { vi } from "vitest";
import type { Item, Project, ScoutState, Workspace } from "../api";
import type { ScoutActions } from "../contracts";

export const ws = (id: string, name: string, order: number, patch: Partial<Workspace> = {}): Workspace =>
  ({ id, name, color: "#3b6cf6", order, collapsed: false, ...patch });
export const proj = (id: string, workspace: string, name: string, order: number, patch: Partial<Project> = {}): Project =>
  ({ id, workspace, name, color: "#3b6cf6", order, pinned: false, hidden: false, freddai_project: null, ...patch });
export const item = (id: string, project: string, title: string, lane: Item["lane"], order: number, patch: Partial<Item> = {}): Item => ({
  id, project, kind: "task", title, subtitle: null, lane, status: "none", source: null, origin: "user", thread: null,
  order, created: "2026-11-13T10:00:00Z", updated: "2026-11-13T10:00:00Z", done_at: lane === "done" ? "2026-11-13T11:00:00Z" : null, ...patch,
});

export function makeActions(): ScoutActions {
  const ok = () => vi.fn(async () => {});
  return {
    workspaceSave: ok(), workspaceDelete: ok(), workspaceReorder: ok(),
    projectSave: ok(), projectDelete: ok(), projectMove: ok(),
    itemSave: ok(), itemDelete: ok(), itemMove: ok(),
    ruleSave: ok(), ruleDelete: ok(), sourceSave: ok(), sourceDelete: ok(),
    settingsSave: ok(), importFreddai: ok(), sampleData: ok(), refresh: ok(),
  };
}

/** LiveCase (Sales pinned, Support, Archive hidden), Freddai (Build), Home collapsed (Family). */
export function boardState(): ScoutState {
  return {
    revision: 1,
    workspaces: [ws("w2", "Freddai", 1), ws("w1", "LiveCase", 0), ws("w3", "Home", 2, { collapsed: true })],
    projects: [
      proj("p2", "w1", "Support", 1),
      proj("p1", "w1", "Sales", 0, { pinned: true }),
      proj("p3", "w2", "Build", 0),
      proj("p4", "w3", "Family", 0),
      proj("p5", "w1", "Archive", 2, { hidden: true }),
    ],
    items: [
      item("i1", "p1", "Reply to Acme about pricing", "focus", 0, { kind: "email", status: "needs_you" }),
      item("i2", "p1", "Demo with Northwind", "focus", 1, { kind: "meeting", status: "agent_working" }),
      item("i3", "p1", "Update the pipeline sheet", "backlog", 0),
      item("i4", "p2", "Fix login redirect loop", "focus", 0, { kind: "code", status: "needs_you" }),
      item("i5", "p2", "Refund request", "backlog", 0, { kind: "email" }),
      item("i6", "p3", "Review PR #42", "backlog", 0, { kind: "code" }),
      item("i7", "p4", "Book the dentist", "focus", 0, { status: "needs_you" }),
      item("i8", "p5", "Old hidden thing", "focus", 0, { status: "needs_you" }),
      item("i9", "p1", "Sent invoice", "done", 0),
    ],
    rules: [], sources: [],
    settings: { onboarding_done: true, onboarding_step: 5, sample_data: false },
  };
}
