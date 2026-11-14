/** Clock shrine helpers for the Campus (pure, no DOM). Same semantics as the Classic office's shrine. */
import type { OfficeSchedule } from "../office/officeModel";

export type SceneSchedule = OfficeSchedule;

/** Enabled schedules in due-time order (ties by id), as the Classic shrine lists them. */
export function shrineEntries(schedules: readonly SceneSchedule[] = []): SceneSchedule[] {
  return schedules.filter(s => s.enabled).sort((a, b) => a.next_due - b.next_due || a.id.localeCompare(b.id));
}

/** The next enabled schedule (earliest `next_due`), or null when none are enabled. */
export function nextDueSchedule(schedules: readonly SceneSchedule[] = []): SceneSchedule | null {
  return shrineEntries(schedules)[0] ?? null;
}

/** "6 scheduled · +2 more" (only four admirers fit around the clock); empty string when nothing is scheduled. */
export function shrineCountLabel(count: number): string {
  if (count <= 0) return "";
  return `${count} scheduled${count > 4 ? ` · +${count - 4} more` : ""}`;
}

/** "3:05 PM" today, otherwise "Fri 3:05 PM". */
export function dueLabel(due: number, now: number): string {
  const d = new Date(due), t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return new Date(now).toDateString() === d.toDateString() ? t : `${d.toLocaleDateString([], { weekday: "short" })} ${t}`;
}

/** Hour and minute hand angles (radians, clockwise from 12) for a local time. */
export function clockHands(time: number): { hour: number; minute: number } {
  const d = new Date(time), m = d.getMinutes() + d.getSeconds() / 60, h = (d.getHours() % 12) + m / 60;
  return { hour: (h / 12) * Math.PI * 2, minute: (m / 60) * Math.PI * 2 };
}
