import { useCallback, useEffect, useRef, useState } from "react";
import { commanderApi, type CommanderState, type Proposal, type Todo } from "./api";

export const POLL_MS = 3000;
export type CommanderData = {
  state: CommanderState | null; proposals: Proposal[]; todos: Todo[];
  /** Loud: the last refresh failure, or "" when healthy. */
  error: string; loaded: boolean; refresh: () => Promise<void>;
};

/** Polls commander state, proposals and to-dos every 3s while mounted. Failures set `error` (never swallowed) and clear on the next success. */
export function useCommander({ todos: wantTodos = true, interval = POLL_MS }: { todos?: boolean; interval?: number } = {}): CommanderData {
  const [state, setState] = useState<CommanderState | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [error, setError] = useState(""), [loaded, setLoaded] = useState(false);
  const alive = useRef(true), busy = useRef(false);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const [s, p, t] = await Promise.all([commanderApi.state(), commanderApi.proposals(), wantTodos ? commanderApi.todos() : Promise.resolve(null)]);
      if (!alive.current) return;
      setState(s); setProposals(p); if (t) setTodos(t); setError("");
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      console.error("[commander] refresh failed", text);
      if (alive.current) setError(text);
    } finally { busy.current = false; if (alive.current) setLoaded(true); }
  }, [wantTodos]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), interval);
    return () => { alive.current = false; clearInterval(timer); };
  }, [refresh, interval]);
  return { state, proposals, todos, error, loaded, refresh };
}
