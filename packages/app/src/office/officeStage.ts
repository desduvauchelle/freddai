import { useEffect, useMemo, useReducer, useRef } from "react";
import type { OfficeAgent, OfficeModel } from "./officeModel";
import type { Layout } from "./officeLayout";
import { advance, assignSlots, routeWaypoints, startCursor, type Cursor, type Nav, type Waypoint } from "./officePath";

/* Character placement and walking. `resolveDestinations` is pure; `useOfficeStage` keeps per-character state in a ref and animates it with rAF. */

export type Pose = "seated" | "stand" | "cup" | "sit";
export type Dest = { node: string; pose: Pose };
export const WALK_SPEED = 90;
export const CHECK_IN_MS = 800;
export const DROP_MS = 700;
const FRAME_MS = 150;

export type SlotMemory = { desk: Map<string, Map<string, number>>; lounge: Map<string, number>; lobby: Map<string, number> };
export const newSlotMemory = (): SlotMemory => ({ desk: new Map(), lounge: new Map(), lobby: new Map() });

export type Destinations = {
  /** Agent id -> where it belongs right now. Agents that don't fit (a fifth desk, a ninth cup) get no entry. */
  dest: Map<string, Dest>;
  /** Room index -> slot -> owning agent (a needs-you agent keeps its desk reserved while it is in the lounge). */
  owners: Map<number, Map<number, OfficeAgent>>;
  /** Room index -> agents with a desk-bound job but no free desk ("+N" on the scoreboard). */
  overflow: Map<number, number>;
  loungeExtra: number; lobbyExtra: number;
};

/** Pure: slot assignment + destination for every character. `memory` carries slots between calls so nobody swaps desks. */
export function resolveDestinations(model: OfficeModel, layout: Layout, memory: SlotMemory): Destinations {
  const dest = new Map<string, Dest>(), owners = new Map<number, Map<number, OfficeAgent>>(), overflow = new Map<number, number>();
  const roomOf = new Map(layout.rooms.map(r => [r.project.id, r] as const));
  const rank = (a: OfficeAgent) => (a.state === "failed" ? 0 : 1);
  const byProject = new Map<string, OfficeAgent[]>();
  for (const a of model.agents) if (a.place === "desk" || a.place === "lounge") (byProject.get(a.projectId) ?? byProject.set(a.projectId, []).get(a.projectId)!).push(a);
  for (const [pid, list] of byProject) {
    const room = roomOf.get(pid);
    if (!room) continue;
    const ordered = [...list].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
    const slots = assignSlots(memory.desk.get(pid) ?? new Map(), ordered.map(a => a.id), room.desks.length);
    memory.desk.set(pid, slots);
    const own = new Map<number, OfficeAgent>();
    for (const a of ordered) {
      const slot = slots.get(a.id);
      if (slot == null) { if (a.place === "desk") overflow.set(room.index, (overflow.get(room.index) ?? 0) + 1); continue; }
      own.set(slot, a);
      if (a.place === "desk") dest.set(a.id, a.state === "failed" ? { node: room.desks[slot].stand.node, pose: "stand" } : { node: room.desks[slot].seat.node, pose: "seated" });
    }
    owners.set(room.index, own);
  }
  const place = (place: "lounge" | "lobby", spots: readonly { node: string }[], mem: Map<string, number>, pose: Pose) => {
    const ids = model.agents.filter(a => a.place === place).sort((a, b) => (a.tag ?? 0) - (b.tag ?? 0) || a.id.localeCompare(b.id)).map(a => a.id);
    const slots = assignSlots(mem, ids, spots.length);
    mem.clear(); slots.forEach((v, k) => mem.set(k, v));
    for (const id of ids) { const s = slots.get(id); if (s != null) dest.set(id, { node: spots[s].node, pose }); }
    return ids.length - slots.size;
  };
  const loungeExtra = place("lounge", layout.loungeSpots, memory.lounge, "cup");
  const lobbyExtra = place("lobby", layout.benches, memory.lobby, "sit");
  return { dest, owners, overflow, loungeExtra, lobbyExtra };
}

export type Char = {
  id: string; agent: OfficeAgent; x: number; y: number;
  pose: Pose; moving: boolean; frame: 0 | 1; flip: boolean; carry: boolean;
  /** Heading for the in-tray / front door: not interactive-critical but still rendered until it leaves. */
  leaving: boolean;
};
type Phase = "go" | "toTray" | "exit";
type Walker = {
  agent: OfficeAgent; dest: Dest | null; node: string; phase: Phase;
  route: Waypoint[]; cur: Cursor; flip: boolean; moving: boolean; clock: number;
};
export type Stage = {
  chars: Char[];
  /** Agent ids whose folder is still in their hands (walking to the in-tray), so the tray doesn't show it yet. */
  carrying: Set<string>;
  destinations: Destinations;
};

type Engine = { walkers: Map<string, Walker>; nav: Nav | null; populated: boolean; memory: SlotMemory; born: number };
/** Threads already present within this window of mounting (initial data load) appear in place instead of walking in. */
export const HYDRATE_MS = 1500;

const walking = (w: Walker) => w.route.length > 0 && w.cur.next < w.route.length;
/** The node the walker is heading for (or sits at), so a re-route never backtracks through a wall. */
const headingFor = (w: Walker): string => (walking(w) ? w.route[w.cur.next].node ?? w.node : w.node);

function setRoute(w: Walker, nav: Nav, to: string, dwell: Record<string, number>, fromDoor = false) {
  const here = walking(w) ? { x: w.cur.x, y: w.cur.y } : null;
  const pts = routeWaypoints(nav, fromDoor ? "door" : headingFor(w), to, dwell);
  if (!pts) return placeAt(w, nav, to);
  if (here) pts.unshift(here);
  w.route = pts; w.cur = startCursor(pts);
  if (here) w.cur.wait = 0;
  w.node = pts[pts.length - 1].node ?? to;
}
function placeAt(w: Walker, nav: Nav, node: string) { const p = nav.nodes[node]; w.route = []; w.cur = { x: p.x, y: p.y, next: 0, wait: 0 }; w.node = node; w.moving = false; }

/** Brings walkers in line with the model. Mutates the engine; idempotent for identical inputs. */
function reconcile(e: Engine, model: OfficeModel, layout: Layout, reduced: boolean, nowMs: number): Destinations {
  const nav = layout.nav, d = resolveDestinations(model, layout, e.memory);
  const snap = e.nav !== nav, instant = reduced || snap || (!e.populated && nowMs - e.born < HYDRATE_MS);
  e.nav = nav;
  if (d.dest.size) e.populated = true;
  const agents = new Map(model.agents.map(a => [a.id, a] as const));
  for (const [id, dest] of d.dest) {
    const agent = agents.get(id)!;
    let w = e.walkers.get(id);
    if (!w) {
      w = { agent, dest, node: dest.node, phase: "go", route: [], cur: { x: 0, y: 0, next: 0, wait: 0 }, flip: false, moving: false, clock: 0 };
      e.walkers.set(id, w);
      if (instant) placeAt(w, nav, dest.node); else setRoute(w, nav, dest.node, { recep: CHECK_IN_MS }, true);
      continue;
    }
    w.agent = agent;
    if (instant) { w.dest = dest; w.phase = "go"; placeAt(w, nav, dest.node); continue; }
    if (w.dest?.node !== dest.node || w.phase !== "go") { w.phase = "go"; w.dest = dest; setRoute(w, nav, dest.node, {}); }
  }
  for (const [id, w] of [...e.walkers]) {
    if (d.dest.has(id)) continue;
    const agent = agents.get(id);
    if (agent) w.agent = agent;
    if (instant) { e.walkers.delete(id); continue; }
    if (w.phase !== "go") continue;
    w.dest = null;
    if (agent?.place === "tray") { w.phase = "toTray"; setRoute(w, nav, "tray", { tray: DROP_MS }); }
    else { w.phase = "exit"; setRoute(w, nav, "door", {}); }
  }
  return d;
}

/** Advances every walker by `dt` ms. Returns true while anything is still moving or pausing. */
function tick(e: Engine, dt: number): boolean {
  let busy = false;
  for (const [id, w] of [...e.walkers]) {
    if (!w.route.length) { w.moving = false; continue; }
    w.clock += dt;
    const step = advance(w.route, w.cur, dt, WALK_SPEED);
    w.cur = { x: step.x, y: step.y, next: step.next, wait: step.wait };
    w.moving = step.moving;
    if (step.dx) w.flip = step.dx < 0;
    if (step.done) {
      w.route = []; w.moving = false;
      if (w.phase === "toTray") { w.phase = "exit"; w.node = "tray"; setRoute(w, e.nav!, "door", {}); busy = true; continue; }
      if (w.phase === "exit") { e.walkers.delete(id); continue; }
    } else busy = true;
  }
  return busy;
}

const snapshot = (e: Engine): Stage["chars"] => [...e.walkers.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, w]) => ({
  id, agent: w.agent, x: w.cur.x, y: w.cur.y, pose: w.dest?.pose ?? "stand", moving: w.moving,
  frame: (w.moving ? Math.floor(w.clock / FRAME_MS) % 2 : 0) as 0 | 1, flip: w.flip, carry: w.phase === "toTray", leaving: w.phase !== "go",
}));

/** Characters for the current model, animated at a constant walking speed. `reduced` teleports instead of walking. */
export function useOfficeStage(model: OfficeModel, layout: Layout, reduced: boolean): Stage {
  "use no memo"; // reads and mutates a ref during render on purpose (see below); the React Compiler must not cache it
  const engine = useRef<Engine | null>(null);
  if (!engine.current) engine.current = { walkers: new Map(), nav: null, populated: false, memory: newSlotMemory(), born: performance.now() };
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const e = engine.current;
  // Reconcile during render so the first paint already has everyone in place; it only mutates the ref and is idempotent.
  const destinations = useMemo(() => reconcile(e, model, layout, reduced, performance.now()), [e, model, layout, reduced]);
  const busy = [...e.walkers.values()].some(w => w.route.length > 0);
  useEffect(() => {
    if (!busy) return;
    let raf = 0, last = performance.now();
    const frame = (t: number) => {
      const dt = Math.min(100, t - last); last = t;
      const more = tick(e, dt);
      bump();
      if (more) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [busy, e, model, layout]);
  const chars = snapshot(e);
  return { chars, carrying: new Set(chars.filter(c => c.carry).map(c => c.agent.id)), destinations };
}
