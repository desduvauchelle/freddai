import { bucketThreads, compareThreadRecency, type Session } from './desktop/types';

type ProjectThread = Pick<Session, 'id' | 'status' | 'updated' | 'last_user_message_at'> & { pinned?: boolean; pending?: unknown };

/** Dashboard project panels follow navigation priority, before paging, with one row per id. */
export function orderProjectThreads<T extends ProjectThread>(threads: readonly T[], read: Record<string, number>, queued: (thread: T) => number = () => 0): T[] {
  const unique = [...new Map(threads.map(t => [t.id, t])).values()].sort(compareThreadRecency);
  const { active, older } = bucketThreads(unique, { read, selected: '', recentCount: 0, scope: 'flat', hideRead: true, filter: 'all', queued });
  return [...active, ...older];
}
