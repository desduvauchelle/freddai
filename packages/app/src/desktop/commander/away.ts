import type { Project } from "../types";
import type { Proposal, Todo } from "./api";
import type { ToolsTab } from "./CommanderTools";

export const AWAY_MS = 10 * 60_000;
export const LAST_VISIT_KEY = "freddai.commander.lastVisit";
export type AwayCard = { id: string; kind: "finished" | "waiting" | "next"; title: string; detail: string; tab?: ToolsTab; thread?: string | null };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Reads the previous visit and stamps the current one. Returns the gap in ms, or null when there was no earlier visit. */
export function recordVisit(now = Date.now(), storage: Pick<Storage, "getItem" | "setItem"> = localStorage): number | null {
  let previous: number | null = null;
  try {
    const raw = Number(storage.getItem(LAST_VISIT_KEY));
    previous = Number.isFinite(raw) && raw > 0 ? raw : null;
    storage.setItem(LAST_VISIT_KEY, String(now));
  } catch (e) { console.error("[commander] couldn't read/write last visit", e); }
  return previous === null ? null : now - previous;
}

/** At most 3 cards (one per kind): what finished, what is waiting on the user, what is next. */
export function awayCards(todos: readonly Todo[], proposals: readonly Proposal[], projects: readonly Project[], since: number): AwayCard[] {
  const name = (id: string | null) => projects.find(p => p.id === id)?.name;
  const cards: AwayCard[] = [];
  const finished = todos.filter(t => t.status === "done" && Date.parse(t.updated_at) >= since).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  if (finished.length) cards.push({ id: "finished", kind: "finished", title: `${plural(finished.length, "task")} finished`, detail: [finished[0].title, name(finished[0].project)].filter(Boolean).join(" · "), tab: "todos", thread: finished.length === 1 ? finished[0].thread : null });
  const pending = proposals.filter(p => p.status === "pending"), review = todos.filter(t => t.status === "needs_review");
  const waiting = pending.length + review.length;
  if (waiting) cards.push({ id: "waiting", kind: "waiting", title: `${waiting} waiting on you`, detail: pending[0]?.summary ?? review[0]?.title ?? "", tab: "waiting" });
  const next = todos.filter(t => t.status === "open" || t.status === "in_progress")
    .sort((a, b) => (a.due ? Date.parse(a.due) : Infinity) - (b.due ? Date.parse(b.due) : Infinity))[0];
  if (next) cards.push({ id: "next", kind: "next", title: "Up next", detail: [next.title, name(next.project)].filter(Boolean).join(" · "), tab: "todos", thread: next.thread });
  return cards.slice(0, 3);
}

/** Compact "away 2 days" label for the welcome strip. */
export function awayGap(gapMs: number): string {
  const mins = Math.round(gapMs / 60_000);
  if (mins < 60) return `away ${plural(mins, "minute")}`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `away ${plural(hours, "hour")}` : `away ${plural(Math.round(hours / 24), "day")}`;
}
