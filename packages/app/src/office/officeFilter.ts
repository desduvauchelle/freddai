import type { Project, Session } from "../desktop/types";
import { agentState, type OfficeSchedule } from "./officeModel";

export const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const OFFICE_RECENT_ONLY_KEY = "freddai.office.recent-only.v1";

type FilterSession = Pick<Session, "id" | "project" | "status" | "pending" | "updated" | "archived" | "deleted_at"> & { last_user_message_at?: number | null; turn_started_at?: number | null };

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/**
 * Projects that deserve a room: activity in the last 7 days, an enabled schedule, or a live thread.
 * Fails open: when sessions or schedules were not provided (not loaded), every project is kept rather than hidden.
 * Keeps input order. The Commander project is never hidden.
 */
export function recentProjects<P extends Pick<Project, "id" | "kind">>(
  projects: readonly P[],
  sessions: readonly FilterSession[] | undefined,
  schedules: readonly Pick<OfficeSchedule, "project" | "enabled">[] | undefined,
  now: number,
  queuedThreadIds?: ReadonlySet<string>,
): P[] {
  if (!sessions || !schedules) return [...projects];
  const cutoff = now - RECENT_WINDOW_MS;
  const keep = new Set<string>();
  for (const s of schedules) if (s.enabled) keep.add(s.project);
  for (const t of sessions) {
    if (keep.has(t.project) || t.deleted_at != null) continue;
    const stamps = [t.updated, t.last_user_message_at, t.turn_started_at];
    if (!finite(t.updated)) { keep.add(t.project); continue; } // no usable timestamp: show, do not hide
    const live = !t.archived && (["working", "needs-you", "starting"].includes(agentState(t)) || !!queuedThreadIds?.has(t.id));
    if (live || stamps.some(v => finite(v) && v >= cutoff)) keep.add(t.project);
  }
  return projects.filter(p => p.kind === "commander" || keep.has(p.id));
}

export function readRecentOnly(storage: Pick<Storage, "getItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage): boolean {
  try { return storage?.getItem(OFFICE_RECENT_ONLY_KEY) !== "false"; } catch { return true; }
}
export function writeRecentOnly(value: boolean, storage: Pick<Storage, "setItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage) {
  try { storage?.setItem(OFFICE_RECENT_ONLY_KEY, String(value)); } catch (e) { console.warn("office.recent-only.persist-failed", e); }
}
