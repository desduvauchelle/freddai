import { homeRunState } from "../desktop/home-state";
import type { Project, Session } from "../desktop/types";

export type OfficeAgentState = "working" | "needs-you" | "review" | "done" | "failed" | "idle" | "starting";
/** Where a thread's character lives: at its desk, in the coffee lounge, on a lobby bench, or on its way out via the in-tray. */
export type OfficePlace = "desk" | "lounge" | "lobby" | "tray";

/** Minimal schedule shape (a subset of the app's `Schedule`); `next_due` is epoch milliseconds. */
export type OfficeSchedule = { id: string; name: string; project: string; next_due: number; enabled: boolean };

export type OfficeAgent = {
  id: string; threadId: string; title: string; projectId: string; projectName: string; projectColor: string;
  state: OfficeAgentState; place: OfficePlace; updated: number;
  /** Human text for the state; never colour-only. */
  stateLabel: string;
  /** Short glyph shown in the speech bubble. */
  cue: string;
  /** Stable 0..3 sprite variant derived from the thread id. */
  variant: number;
  /** 1-based number shared by the character's "?" bubble and the legend; needs-you only. */
  tag: number | null;
};
export type ProjectTotals = { msgs: number; threads: number; working: number };
export type OfficeRoom = { projectId: string; name: string; color: string; totals: ProjectTotals; agents: OfficeAgent[] };
export type OfficeShrine = { entries: { id: string; name: string; projectName: string; due: number; variant: number }[]; next: number | null };
export type OfficeModel = {
  /** One room per project, in the order of the `projects` array. Never filtered or re-sorted by activity. */
  rooms: OfficeRoom[];
  /** Every character: desk (working/failed), lounge (needs-you), lobby (starting/queued) and finished threads heading for the tray. */
  agents: OfficeAgent[];
  /** Finished threads still inside the linger window, newest first; each is a folder in the in-tray. */
  tray: OfficeAgent[];
  shrine: OfficeShrine | null; summary: string;
};

export const STATE_LABEL: Record<OfficeAgentState, string> = {
  working: "Working", "needs-you": "Needs you", review: "Ready for review", done: "Done", failed: "Failed", idle: "Idle", starting: "Starting",
};
export const STATE_CUE: Record<OfficeAgentState, string> = { working: "...", "needs-you": "?", review: "R", done: "✓", failed: "!", idle: "z", starting: "…" };

/** Finished threads keep their folder in the in-tray this long after their last update. */
export const OFFICE_LINGER_MS = 6 * 60 * 60 * 1000;

const live = (t: Session) => !t.archived && t.deleted_at == null && t.status !== "archived" && t.status !== "deleted";
const hash = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

export function agentState(t: Pick<Session, "status" | "pending">): OfficeAgentState {
  if (t.pending) return "needs-you";
  const run = homeRunState(t);
  if (run === "failed") return "failed";
  if (run === "waiting") return "needs-you";
  if (t.status === "starting") return "starting";
  if (run === "running") return "working";
  if (t.status === "review") return "review";
  if (t.status === "done") return "done";
  return "idle";
}

/**
 * Scoreboard numbers per project. Counts every non-archived, non-deleted thread of the project (not just the lingering ones);
 * `msgs` is the number of user-role messages. Projects without threads still get a zeroed entry.
 */
export function projectTotals(sessions: readonly Session[], projects: readonly Project[]): Map<string, ProjectTotals> {
  const out = new Map<string, ProjectTotals>(projects.map(p => [p.id, { msgs: 0, threads: 0, working: 0 }]));
  for (const t of sessions) {
    const totals = out.get(t.project);
    if (!totals || !live(t)) continue;
    totals.threads++;
    totals.msgs += t.messages.reduce((n, m) => n + (m.role === "user" ? 1 : 0), 0);
    if (homeRunState(t) === "running") totals.working++;
  }
  return out;
}

export const totalsLabel = (t: ProjectTotals) => `${t.msgs} msg${t.msgs === 1 ? "" : "s"} · ${t.threads} thread${t.threads === 1 ? "" : "s"} · ${t.working} working`;

const PLACE: Partial<Record<OfficeAgentState, OfficePlace>> = { working: "desk", failed: "desk", "needs-you": "lounge", starting: "lobby", review: "tray", done: "tray" };

/**
 * Threads -> characters, one room per project. Pure; `now` is injectable.
 * `queued` lists thread ids that have queued runs: an otherwise settled thread with one waits in the lobby instead of leaving.
 */
export function officeModel(sessions: readonly Session[], projects: readonly Project[], now: number = Date.now(), schedules: readonly OfficeSchedule[] = [], queued: ReadonlySet<string> = new Set()): OfficeModel {
  const byId = new Map(projects.map(p => [p.id, p] as const));
  const totals = projectTotals(sessions, projects);
  const found: OfficeAgent[] = [];
  for (const t of sessions) {
    const project = byId.get(t.project);
    if (!project || !live(t)) continue;
    let state = agentState(t), label = STATE_LABEL[state] as string;
    if ((state === "review" || state === "done" || state === "idle") && queued.has(t.id)) { state = "starting"; label = "Queued"; }
    const place = PLACE[state];
    if (!place) continue;
    if (place === "tray" && now - t.updated > OFFICE_LINGER_MS) continue;
    found.push({ id: `agent:${t.id}`, threadId: t.id, title: t.title, projectId: project.id, projectName: project.name, projectColor: project.color, state, place, updated: t.updated, stateLabel: label, cue: STATE_CUE[state], variant: hash(t.id) % 4, tag: null });
  }
  // Oldest waiting thread is #1, so a number never changes when a newer one appears.
  const needs = found.filter(a => a.state === "needs-you").sort((a, b) => a.updated - b.updated || a.id.localeCompare(b.id));
  needs.forEach((a, i) => { a.tag = i + 1; });
  const agents = found.sort((a, b) => a.id.localeCompare(b.id));
  const tray = agents.filter(a => a.place === "tray").sort((a, b) => b.updated - a.updated || a.id.localeCompare(b.id));
  const rooms = projects.map((p): OfficeRoom => ({ projectId: p.id, name: p.name, color: p.color, totals: totals.get(p.id)!, agents: agents.filter(a => a.projectId === p.id && a.place === "desk") }));
  const entries = schedules.filter(s => s.enabled).map(s => ({ id: s.id, name: s.name, projectName: byId.get(s.project)?.name ?? s.project, due: s.next_due, variant: hash(s.id) % 4 })).sort((a, b) => a.due - b.due || a.id.localeCompare(b.id));
  const shrine = entries.length ? { entries, next: entries[0].due } : null;
  const working = agents.filter(a => a.state === "working").length, waiting = needs.length;
  const summary = [working ? `${working} working` : "", waiting ? `${waiting} need${waiting === 1 ? "s" : ""} you` : ""].filter(Boolean).join(" · ") || (agents.length ? "All settled" : "Office is empty");
  return { rooms, agents, tray, shrine, summary };
}
