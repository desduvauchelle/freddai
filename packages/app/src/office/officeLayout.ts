import type { OfficeAgent, OfficeAgentState, OfficeModel, OfficeRoom } from "./officeModel";

/** Logical pixel grid for the office scene (1 unit = 1 art pixel; a tile is 16). The SVG scales this to any container. */
export const TILE = 16;
export const CELL_W = 80;
export const CELL_H = 74;
export const WALL = 8;
export const FACE = 28;
export const SIDE = 4;
export const SOUTH = 6;
export const PAD_BOTTOM = 14;
export const CORRIDOR_H = 40;
export const RECEPTION_H = 62;
export const MIN_INNER_W = 480;
export const MINI_MAX_ROOMS = 4;
export const MINI_MAX_DESKS = 3;
/** Mini puts reception in a column on the left (the strip below would waste the card's width). */
export const LOBBY_W = 150;
export const MINI_CORRIDOR_H = 34;
export const MINI_MIN_ZONE_W = 330;

export type PlacedAgent = { agent: OfficeAgent; x: number; y: number; tag: number | null };
export type PlacedRoom = {
  room: OfficeRoom; index: number; x: number; y: number; w: number; h: number; cols: number; rows: number;
  agents: PlacedAgent[]; hidden: number; doorX: number;
  /** Unoccupied desk cells (top-left), used for furniture. */
  spare: { x: number; y: number }[];
};
export type Band = { x: number; y: number; w: number; h: number };
export type Layout = {
  width: number; height: number; innerW: number; lobby: boolean;
  rooms: PlacedRoom[]; corridors: (Band & { last: boolean })[]; reception: Band;
  needs: { tag: number; agent: OfficeAgent }[];
  hiddenRooms: number; empty: boolean;
  entrance: { x: number; w: number };
};

const PRIORITY: Record<OfficeAgentState, number> = { "needs-you": 0, failed: 1, review: 2, working: 3, done: 4, idle: 5 };

/** Rooms per grid row, chosen from the project count (mini is always one wide row). */
export function gridCols(count: number, variant: "mini" | "full"): number {
  if (variant === "mini") return Math.max(1, Math.min(count, MINI_MAX_ROOMS));
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  if (count <= 8) return 4;
  return count === 9 ? 3 : 4;
}

/** Desk columns inside a room for `n` desks. */
export function deskCols(n: number): number {
  if (n <= 4) return Math.max(2, n);
  return n <= 6 ? 3 : 4;
}

export function layoutOffice(model: OfficeModel, variant: "mini" | "full", maxRooms: number = MINI_MAX_ROOMS, forceCols?: number): Layout {
  const mini = variant === "mini";
  const allRooms = model.rooms;
  const shown = mini ? allRooms.slice(0, maxRooms) : allRooms;
  const hiddenRooms = allRooms.length - shown.length;
  const per = forceCols && !mini ? Math.max(1, Math.min(forceCols, shown.length)) : gridCols(shown.length, variant);

  type Draft = { room: OfficeRoom; agents: OfficeAgent[]; hidden: number; cols: number; rows: number; w: number };
  const drafts: Draft[] = shown.map(room => {
    let agents = room.agents;
    if (mini && agents.length > MINI_MAX_DESKS) agents = [...agents].sort((a, b) => PRIORITY[a.state] - PRIORITY[b.state]).slice(0, MINI_MAX_DESKS);
    const cols = deskCols(agents.length);
    return { room, agents, hidden: room.agents.length - agents.length, cols, rows: Math.ceil(agents.length / cols), w: cols * CELL_W + 2 * SIDE };
  });

  const groups: Draft[][] = [];
  for (let i = 0; i < drafts.length; i += per) groups.push(drafts.slice(i, i + per));
  const rowW = (g: Draft[]) => g.reduce((s, d) => s + d.w, 0);
  const lobbyW = mini ? LOBBY_W : 0, corridorH = mini ? MINI_CORRIDOR_H : CORRIDOR_H;
  const zoneW = Math.max(mini ? MINI_MIN_ZONE_W : MIN_INNER_W, ...groups.map(rowW));
  const zoneX = WALL + lobbyW, innerW = lobbyW + zoneW;

  const rooms: PlacedRoom[] = [], corridors: Layout["corridors"] = [], needs: Layout["needs"] = [];
  let y = WALL, tag = 0, index = 0;
  for (const g of groups) {
    const h = FACE + Math.max(...g.map(d => d.rows)) * CELL_H + PAD_BOTTOM + SOUTH;
    let x = zoneX + Math.round((zoneW - rowW(g)) / 2);
    for (const d of g) {
      const agents: PlacedAgent[] = d.agents.map((agent, i) => {
        const t = agent.state === "needs-you" ? ++tag : null;
        if (t) needs.push({ tag: t, agent });
        return { agent, tag: t, x: x + SIDE + (i % d.cols) * CELL_W, y: y + FACE + Math.floor(i / d.cols) * CELL_H };
      });
      const spare: PlacedRoom["spare"] = [];
      for (let i = d.agents.length; i < d.cols * Math.max(1, d.rows); i++) spare.push({ x: x + SIDE + (i % d.cols) * CELL_W, y: y + FACE + Math.floor(i / d.cols) * CELL_H });
      rooms.push({ room: d.room, index: index++, x, y, w: d.w, h, cols: d.cols, rows: d.rows, agents, hidden: d.hidden, doorX: x + d.w / 2, spare });
      x += d.w;
    }
    y += h;
    corridors.push({ x: zoneX, y, w: zoneW, h: corridorH, last: false });
    y += corridorH;
  }
  const empty = groups.length === 0;
  if (empty) { corridors.push({ x: zoneX, y, w: zoneW, h: corridorH * 2, last: true }); y += corridorH * 2; }
  else corridors[corridors.length - 1].last = true;
  const reception = mini ? { x: WALL, y: WALL, w: LOBBY_W, h: y - WALL } : { x: WALL, y, w: innerW, h: RECEPTION_H };
  const height = (mini ? y : y + RECEPTION_H) + WALL;
  return { width: innerW + 2 * WALL, height, innerW, lobby: mini, rooms, corridors, reception, needs, hiddenRooms, empty, entrance: { x: mini ? WALL + (LOBBY_W - 32) / 2 : WALL + 112, w: 32 } };
}

/** Full mode: of the sensible room-grid shapes, the one that scales largest into a `w` x `h` box (so the art fills the window). */
export function bestFullLayout(model: OfficeModel, w: number, h: number): Layout {
  const base = layoutOffice(model, "full");
  const n = model.rooms.length;
  if (n < 3 || w <= 0 || h <= 0) return base;
  const fit = (l: Layout) => Math.min(w / l.width, h / l.height);
  let best = base;
  for (let cols = 2; cols <= Math.min(4, n); cols++) {
    const l = layoutOffice(model, "full", MINI_MAX_ROOMS, cols);
    if (fit(l) > fit(best) * 1.04) best = l;
  }
  return best;
}
