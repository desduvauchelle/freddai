import { homeRunState } from "../desktop/home-state";
import type { Project, Session } from "../desktop/types";

export type OfficeAgentState = "working" | "needs-you" | "review" | "done" | "failed" | "idle";

/** Minimal schedule shape (a subset of the app's `Schedule`); `next_due` is epoch milliseconds. */
export type OfficeSchedule = { id: string; name: string; project: string; next_due: number; enabled: boolean };

export type OfficeAgent = {
  id: string; threadId: string; title: string; projectId: string; projectName: string;
  state: OfficeAgentState; updated: number;
  /** Human text for the state; never colour-only. */
  stateLabel: string;
  /** Short glyph shown in the speech bubble. */
  cue: string;
  /** Stable 0..3 sprite variant derived from the thread id. */
  variant: number;
  /** Desk position inside its room (row-major). */
  desk: number;
};
export type OfficeRoom = { projectId: string; name: string; color: string; agents: OfficeAgent[]; needsYou: number };
export type OfficeShrine = { entries: { id: string; name: string; projectName: string; due: number }[]; next: number | null };
export type OfficeModel = { rooms: OfficeRoom[]; agents: OfficeAgent[]; shrine: OfficeShrine | null; summary: string };

export const STATE_LABEL: Record<OfficeAgentState, string> = {
  working: "Working", "needs-you": "Needs you", review: "Ready for review", done: "Done", failed: "Failed", idle: "Idle",
};
export const STATE_CUE: Record<OfficeAgentState, string> = { working: "...", "needs-you": "?", review: "R", done: "✓", failed: "!", idle: "z" };

/** Finished/idle threads stay at their desk this long after their last update. */
export const OFFICE_LINGER_MS = 6 * 60 * 60 * 1000;

const live = (t: Session) => !t.archived && t.deleted_at == null && t.status !== "archived" && t.status !== "deleted";
const hash = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

export function agentState(t: Pick<Session, "status" | "pending">): OfficeAgentState {
  const run = homeRunState(t);
  if (run === "failed") return "failed";
  if (run === "waiting") return "needs-you";
  if (run === "running") return "working";
  if (t.status === "review") return "review";
  if (t.status === "done") return "done";
  return "idle";
}

/** Threads -> agents at desks, grouped into one room per project. Pure; `now` is injectable. */
export function officeModel(sessions: readonly Session[], projects: readonly Project[], now: number = Date.now(), schedules: readonly OfficeSchedule[] = []): OfficeModel {
  const rooms: OfficeRoom[] = [];
  const known = new Set(projects.map(p => p.id));
  const byId = new Map(projects.map(p => [p.id, p] as const));
  const ids = [...projects.map(p => p.id), ...[...new Set(sessions.map(s => s.project))].filter(id => !known.has(id))];
  for (const id of ids) {
    const project = byId.get(id);
    const mine = sessions.filter(t => t.project === id && live(t)).filter(t => homeRunState(t) !== "" || now - t.updated <= OFFICE_LINGER_MS)
      .sort((a, b) => b.updated - a.updated || a.id.localeCompare(b.id));
    if (!mine.length) continue;
    const name = project?.name ?? id;
    const agents = mine.map((t, desk): OfficeAgent => {
      const state = agentState(t);
      return { id: `agent:${t.id}`, threadId: t.id, title: t.title, projectId: id, projectName: name, state, updated: t.updated, stateLabel: STATE_LABEL[state], cue: STATE_CUE[state], variant: hash(t.id) % 4, desk };
    });
    rooms.push({ projectId: id, name, color: project?.color ?? "#888", agents, needsYou: agents.filter(a => a.state === "needs-you").length });
  }
  rooms.sort((a, b) => b.needsYou - a.needsYou || b.agents[0].updated - a.agents[0].updated || a.projectId.localeCompare(b.projectId));
  const agents = rooms.flatMap(r => r.agents);
  const entries = schedules.filter(s => s.enabled).map(s => ({ id: s.id, name: s.name, projectName: byId.get(s.project)?.name ?? s.project, due: s.next_due })).sort((a, b) => a.due - b.due || a.id.localeCompare(b.id));
  const shrine = entries.length ? { entries, next: entries[0].due } : null;
  const working = agents.filter(a => a.state === "working").length, needs = agents.filter(a => a.state === "needs-you").length;
  const summary = [working ? `${working} working` : "", needs ? `${needs} need${needs === 1 ? "s" : ""} you` : ""].filter(Boolean).join(" · ") || (agents.length ? "All settled" : "Office is empty");
  return { rooms, agents, shrine, summary };
}
