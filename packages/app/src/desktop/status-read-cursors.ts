import type { Session } from "./types";

/** Presentation only: never write these cursors back to the host. */
export function statusReadCursors(threads: readonly Pick<Session, "id" | "status" | "updated">[], read: Record<string, number>, ignoreUnread: boolean): Record<string, number> {
  if (!ignoreUnread) return read;
  const display = { ...read };
  for (const thread of threads) {
    if (thread.status === "done") display[thread.id] = thread.updated;
    // An error needs attention regardless of whether its transcript has been viewed.
    if (thread.status === "failed") delete display[thread.id];
  }
  return display;
}
