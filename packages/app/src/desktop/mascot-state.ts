import type { Session } from "./types";

type Read = Record<string, number>;
/** A completed reply the user has not looked at yet (same rule as the thread-list "unread" dot). */
export const isUnread = (thread: Pick<Session, "id" | "status" | "updated"> | undefined, read?: Read) =>
  !!thread && !!read && thread.status === "done" && (read[thread.id] ?? -1) < thread.updated;

export function mascotState(selected: Session | undefined, sessions: readonly Session[], read?: Read) {
  const thread = selected ?? sessions.find(s => s.pending || s.status === "waiting")
    ?? sessions.find(s => s.status === "starting" || s.status === "running");
  if (thread?.pending || thread?.status === "waiting") return { mood: 4, label: "Needs your input" };
  // Unread results make the mouse wait for you, like the unread dot in the thread list.
  if (selected && isUnread(selected, read)) return { mood: 4, label: "Waiting for you" };
  switch (thread?.status) {
    case "starting":
    case "running": return { mood: 2, label: "Working" };
    case "done": return { mood: 6, label: "Completed" };
    case "interrupted": return { mood: 7, label: "Interrupted" };
    case "failed": return { mood: 8, label: "Needs attention" };
    default: return { mood: 0, label: "Ready" };
  }
}

/** Short status chip text next to a conversation title; idle shows nothing. */
export const moodChip = (mood: number) => ({ 2: "Working…", 4: "Waiting for you", 6: "Done", 7: "Interrupted", 8: "Needs attention" } as Record<number, string>)[mood] ?? null;

/** Diameters (px) for each place the mascot appears. The titlebar keeps the compact 28px badge. */
export const MASCOT_SIZES = { header: 38, hero: 148, approval: 36 } as const;
/** Higher wins a Rive slot; the rest render static art. */
export const MASCOT_PRIORITY = { hero: 3, header: 3, titlebar: 2, approval: 1 } as const;
