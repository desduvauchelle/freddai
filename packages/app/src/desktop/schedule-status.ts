import { readSchedule } from "./schedule-controls";
import { scheduleEnded } from "./schedule-end";
import type { Schedule } from "./types";

export type ScheduleStatus = "active" | "paused" | "ended";
export const scheduleStatus = (s: Schedule): ScheduleStatus => scheduleEnded(s) ? "ended" : s.enabled ? "active" : "paused";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function time12(time: string) {
  const [h, m] = time.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
/** Human cadence, e.g. "Weekdays at 9:00 AM". Multiple entries (newline separated) are joined. */
export function cadenceSummary(cron: string): string {
  return cron.split("\n").filter(Boolean).map(entry => {
    const t = readSchedule(entry);
    if (t.repeat === "custom") return `Custom (${entry.trim()})`;
    const at = time12(t.time);
    if (t.repeat === "daily") return `Daily at ${at}`;
    if (t.repeat === "weekdays") return `Weekdays at ${at}`;
    if (t.repeat === "monthly") return `Monthly on day ${t.day} at ${at}`;
    const days = t.day.split(",").map(Number).sort((a, b) => a - b);
    return `${days.map(d => DAYS[d]).join(", ")} at ${at}`;
  }).join(" · ");
}

export function relativeTime(ms: number, now = Date.now()): string {
  const diff = ms - now, abs = Math.abs(diff);
  const units: [number, Intl.RelativeTimeFormatUnit][] = [[86400000, "day"], [3600000, "hour"], [60000, "minute"]];
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [size, unit] of units) if (abs >= size) return fmt.format(Math.round(diff / size), unit);
  return diff >= 0 ? "in under a minute" : "just now";
}
export function absoluteTime(ms: number, timezone?: string): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  try { return new Date(ms).toLocaleString(undefined, { ...opts, timeZone: timezone }); } catch { return new Date(ms).toLocaleString(undefined, opts); }
}
/** Next run label for an active schedule, or null when nothing is due. */
export const nextRunLabel = (s: Schedule, now = Date.now()): string | null =>
  s.next_due > 0 ? `${relativeTime(s.next_due, now)} · ${absoluteTime(s.next_due, s.timezone)}` : null;

/** Most recent run that actually started or reported a state. */
export function lastRun(s: Schedule): Schedule["runs"][number] | null {
  return s.runs.length ? [...s.runs].sort((a, b) => b.due - a.due)[0] : null;
}
export function lastRunSummary(s: Schedule, now = Date.now()): { state: string; when: string; session: string | null } | null {
  const run = lastRun(s);
  return run ? { state: run.state, when: relativeTime(run.due, now), session: run.session } : null;
}
