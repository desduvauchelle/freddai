import type { Session } from "./types";

/** Desktop twin of the mobile `nativeRunState`: a pending decision wins over the reported status. */
export function homeRunState(thread: Pick<Session, "status" | "pending">): "running" | "waiting" | "failed" | "" {
  if (thread.status === "failed") return "failed";
  if (thread.pending || thread.status === "waiting") return "waiting";
  if (thread.status === "running" || thread.status === "starting") return "running";
  return "";
}
