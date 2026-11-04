/** Read cursors live on the Mac host (`Session.read_at`) and are shared by the desktop and the paired iPhone.
 * A cursor is the thread `updated` value the user has seen; it only ever moves forward. */
export type ReadCursors = Record<string, number>;
type Storage = Pick<globalThis.Storage, 'getItem' | 'removeItem'>;

/** Pointwise maximum of cursor maps. */
export function maxCursors(...maps: ReadCursors[]): ReadCursors {
  const out: ReadCursors = {};
  for (const map of maps) for (const [id, at] of Object.entries(map)) if (typeof at === 'number' && Number.isFinite(at) && at > (out[id] ?? -Infinity)) out[id] = at;
  return out;
}

/** Cursor map derived from the host snapshot, raised by optimistic local marks that the host has not echoed yet. */
export function readFromThreads(threads: readonly { id: string; read_at?: number | null }[], overlay: ReadCursors = {}): ReadCursors {
  const hosted: ReadCursors = {};
  for (const t of threads) if (typeof t.read_at === 'number') hosted[t.id] = t.read_at;
  return maxCursors(hosted, overlay);
}

/** One-time move of a device-local read map to the host. The key is removed only after the host accepted it. */
export async function migrateLocalRead(key: string, storage: Storage, send: (cursors: ReadCursors) => Promise<unknown>, log: (...args: unknown[]) => void = console.error): Promise<'none' | 'migrated' | 'failed'> {
  let raw: string | null;
  try { raw = storage.getItem(key); } catch (error) { log('[read-sync] cannot read local read cursors', { key, error: String(error) }); return 'failed'; }
  if (raw === null) return 'none';
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch (error) { log('[read-sync] local read cursors are not valid JSON; keeping them', { key, error: String(error) }); return 'failed'; }
  const cursors = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? maxCursors(parsed as ReadCursors) : {};
  try {
    if (Object.keys(cursors).length) await send(cursors);
    storage.removeItem(key);
    return 'migrated';
  } catch (error) {
    log('[read-sync] migration of local read cursors failed; keeping them for the next start', { key, count: Object.keys(cursors).length, error: String(error) });
    return 'failed';
  }
}
