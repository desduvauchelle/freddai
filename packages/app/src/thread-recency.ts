/** Older hosts omit send timestamps. Track user-message identity at snapshot ingestion,
 * never activity time, until the host can safely upgrade. Store only IDs and times. */
type Thread = { id: string; updated: number; last_user_message_at?: number | null; messages: { id: string; role: string }[] };
type Cursor = { message: string | null; sent: number };
export function createThreadRecencyTracker(storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  const key = 'freddai.thread-send-cursors.v1';
  let cursors: Record<string, Cursor> = {};
  try {
    const saved = JSON.parse(storage?.getItem(key) || '{}');
    for (const [id, cursor] of Object.entries(saved)) {
      const c = cursor as Cursor;
      if (c && (c.message === null || typeof c.message === 'string') && Number.isFinite(c.sent)) cursors[id] = c;
    }
  } catch { /* Storage is optional; retain cursors in memory. */ }
  // Snapshot reconciliation keeps unchanged threads reference-equal, so unchanged work is skipped:
  // the same input array returns the same output, and a thread whose cursor has not moved reuses its result.
  const results = new WeakMap<object, { cursor: Cursor | undefined; value: unknown }>();
  let lastInput: unknown[] | undefined, lastOutput: unknown[] | undefined;
  return <T extends Thread>(threads: T[]): T[] => {
    if (threads === lastInput) return lastOutput as T[];
    let changed = false;
    const result = threads.map(thread => {
      const cached = results.get(thread);
      if (cached && cached.cursor === cursors[thread.id]) return cached.value as T;
      let message: string | null = null;
      for (let index = thread.messages.length - 1; index >= 0; index--) {
        if (thread.messages[index].role === 'user') { message = thread.messages[index].id; break; }
      }
      const previous = cursors[thread.id];
      const sent = thread.last_user_message_at ?? (previous?.message === message ? previous.sent : thread.updated);
      if (!previous || previous.message !== message || previous.sent !== sent) {
        cursors[thread.id] = { message, sent }; changed = true;
      }
      const value = thread.last_user_message_at == null ? { ...thread, last_user_message_at: sent } : thread;
      results.set(thread, { cursor: cursors[thread.id], value });
      return value;
    });
    lastInput = threads; lastOutput = result;
    if (changed) { try { storage?.setItem(key, JSON.stringify(cursors)); } catch { /* Retain in memory. */ } }
    return result;
  };
}
export function browserThreadRecencyTracker() {
  try { return createThreadRecencyTracker(localStorage); } catch { return createThreadRecencyTracker(); }
}
