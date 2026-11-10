import { dotClass } from "./interrupted";

export function labelStatus(s: string) {
  return (
    (
      {
        done: "Completed",
        unread: "Unread reply",
        waiting: "Needs you",
        failed: "Failed",
        interrupted: "Interrupted",
        running: "Running",
        starting: "Starting",
      } as Record<string, string>
    )[s] || s
  );
}
export function Dot({ status }: { status: string }) {
  return (
    <span
      role="img"
      aria-label={labelStatus(status)}
      title={labelStatus(status)}
      className={`state-dot state-${dotClass(status)}`}
    />
  );
}
