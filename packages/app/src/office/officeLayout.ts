import { makeNav, type Nav, type Point } from "./officePath";

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

export type PlanProject = { id: string; name: string; color: string; kind?: "commander" | null };
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
  const projectWaiting = projects.filter(project => project.kind !== "commander").map((project, i) => {
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

/**
 * Mini card plan: starts from one row up to six rooms, otherwise two balanced rows (the widest sensible map), and only widens
 * further when the map, scaled to the full card width `w`, would be taller than `maxH`. Depends on project count and viewport only.
 */
export function miniCols(count: number, w = 0, maxH = 0): number {
  const top = Math.max(1, Math.min(count, MAX_COLS)), first = Math.min(top, count <= 6 ? count : Math.ceil(count / 2));
  if (w <= 0 || maxH <= 0) return first;
  for (let cols = first; cols <= top; cols++) { const s = sizeFor(count, cols); if ((s.height * w) / s.width <= maxH) return cols; }
  return top;
}

/** Full overlay plan: the column count that scales the whole map largest into the real stage box (scale may exceed 1). */
export const bestFullLayout = (projects: readonly PlanProject[], w: number, h: number): Layout => floorPlan(projects, planCols(projects.length, w, h));
