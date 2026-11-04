import type { Session } from "./types";

/** Sidebar dot class for a thread status. Interrupted is red: the turn was cut off and needs the user. */
export function dotClass(status: string): string {
  if (status === "failed") return "Failed";
  if (status === "interrupted") return "Interrupted";
  if (status === "done") return "Done";
  if (status === "running" || status === "starting") return "In-progress";
  if (status === "unread" || status === "waiting") return "Needs-you";
  return "Next";
}

/** Interrupted threads that can still be resumed from the global banner. */
export function interruptedThreads<T extends Pick<Session, "status" | "archived" | "deleted_at">>(sessions: T[] | undefined): T[] {
  return (sessions ?? []).filter(s => s.status === "interrupted" && !s.archived && s.deleted_at == null);
}

export function interruptedBannerText(count: number): string {
  return `${count} ${count === 1 ? "thread was" : "threads were"} interrupted.`;
}

export type ResumeFailure = { id: string; error: string };

/** Resume each thread independently; one failure never stops the rest and is always reported. */
export async function resumeAll(
  threads: { id: string }[],
  resume: (thread: any) => Promise<void>,
  log: (event: Record<string, unknown>) => void = e => console.info(JSON.stringify(e)),
): Promise<{ resumed: number; failures: ResumeFailure[] }> {
  const failures: ResumeFailure[] = [];
  for (const thread of threads) {
    try { await resume(thread); } catch (e) { failures.push({ id: thread.id, error: String(e) }); }
  }
  const resumed = threads.length - failures.length;
  log({ event: "resume_all", count: threads.length, resumed, failed: failures.length });
  for (const f of failures) log({ event: "resume_all.failed", thread: f.id, error: f.error });
  return { resumed, failures };
}

export function resumeFailureMessage(failures: ResumeFailure[]): string {
  return failures.length ? `Could not resume ${failures.length} thread${failures.length === 1 ? "" : "s"}: ${failures.map(f => f.error).join("; ")}` : "";
}
