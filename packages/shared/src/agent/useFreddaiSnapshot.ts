import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { applySnapshotDelta, type SnapshotReply } from "./applySnapshotDelta";
import { reconcileSnapshot } from "./reconcileSnapshot";
import type { Database } from "./types";

export type FreddaiSnapshotOptions = {
  /** Poll period while the window is visible. */
  intervalMs?: number;
  /** Threads whose full transcript is needed. Every other session arrives as a summary
   * (`transcriptLoaded: false`, no tool/reasoning messages), so callers must not read their messages. */
  openThreads?: readonly string[];
};

const NONE: readonly string[] = [];
const EMPTY = { sessions: [] } as unknown as Database;

/** Polls the Freddai host with incremental `snapshot_since` (the same cursor protocol DesktopApp uses), so
 * only changed sessions travel and only `openThreads` carry transcripts. Polls never overlap, a reply is
 * dropped if the scope changed while it was in flight, and errors are surfaced as strings, never swallowed. */
export function useFreddaiSnapshot(options: FreddaiSnapshotOptions = {}): { db: Database | null; error: string | null; refresh: () => Promise<void> } {
  const { intervalMs = 3000, openThreads = NONE } = options;
  const [db, setDb] = useState<Database | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  const raw = useRef<Database | null>(null);
  const scopeKey = JSON.stringify([...new Set(openThreads)].sort());
  const scope = useRef<string>(scopeKey);
  scope.current = scopeKey;
  // Revision/host the next `snapshot_since` is relative to, and a tail so calls run one at a time.
  const cursor = useRef<{ revision: number; hostId: string | null; scope?: string; tail: Promise<unknown>; inflight: number }>({ revision: 0, hostId: null, tail: Promise.resolve(), inflight: 0 });

  const refresh = useCallback(() => {
    const c = cursor.current;
    const reset = () => { c.revision = 0; c.hostId = null; };
    const run = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const key = scope.current;
        if (c.scope !== key) { reset(); c.scope = key; }
        const reply = await invoke<SnapshotReply>("snapshot_since", { revision: c.revision, hostId: c.hostId, openThreads: JSON.parse(key) as string[] });
        if (!live.current) return;
        if (scope.current !== key) continue; // the open threads changed while this was in flight
        // A different host (restart/upgrade) answers in full; a partial reply from another host cannot be merged.
        if (c.hostId !== null && reply.hostId !== c.hostId && !reply.full) { reset(); continue; }
        const next = applySnapshotDelta(raw.current ?? EMPTY, reply);
        if (!next) { reset(); continue; } // inconsistent delta: ask for a full snapshot
        c.revision = reply.revision;
        c.hostId = reply.hostId;
        if (!reply.unchanged || !raw.current) {
          const merged = raw.current ? reconcileSnapshot(raw.current, next) : next;
          raw.current = merged;
          setDb(merged);
        }
        setError(null);
        return;
      }
      throw new Error("Freddai snapshot is out of sync with the host");
    };
    const guarded = async () => {
      c.inflight++;
      try { await run(); } catch (e) { if (live.current) setError(e instanceof Error ? e.message : String(e)); } finally { c.inflight--; }
    };
    const result = c.tail.then(guarded, guarded);
    c.tail = result;
    return result;
  }, []);

  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  // Fetch immediately on mount and whenever the open threads change.
  useEffect(() => { void refresh(); }, [refresh, scopeKey]);

  useEffect(() => {
    // Only poll while the window is visible; catch up as soon as it becomes visible again.
    // Skip a tick while a previous call is still in flight.
    const timer = setInterval(() => { if (document.visibilityState !== "hidden" && cursor.current.inflight === 0) void refresh(); }, intervalMs);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh, intervalMs]);

  return { db, error, refresh };
}
