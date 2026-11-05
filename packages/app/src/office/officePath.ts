/* Pure walking helpers: a waypoint graph, shortest routes through it, constant-speed stepping along a route and stable slot assignment. */

export type Point = { x: number; y: number };
/** Named points joined by axis-aligned edges that only run through doorways and open floor, so any route avoids the walls. */
export type Nav = { nodes: Record<string, Point>; adj: Record<string, string[]> };
export type Waypoint = Point & { node?: string; dwell?: number };

export function makeNav(nodes: Record<string, Point>, edges: readonly (readonly [string, string])[]): Nav {
  const adj: Record<string, string[]> = {};
  for (const k of Object.keys(nodes)) adj[k] = [];
  for (const [a, b] of edges) {
    if (!nodes[a] || !nodes[b]) throw new Error(`Unknown nav node in edge ${a} - ${b}`);
    adj[a].push(b); adj[b].push(a);
  }
  return { nodes, adj };
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Dijkstra over the graph; returns node names from `from` to `to` inclusive, or null when unreachable or unknown. */
export function planRoute(nav: Nav, from: string, to: string): string[] | null {
  if (!nav.nodes[from] || !nav.nodes[to]) return null;
  const best = new Map<string, number>([[from, 0]]), prev = new Map<string, string>(), todo = new Set<string>([from]);
  while (todo.size) {
    let cur = "", d = Infinity;
    for (const n of todo) { const v = best.get(n)!; if (v < d || (v === d && n < cur)) { cur = n; d = v; } }
    todo.delete(cur);
    if (cur === to) break;
    for (const n of nav.adj[cur]) {
      const nd = d + dist(nav.nodes[cur], nav.nodes[n]);
      if (nd < (best.get(n) ?? Infinity)) { best.set(n, nd); prev.set(n, cur); todo.add(n); }
    }
  }
  if (!best.has(to)) return null;
  const out = [to];
  while (out[0] !== from) out.unshift(prev.get(out[0])!);
  return out;
}

/** Route as waypoints (starting at `from`). `dwell` maps a node name to a pause in ms when the walker reaches it. */
export function routeWaypoints(nav: Nav, from: string, to: string, dwell: Readonly<Record<string, number>> = {}): Waypoint[] | null {
  const names = planRoute(nav, from, to);
  return names && names.map(n => ({ ...nav.nodes[n], node: n, dwell: dwell[n] }));
}

export function routeLength(pts: readonly Point[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += dist(pts[i - 1], pts[i]);
  return n;
}

export type Cursor = { x: number; y: number; /** index of the waypoint being walked to */ next: number; /** remaining pause in ms */ wait: number };
export type Step = Cursor & { moving: boolean; /** -1 / 0 / 1: horizontal facing of the last movement */ dx: number; done: boolean };

export const startCursor = (pts: readonly Waypoint[]): Cursor => ({ x: pts[0].x, y: pts[0].y, next: 1, wait: pts[0].dwell ?? 0 });

/** Moves a cursor `dtMs` along `pts` at `speed` logical px/s, honouring dwell pauses. Deterministic and side-effect free. */
export function advance(pts: readonly Waypoint[], cur: Cursor, dtMs: number, speed: number): Step {
  let { x, y, next, wait } = cur, left = Math.max(0, dtMs), moving = false, dx = 0;
  while (left > 0) {
    if (wait > 0) { const used = Math.min(wait, left); wait -= used; left -= used; continue; }
    if (next >= pts.length) break;
    const t = pts[next], d = Math.hypot(t.x - x, t.y - y), reach = (speed * left) / 1000;
    if (t.x !== x) dx = Math.sign(t.x - x);
    moving = true;
    if (reach >= d) { left -= (d / speed) * 1000; x = t.x; y = t.y; wait = t.dwell ?? 0; next++; }
    else { x += ((t.x - x) / d) * reach; y += ((t.y - y) / d) * reach; left = 0; }
  }
  return { x, y, next, wait, moving, dx, done: next >= pts.length && wait <= 0 };
}

/**
 * Stable slot assignment: ids that already hold a slot keep it, new ids take the lowest free slot in `ids` order,
 * and ids that don't fit (or are gone) hold none. Used so a character always returns to its own desk.
 */
export function assignSlots(prev: ReadonlyMap<string, number>, ids: readonly string[], capacity: number): Map<string, number> {
  const out = new Map<string, number>(), used = new Set<number>();
  for (const id of ids) { const s = prev.get(id); if (s != null && s < capacity && !used.has(s)) { out.set(id, s); used.add(s); } }
  for (const id of ids) {
    if (out.has(id)) continue;
    let s = 0;
    while (s < capacity && used.has(s)) s++;
    if (s < capacity) { out.set(id, s); used.add(s); }
  }
  return out;
}
