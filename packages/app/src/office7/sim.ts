/**
 * Office v7 "Campus": per-agent state machine. Pure (no DOM, no canvas) so it can be tested directly.
 *
 *   idle (field) -> walking-to-office -> at-desk -> walking-to-hq -> handover -> walking-to-field -> idle
 *   needs-you / review: walking-to-office -> at-door (stands at the door and waves)
 *
 * Session status (via OfficeAgent.state) drives the targets; movement follows a small walkway graph at a calm pace.
 */
import type { OfficeAgent } from "../office/officeModel";
import { CELL_W, FOOT, HQ, deskCount, deskSlots, type CampusLayout, type Pt } from "./layout";

export type Phase = "idle" | "walking-to-office" | "at-desk" | "at-door" | "walking-to-hq" | "handover" | "walking-to-field";
export type Target = "desk" | "door" | "hq" | "field";
export type SimProject = { id: string; agents: readonly OfficeAgent[] };
type IdleMode = "sit" | "kick" | "wander";
type Way = { p: Pt; node?: string };

export type Actor = {
  id: string; agent: OfficeAgent; projectId: string; cell: number;
  phase: Phase; target: Target; state: OfficeAgent["state"];
  x: number; y: number; face: number; walking: boolean;
  /** Seat index in the project's building, -1 when there is no free desk (not drawn). */
  seat: number; slot: number;
  /** Carries a document (walking to / at the boss). */
  doc: boolean; outcome: "done" | "failed" | null;
  /** Seconds the post-handover tick is still shown. */
  stamp: number; timer: number; delivered: boolean;
  mode: IdleMode; wait: number;
  path: Way[]; speed: number; seed: number; hidden: boolean;
};

export const WALK_SPEED = 1.25;
export const HANDOVER_SECS = 2.2;
const DOOR_OFFS = [1.7, -1.7, 3.1, -3.1, 0];
const HQ_OFFS = [0, -1.6, 1.6, -3.2, 3.2];
export const hash32 = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

type GNode = { p: Pt; adj: string[] };
type Graph = Map<string, GNode>;

function buildGraph(l: CampusLayout): Graph {
  const g: Graph = new Map();
  const add = (id: string, p: Pt) => { if (!g.has(id)) g.set(id, { p, adj: [] }); };
  const link = (a: string, b: string) => { if (a === b) return; const A = g.get(a)!, B = g.get(b)!; if (!A.adj.includes(b)) A.adj.push(b); if (!B.adj.includes(a)) B.adj.push(a); };
  const chain = (ids: string[], axis: 0 | 1) => { const s = [...ids].sort((a, b) => g.get(a)!.p[axis] - g.get(b)!.p[axis]); for (let i = 1; i < s.length; i++) link(s[i - 1]!, s[i]!); };
  const lastRow = l.rows - 1;
  const ys = l.avenueYs;
  const rowIds: string[][] = ys.map(() => []);
  // vertical avenues at cell boundaries
  for (let r = 0; r < ys.length; r++) for (let k = 0; k <= l.cols; k++) { const id = `v:${k}:${r}`; add(id, [k * CELL_W, ys[r]!]); rowIds[r]!.push(id); }
  for (let k = 0; k <= l.cols; k++) for (let r = 1; r < ys.length; r++) link(`v:${k}:${r - 1}`, `v:${k}:${r}`);
  // doors and yards
  for (const c of l.cells) {
    const cx = c.ox + (FOOT.x0 + FOOT.x1) / 2;
    add(`y:${c.index}`, [cx, ys[c.row]!]); rowIds[c.row]!.push(`y:${c.index}`);
    add(`d:${c.index}`, [cx, c.oy + FOOT.y1 + 0.35]); link(`y:${c.index}`, `d:${c.index}`);
  }
  // corridors
  const cors = [["l", l.corridor.l], ["r", l.corridor.r]] as const;
  for (const [s, x] of cors) { add(`cb:${s}`, [x, ys[lastRow]!]); rowIds[lastRow]!.push(`cb:${s}`); }
  for (let r = 0; r < ys.length; r++) chain(rowIds[r]!, 0);
  const fy = l.field.ball.y0 + 1.2;
  for (const [s, x] of cors) {
    add(`cf:${s}`, [x, l.hq.front]); add(`ff:${s}`, [x, fy]);
    chain([`cb:${s}`, `cf:${s}`, `ff:${s}`], 1);
  }
  add("hf", [l.cx, l.hq.front]); add("hd", [l.cx, l.hq.doorY + 0.25]);
  chain(["cf:l", "hf", "cf:r"], 0); link("hf", "hd");
  return g;
}

function dijkstra(g: Graph, from: string, to: string): string[] {
  if (from === to) return [from];
  const dist = new Map<string, number>([[from, 0]]), prev = new Map<string, string>(), done = new Set<string>();
  while (true) {
    let cur: string | null = null, best = Infinity;
    for (const [id, d] of dist) if (!done.has(id) && d < best) { best = d; cur = id; }
    if (cur == null) return [from];
    if (cur === to) break;
    done.add(cur);
    const A = g.get(cur)!;
    for (const nb of A.adj) {
      const B = g.get(nb)!, nd = best + Math.hypot(A.p[0] - B.p[0], A.p[1] - B.p[1]);
      if (nd < (dist.get(nb) ?? Infinity)) { dist.set(nb, nd); prev.set(nb, cur); }
    }
  }
  const out = [to];
  while (out[0] !== from) out.unshift(prev.get(out[0]!)!);
  return out;
}

function nearestNode(g: Graph, x: number, y: number): string {
  let best = "", bd = Infinity;
  for (const [id, n] of g) { const d = Math.hypot(n.p[0] - x, n.p[1] - y); if (d < bd) { bd = d; best = id; } }
  return best;
}

export class CampusSim {
  actors = new Map<string, Actor>();
  private layout: CampusLayout | null = null;
  private graph: Graph = new Map();
  private key = "";
  private primed = false;
  private known = new Set<string>();
  private seats = new Map<string, (string | null)[]>();
  private doorSlots = new Map<string, (string | null)[]>();
  private hqSlots: (string | null)[] = [null, null, null, null, null];
  private bench: (string | null)[] = [null, null, null, null];
  private kick: (string | null)[] = [null, null];
  private cellOf = new Map<string, number>();
  private nDesks = new Map<string, number>();

  get(id: string): Actor | undefined { return this.actors.get(id); }
  /** Who sits at seat `i` of project `pid`'s building. */
  seatOwner(pid: string, i: number): Actor | null { const id = this.seats.get(pid)?.[i]; return (id && this.actors.get(id)) || null; }
  /** True when both kick spots are manned by arrived players. */
  kickPair(): [Actor, Actor] | null {
    const [a, b] = this.kick.map(id => (id ? this.actors.get(id) : undefined));
    return a && b && !a.walking && !b.walking && a.phase === "idle" && b.phase === "idle" ? [a, b] : null;
  }

  private rnd(a: Actor) { let x = a.seed || 1; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; a.seed = x; return x / 4294967296; }

  private desire(a: Actor): Target {
    switch (a.state) {
      case "working": case "starting": return "desk";
      case "needs-you": case "review": return "door";
      case "done": case "failed": return a.delivered ? "field" : "hq";
      default: return "field";
    }
  }

  /* ---- slot bookkeeping ---- */
  private claim(list: (string | null)[], id: string, preferred = -1): number {
    const at = list.indexOf(id);
    if (at >= 0) return at;
    if (preferred >= 0 && list[preferred] == null) { list[preferred] = id; return preferred; }
    const free = list.indexOf(null);
    if (free >= 0) { list[free] = id; return free; }
    return -1;
  }
  private release(a: Actor) {
    const s = this.seats.get(a.projectId); if (s) { const i = s.indexOf(a.id); if (i >= 0) s[i] = null; }
    const d = this.doorSlots.get(a.projectId); if (d) { const i = d.indexOf(a.id); if (i >= 0) d[i] = null; }
    for (const list of [this.hqSlots, this.bench, this.kick]) { const i = list.indexOf(a.id); if (i >= 0) list[i] = null; }
    a.seat = -1; a.slot = -1;
  }

  /* ---- geometry helpers ---- */
  private cellOfActor(a: Actor) { return this.layout!.cells[a.cell]!; }
  private doorPos(a: Actor): Pt { const c = this.cellOfActor(a); return [c.ox + (FOOT.x0 + FOOT.x1) / 2, c.oy + FOOT.y1 + 0.35]; }
  private seatSlot(a: Actor) { const c = this.cellOfActor(a); return deskSlots(c, this.nDesks.get(a.projectId) ?? 2)[a.seat]; }
  private standPos(a: Actor): Pt { const c = this.cellOfActor(a); return [c.ox + (FOOT.x0 + FOOT.x1) / 2 + DOOR_OFFS[Math.max(0, a.slot) % DOOR_OFFS.length]!, c.oy + FOOT.y1 + 1.0]; }
  private hqSpot(a: Actor): Pt { const h = this.layout!.hq; return [h.cx + HQ_OFFS[Math.max(0, a.slot) % HQ_OFFS.length]!, h.y0 + 3.3]; }
  private benchSeat(i: number): Pt { const b = this.layout!.field.benches[i >> 1]!; return [b[0] + (i & 1 ? 0.55 : -0.55), b[1]]; }
  private lawnPoint(a: Actor): Pt {
    const f = this.layout!.field, r = (hash32(a.id) & 1) === 0 ? f.ball : f.picnic;
    return [r.x0 + 1 + this.rnd(a) * Math.max(0.5, r.x1 - r.x0 - 2), r.y0 + 2 + this.rnd(a) * Math.max(0.5, r.y1 - r.y0 - 3)];
  }
  private pickFieldSpot(a: Actor): Pt {
    this.release(a);
    const pref = a.seed % 3;
    const order: IdleMode[] = pref === 0 ? ["sit", "kick", "wander"] : pref === 1 ? ["kick", "sit", "wander"] : ["wander", "sit", "kick"];
    for (const m of order) {
      if (m === "sit") { const i = this.claim(this.bench, a.id); if (i >= 0) { a.mode = "sit"; return this.benchSeat(i); } }
      else if (m === "kick") { const i = this.claim(this.kick, a.id); if (i >= 0) { a.mode = "kick"; return this.layout!.field.kick[i]!; } }
      else { a.mode = "wander"; a.wait = 1 + this.rnd(a) * 3; return this.lawnPoint(a); }
    }
    a.mode = "wander"; return this.lawnPoint(a);
  }

  /* ---- routing ---- */
  private exitWays(a: Actor): { ways: Way[]; node: string } {
    const l = this.layout!, g = this.graph;
    if (a.walking && a.path.length && a.phase !== "idle") {
      const i = a.path.findIndex(w => w.node);
      if (i >= 0) return { ways: a.path.slice(0, i + 1), node: a.path[i]!.node! };
      const n = nearestNode(g, a.x, a.y);
      return { ways: [{ p: g.get(n)!.p, node: n }], node: n };
    }
    if (a.phase === "at-desk" && a.seat >= 0) {
      const s = this.seatSlot(a), c = this.cellOfActor(a);
      if (s) return { ways: [{ p: [s.gapX, s.seat.y] }, { p: [s.gapX, c.oy + FOOT.y1 - 0.2] }, { p: this.doorPos(a), node: `d:${a.cell}` }], node: `d:${a.cell}` };
    }
    if (a.phase === "at-desk" || a.phase === "at-door") return { ways: [{ p: this.doorPos(a), node: `d:${a.cell}` }], node: `d:${a.cell}` };
    if (a.phase === "handover") return { ways: [{ p: [l.hq.cx, l.hq.y1 - 0.6] }, { p: g.get("hd")!.p, node: "hd" }], node: "hd" };
    // in the field
    const side = a.x < l.cx ? "l" : "r", cor = side === "l" ? l.corridor.l : l.corridor.r;
    return { ways: [{ p: [cor, a.y] }, { p: g.get(`ff:${side}`)!.p, node: `ff:${side}` }], node: `ff:${side}` };
  }

  private route(a: Actor, to: Target) {
    const l = this.layout!, g = this.graph;
    const { ways, node } = this.exitWays(a);
    let end: string, suffix: Way[] = [];
    if (to === "desk") {
      end = `d:${a.cell}`;
      const s = a.seat >= 0 ? this.seatSlot(a) : undefined, c = this.cellOfActor(a);
      if (s) suffix = [{ p: [s.gapX, c.oy + FOOT.y1 - 0.2] }, { p: [s.gapX, s.seat.y] }, { p: [s.seat.x, s.seat.y] }];
    } else if (to === "door") { end = `d:${a.cell}`; suffix = [{ p: this.standPos(a) }]; }
    else if (to === "hq") { end = "hd"; suffix = [{ p: [l.hq.cx, l.hq.y1 - 0.6] }, { p: this.hqSpot(a) }]; }
    else {
      const spot = this.pickFieldSpot(a), side = spot[0] < l.cx ? "l" : "r", cor = side === "l" ? l.corridor.l : l.corridor.r;
      end = `ff:${side}`; suffix = [{ p: [cor, spot[1]] }, { p: spot }];
    }
    const mid = dijkstra(g, node, end).slice(1).map(id => ({ p: g.get(id)!.p, node: id }));
    const all = [...ways, ...mid, ...suffix], out: Way[] = [];
    let px = a.x, py = a.y;
    for (const w of all) { if (Math.hypot(w.p[0] - px, w.p[1] - py) < 0.02) { if (w.node && out.length) out[out.length - 1]!.node = w.node; continue; } out.push(w); px = w.p[0]; py = w.p[1]; }
    a.path = out; a.walking = out.length > 0;
  }

  /* ---- transitions ---- */
  private begin(a: Actor) {
    const to = this.desire(a);
    const prevPhase = a.phase;
    for (const list of [this.bench, this.kick]) { const i = list.indexOf(a.id); if (i >= 0 && to !== "field") list[i] = null; }
    if (to !== "hq") { const i = this.hqSlots.indexOf(a.id); if (i >= 0) this.hqSlots[i] = null; }
    if (to !== "desk") { const s = this.seats.get(a.projectId); if (s) { const i = s.indexOf(a.id); if (i >= 0) s[i] = null; } if (to !== "door") { const d = this.doorSlots.get(a.projectId); if (d) { const i = d.indexOf(a.id); if (i >= 0) d[i] = null; } } }
    a.target = to; a.hidden = false;
    if (to === "desk") {
      const seats = this.seats.get(a.projectId) ?? [];
      a.seat = this.claim(seats, a.id);
      const d = this.doorSlots.get(a.projectId); if (d) { const i = d.indexOf(a.id); if (i >= 0) d[i] = null; }
      this.route(a, "desk"); a.phase = "walking-to-office"; a.doc = false;
      if (!a.path.length) this.arrive(a);
    } else if (to === "door") {
      a.slot = this.claim(this.doorSlots.get(a.projectId) ?? [], a.id);
      if (a.slot < 0) a.slot = 4;
      this.route(a, "door"); a.phase = "walking-to-office"; a.doc = false;
      if (!a.path.length) this.arrive(a);
    } else if (to === "hq") {
      a.slot = this.claim(this.hqSlots, a.id); if (a.slot < 0) a.slot = 0;
      a.outcome = a.state === "failed" ? "failed" : "done"; a.doc = true; a.stamp = 0;
      this.route(a, "hq"); a.phase = "walking-to-hq";
      if (!a.path.length) this.arrive(a);
    } else {
      if (prevPhase === "handover") { const i = this.hqSlots.indexOf(a.id); if (i >= 0) this.hqSlots[i] = null; }
      a.doc = false;
      this.route(a, "field"); a.phase = "walking-to-field";
      if (!a.path.length) this.arrive(a);
    }
  }

  private arrive(a: Actor) {
    a.walking = false; a.path = [];
    if (a.phase === "walking-to-office") { a.phase = a.target === "desk" ? "at-desk" : "at-door"; a.face = 0; if (a.target === "desk") a.hidden = a.seat < 0; }
    else if (a.phase === "walking-to-hq") { a.phase = "handover"; a.timer = HANDOVER_SECS; a.face = 0; }
    else if (a.phase === "walking-to-field") { a.phase = "idle"; a.wait = 1 + this.rnd(a) * 3; if (a.mode === "sit") a.face = 0; else if (a.mode === "kick") a.face = this.kick.indexOf(a.id) === 0 ? 1 : -1; }
  }

  /** Put the actor straight at its destination (first render, reduced motion, layout change). */
  private place(a: Actor) {
    const to = this.desire(a);
    this.release(a);
    a.target = to; a.hidden = false; a.walking = false; a.path = []; a.doc = false; a.stamp = 0; a.face = 0;
    if (to === "desk") {
      a.seat = this.claim(this.seats.get(a.projectId) ?? [], a.id); a.phase = "at-desk";
      const s = a.seat >= 0 ? this.seatSlot(a) : undefined;
      if (s) { a.x = s.seat.x; a.y = s.seat.y; } else { const d = this.doorPos(a); a.x = d[0]; a.y = d[1]; a.hidden = true; }
    } else if (to === "door") {
      a.slot = this.claim(this.doorSlots.get(a.projectId) ?? [], a.id); if (a.slot < 0) a.slot = 4;
      a.phase = "at-door"; const p = this.standPos(a); a.x = p[0]; a.y = p[1];
    } else {
      if (to === "hq") a.delivered = true;
      a.target = "field"; a.phase = "idle";
      const p = this.pickFieldSpot(a); a.x = p[0]; a.y = p[1];
      if (a.mode === "kick") a.face = this.kick.indexOf(a.id) === 0 ? 1 : -1;
    }
  }

  /** Re-read the scene. Call whenever layout, projects or agents change; cheap when nothing did. */
  sync(layout: CampusLayout, projects: readonly SimProject[], reduced: boolean) {
    const key = `${layout.orientation}:${layout.cols}x${layout.rows}:${projects.map(p => p.id).join(",")}`;
    const relayout = key !== this.key;
    if (relayout) { this.key = key; this.layout = layout; this.graph = buildGraph(layout); }
    else this.layout = layout;
    this.cellOf.clear();
    const resized = new Set<string>();
    projects.forEach((p, i) => {
      const n = deskCount(p.agents.length);
      this.cellOf.set(p.id, i); this.nDesks.set(p.id, n);
      if (this.seats.get(p.id)?.length !== n) { if (this.seats.has(p.id)) resized.add(p.id); this.seats.set(p.id, Array.from({ length: n }, () => null)); }
      if (!this.doorSlots.has(p.id)) this.doorSlots.set(p.id, [null, null, null, null, null]);
    });
    const seen = new Set<string>();
    for (const p of projects) {
      const cell = this.cellOf.get(p.id)!;
      for (const ag of p.agents) {
        seen.add(ag.id);
        let a = this.actors.get(ag.id);
        if (!a || a.projectId !== p.id) {
          if (a) this.release(a);
          a = { id: ag.id, agent: ag, projectId: p.id, cell, phase: "idle", target: "field", state: ag.state, x: 0, y: 0, face: 0, walking: false, seat: -1, slot: -1, doc: false, outcome: null, stamp: 0, timer: 0, delivered: false, mode: "wander", wait: 1, path: [], speed: WALK_SPEED * (0.92 + (hash32(ag.id) % 17) / 100), seed: hash32(ag.id) || 1, hidden: false };
          this.actors.set(ag.id, a);
          const spawnWalking = this.primed && !relayout && !reduced && this.known.has(p.id);
          if (spawnWalking) {
            const sp = this.pickFieldSpot(a); a.x = sp[0]; a.y = sp[1]; a.phase = "idle";
            if (this.desire(a) !== "field") this.begin(a); else this.place(a);
          } else this.place(a);
          continue;
        }
        a.agent = ag; a.cell = cell;
        const changed = a.state !== ag.state;
        if (changed) { a.state = ag.state; a.delivered = false; }
        if (relayout || (reduced && (changed || a.walking || a.phase === "handover"))) this.place(a);
        else if (changed) this.begin(a);
      }
    }
    for (const [id, a] of this.actors) if (!seen.has(id)) { this.release(a); this.actors.delete(id); }
    for (const a of this.actors.values()) if (resized.has(a.projectId) && a.target === "desk") this.place(a);
    this.known = new Set(projects.map(p => p.id));
    this.primed = true;
  }

  /** Advance by `dt` seconds (clamped); a no-op when reduced motion is on (agents sit at their destination). */
  step(dt: number) {
    const d = Math.min(0.25, Math.max(0, dt));
    if (!d || !this.layout) return;
    for (const a of this.actors.values()) {
      if (a.stamp > 0) a.stamp = Math.max(0, a.stamp - d);
      if (a.phase === "handover") {
        a.timer -= d;
        if (a.timer <= 1.0 && a.doc) { a.doc = false; a.stamp = 4.5; }
        if (a.timer <= 0) { a.delivered = true; this.begin(a); }
        continue;
      }
      if (a.path.length) {
        let left = a.speed * (a.mode === "wander" && a.phase === "idle" ? 0.55 : 1) * d;
        while (left > 0 && a.path.length) {
          const w = a.path[0]!, dx = w.p[0] - a.x, dy = w.p[1] - a.y, dist = Math.hypot(dx, dy);
          if (dist <= left) { a.x = w.p[0]; a.y = w.p[1]; left -= dist; a.path.shift(); if (Math.abs(dx) > 0.01) a.face = Math.sign(dx); }
          else { a.x += (dx / dist) * left; a.y += (dy / dist) * left; if (Math.abs(dx) > 0.01) a.face = Math.sign(dx); left = 0; }
        }
        if (!a.path.length) this.arrive(a);
        continue;
      }
      if (a.phase === "idle" && a.mode === "wander") {
        a.wait -= d;
        if (a.wait <= 0) { a.path = [{ p: this.lawnPoint(a) }]; a.walking = true; a.wait = 2 + this.rnd(a) * 4; }
      }
    }
  }
}
