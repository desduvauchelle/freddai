/* eslint-disable */
// Freddai Office rebuilt for the film. Floor plan, nav graph and pixel sprites are copied from packages/app/src/office
// (officeLayout.ts, officePath.ts, sprites.tsx); animation is driven by the film clock instead of the app's stage hook.
import React, { ReactElement } from "react";
import { useCurrentFrame } from "remotion";

export type OfficeAgentState = "working" | "needs-you" | "review" | "done" | "failed" | "idle" | "starting";


export type Point = { x: number; y: number };
/** Named points joined by axis-aligned edges that only run through doorways and open floor, so any route avoids the walls. */
export type Nav = { nodes: Record<string, Point>; adj: Record<string, string[]> };


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




/*
 * Adaptive floor plan, fixed during thread activity. Geometry is a pure function of the project list (order, names, colours) and the room-grid column count;
 * thread states never feed into it, so the map cannot reflow when work starts, waits or finishes.
 * Logical pixel grid: 1 unit = 1 art pixel, scaled by the parent <svg>.
 */
export const CELL_W = 80;
export const CELL_H = 74;
export const WALL = 8;
export const SPINE = 28;
export const SIDE = 4;
export const FACE = 36;
export const SOUTH = 6;
export const PAD_BOTTOM = 14;
export const DESKS = 4;
export const ROOM_W = 2 * CELL_W + 2 * SIDE;
export const ROOM_H = FACE + 2 * CELL_H + PAD_BOTTOM + SOUTH;
export const CORRIDOR_H = 40;
/** Walking line inside a corridor, measured from the bottom of the room row above it. */
export const CORRIDOR_LINE = 28;
export const BAND_H = 112;
export const MIN_INNER_W = 744;
export const MAX_COLS = 8;
export const DOOR_W = 34;
export const LOUNGE_MAX = 8;
export const LOBBY_MAX = 6;
export const TRAY_MAX = 8;
export const TRAY_COLS = 4;

export type PlanProject = { id: string; name: string; color: string };
export type Spot = Point & { node: string };
export type DeskSpot = { slot: number; x: number; y: number; seat: Spot; stand: Spot };
export type PlacedRoom = { project: PlanProject; index: number; x: number; y: number; w: number; h: number; floorY: number; doorX: number; desks: DeskSpot[] };
export type Rect = { x: number; y: number; w: number; h: number };
export type Layout = {
  width: number; height: number; innerW: number; cols: number; rows: number; spineX: number;
  rooms: PlacedRoom[]; corridors: (Rect & { line: number })[];
  band: Rect; lobby: Rect; lounge: Rect; shrine: Rect; you: Rect;
  door: Rect; reception: Rect; benches: Spot[]; projectWaiting: (Spot & { project: PlanProject })[]; coffee: Rect; tables: Point[]; loungeSpots: Spot[];
  deskUser: Rect; tray: Rect & { stand: Spot; cells: Point[] };
  nav: Nav;
};

const lobbyWidth = (count: number) => Math.max(160, 96 + Math.ceil(count / 3) * 24);

const sizeFor = (count: number, cols: number) => {
  const rows = Math.ceil(count / cols), innerW = Math.max(MIN_INNER_W, lobbyWidth(count) + 156 + 224 + 144, SPINE + cols * ROOM_W);
  return { rows, innerW, width: innerW + 2 * WALL, height: 2 * WALL + Math.max(rows, 1) * CORRIDOR_H + rows * ROOM_H + BAND_H };
};

/** Rooms per grid row: the choice that scales the whole map largest into a `w` x `h` box (ties keep fewer columns). */
export function planCols(count: number, w: number, h: number): number {
  const max = Math.max(1, Math.min(count, MAX_COLS));
  if (w <= 0 || h <= 0) return count <= 3 ? max : Math.min(max, Math.ceil(count / 2));
  const fit = (cols: number) => { const s = sizeFor(count, cols); return Math.min(w / s.width, h / s.height); };
  let best = 1;
  for (let cols = 2; cols <= max; cols++) if (fit(cols) > fit(best) * 1.03) best = cols;
  return best;
}

export function floorPlan(projects: readonly PlanProject[], cols: number): Layout {
  const count = projects.length, c = Math.max(1, Math.min(cols, Math.max(count, 1)));
  const { rows, innerW, width, height } = sizeFor(count, c);
  const rr = Math.max(rows, 1), spineX = WALL + SPINE / 2;
  const x0 = WALL + SPINE;
  // Balance row populations first, then give their unused width back to rooms.
  // Integer boundaries keep the pixel artwork crisp, including uneven row sizes.
  const rowCounts = Array.from({ length: rows }, (_, row) => Math.floor(count / rows) + (row < count % rows ? 1 : 0));
  const placements = rowCounts.flatMap((n, row) => Array.from({ length: n }, (_, col) => {
    const left = Math.floor(col * (innerW - SPINE) / n);
    const right = Math.floor((col + 1) * (innerW - SPINE) / n);
    return { row, x: x0 + left, w: right - left };
  }));
  const nodes: Record<string, Point> = {}, edges: [string, string][] = [];
  const node = (name: string, x: number, y: number) => { nodes[name] = { x, y }; return { node: name, x, y }; };
  const chain = (names: string[]) => { for (let i = 1; i < names.length; i++) edges.push([names[i - 1], names[i]]); };
  const sorted = (names: string[]) => [...names].sort((a, b) => nodes[a].x - nodes[b].x);

  const corridors: Layout["corridors"] = Array.from({ length: rr }, (_, k) => {
    const y = WALL + k * (ROOM_H + CORRIDOR_H) + (k < rows ? ROOM_H : 0);
    return { x: WALL, y, w: innerW, h: CORRIDOR_H, line: y + CORRIDOR_LINE };
  });
  const by = WALL + rr * CORRIDOR_H + rows * ROOM_H;
  corridors.forEach((cr, k) => node(`spine:${k}`, spineX, cr.line));
  const onLine: string[][] = corridors.map((_, k) => [`spine:${k}`]);

  const rooms: PlacedRoom[] = projects.map((project, index) => {
    const { row, x, w } = placements[index];
    const y = WALL + row * (ROOM_H + CORRIDOR_H), floorY = y + FACE, doorX = x + Math.floor(w / 2);
    const cellWidth = (w - 2 * SIDE) / 2;
    const deskX = (col: number) => x + SIDE + Math.floor(col * cellWidth + (cellWidth - CELL_W) / 2);
    const out = `door:${index}:out`, inn = `door:${index}:in`, innY = y + ROOM_H - SOUTH - 6;
    node(out, doorX, corridors[row].line); onLine[row].push(out);
    node(inn, doorX, innY);
    edges.push([out, inn]);
    const aisle = [0, 1].map(k => deskX(k) + 66);
    const bottoms = aisle.map((ax, k) => node(`aisle:${index}:${k}`, ax, innY).node);
    chain([bottoms[0], inn, bottoms[1]]);
    const desks: DeskSpot[] = Array.from({ length: DESKS }, (_, slot) => {
      const dx = deskX(slot % 2), dy = floorY + Math.floor(slot / 2) * CELL_H;
      const stand = node(`stand:${index}:${slot}`, dx + 66, dy + 66), ap = node(`ap:${index}:${slot}`, dx + 66, dy + 26), seat = node(`seat:${index}:${slot}`, dx + 28, dy + 26);
      edges.push([ap.node, seat.node]);
      return { slot, x: dx, y: dy, seat, stand };
    });
    // One aisle per desk column, top to bottom: row-0 approach, row-0 stand, row-1 approach, row-1 stand, room floor.
    for (let k = 0; k < 2; k++) chain([`ap:${index}:${k}`, desks[k].stand.node, `ap:${index}:${2 + k}`, desks[2 + k].stand.node, bottoms[k]]);
    return { project, index, x, y, w, h: ROOM_H, floorY, doorX, desks };
  });

  // Band along the bottom: lobby | coffee lounge | clock shrine | "you" desk. The lobby column is the spine itself, so the front door sits under it.
  const shrineW = 156, sharedW = innerW - shrineW;
  const lobbyW = lobbyWidth(count), loungeW = Math.round((sharedW - lobbyW) * 0.65);
  const lobby: Rect = { x: WALL, y: by, w: lobbyW, h: BAND_H }, lounge: Rect = { x: WALL + lobbyW, y: by, w: loungeW, h: BAND_H }, shrine: Rect = { x: WALL + lobbyW + loungeW, y: by, w: shrineW, h: BAND_H }, you: Rect = { x: shrine.x + shrine.w, y: by, w: sharedW - lobbyW - loungeW, h: BAND_H };
  const last = rr - 1, laneY = by + BAND_H - 12;
  node("door", spineX, height + 26);
  node("entry", spineX, by + BAND_H - 14);
  node("recep", spineX, by + 54);
  chain(["door", "entry", "recep", `spine:${last}`]);
  for (let k = last; k > 0; k--) edges.push([`spine:${k}`, `spine:${k - 1}`]);
  const reception: Rect = { x: lobby.x + 34, y: by + 24, w: 48, h: 13 };
  const nBench = 2;
  const benches: Spot[] = [];
  const bn: string[] = ["recep"];
  for (let i = 0; i < nBench; i++) {
    const bx = lobby.x + 48 + i * 26;
    bn.push(node(`bench:${i}`, bx, by + 54).node);
    benches.push(node(`lobby:${i}`, bx, by + 78));
    edges.push([`bench:${i}`, `lobby:${i}`]);
  }
  chain(bn);
  // Three compact rows of project-colored reserves, connected to the corridor above.
  const projectWaiting = projects.map((project, i) => {
    const x = lobby.x + 96 + Math.floor(i / 3) * 24;
    const y = by + 40 + (i % 3) * 27;
    const hub = node(`ready:hub:${i}`, x, corridors[last].line);
    onLine[last].push(hub.node);
    const spot = node(`ready:${project.id}`, x, y);
    edges.push([hub.node, spot.node]);
    return { ...spot, project };
  });

  const hubLounge = node("hub:lounge", lounge.x + 14, corridors[last].line), laneLounge = node("lane:lounge", lounge.x + 14, laneY);
  edges.push([hubLounge.node, laneLounge.node]);
  const nSpot = Math.max(2, Math.min(LOUNGE_MAX, Math.floor((loungeW - 52) / 24) + 1));
  const loungeSpots: Spot[] = [], lane: string[] = [laneLounge.node];
  for (let i = 0; i < nSpot; i++) {
    const sx = lounge.x + 44 + i * 24;
    lane.push(node(`lounge:lane:${i}`, sx, laneY).node);
    loungeSpots.push(node(`lounge:${i}`, sx, by + 86));
    edges.push([`lounge:lane:${i}`, `lounge:${i}`]);
  }
  chain(lane);
  const coffee: Rect = { x: lounge.x + 34, y: by + 8, w: 78, h: 22 };
  const tables: Point[] = [{ x: lounge.x + 62, y: by + 52 }, { x: lounge.x + 62 + Math.min(80, loungeW - 120), y: by + 52 }];

  const trayW = 104, trayX = you.x + Math.round((you.w - trayW) / 2) + 6;
  const hubYou = node("hub:you", you.x + 10, corridors[last].line), laneYou = node("lane:you", you.x + 10, laneY);
  const trayStand = node("tray", trayX + trayW / 2, laneY);
  edges.push([hubYou.node, laneYou.node], [laneYou.node, trayStand.node]);
  const tray = { x: trayX, y: by + 46, w: trayW, h: 38, stand: trayStand, cells: Array.from({ length: TRAY_MAX }, (_, i) => ({ x: trayX + 6 + (i % TRAY_COLS) * 24, y: by + 55 + Math.floor(i / TRAY_COLS) * 14 })) };
  const deskUser: Rect = { x: trayX - 2, y: by + 18, w: trayW + 4, h: 12 };

  onLine[last].push(hubLounge.node, hubYou.node);
  onLine.forEach(names => chain(sorted(names)));
  return { width, height, innerW, cols: c, rows, spineX, rooms, corridors, band: { x: WALL, y: by, w: innerW, h: BAND_H }, lobby, lounge, shrine, you, door: { x: spineX - 14, y: height - WALL, w: 28, h: WALL }, reception, benches, projectWaiting, coffee, tables, loungeSpots, deskUser, tray, nav: makeNav(nodes, edges) };
}




/* Pixel art as SVG rects on a logical grid; everything is drawn crisp and scaled by the parent <svg>. */

export const FUR = ["#d9a066", "#a9a9bd", "#e8d4a8", "#c27a55"];
const SHIRT = ["#5b7fd1", "#d15b7f", "#4cae7e", "#9b6bd1"];
const INK = "#1b1a24";

export const STATE_COLOR: Record<OfficeAgentState, string> = {
  working: "#5fd68a", "needs-you": "#f2c14e", review: "#8fb0ff", done: "#4fd1c5", failed: "#ef5f5f", idle: "#8b88a0", starting: "#c9a0f0",
};

const HEAD = [
  "..bbb..bbb..",
  ".bppb..bppb.",
  ".bppbbbbppb.",
  "..bbbbbbbb..",
  ".bbdbbbbdbb.",
  ".bbbbbbbbbb.",
  "..bbbnnbbb..",
  "...bbbbbb...",
];

/** Merges horizontal runs of equal colour so a sprite is a handful of rects, not one per pixel. */
export function Pix({ rows, colors, x = 0, y = 0, s = 1 }: { rows: readonly string[]; colors: Record<string, string>; x?: number; y?: number; s?: number }) {
  const out: ReactElement[] = [];
  rows.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      const ch = row[c], fill = colors[ch];
      let e = c + 1;
      while (e < row.length && row[e] === ch) e++;
      if (fill) out.push(<rect key={`${r}-${c}`} x={x + c * s} y={y + r * s} width={(e - c) * s} height={s} fill={fill} />);
      c = e;
    }
  });
  return <>{out}</>;
}

export function Head({ x, y, variant, closed = false }: { x: number; y: number; variant: number; closed?: boolean }) {
  const fur = FUR[variant % 4];
  return <Pix rows={HEAD} x={x} y={y} colors={{ b: fur, p: "#e8a0a8", d: closed ? fur : INK, n: "#d9657a" }} />;
}

const CHECK = ["......#", ".....#.", "#...#..", ".#.#...", "..#...."];

/** Lit screen content per state. Working scrolls code lines; every other state has a distinct static picture. */
function ScreenContent({ state, x, y }: { state: OfficeAgentState; x: number; y: number }) {
  const frame = useCurrentFrame();
  if (state === "working") {
    const widths = [20, 12, 26, 16, 22, 9, 18, 24];
    const cols = ["#7bd88f", "#8fb0ff", "#7bd88f", "#f2c14e", "#7bd88f", "#8fb0ff", "#7bd88f", "#bfe9c9"];
    const lines = [...widths, ...widths].map((w, i) => <rect key={i} x={x + 2 + (i % 3) * 2} y={y + 1 + i * 3} width={w} height={2} fill={cols[i % 8]} />);
    return <g><g transform={`translate(0 ${-((frame * 0.45) % 24)})`}>{lines}</g></g>;
  }
  if (state === "needs-you") return <><rect x={x + 2} y={y + 2} width={18} height={2} fill="#f2c14e" /><rect x={x + 2} y={y + 6} width={24} height={2} fill="#c79a2e" /><rect opacity={Math.floor(frame / 12) % 2 ? 0.2 : 1} x={x + 2} y={y + 10} width={4} height={2} fill="#ffe08a" /></>;
  if (state === "review") return <><rect x={x + 3} y={y + 2} width={24} height={2} fill="#8fb0ff" /><rect x={x + 3} y={y + 5} width={20} height={2} fill="#5b7fd1" /><rect x={x + 3} y={y + 8} width={26} height={2} fill="#8fb0ff" /><rect x={x + 3} y={y + 11} width={12} height={1} fill="#5b7fd1" /></>;
  if (state === "done") return <Pix rows={CHECK} x={x + 9} y={y + 2} s={2} colors={{ "#": "#6ff0a0" }} />;
  if (state === "failed") return <><rect x={x + 14} y={y + 1} width={4} height={7} fill="#fff" /><rect x={x + 14} y={y + 10} width={4} height={2} fill="#fff" /></>;
  return <><rect x={x + 5} y={y + 4} width={2} height={2} fill="#3a384a" /><rect x={x + 14} y={y + 8} width={2} height={2} fill="#3a384a" /><rect x={x + 24} y={y + 3} width={2} height={2} fill="#3a384a" /></>;
}
const SCREEN_BG: Record<OfficeAgentState, string> = { working: "#0f1d24", "needs-you": "#3a2d0c", review: "#14203a", done: "#0e1a14", failed: "#a02323", idle: "#16151d", starting: "#16151d" };

export function Bubble({ x, y, w, h, glyph, fill, tail = "bottom", size = 12, tag = null }: { x: number; y: number; w: number; h: number; glyph: string; fill: string; tail?: "bottom" | "left"; size?: number; tag?: number | null }) {
  return <g className="office-bubble">
    <rect x={x - 1} y={y} width={w + 2} height={h} fill={INK} /><rect x={x} y={y - 1} width={w} height={h + 2} fill={INK} />
    <rect x={x} y={y} width={w} height={h} fill={fill} />
    {tail === "bottom"
      ? <><rect x={x + w / 2 - 3} y={y + h} width={6} height={2} fill={INK} /><rect x={x + w / 2 - 2} y={y + h} width={4} height={2} fill={fill} /><rect x={x + w / 2 - 1} y={y + h + 2} width={2} height={2} fill={INK} /></>
      : <><rect x={x - 3} y={y + h - 2} width={3} height={3} fill={INK} /><rect x={x - 1} y={y + h - 3} width={2} height={3} fill={fill} /></>}
    <text x={x + w / 2} y={y + h * 0.76} textAnchor="middle" fontSize={size} fontWeight={800} fill={INK} fontFamily="ui-monospace, Menlo, Consolas, monospace">{glyph}</text>
    {tag != null && <><rect x={x - 4} y={y - 4} width={9} height={9} fill={INK} /><text x={x + 0.5} y={y + 3.5} textAnchor="middle" fontSize={7} fontWeight={800} fill="#fff" fontFamily="ui-monospace, Menlo, Consolas, monospace">{tag}</text></>}
  </g>;
}

/**
 * Furniture of one desk cell (CELL_W x CELL_H, origin top-left): chair, monitor, desk. The agent is a separate <Character>.
 * `state` is the screen: working scrolls code, needs-you shows a blinking prompt, failed is red with smoke, idle is dark (empty desk).
 */
export function DeskFurniture({ x, y, state, typing, fur }: { x: number; y: number; state: OfficeAgentState; typing: boolean; fur: string }) {
  const fr = useCurrentFrame();
  const sc = STATE_COLOR[state];
  return <g transform={`translate(${x} ${y})`}>
    <rect x={19} y={12} width={18} height={18} fill="#3b4260" /><rect x={19} y={12} width={18} height={2} fill="#5a6590" /><rect x={19} y={12} width={2} height={18} fill="#2f3550" />
    <rect x={10} y={26} width={36} height={20} fill="#23222d" /><rect x={10} y={26} width={36} height={1} fill="#4a4860" />
    <rect x={12} y={28} width={32} height={14} fill={SCREEN_BG[state]} />
    <g clipPath="url(#office-scr)"><ScreenContent state={state} x={12} y={28} /></g>
    <rect x={27} y={43} width={2} height={2} fill={state === "idle" ? "#3a384a" : sc} />
    <rect x={2} y={46} width={52} height={12} fill="#b98550" /><rect x={2} y={46} width={52} height={1} fill="#d9a86e" />
    <rect x={2} y={58} width={52} height={4} fill="#8a5f36" /><rect x={4} y={62} width={3} height={6} fill="#6a4527" /><rect x={49} y={62} width={3} height={6} fill="#6a4527" />
    <rect x={18} y={50} width={20} height={4} fill="#d8d8e0" /><rect x={19} y={51} width={18} height={1} fill="#9a98a8" /><rect x={19} y={53} width={18} height={1} fill="#9a98a8" />
    {typing && <><rect x={22} y={48 + (Math.floor(fr / 3) % 2)} width={3} height={2} fill={fur} /><rect x={31} y={48 + (Math.floor(fr / 4) % 2)} width={3} height={2} fill={fur} /></>}
      </g>;
}

export type CharPose = "seated" | "stand" | "cup" | "sit";

/**
 * One character, origin at the feet (seated: at the seat, the desk hides the rest). Walking is two frames of legs and arms.
 * `carry` holds a folder in `folder` colour; `cup` holds a coffee cup. `flip` mirrors it to face left.
 */
export function Character({ x, y, variant, pose, moving = false, frame = 0, flip = false, carry = false, folder = "#d9a066", headset = false, shirtColor }: { x: number; y: number; variant: number; pose: CharPose; moving?: boolean; frame?: 0 | 1; flip?: boolean; carry?: boolean; folder?: string; headset?: boolean; shirtColor?: string }) {
  const fur = FUR[variant % 4], shirt = shirtColor ?? SHIRT[variant % 4], pants = "#2a2838";
  if (pose === "seated") return <g transform={`translate(${x} ${y})`}>
    <rect x={-7} y={-4} width={14} height={4} fill={shirt} />
    <Head x={-6} y={-12} variant={variant} />
    {headset && <><rect x={-7} y={-9} width={1} height={4} fill={pants} /><rect x={6} y={-9} width={1} height={4} fill={pants} /><rect x={-6} y={-13} width={12} height={1} fill={pants} /><rect x={6} y={-6} width={3} height={1} fill={pants} /></>}
  </g>;
  const f = moving ? frame : 0, bob = moving && f === 1 ? 1 : 0;
  return <g transform={`translate(${x} ${y})${flip ? " scale(-1 1)" : ""}`}>
    {pose === "sit"
      ? <><rect x={-5} y={-3} width={4} height={3} fill={pants} /><rect x={1} y={-3} width={4} height={3} fill={pants} /></>
      : <><rect x={-4} y={-6} width={3} height={6 - (moving && f === 1 ? 1 : 0)} fill={pants} /><rect x={1} y={-6} width={3} height={6 - (moving && f === 0 ? 1 : 0)} fill={pants} /></>}
    <rect x={-6} y={-14 + bob} width={12} height={pose === "sit" ? 11 : 8} fill={shirt} />
    <rect x={-8} y={-13 + (moving && f === 0 ? 1 : 0) + bob} width={2} height={6} fill={fur} />
    {pose === "cup" ? <rect x={6} y={-17} width={2} height={6} fill={fur} /> : <rect x={6} y={-13 + (moving && f === 1 ? 1 : 0) + bob} width={2} height={6} fill={fur} />}
    <Head x={-6} y={-22 + bob} variant={variant} />
    {pose === "cup" && <g><rect x={8} y={-15} width={5} height={5} fill="#f4f1e8" /><rect x={8} y={-15} width={5} height={1} fill="#7a4a2a" /><rect x={13} y={-14} width={1} height={3} fill="#f4f1e8" /></g>}
    {carry && <Folder x={3} y={-12} color={folder} w={11} h={8} />}
  </g>;
}

/** A manila folder in a project colour (x,y = top-left). */
export function Folder({ x, y, color, w = 18, h = 12 }: { x: number; y: number; color: string; w?: number; h?: number }) {
  return <g>
    <rect x={x - 1} y={y - 1} width={w + 2} height={h + 2} fill={INK} />
    <rect x={x} y={y} width={w} height={h} fill={color} />
    <rect x={x} y={y} width={Math.round(w * 0.45)} height={2} fill="#ffffff" opacity={0.35} />
    <rect x={x + 2} y={y + Math.round(h * 0.45)} width={w - 4} height={Math.max(1, Math.round(h * 0.28))} fill="#f4f1e8" />
  </g>;
}

export function CoffeeMachine({ x, y }: { x: number; y: number }) {
  return <g transform={`translate(${x} ${y})`}>
    <rect x={0} y={0} width={16} height={20} fill="#2c2f3d" /><rect x={0} y={0} width={16} height={2} fill="#4a4f66" />
    <rect x={2} y={3} width={12} height={5} fill="#8fb0ff" /><rect x={3} y={4} width={4} height={1} fill="#fff" opacity={0.6} />
    <rect x={9} y={10} width={3} height={3} fill="#ef5f5f" /><rect x={3} y={10} width={3} height={3} fill="#5fd68a" />
    <rect x={5} y={14} width={6} height={6} fill="#14131a" /><rect x={6} y={17} width={4} height={3} fill="#f4f1e8" /><rect x={6} y={17} width={4} height={1} fill="#7a4a2a" />
  </g>;
}

export function Cup({ x, y }: { x: number; y: number }) {
  return <g><rect x={x} y={y} width={5} height={5} fill="#f4f1e8" /><rect x={x} y={y} width={5} height={1} fill="#7a4a2a" /><rect x={x + 5} y={y + 1} width={1} height={3} fill="#f4f1e8" /></g>;
}

/** Round café table seen from the front (x,y = centre of the top). */
export function Table({ x, y }: { x: number; y: number }) {
  return <g>
    <rect x={x - 11} y={y - 3} width={22} height={6} fill="#c79a62" /><rect x={x - 9} y={y - 5} width={18} height={2} fill="#d9b27c" /><rect x={x - 9} y={y + 3} width={18} height={2} fill="#8a5f36" />
    <rect x={x - 1} y={y + 5} width={2} height={7} fill="#6a4527" /><rect x={x - 5} y={y + 12} width={10} height={2} fill="#6a4527" />
    <Cup x={x - 6} y={y - 9} />
  </g>;
}

export function Bench({ x, y }: { x: number; y: number }) {
  return <g>
    <rect x={x - 12} y={y - 15} width={24} height={6} fill="#4a3a5e" /><rect x={x - 12} y={y - 15} width={24} height={1} fill="#6a5a84" />
    <rect x={x - 12} y={y - 5} width={24} height={6} fill="#5b4a74" /><rect x={x - 12} y={y - 5} width={24} height={1} fill="#7e6c9c" />
    <rect x={x - 10} y={y + 1} width={2} height={4} fill="#2a2536" /><rect x={x + 8} y={y + 1} width={2} height={4} fill="#2a2536" />
  </g>;
}

export function Plant({ x, y, big = false }: { x: number; y: number; big?: boolean }) {
  const s = big ? 1.3 : 1;
  return <g transform={`translate(${x} ${y}) scale(${s})`}>
    <rect x={3} y={-2} width={6} height={4} fill="#3f9a4f" /><rect x={1} y={-6} width={4} height={5} fill="#52b862" /><rect x={7} y={-7} width={4} height={6} fill="#3f9a4f" /><rect x={4} y={-10} width={4} height={6} fill="#6bd07a" />
    <rect x={2} y={2} width={8} height={7} fill="#b0603a" /><rect x={2} y={2} width={8} height={1} fill="#cf7c52" /><rect x={3} y={9} width={6} height={1} fill="#7e4326" />
  </g>;
}

export function Cooler({ x, y }: { x: number; y: number }) {
  return <g transform={`translate(${x} ${y})`}>
    <rect x={2} y={-12} width={8} height={11} fill="#7ec8f2" /><rect x={2} y={-12} width={8} height={2} fill="#b5e2f8" />
    <rect x={0} y={-1} width={12} height={14} fill="#cfd6e0" /><rect x={0} y={-1} width={12} height={1} fill="#fff" /><rect x={4} y={3} width={4} height={2} fill="#5b7fd1" /><rect x={5} y={6} width={2} height={2} fill="#ef5f5f" />
    <rect x={0} y={11} width={12} height={2} fill="#9aa3b3" />
  </g>;
}

export function Shelf({ x, y, w = 24, h = 18 }: { x: number; y: number; w?: number; h?: number }) {
  const books = ["#c4553f", "#5b7fd1", "#e2b34a", "#4cae7e", "#9b6bd1", "#d9a066"];
  const rows = h > 24 ? 3 : 2, rh = (h - 2) / rows;
  const out: ReactElement[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < Math.floor((w - 4) / 3); c++) {
    const bh = rh - 3 - ((c + r) % 3);
    out.push(<rect key={`${r}-${c}`} x={x + 2 + c * 3} y={y + 1 + r * rh + (rh - 2 - bh)} width={2} height={bh} fill={books[(c * 2 + r) % 6]} />);
  }
  return <g><rect x={x} y={y} width={w} height={h} fill="#5a3c24" />{out}{Array.from({ length: rows }, (_, r) => <rect key={r} x={x} y={y + (r + 1) * rh} width={w} height={1.5} fill="#8a5f36" />)}</g>;
}

export function WallWindow({ x, y }: { x: number; y: number }) {
  return <g><rect x={x} y={y} width={22} height={16} fill="#6f6a80" /><rect x={x + 2} y={y + 2} width={18} height={12} fill="#8ec9f0" /><rect x={x + 2} y={y + 2} width={18} height={4} fill="#b9e1f8" /><rect x={x + 10} y={y + 2} width={2} height={12} fill="#6f6a80" /></g>;
}

/** Wall clock showing the next due time. */
export function WallClock({ x, y, due }: { x: number; y: number; due: number }) {
  const d = new Date(due), min = d.getMinutes(), hr = (d.getHours() % 12) + min / 60;
  const hand = (turn: number, len: number) => { const a = turn * Math.PI * 2; return [x + 9 + Math.sin(a) * len, y + 9 - Math.cos(a) * len]; };
  const [hx, hy] = hand(hr / 12, 4), [mx, my] = hand(min / 60, 6.5);
  return <g>
    <rect x={x + 2} y={y} width={14} height={18} fill="#2a2536" /><rect x={x} y={y + 2} width={18} height={14} fill="#2a2536" />
    <rect x={x + 3} y={y + 1} width={12} height={16} fill="#f4eee0" /><rect x={x + 1} y={y + 3} width={16} height={12} fill="#f4eee0" />
    {[[9, 3], [9, 14], [3, 9], [14, 9]].map(([a, b], i) => <rect key={i} x={x + a} y={y + b} width={1} height={1} fill="#6a6478" />)}
    <line x1={x + 9} y1={y + 9} x2={hx} y2={hy} stroke="#1b1a24" strokeWidth={1.5} /><line x1={x + 9} y1={y + 9} x2={mx} y2={my} stroke="#c4553f" strokeWidth={1} />
  </g>;
}

/** The user at reception: a pixel mouse with a headset behind a counter. */
export function UserAvatar({ x, y }: { x: number; y: number }) {
  return <g transform={`translate(${x} ${y})`}>
    <rect x={-1} y={9} width={14} height={9} fill="#3f6fd0" />
    <Head x={0} y={0} variant={1} />
    <rect x={0} y={-1} width={12} height={1} fill="#2a2838" /><rect x={-1} y={3} width={2} height={5} fill="#2a2838" /><rect x={11} y={3} width={2} height={5} fill="#2a2838" />
    <rect x={11} y={7} width={4} height={1} fill="#2a2838" />
  </g>;
}


/** Back-facing mouse with raised paws, looking up toward the shrine clock. */
export function ClockAdmirer({ x, y, variant }: { x: number; y: number; variant: number }) {
  const fur = FUR[variant % 4];
  return <g transform={`translate(${x} ${y})`}>
    <ellipse cx={0} cy={1} rx={10} ry={3} fill="#1b1a24" opacity={0.3} />
    <rect x={-5} y={-5} width={4} height={5} fill="#2a2838" /><rect x={1} y={-5} width={4} height={5} fill="#2a2838" />
    <rect x={-6} y={-14} width={12} height={10} fill={SHIRT[variant % 4]} />
    <rect x={-9} y={-20} width={3} height={10} fill={fur} /><rect x={7} y={-20} width={3} height={10} fill={fur} />
    <Pix rows={HEAD} x={-6} y={-24} colors={{ b: fur, p: "#e8a0a8", d: fur, n: fur }} />
    <rect x={-1} y={-3} width={2} height={5} fill="#e8a0a8" /><rect x={1} y={0} width={4} height={2} fill="#e8a0a8" />
    <path d="M 0 -33 v 6 M -3 -30 h 6" stroke="#ffe49a" strokeWidth={2} />
  </g>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Film layer: sample data, animation schedule, camera, window chrome.
// ---------------------------------------------------------------------------------------------------------------------
import { Easing, interpolate, spring, useVideoConfig } from "remotion";
import { C, FONT, clamp } from "./theme";
import { FONT_MONO } from "./fonts";
import { CUE, T } from "./timeline";

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const mix = (a: string, b: string, t: number) => {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return "#" + [0, 1, 2].map((i) => Math.round(p(a, i) * (1 - t) + p(b, i) * t).toString(16).padStart(2, "0")).join("");
};
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export const PROJECTS: PlanProject[] = [
  { id: "p0", name: "Freddai", color: "#5b7fd1" },
  { id: "p1", name: "Landing page", color: "#d15b7f" },
  { id: "p2", name: "Billing API", color: "#4cae7e" },
];
export const LAYOUT = floorPlan(PROJECTS, 3);

// ---- walking schedule ----
type Phase = { at: number; to: string; endPose: "seated" | "stand"; carry?: boolean; arriveBy?: number; speed?: number };
type AgentSpec = { id: string; project: number; variant: number; start: string; startPose: "seated" | "stand"; phases: Phase[]; label: string };
const SPEED = 62; // logical px per second

const AGENTS: AgentSpec[] = [
  { id: "a1", project: 0, variant: 0, start: "seat:0:0", startPose: "seated", phases: [], label: "Fix flaky sync test" },
  { id: "a2", project: 1, variant: 1, start: "seat:1:0", startPose: "seated", phases: [], label: "Polish pricing page" },
  // needs-you agent: leaves its desk and arrives in the lounge exactly on the lounge cue
  { id: "a7", project: 0, variant: 2, start: "seat:0:2", startPose: "seated", label: "Add retry cap to webhooks", phases: [{ at: 0, to: "lounge:1", endPose: "stand", arriveBy: CUE.lounge + 0.35, speed: 150 }] },
  // finished agent: stands up, carries its folder to the in-tray
  { id: "a6", project: 2, variant: 3, start: "seat:2:0", startPose: "seated", label: "Ship invoice export", phases: [{ at: CUE.folderOut - 0.25, to: "tray", endPose: "stand", carry: true, speed: 150 }] },
  // arrivals from the lobby at the walk cue
  { id: "a3", project: 0, variant: 3, start: "ready:p0", startPose: "stand", label: "Review PR comments", phases: [{ at: CUE.walk, to: "seat:0:1", endPose: "seated", speed: 150 }] },
  { id: "a4", project: 1, variant: 0, start: "ready:p1", startPose: "stand", label: "Fix nav on tablets", phases: [{ at: CUE.walk + 0.4, to: "seat:1:1", endPose: "seated", speed: 150 }] },
  { id: "a5", project: 2, variant: 1, start: "ready:p2", startPose: "stand", label: "Add pagination", phases: [{ at: CUE.walk + 0.8, to: "seat:2:1", endPose: "seated", speed: 150 }] },
];

type Resolved = { t0: number; t1: number; pts: Point[]; cum: number[]; to: string; endPose: "seated" | "stand"; carry: boolean; speed: number; flipEnd: boolean };
const resolveAgent = (a: AgentSpec): Resolved[] => {
  let node = a.start;
  return a.phases.map((p) => {
    const names = planRoute(LAYOUT.nav, node, p.to)!;
    const pts = names.map((n) => LAYOUT.nav.nodes[n]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const speed = p.speed ?? SPEED, len = cum[cum.length - 1];
    const t0 = p.arriveBy !== undefined ? p.arriveBy - len / speed : p.at;
    let flipEnd = false;
    for (let i = pts.length - 1; i > 0; i--) if (pts[i].x !== pts[i - 1].x) { flipEnd = pts[i].x < pts[i - 1].x; break; }
    node = p.to;
    return { t0, t1: t0 + len / speed, pts, cum, to: p.to, endPose: p.endPose, carry: !!p.carry, speed, flipEnd };
  });
};
const PLANS = AGENTS.map((a) => ({ spec: a, phases: resolveAgent(a) }));

type AgentNow = { id: string; spec: AgentSpec; x: number; y: number; moving: boolean; flip: boolean; carry: boolean; pose: "seated" | "stand"; arrivedAt: number | null; place: "desk" | "lounge" | "tray" | "lobby" };
const agentAt = (plan: (typeof PLANS)[number], t: number): AgentNow => {
  const { spec, phases } = plan;
  let node = spec.start, pose = spec.startPose, flip = false, arrivedAt: number | null = null, place: AgentNow["place"] = spec.startPose === "seated" ? "desk" : "lobby";
  for (const p of phases) {
    if (t < p.t0) break;
    if (t < p.t1) {
      const d = (t - p.t0) * p.speed;
      let i = 1;
      while (i < p.cum.length - 1 && p.cum[i] < d) i++;
      const a = p.pts[i - 1], b = p.pts[i], seg = p.cum[i] - p.cum[i - 1] || 1, k = Math.min(1, Math.max(0, (d - p.cum[i - 1]) / seg));
      const dx = b.x - a.x;
      return { id: spec.id, spec, x: a.x + dx * k, y: a.y + (b.y - a.y) * k, moving: true, flip: dx !== 0 ? dx < 0 : flip, carry: p.carry, pose: "stand", arrivedAt: null, place: "lobby" };
    }
    node = p.to; pose = p.endPose; flip = p.flipEnd; arrivedAt = p.t1;
    place = p.to.startsWith("seat") ? "desk" : p.to.startsWith("lounge") ? "lounge" : p.to === "tray" ? "tray" : "lobby";
  }
  const n = LAYOUT.nav.nodes[node];
  return { id: spec.id, spec, x: n.x, y: n.y, moving: false, flip, carry: false, pose, arrivedAt, place };
};

// ---- camera ----
type Key = { t: number; z: number; x: number; y: number };
const W = LAYOUT.width, H = LAYOUT.height;
const CAM: Key[] = [
  { t: T.office, z: 1.0, x: W / 2, y: H / 2 },
  { t: CUE.walk - 0.9, z: 1.04, x: W / 2, y: H / 2 },
  { t: CUE.walk + 0.4, z: 1.12, x: 380, y: 172 },
  { t: CUE.folderOut - 0.6, z: 1.12, x: 380, y: 172 },
  { t: CUE.folderOut + 0.7, z: 1.3, x: 500, y: 262 },
  { t: CUE.lounge - 0.4, z: 1.3, x: 500, y: 262 },
  { t: CUE.lounge + 0.9, z: 1.9, x: 290, y: 296 },
  { t: T.computer, z: 1.95, x: 290, y: 296 },
];
const camera = (t: number): Key => {
  if (t <= CAM[0].t) return CAM[0];
  for (let i = 1; i < CAM.length; i++) {
    if (t <= CAM[i].t) {
      const a = CAM[i - 1], b = CAM[i], k = interpolate(t, [a.t, b.t], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
      return { t, z: a.z + (b.z - a.z) * k, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  return CAM[CAM.length - 1];
};

export const WIN = { x: 48, y: 36, w: 1824, h: 1008, bar: 56, foot: 60 };
const STAGE = { w: WIN.w, h: WIN.h - WIN.bar - WIN.foot };
const S0 = Math.min(STAGE.w / W, STAGE.h / H);
const view = (t: number) => {
  const c = camera(t), s = S0 * c.z, vw = STAGE.w / s, vh = STAGE.h / s;
  let vx = c.x - vw / 2, vy = c.y - vh / 2;
  vx = vw >= W ? (W - vw) / 2 : Math.min(W - vw, Math.max(0, vx));
  vy = vh >= H ? (H - vh) / 2 : Math.min(H - vh, Math.max(0, vy));
  return { vx, vy, vw, vh, s };
};
/** Stage-local pixel position of a layout point at time t. */
const toStage = (t: number, p: Point) => { const v = view(t); return { x: (p.x - v.vx) * v.s, y: (p.y - v.vy) * v.s }; };

// ---- scene pieces ----
const Defs: React.FC = () => (
  <defs>
    <clipPath id="office-scr"><rect x={12} y={28} width={32} height={14} /></clipPath>
    <pattern id="o-hall" width={32} height={32} patternUnits="userSpaceOnUse"><rect width={32} height={32} fill="#3a3e50" /><rect width={16} height={16} fill="#434858" /><rect x={16} y={16} width={16} height={16} fill="#434858" /></pattern>
    <pattern id="o-lobby" width={32} height={8} patternUnits="userSpaceOnUse"><rect width={32} height={8} fill="#6a4a38" /><rect width={32} height={1} fill="#5a3e2e" /><rect x={14} width={1} height={8} fill="#5a3e2e" /></pattern>
    <pattern id="o-lounge" width={16} height={16} patternUnits="userSpaceOnUse"><rect width={16} height={16} fill="#d7c8ad" /><rect width={8} height={8} fill="#c8b794" /><rect x={8} y={8} width={8} height={8} fill="#c8b794" /></pattern>
    <pattern id="o-you" width={8} height={8} patternUnits="userSpaceOnUse"><rect width={8} height={8} fill="#3c4a72" /><rect width={4} height={4} fill="#43527c" /><rect x={4} y={4} width={4} height={4} fill="#43527c" /></pattern>
    {LAYOUT.rooms.map((r) => {
      const a = mix(r.project.color, "#2e2a3a", 0.34), b = mix(r.project.color, "#2e2a3a", 0.44), k = r.index % 4;
      return (
        <pattern key={r.index} id={`o-f${r.index}`} width={32} height={32} patternUnits="userSpaceOnUse">
          <rect width={32} height={32} fill={a} />
          {k === 0 && <><rect width={16} height={16} fill={b} /><rect x={16} y={16} width={16} height={16} fill={b} /></>}
          {k === 1 && [0, 8, 16, 24].map((y) => <rect key={y} y={y} width={32} height={1} fill={b} />)}
          {k === 2 && <><rect width={32} height={1} fill={b} /><rect width={1} height={32} fill={b} /><rect x={16} width={1} height={32} fill={b} /><rect y={16} width={32} height={1} fill={b} /></>}
        </pattern>
      );
    })}
  </defs>
);

type Totals = { msgs: number; threads: number; working: number };
const totalsLabel = (t: Totals) => `${t.msgs} msgs · ${t.threads} threads · ${t.working} working`;

const RoomShell: React.FC<{ r: PlacedRoom; seatedDesks: Map<number, AgentNow>; totals: Totals; t: number }> = ({ r, seatedDesks, totals }) => {
  const { x, y, w, h, project } = r, color = project.color;
  const door = 34, dx = Math.round(r.doorX - door / 2), floorY = r.floorY;
  const plateW = w - 16, chars = Math.floor((plateW - 12) / 8.1);
  const rugW = w - 2 * SIDE - 20, rugH = 2 * CELL_H - 26;
  const label = totalsLabel(totals);
  return (
    <g>
      <rect x={x} y={floorY} width={w} height={h - FACE} fill={`url(#o-f${r.index})`} />
      <rect x={x + SIDE + 10} y={floorY + 18} width={rugW} height={rugH} fill={mix(color, "#241f2e", 0.3)} opacity={0.75} />
      <rect x={x + SIDE + 12} y={floorY + 20} width={rugW - 4} height={rugH - 4} fill="none" stroke={mix(color, "#ffffff", 0.55)} strokeWidth={1} opacity={0.5} />
      <rect x={x} y={y} width={w} height={4} fill="#2a2536" /><rect x={x} y={y + 4} width={w} height={FACE - 4} fill="#e0d7c6" /><rect x={x} y={y + FACE - 4} width={w} height={4} fill="#b9ae9a" /><rect x={x} y={y + FACE - 1} width={w} height={1} fill="#6b6275" />
      <rect x={x} y={y} width={SIDE} height={h} fill="#2a2536" /><rect x={x + w - SIDE} y={y} width={SIDE} height={h} fill="#2a2536" />
      <rect x={x} y={y + h - SOUTH} width={dx - x} height={SOUTH} fill="#2a2536" /><rect x={dx + door} y={y + h - SOUTH} width={x + w - dx - door} height={SOUTH} fill="#2a2536" />
      <rect x={dx - 2} y={y + h - SOUTH} width={2} height={SOUTH} fill="#8a5f36" /><rect x={dx + door} y={y + h - SOUTH} width={2} height={SOUTH} fill="#8a5f36" />
      <rect x={dx} y={y + h - SOUTH} width={door} height={SOUTH} fill={mix(color, "#1b1a24", 0.5)} opacity={0.55} />
      <rect x={x + 7} y={y + 5} width={plateW + 2} height={18} fill="#1b1a24" /><rect x={x + 8} y={y + 6} width={plateW} height={16} fill="#2c2638" /><rect x={x + 8} y={y + 6} width={plateW} height={3} fill={color} />
      <text x={x + 8 + plateW / 2} y={y + 20} textAnchor="middle" fontSize={13} fontWeight={700} fill="#f4f1fa" fontFamily={MONO}>{clip(project.name, chars)}</text>
      <rect x={x + 7} y={y + 23} width={plateW + 2} height={11} fill="#1b1a24" /><rect x={x + 8} y={y + 24} width={plateW} height={9} fill="#14231c" />
      <text x={x + 8 + plateW / 2} y={y + 30.6} textAnchor="middle" fontSize={7.4} fontWeight={700} fill="#7bd88f" fontFamily={MONO} {...(label.length * 4.5 > plateW - 6 ? { textLength: plateW - 6, lengthAdjust: "spacingAndGlyphs" as const } : {})}>{label}</text>
      {r.desks.map((d) => {
        const owner = seatedDesks.get(d.slot);
        const seated = !!owner && !owner.moving && owner.pose === "seated";
        return <DeskFurniture key={d.slot} x={d.x} y={d.y} state={seated ? "working" : "idle"} typing={seated} fur={FUR[(owner?.spec.variant ?? 0) % 4]} />;
      })}
      <Plant x={x + SIDE + 2} y={y + h - SOUTH - 14} /><Plant x={x + w - SIDE - 14} y={y + h - SOUTH - 14} />
    </g>
  );
};

const plate = (x: number, y: number, w: number, text: string, size = 7) => (
  <g><rect x={x - 1} y={y - 1} width={w + 2} height={11} fill="#1b1a24" /><rect x={x} y={y} width={w} height={9} fill="#2c2638" /><text x={x + w / 2} y={y + 7.2} textAnchor="middle" fontSize={size} fontWeight={800} fill="#f4f1fa" fontFamily={MONO} letterSpacing={0.4}>{text}</text></g>
);

const Band: React.FC<{ waiting: number; folders: { color: string; at: number }[]; t: number }> = ({ waiting, folders, t }) => {
  const { lobby, lounge, shrine, you, reception: rc, coffee, tray, deskUser, band } = LAYOUT;
  const by = band.y, doorX = LAYOUT.door.x;
  const { fps } = useVideoConfig();
  return (
    <g>
      <rect x={lobby.x} y={by} width={lobby.w} height={BAND_H} fill="url(#o-lobby)" />
      <rect x={lounge.x} y={by} width={lounge.w} height={BAND_H} fill="url(#o-lounge)" />
      <rect x={you.x} y={by} width={you.w} height={BAND_H} fill="url(#o-you)" />
      <rect x={lounge.x - 1} y={by + 6} width={3} height={BAND_H - 6} fill="#2a2536" /><rect x={you.x - 1} y={by + 6} width={3} height={BAND_H - 6} fill="#2a2536" />
      <rect x={WALL} y={by} width={band.w} height={2} fill="#2a2536" opacity={0.5} />
      {/* lobby */}
      {plate(lobby.x + 38, by + 5, 50, "LOBBY")}
      <Character x={rc.x + rc.w - 12} y={rc.y + 4} variant={2} pose="seated" headset />
      <rect x={rc.x + 6} y={rc.y - 8} width={14} height={9} fill="#23222d" /><rect x={rc.x + 7} y={rc.y - 7} width={12} height={6} fill="#14203a" /><rect x={rc.x + 10} y={rc.y + 1} width={6} height={2} fill="#4a4860" />
      <rect x={rc.x} y={rc.y} width={rc.w} height={13} fill="#b98550" /><rect x={rc.x} y={rc.y} width={rc.w} height={3} fill="#d9a86e" /><rect x={rc.x} y={rc.y + 13} width={rc.w} height={4} fill="#8a5f36" />
      <text x={rc.x + rc.w / 2} y={rc.y + 10.5} textAnchor="middle" fontSize={5} fontWeight={800} fill="#2a1a0c" fontFamily={MONO} letterSpacing={0.5}>RECEPTION</text>
      {LAYOUT.benches.map((b) => <Bench key={b.node} x={b.x} y={b.y} />)}
      <text x={lobby.x + 34} y={by + 94} fontSize={6.4} fontWeight={700} fill="#e8d9c8" fontFamily={MONO}>WAITING</text>
      {/* coffee lounge */}
      <rect x={coffee.x} y={coffee.y + 10} width={coffee.w} height={12} fill="#8a5f36" /><rect x={coffee.x} y={coffee.y + 10} width={coffee.w} height={3} fill="#c79a62" />
      <CoffeeMachine x={coffee.x + 6} y={coffee.y - 8} />
      {[0, 1, 2, 3].map((i) => <g key={i}><rect x={coffee.x + 32 + i * 9} y={coffee.y + 6} width={5} height={5} fill="#f4f1e8" /><rect x={coffee.x + 32 + i * 9} y={coffee.y + 6} width={5} height={1} fill="#7a4a2a" /></g>)}
      {plate(coffee.x + coffee.w + 8, by + 6, 74, "COFFEE LOUNGE", 6.6)}
      {LAYOUT.tables.map((tb, i) => <Table key={i} x={tb.x} y={tb.y} />)}
      <text x={lounge.x + 44} y={by + 107} fontSize={6.4} fontWeight={700} fill="#4a3a2a" fontFamily={MONO}>{waiting ? `WAITING FOR YOU · ${waiting}` : "NOBODY IS WAITING FOR YOU"}</text>
      {/* clock shrine */}
      <rect x={shrine.x} y={by} width={shrine.w} height={BAND_H} fill="#37304b" />
      <rect x={shrine.x} y={by + 6} width={3} height={BAND_H - 6} fill="#211c30" />
      <rect x={shrine.x + 12} y={by + 58} width={shrine.w - 24} height={34} fill="#514064" />
      <rect x={shrine.x + 15} y={by + 60} width={shrine.w - 30} height={30} fill="none" stroke="#b49a65" />
      {plate(shrine.x + 32, by + 4, 92, "CLOCK SHRINE", 7)}
      <rect x={shrine.x + 60} y={by + 45} width={36} height={10} fill="#9c7546" />
      <rect x={shrine.x + 51} y={by + 53} width={54} height={5} fill="#dfbb72" />
      <g transform={`translate(${shrine.x + 60} ${by + 17}) scale(2)`}><WallClock x={0} y={0} due={new Date(2026, 10, 5, 9, 0).getTime()} /></g>
      {[shrine.x + 42, shrine.x + 110].map((x) => <g key={x}><rect x={x} y={by + 43} width={4} height={10} fill="#f4e5bc" /><rect x={x + 1} y={by + 39} width={2} height={4} fill="#ffd371" /></g>)}
      {[0, 1].map((i) => <ClockAdmirer key={i} x={shrine.x + shrine.w / 2 + (i - 0.5) * 28} y={by + 87} variant={i + 1} />)}
      <text x={shrine.x + shrine.w / 2} y={by + 99} textAnchor="middle" fontSize={7} fontWeight={800} fill="#ffe49a" fontFamily={MONO}>NEXT 9:00 AM</text>
      <text x={shrine.x + shrine.w / 2} y={by + 108} textAnchor="middle" fontSize={6.4} fill="#e0d7ed" fontFamily={MONO}>2 scheduled</text>
      {/* you: desk and in-tray */}
      <UserAvatar x={tray.x + 46} y={by + 3} />
      <rect x={deskUser.x} y={deskUser.y} width={deskUser.w} height={12} fill="#b98550" /><rect x={deskUser.x} y={deskUser.y} width={deskUser.w} height={2} fill="#d9a86e" /><rect x={deskUser.x} y={deskUser.y + 12} width={deskUser.w} height={4} fill="#8a5f36" />
      <rect x={deskUser.x + deskUser.w / 2 - 12} y={deskUser.y + 3} width={24} height={8} fill="#f4f1e8" /><text x={deskUser.x + deskUser.w / 2} y={deskUser.y + 9.4} textAnchor="middle" fontSize={6.6} fontWeight={800} fill="#1b1a24" fontFamily={MONO}>YOU</text>
      <rect x={tray.x - 1} y={tray.y - 1} width={tray.w + 2} height={tray.h + 2} fill="#1b1a24" /><rect x={tray.x} y={tray.y} width={tray.w} height={tray.h} fill="#3a3446" /><rect x={tray.x + 2} y={tray.y + 10} width={tray.w - 4} height={tray.h - 12} fill="#241f2e" />
      <text x={tray.x + 5} y={tray.y + 8} fontSize={6.6} fontWeight={800} fill="#e8d9c8" fontFamily={MONO} letterSpacing={0.5}>IN-TRAY</text>
      {folders.map((f, i) => {
        const cell = tray.cells[i], p = spring({ frame: Math.round((t - f.at) * fps), fps, config: { damping: 12, stiffness: 220, mass: 0.6 } });
        return <g key={i} transform={`translate(${cell.x + 9} ${cell.y + 6}) scale(${Math.max(0.01, p)}) translate(${-(cell.x + 9)} ${-(cell.y + 6)})`}><Folder x={cell.x} y={cell.y} color={f.color} /></g>;
      })}
      {/* front door */}
      <rect x={doorX - 2} y={LAYOUT.height - WALL} width={32} height={WALL} fill="#9fd4ea" /><rect x={doorX + 13} y={LAYOUT.height - WALL} width={2} height={WALL} fill="#5a7a8a" />
      <rect x={doorX - 4} y={LAYOUT.height - WALL} width={2} height={WALL} fill="#8a5f36" /><rect x={doorX + 30} y={LAYOUT.height - WALL} width={2} height={WALL} fill="#8a5f36" />
      <rect x={doorX} y={by + BAND_H - 8} width={28} height={6} fill="#6b3f4a" />
      <text x={doorX + 38} y={by + BAND_H - 4} fontSize={6.4} fontWeight={700} fill="#e8d9c8" fontFamily={MONO}>FRONT DOOR</text>
    </g>
  );
};

/** The pixel office SVG at film time `t` (absolute seconds). Includes camera via viewBox. */
const OfficeSvg: React.FC<{ t: number; hot: boolean }> = ({ t, hot }) => {
  const frame = useCurrentFrame(), { fps } = useVideoConfig();
  const v = view(t);
  const now = PLANS.map((p) => agentAt(p, t));
  const toBy = (id: string) => now.find((n) => n.id === id)!;
  // scoreboard totals
  const base = [14, 9, 11];
  const totals: Totals[] = PROJECTS.map((_, i) => {
    const mine = now.filter((n) => n.spec.project === i);
    const msgs = base[i] + Math.floor(Math.max(0, t - T.office + i * 0.7) / 2.1);
    return { msgs, threads: mine.length + (i === 0 ? 1 : 0), working: mine.filter((n) => !n.moving && n.pose === "seated").length };
  });
  const lounged = now.filter((n) => n.place === "lounge" && !n.moving && n.arrivedAt !== null);
  const trayArr = toBy("a6");
  const folders = [{ color: PROJECTS[0].color, at: -100 }, ...(trayArr.place === "tray" && !trayArr.moving ? [{ color: PROJECTS[2].color, at: trayArr.arrivedAt! }] : [])];
  // order: draw by y so characters overlap naturally
  const drawn = [...now].sort((a, b) => a.y - b.y);
  const appear = (i: number) => spring({ frame: frame - Math.round((CUE.office - T.office) * fps) - i * 2, fps, config: { damping: 18, stiffness: 260, mass: 0.7 } });
  return (
    <svg width={STAGE.w} height={STAGE.h} viewBox={`${v.vx} ${v.vy} ${v.vw} ${v.vh}`} style={{ display: "block", shapeRendering: "crispEdges" }}>
      <Defs />
      <rect x={-200} y={-200} width={W + 400} height={H + 400} fill="#221e2c" />
      <rect x={WALL} y={WALL} width={LAYOUT.innerW} height={H - 2 * WALL} fill="url(#o-hall)" />
      {LAYOUT.corridors.map((b, i) => (
        <g key={i}>
          <rect x={b.x} y={b.line - 6} width={b.w} height={12} fill="#4b5170" opacity={0.5} />
          {LAYOUT.rooms.filter((r) => Math.abs(r.y + r.h - b.y) < 1).map((r) => <rect key={r.index} x={Math.round(r.doorX - 14)} y={b.y + 1} width={28} height={7} fill="#7a3f52" />)}
        </g>
      ))}
      {LAYOUT.rooms.map((r, i) => {
        const p = appear(i);
        const desks = new Map<number, AgentNow>();
        for (const n of now) {
          const m = /^seat:(\d+):(\d+)$/.exec(n.spec.start);
          if (m && +m[1] === r.index) { if (!(n.moving || n.place !== "desk")) desks.set(+m[2], n); }
          for (const ph of PLANS.find((q) => q.spec.id === n.id)!.phases) { const mm = /^seat:(\d+):(\d+)$/.exec(ph.to); if (mm && +mm[1] === r.index && n.place === "desk" && !n.moving) desks.set(+mm[2], n); }
        }
        return (
          <g key={r.index} opacity={Math.min(1, p * 1.4)} transform={`translate(0 ${(1 - p) * 14})`}>
            <RoomShell r={r} seatedDesks={desks} totals={totals[i]} t={t} />
          </g>
        );
      })}
      <g opacity={Math.min(1, appear(3) * 1.4)}><Band waiting={lounged.length} folders={folders} t={t} /></g>
      {/* lobby reserves: project-coloured idle characters, replenished after one leaves */}
      {LAYOUT.projectWaiting.map((spot, i) => {
        const walker = PLANS.find((p) => p.spec.start === `ready:${spot.project.id}`);
        const dep = walker ? walker.phases[0].t0 : null;
        const show = dep === null || t > dep + 1.6;
        return show ? <g key={i} opacity={dep === null ? 1 : Math.min(1, (t - dep - 1.6) * 2)}>
          <rect x={spot.x - 10} y={spot.y - 2} width={20} height={5} fill={spot.project.color} opacity={0.4} />
          <Character x={spot.x} y={spot.y} variant={(i + 1) % 4} shirtColor={spot.project.color} pose="stand" />
        </g> : null;
      })}
      <g opacity={Math.min(1, appear(2) * 1.5)}>{drawn.map((n) => {
        const seated = !n.moving && n.pose === "seated";
        const isNeed = n.id === "a7" && !n.moving && n.arrivedAt !== null;
        const isLobbyReserve = n.place === "lobby" && !n.moving;
        const k = isNeed ? spring({ frame: Math.round((t - n.arrivedAt!) * fps), fps, config: { damping: 9, stiffness: 240, mass: 0.6 } }) : 0;
        return (
          <g key={n.id}>
            {isLobbyReserve && <rect x={n.x - 10} y={n.y - 2} width={20} height={5} fill={PROJECTS[n.spec.project].color} opacity={0.4} />}
            <Character x={n.x} y={n.y} variant={n.spec.variant} shirtColor={PROJECTS[n.spec.project].color} pose={seated ? "seated" : "stand"} moving={n.moving} frame={(Math.floor(frame / 5) % 2) as 0 | 1} flip={n.flip} carry={n.carry} folder={PROJECTS[n.spec.project].color} />
            {isNeed && (
              <g transform={`translate(${n.x} ${n.y - 44}) scale(${Math.max(0.01, k)}) translate(${-n.x} ${-(n.y - 44)})`}>
                <rect x={n.x - 12} y={n.y + 2} width={24} height={6} fill="#f2c14e" opacity={0.28 + 0.14 * Math.sin(frame / 5)} />
                <Bubble x={n.x - 9} y={n.y - 44} w={18} h={15} glyph="?" fill="#f2c14e" size={13} tag={1} />
              </g>
            )}
            {isNeed && hot && <rect x={n.x - 11} y={n.y - 26} width={22} height={28} fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={1} />}
          </g>
        );
      })}</g>
      <rect x={0} y={0} width={W} height={WALL} fill="#2a2536" /><rect x={0} y={0} width={WALL} height={H} fill="#2a2536" /><rect x={W - WALL} y={0} width={WALL} height={H} fill="#2a2536" />
      <rect x={0} y={H - WALL} width={LAYOUT.door.x - 4} height={WALL} fill="#2a2536" /><rect x={LAYOUT.door.x + 32} y={H - WALL} width={W - LAYOUT.door.x - 32} height={WALL} fill="#2a2536" />
    </svg>
  );
};

const Arrow: React.FC<{ size?: number; ring?: number }> = ({ size = 44, ring = 0 }) => (
  <svg width={size} height={size * 1.4} viewBox="0 0 16 22" style={{ overflow: "visible", filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.5))" }}>
    {ring > 0 && <circle cx={1} cy={1} r={4 + ring * 14} fill="none" stroke="#fff" strokeWidth={1} opacity={1 - ring} />}
    <path d="M1 1 L1 17 L5 13 L8 20 L11 19 L8 12 L14 12 Z" fill="#fff" stroke="#111" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
);

const LEGEND: { s: OfficeAgentState; glyph: string; label: string }[] = [
  { s: "working", glyph: "...", label: "Working" }, { s: "needs-you", glyph: "?", label: "Needs you" },
  { s: "failed", glyph: "!", label: "Failed" }, { s: "starting", glyph: "…", label: "Starting" }, { s: "done", glyph: "✓", label: "Done" },
];

/** Thread panel that opens when the waiting agent is clicked. */
const ThreadPanel: React.FC<{ p: number }> = ({ p }) => {
  const rows = [
    { who: "You", text: "Move the invoice webhooks onto the new retry queue.", you: true },
    { who: "Agent", text: "Done across 4 files, tests pass. One question before I merge: should the retry cap be 5 attempts, or unlimited?", you: false },
  ];
  return (
    <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 780, transform: `translateX(${(1 - p) * 820}px)`, background: C.bgDark, borderLeft: `2px solid ${C.line}`, boxShadow: "-30px 0 80px rgba(0,0,0,0.5)", fontFamily: FONT, color: C.textDark, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "26px 34px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ width: 16, height: 16, borderRadius: 4, background: PROJECTS[0].color }} />
        <div style={{ fontSize: 28, fontWeight: 700 }}>Add retry cap to webhooks</div>
        <div style={{ marginLeft: "auto", fontSize: 20, fontWeight: 700, color: "#1b1a24", background: "#f2c14e", borderRadius: 999, padding: "6px 16px" }}>Needs you</div>
      </div>
      <div style={{ flex: 1, padding: "30px 34px", display: "flex", flexDirection: "column", gap: 22 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ alignSelf: r.you ? "flex-end" : "flex-start", maxWidth: 620, background: r.you ? C.bgDark2 : "transparent", border: r.you ? "none" : `1px solid ${C.line}`, borderRadius: 18, padding: "18px 24px", fontSize: 26, lineHeight: 1.35 }}>{r.text}</div>
        ))}
        <div style={{ display: "flex", gap: 14, marginTop: 4 }}>
          {["5 attempts", "Unlimited"].map((o, i) => <div key={o} style={{ fontSize: 24, fontWeight: 650, padding: "12px 24px", borderRadius: 12, border: `2px solid ${i === 0 ? C.sage : C.line}`, color: i === 0 ? C.sage : C.textDark }}>{o}</div>)}
        </div>
      </div>
      <div style={{ margin: "0 34px 30px", border: `1px solid ${C.line}`, borderRadius: 16, padding: "18px 24px", fontSize: 24, color: C.slateLight }}>Reply to this thread</div>
    </div>
  );
};

/** Full Office chapter body, `t` in absolute film seconds. */
export const OfficeWindow: React.FC<{ t: number }> = ({ t }) => {
  const frame = useCurrentFrame(), { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 17, stiffness: 150, mass: 0.9 } });
  const sc = interpolate(enter, [0, 1], [0.94, 1]);
  const now = PLANS.map((p) => agentAt(p, t));
  const working = now.filter((n) => !n.moving && n.pose === "seated").length, need = now.some((n) => n.id === "a7" && !n.moving && n.arrivedAt !== null) ? 1 : 0;
  const summary = [working ? `${working} working` : "", need ? `${need} needs you` : ""].filter(Boolean).join(" · ");
  const agent = agentAt(PLANS.find((p) => p.spec.id === "a7")!, CUE.openThread);
  // mouse cursor: glides to the waiting agent, clicks on the openThread cue
  const target = toStage(CUE.openThread, { x: agent.x, y: agent.y - 12 });
  const tIn = CUE.openThread - 1.6;
  const mk = interpolate(t, [tIn, CUE.openThread - 0.1], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const from = { x: STAGE.w * 0.78, y: STAGE.h * 0.5 };
  const cx = from.x + (target.x - from.x) * mk, cy = from.y + (target.y - from.y) * mk;
  const clickF = Math.round((t - CUE.openThread) * fps);
  const ring = clickF >= 0 && clickF < 14 ? clickF / 14 : 0;
  const press = clickF >= 0 && clickF < 4 ? 0.88 : 1;
  const panel = spring({ frame: Math.max(0, clickF - 3), fps, config: { damping: 18, stiffness: 170, mass: 0.9 } });
  const hot = t > CUE.openThread - 0.5;
  const tip = hot && clickF < 3;
  return (
    <div style={{ position: "absolute", left: WIN.x, top: WIN.y, width: WIN.w, height: WIN.h, transform: `scale(${sc})`, opacity: Math.min(1, enter * 1.5), borderRadius: 22, overflow: "hidden", background: "#1b1a24", boxShadow: "0 50px 140px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08)", fontFamily: FONT }}>
      {/* title bar */}
      <div style={{ height: WIN.bar, background: "#26232f", display: "flex", alignItems: "center", padding: "0 22px", gap: 12, borderBottom: "2px solid #4a4560" }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => <div key={c} style={{ width: 16, height: 16, borderRadius: 8, background: c }} />)}
        <div style={{ marginLeft: 26, fontSize: 22, fontWeight: 800, letterSpacing: 2, color: "#ece8f4", fontFamily: FONT_MONO }}>OFFICE</div>
        <div style={{ marginLeft: 20, fontSize: 22, color: "#a39db3" }}>{summary || "Everyone is arriving"}</div>
      </div>
      {/* stage */}
      <div style={{ position: "absolute", left: 0, top: WIN.bar, width: STAGE.w, height: STAGE.h, overflow: "hidden" }}>
        <OfficeSvg t={t} hot={hot} />
        {tip && (
          <div style={{ position: "absolute", left: target.x, top: target.y - 120, transform: "translate(-50%,-100%)", background: "#0f0e14", border: "2px solid #4a4560", color: "#ece8f4", fontSize: 24, padding: "10px 18px", whiteSpace: "nowrap" }}>Billing API · Add retry cap to webhooks · Needs you</div>
        )}
        <ThreadPanel p={panel} />
        {mk > 0 && <div style={{ position: "absolute", left: cx, top: cy, transform: `scale(${press})`, transformOrigin: "0 0" }}><Arrow ring={ring} /></div>}
      </div>
      {/* legend bar */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: WIN.foot, background: "#26232f", borderTop: "2px solid #4a4560", display: "flex", alignItems: "center", gap: 34, padding: "0 28px", color: "#ece8f4" }}>
        <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 20, letterSpacing: 2 }}>LEGEND</div>
        {LEGEND.map((l) => (
          <div key={l.s} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 22, fontWeight: 650 }}>
            <i style={{ display: "grid", placeItems: "center", minWidth: 30, height: 30, background: STATE_COLOR[l.s], color: "#1b1a24", fontFamily: FONT_MONO, fontWeight: 800, fontSize: 20, fontStyle: "normal", boxShadow: "0 0 0 2px #0f0e14" }}>{l.glyph}</i>
            {l.label}
          </div>
        ))}
      </div>
    </div>
  );
};
