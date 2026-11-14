import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Database } from "@freddai/shared/agent/types";

type Register = (thread: string) => () => void;

/** Lets each mounted chat (side chat, item thread) tell the shell which Freddai thread it shows, so the
 * snapshot only carries those transcripts. Without a provider registration is a no-op. */
export const OpenThreadsContext = createContext<Register | null>(null);

/** Shell side: the sorted, de-duplicated threads currently registered, and the register function to provide. */
export function useOpenThreadRegistry(): [string[], Register] {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const register = useCallback<Register>(thread => {
    setCounts(c => ({ ...c, [thread]: (c[thread] ?? 0) + 1 }));
    return () => setCounts(c => {
      const { [thread]: n = 0, ...rest } = c;
      return n > 1 ? { ...rest, [thread]: n - 1 } : rest;
    });
  }, []);
  const threads = useMemo(() => Object.keys(counts).sort(), [counts]);
  return [threads, register];
}

/** Chat side: keep `thread`'s transcript in the snapshot while mounted. */
export function useOpenThread(thread: string | null | undefined) {
  const register = useContext(OpenThreadsContext);
  useEffect(() => (thread && register ? register(thread) : undefined), [thread, register]);
}

/** The latest Freddai snapshot error, so notices can tell "still loading" from "failed". */
export const FreddaiErrorContext = createContext<string | null>(null);

export const FREDDAI_LOADING_GRACE_MS = 3000;

/** Nothing while Freddai data is present or in its first seconds of loading; the real error text when the
 * snapshot failed; a neutral "still connecting" line if loading drags on without an error. */
export function FreddaiStatusNote({ db, className = "sc-muted" }: { db: Database | null; className?: string }) {
  const error = useContext(FreddaiErrorContext);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (db) return;
    const timer = setTimeout(() => setSlow(true), FREDDAI_LOADING_GRACE_MS);
    return () => clearTimeout(timer);
  }, [db]);
  if (db) return null;
  if (error) return <p className={className} role="alert">Freddai is not reachable: {error}</p>;
  if (slow) return <p className={className} role="status">Connecting to Freddai…</p>;
  return null;
}
