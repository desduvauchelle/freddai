import { useCallback, useEffect, useRef, useState } from 'react';
import type { NoteSummary, Proposal, Todo } from '../../desktop/commander/api';
import type { CompanionClient, CompanionCommanderState } from '../companion';

export const COMMANDER_POLL_MS = 5000;
export type CommanderData = {
  state: CompanionCommanderState | null; proposals: Proposal[]; todos: Todo[]; notes: NoteSummary[];
  /** Loud: set whenever a Mac call failed, cleared by the next success. */
  error: string; loading: boolean; refresh: () => Promise<void>;
};
const message = (e: unknown) => e instanceof Error ? e.message : String(e);

/** Polls Commander state from the paired Mac through `client.commander`. Errors are surfaced, never swallowed. */
export function useCommanderData(client: CompanionClient | undefined, enabled: boolean, options: { lists?: boolean; intervalMs?: number } = {}): CommanderData {
  const { lists = false, intervalMs = COMMANDER_POLL_MS } = options;
  const [state, setState] = useState<CompanionCommanderState | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]), [todos, setTodos] = useState<Todo[]>([]), [notes, setNotes] = useState<NoteSummary[]>([]);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const alive = useRef(true);
  const commander = client?.commander;
  const refresh = useCallback(async () => {
    if (!commander) return;
    try {
      const [s, p, t, n] = await Promise.all([commander.state(), commander.proposals(), lists ? commander.todos() : Promise.resolve(null), lists ? commander.notes() : Promise.resolve(null)]);
      if (!alive.current) return;
      setState(s); setProposals(p); if (t) setTodos(t); if (n) setNotes(n); setError('');
    } catch (e) {
      console.error('[commander] refresh failed', e);
      if (alive.current) setError(message(e));
    } finally { if (alive.current) setLoading(false); }
  }, [commander, lists]);
  useEffect(() => {
    alive.current = true;
    if (!enabled || !commander) return () => { alive.current = false; };
    setLoading(true); void refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, intervalMs);
    return () => { alive.current = false; clearInterval(timer); };
  }, [enabled, commander, refresh, intervalMs]);
  return { state, proposals, todos, notes, error, loading, refresh };
}
