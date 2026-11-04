import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "./types";

/** Keep departing rows just long enough to fade and close their space. */
export function ThreadList({ threads, renderRow }: {
  threads: Session[];
  renderRow: (thread: Session) => ReactNode;
}) {
  const signature = JSON.stringify(threads.map(t => t.id));
  const [presence, setPresence] = useState({ signature, rows: threads });
  if (presence.signature !== signature) {
    const rows = [...threads];
    // Retain the old position while the rest of the list closes the gap.
    presence.rows.forEach((thread, index) => {
      if (!threads.some(t => t.id === thread.id)) rows.splice(index, 0, thread);
    });
    setPresence({ signature, rows });
  }
  // Rows that appear after the first render slide/fade in; the initial list and re-orderings do not animate.
  const seen = useRef<Set<string> | null>(null);
  const prior = seen.current;
  useEffect(() => { seen.current = new Set(threads.map(t => t.id)); });
  const current = new Map(threads.map(t => [t.id, t]));
  const departing = JSON.stringify(presence.rows.filter(t => !current.has(t.id)).map(t => t.id));
  useEffect(() => {
    const ids = new Set<string>(JSON.parse(departing));
    if (!ids.size) return;
    // Also clean up when animations are disabled or the webview is backgrounded.
    const timer = window.setTimeout(() => setPresence(previous => ({
      ...previous, rows: previous.rows.filter(t => !ids.has(t.id)),
    })), 240);
    return () => window.clearTimeout(timer);
  }, [departing]);

  return presence.rows.map(thread => {
    const leaving = !current.has(thread.id);
    return <div key={thread.id} className={`thread-presence${leaving ? " thread-departing" : ""}${prior && !prior.has(thread.id) && !leaving ? " thread-arriving" : ""}`}
      inert={leaving} aria-hidden={leaving || undefined}>
      <div className="thread-presence-content">{renderRow(current.get(thread.id) ?? thread)}</div>
    </div>;
  });
}
