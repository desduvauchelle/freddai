/** Structural sharing for host snapshots. The host sends a fresh JSON tree every poll; React and the
 * React Compiler compare by identity, so an unchanged session, message or project must keep the
 * object it had last time. `reconcileSnapshot(prev, next)` returns `prev` itself when the two are
 * deep-equal, otherwise a new tree that reuses every unchanged subtree of `prev`.
 * Arrays whose items carry a string `id` (sessions, messages, projects, accounts, ...) are matched by id,
 * so inserting or removing one entry does not defeat reuse of the others. */
type Item = { id: string };
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasId = (value: unknown): value is Item => isObject(value) && typeof value.id === 'string';

function reconcileArray(prev: unknown[], next: unknown[]): unknown[] {
  let same = prev.length === next.length;
  let byId: Map<string, unknown> | undefined;
  const lookup = (id: string) => {
    if (!byId) { byId = new Map(); for (const item of prev) if (hasId(item) && !byId.has(item.id)) byId.set(item.id, item); }
    return byId.get(id);
  };
  const result = next.map((item, index) => {
    const positional = prev[index];
    // Fast path: same id at the same position. Otherwise look the id up in the previous array.
    const match = hasId(item) && !(hasId(positional) && positional.id === item.id) ? lookup(item.id) : positional;
    const merged = reconcile(match, item);
    if (merged !== positional) same = false;
    return merged;
  });
  return same ? prev : result;
}

function reconcileObject(prev: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(next);
  let same = keys.length === Object.keys(prev).length;
  const entries: [string, unknown][] = keys.map(key => {
    const had = Object.prototype.hasOwnProperty.call(prev, key);
    const merged = reconcile(had ? prev[key] : undefined, next[key]);
    if (!had || merged !== prev[key]) same = false;
    return [key, merged];
  });
  return same ? prev : Object.fromEntries(entries);
}

function reconcile(prev: unknown, next: unknown): unknown {
  if (Object.is(prev, next)) return prev;
  if (Array.isArray(prev) && Array.isArray(next)) return reconcileArray(prev, next);
  if (isObject(prev) && isObject(next)) return reconcileObject(prev, next);
  return next;
}

export function reconcileSnapshot<T>(prev: T, next: T): T {
  return reconcile(prev, next) as T;
}
