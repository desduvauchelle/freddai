import { useEffect, useState } from "react";
import type { Session } from "./types";

export function threadStats(sessions: Session[], now: Date) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  return {
    today: sessions.filter(t => !t.deleted_at && t.updated >= start && t.updated < end).length,
    lifetime: sessions.length,
  };
}
export function ThreadStats({ sessions }: { sessions: Session[] }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const stats = threadStats(sessions, now);
  return <div className="titlebar-thread-stats" role="group" aria-label="Thread statistics">
    <span title="Threads created or active today in your local time, counted once per thread, within the selected workspace/project. Excludes deleted threads.">{stats.today.toLocaleString()} today</span>
    <span className="titlebar-thread-stat-detail" title="All retained threads in the selected workspace/project, including archived and deleted threads. Independent of search and status filters.">{stats.lifetime.toLocaleString()} lifetime</span>
  </div>;
}
