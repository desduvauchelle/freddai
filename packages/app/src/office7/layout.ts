/** Office v7 "Campus": pure layout + projection maths (no DOM). */

export type Orientation = "landscape" | "portrait";

export const CELL_W = 9.4;
/** One building row: yard, front lawn and the strip behind the next back wall (the project name is painted on the wall itself). */
export const CELL_H = 10.6;
export const MARGIN = 1.6;
/** Building footprint inside a cell (cell-relative). Open dollhouse: low front wall, tall back wall, no roof over the floor. */
export const FOOT = { x0: 0.9, x1: 8.5, y0: 2.2, y1: 7.8, h: 2.7 } as const;
export const WALL_LOW = 0.5;
/** HQ footprint size; `top` is the gap between the grid's bottom edge and the HQ back wall. */
export const HQ = { w: 12, d: 5.4, h: 3.0, top: 3.6 } as const;
export const MAX_DESKS = 6;
export const MIN_DESKS = 2;
/** Screen px reserved above the topmost back wall for the status badge pinned on the wall's top-right corner. */
export const PLATE_TOP_PX = 10;
/** Clock shrine plinth half-width (world units, ~4 wide); the admirers stand on the paving around it. */
export const SHRINE_R = 2.0;
/** Lower zone split: landscape is three equal columns at least this wide (HQ + margin fits the middle one). */
export const THIRD_MIN_W = 14;
/** Portrait stacks three equal rows of this depth below the HQ. */
export const THIRD_ROW_H = 7.2;
/** Landscape: depth of the shrine courtyard in front of the HQ walkway. */
export const COURT_D = 7.4;
/** Lawns and courtyard are inset this much inside their third (clear of the corridor roads). */
export const THIRD_INSET = 0.7;

/**
 * Portrait when the container is clearly taller than wide, landscape when clearly wider. Between 0.92 and 1.08 the previous
 * choice sticks so a window sitting near square does not flip back and forth while resizing.
 */
export function pickOrientation(w: number, h: number, prev?: Orientation): Orientation {
  if (!(w > 0) || !(h > 0)) return prev ?? "landscape";
  const r = w / h;
  if (prev === "portrait") return r > 1.08 ? "landscape" : "portrait";
  if (prev === "landscape") return r < 0.92 ? "portrait" : "landscape";
  return r < 1 ? "portrait" : "landscape";
}

export function gridFor(n: number, o: Orientation, maxCols = Infinity): { cols: number; rows: number } {
  const count = Math.max(1, n);
  const target = o === "landscape" ? 1.75 : 0.62;
  const ideal = Math.sqrt(count * target * (CELL_H / CELL_W));
  let cols = o === "landscape" ? Math.ceil(ideal) : Math.round(ideal);
  if (o === "portrait" && count >= 4) cols = Math.max(2, cols);
  cols = Math.min(count, Math.max(1, Math.min(cols, maxCols)));
  return { cols, rows: Math.ceil(count / cols) };
}

export type Cell = { index: number; col: number; row: number; ox: number; oy: number };
export type Rect = { x0: number; y0: number; x1: number; y1: number };
export type Pt = readonly [number, number];
export type Tree = { x: number; y: number; r: number; seed: number };
export type CampusLayout = {
  orientation: Orientation;
  yaw: number;
  cols: number; rows: number; count: number;
  cells: Cell[];
  gridW: number; gridH: number;
  /** Centre x of the grid / zone. */
  cx: number;
  /** y of the walking avenue in front of each building row. */
  avenueYs: number[];
  /** The HQ footprint; `front` is the walkway y just in front of its door. */
  hq: Rect & { cx: number; h: number; doorY: number; front: number };
  /** Centre of the shrine courtyard (kept as `plaza` for older callers); `r` is half its smaller side. */
  plaza: { cx: number; cy: number; r: number };
  /** Paved courtyard in front of the HQ: the middle (landscape) or first (portrait) third, inset. */
  courtyard: Rect;
  /** The three equal parts of the lower zone: [picnic, HQ + courtyard, ball] in landscape; [courtyard, picnic, ball] rows in portrait. */
  thirds: [Rect, Rect, Rect];
  /** Clock shrine: the centrepiece of the courtyard. Always present (schedules never move it). */
  shrine: { cx: number; cy: number; r: number };
  /** Walking corridors left and right of the HQ, x positions. */
  corridor: { l: number; r: number };
  /** Lawns where idle agents hang out. */
  field: { ball: Rect; picnic: Rect; kick: [Pt, Pt]; benches: Pt[]; table: Pt };
  zone: Rect;
  /** Deterministic scenery trees (world units); `r` is the canopy size 0.5-0.9. */
  trees: Tree[];
  /** Whole island, world units. */
  bounds: Rect;
};

export function campusLayout(count: number, orientation: Orientation, maxCols = Infinity): CampusLayout {
  const n = Math.max(0, count);
  const { cols, rows } = gridFor(n, orientation, maxCols);
  const cells: Cell[] = Array.from({ length: n }, (_, index) => {
    const col = index % cols, row = Math.floor(index / cols);
    return { index, col, row, ox: col * CELL_W, oy: row * CELL_H };
  });
  const gridW = cols * CELL_W, gridH = rows * CELL_H, cx = gridW / 2, portrait = orientation === "portrait";
  const hqY0 = gridH + HQ.top, hqY1 = hqY0 + HQ.d, hqFront = hqY1 + 0.9;
  const half = HQ.w / 2, ins = THIRD_INSET;
  const inset = (r: Rect): Rect => ({ x0: r.x0 + ins, x1: r.x1 - ins, y0: r.y0 + ins, y1: r.y1 - ins });
  let zw: number, zh: number, thirds: [Rect, Rect, Rect], corL: number, corR: number, courtyard: Rect, ball: Rect, picnic: Rect;
  if (portrait) {
    // Three equal rows under the HQ walkway: shrine courtyard, picnic lawn, ball field. Corridors run down the zone edges.
    zw = Math.max(gridW, 21);
    corL = cx - zw / 2 + 0.6; corR = cx + zw / 2 - 0.6;
    const y0 = hqFront + 0.6, R = THIRD_ROW_H;
    thirds = [0, 1, 2].map(k => ({ x0: corL, x1: corR, y0: y0 + k * R, y1: y0 + (k + 1) * R })) as [Rect, Rect, Rect];
    zh = thirds[2].y1 - gridH;
    courtyard = inset(thirds[0]); picnic = inset(thirds[1]); ball = inset(thirds[2]);
  } else {
    // Three equal columns: picnic lawn | HQ with the shrine courtyard in front | ball field. Corridors on the two seams.
    zw = Math.max(gridW, THIRD_MIN_W * 3);
    const T = zw / 3, x0 = cx - zw / 2;
    zh = hqFront - gridH + 0.6 + COURT_D;
    thirds = [0, 1, 2].map(k => ({ x0: x0 + k * T, x1: x0 + (k + 1) * T, y0: gridH, y1: gridH + zh })) as [Rect, Rect, Rect];
    corL = thirds[0].x1; corR = thirds[1].x1;
    courtyard = inset({ ...thirds[1], y0: hqFront + 0.6 - ins });
    picnic = inset({ ...thirds[0], y0: gridH + 1.7 }); ball = inset({ ...thirds[2], y0: gridH + 1.7 });
  }
  const zx0 = cx - zw / 2, zx1 = cx + zw / 2;
  const bmx = (ball.x0 + ball.x1) / 2, bmy = (ball.y0 + ball.y1) / 2, kd = Math.min(2.6, (ball.x1 - ball.x0) / 3);
  const pw = picnic.x1 - picnic.x0, pmy = (picnic.y0 + picnic.y1) / 2;
  const ccx = (courtyard.x0 + courtyard.x1) / 2, ccy = (courtyard.y0 + courtyard.y1) / 2;
  const shrine = { cx: ccx, cy: ccy - 0.3, r: SHRINE_R };
  const layout: Omit<CampusLayout, "trees"> = {
    orientation, yaw: portrait ? 0.12 : YAW, cols, rows, count: n, cells, gridW, gridH, cx,
    avenueYs: Array.from({ length: rows }, (_, r) => r * CELL_H + FOOT.y1 + 1.4),
    hq: { x0: cx - half, x1: cx + half, y0: hqY0, y1: hqY1, cx, h: HQ.h, doorY: hqY1, front: hqFront },
    plaza: { cx: ccx, cy: ccy, r: Math.min(courtyard.x1 - courtyard.x0, courtyard.y1 - courtyard.y0) / 2 },
    courtyard, thirds, shrine,
    corridor: { l: corL, r: corR },
    field: {
      ball, picnic, kick: [[bmx - kd, bmy], [bmx + kd, bmy]],
      benches: [[picnic.x0 + pw * 0.3, picnic.y0 + 1.3], [picnic.x0 + pw * 0.72, picnic.y0 + 1.3]], table: [picnic.x0 + pw * 0.5, pmy + 1.2],
    },
    zone: { x0: zx0, x1: zx1, y0: gridH, y1: gridH + zh },
    bounds: { x0: Math.min(0, zx0) - MARGIN, y0: -0.6, x1: Math.max(gridW, zx1) + MARGIN, y1: gridH + zh + 0.3 },
  };
  return { ...layout, trees: placeTrees(layout) };
}

/* ---------- trees ---------- */
const hash01 = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const inRect = (x: number, y: number, r: Rect) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1;

/** World rects trees must stay out of: buildings (with shadow), HQ, walkways, plaza and the field lawns. */
export function treeKeepOut(l: Omit<CampusLayout, "trees">): Rect[] {
  const out: Rect[] = [];
  for (const c of l.cells) out.push({ x0: c.ox + FOOT.x0 - 0.4, x1: c.ox + FOOT.x1 + 1.7, y0: c.oy + FOOT.y0 - 0.55, y1: c.oy + FOOT.y1 + 0.9 });
  const last = l.avenueYs[l.avenueYs.length - 1] ?? 0;
  if (l.cells.length) {
    for (const y of l.avenueYs) out.push({ x0: -0.55, x1: l.gridW + 0.55, y0: y - 1.0, y1: y + 1.0 });
    for (let k = 0; k <= l.cols; k++) out.push({ x0: k * CELL_W - 0.9, x1: k * CELL_W + 0.9, y0: l.avenueYs[0]! - 1.0, y1: last + 1.0 });
    for (const x of [l.corridor.l, l.corridor.r]) out.push({ x0: x - 0.9, x1: x + 0.9, y0: last - 1.0, y1: l.zone.y1 });
  }
  out.push({ x0: l.hq.x0 - 0.5, x1: l.hq.x1 + 1.9, y0: l.hq.y0 - 0.7, y1: l.hq.y1 + 0.6 });
  out.push({ x0: l.corridor.l - 0.9, x1: l.corridor.r + 0.9, y0: l.hq.front - 1.0, y1: l.hq.front + 1.0 });
  const ct = l.courtyard;
  out.push({ x0: ct.x0 - 0.6, x1: ct.x1 + 0.6, y0: ct.y0 - 0.6, y1: ct.y1 + 0.6 });
  out.push({ x0: l.cx - 1.2, x1: l.cx + 1.2, y0: l.hq.doorY, y1: l.hq.front + 1.0 });
  for (const f of [l.field.ball, l.field.picnic]) out.push({ x0: f.x0 - 0.5, x1: f.x1 + 0.5, y0: f.y0 - 0.5, y1: f.y1 + 0.5 });
  return out;
}

/**
 * Scenery trees on a jittered grid, deterministic for a given layout: a ring around the rim, a row behind each back wall,
 * and a cluster around the field lawns. Anything inside a keep-out rect (buildings, HQ, walkways, plaza, lawns) is dropped.
 */
function placeTrees(l: Omit<CampusLayout, "trees">): Tree[] {
  const keep = treeKeepOut(l), b = l.bounds, step = 1.7;
  const trees: Tree[] = [];
  const behind = (x: number, y: number) => l.cells.some(c => x > c.ox + FOOT.x0 - 0.2 && x < c.ox + FOOT.x1 + 1.2 && y > c.oy - 0.5 && y < c.oy + FOOT.y0 - 0.2);
  const nearField = (x: number, y: number) => [l.field.ball, l.field.picnic].some(f => inRect(x, y, { x0: f.x0 - 2.4, x1: f.x1 + 2.4, y0: f.y0 - 2.4, y1: f.y1 + 2.4 }));
  let i = 0;
  for (let gy = b.y0 + 0.5; gy < b.y1; gy += step) for (let gx = b.x0 + 0.5; gx < b.x1; gx += step, i++) {
    const x = gx + (hash01(i * 3.1 + 1) - 0.5) * step * 0.7, y = gy + (hash01(i * 5.3 + 2) - 0.5) * step * 0.7;
    if (x < b.x0 + 0.35 || x > b.x1 - 0.35 || y < b.y0 + 0.2 || y > b.y1 - 0.2) continue;
    if (keep.some(k => inRect(x, y, k))) continue;
    const rim = x < b.x0 + 1.5 || x > b.x1 - 1.5 || y < b.y0 + 1.2 || y > b.y1 - 1.4;
    const p = rim ? 0.92 : behind(x, y) ? 0.8 : nearField(x, y) ? 0.7 : 0.3;
    if (hash01(i * 7.7 + 3) > p) continue;
    const r = 0.5 + hash01(i * 11.3 + 4) * 0.4;
    if (trees.some(t => Math.hypot(t.x - x, t.y - y) < (t.r + r) * 0.95 + 0.35)) continue;
    // behind a back wall the canopy rises into the wall: keep those small
    trees.push({ x, y, r: behind(x, y) && !rim ? Math.min(r, 0.65) : r, seed: i + 1 });
  }
  return trees;
}

/* ---------- desks ---------- */
export const deskCount = (agentCount: number) => Math.min(MAX_DESKS, Math.max(MIN_DESKS, agentCount));
export type DeskSlot = { desk: { x: number; y: number }; seat: { x: number; y: number }; gapX: number };
/** Desk and chair positions (world coords) for the n desks of a building at `cell`. Seats sit behind (north of) their desk. */
export function deskSlots(cell: Cell, n: number): DeskSlot[] {
  const x0 = cell.ox + FOOT.x0, x1 = cell.ox + FOOT.x1, y0 = cell.oy + FOOT.y0, cx = (x0 + x1) / 2;
  const twoRows = n > 3, perRow = twoRows ? Math.ceil(n / 2) : n;
  const rowsY = twoRows ? [y0 + 2.35, y0 + 4.3] : [y0 + 3.1];
  const out: DeskSlot[] = [];
  for (let i = 0; i < n; i++) {
    const r = twoRows ? Math.floor(i / perRow) : 0, ci = i - r * perRow, cnt = twoRows && r === 1 ? n - perRow : perRow;
    const span = (x1 - x0) / Math.max(3, perRow), total = span * cnt, start = cx - total / 2;
    const x = start + span * (ci + 0.5);
    const dir = x < cx - 0.01 ? 1 : x > cx + 0.01 ? -1 : 1;
    out.push({ desk: { x, y: rowsY[r]! }, seat: { x, y: rowsY[r]! - 0.75 }, gapX: x + dir * span / 2 });
  }
  return out;
}

/* ---------- projection: yaw-rotated ground plane, compressed by GK; height lifted by HK ---------- */
export const YAW = 0.26;
export const GK = 0.72;
export const HK = 0.74;

export type View = { S: number; ox: number; oy: number; yaw?: number };

let cacheYaw = YAW, cacheC = Math.cos(YAW), cacheS = Math.sin(YAW);
export function proj(v: View, x: number, y: number, z = 0): Pt {
  const yaw = v.yaw ?? YAW;
  if (yaw !== cacheYaw) { cacheYaw = yaw; cacheC = Math.cos(yaw); cacheS = Math.sin(yaw); }
  const rx = x * cacheC - y * cacheS, ry = x * cacheS + y * cacheC;
  return [rx * v.S + v.ox, ry * v.S * GK - z * v.S * HK + v.oy];
}
/** Depth key: larger is nearer the camera. */
export const depthOf = (x: number, y: number) => x * Math.sin(YAW) + y * Math.cos(YAW);

/** Screen extents of the island at S=1, including building height. Status badges add `PLATE_TOP_PX` on top (see fitView). */
export function projectedBounds(l: CampusLayout) {
  const b = l.bounds, id: View = { S: 1, ox: 0, oy: 0, yaw: l.yaw };
  const pts: Pt[] = [];
  for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]] as const) pts.push(proj(id, x, y, 0), proj(id, x, y, -0.5));
  for (const c of l.cells) pts.push(proj(id, c.ox + FOOT.x0, c.oy + FOOT.y0, FOOT.h + 0.3), proj(id, c.ox + FOOT.x1, c.oy + FOOT.y0, FOOT.h + 0.3));
  pts.push(proj(id, l.hq.x0, l.hq.y0, HQ.h + 0.6), proj(id, l.hq.x1, l.hq.y0, HQ.h + 0.6));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}
export const worldAspect = (l: CampusLayout) => { const b = projectedBounds(l); return b.w / b.h; };

/** Scale at which the whole island (plus badge room above) fits a w x h container. */
export function fitScale(l: CampusLayout, w: number, h: number, pad = 8): number {
  const b = projectedBounds(l);
  return Math.max(2, Math.min((w - pad * 2) / b.w, (h - pad * 2 - PLATE_TOP_PX) / b.h));
}

/**
 * Picks the column count (and so the grid shape) whose campus renders largest inside w x h. The whole campus always fits;
 * a bigger scale also means bigger wall lettering and bigger people.
 */
export function chooseLayout(n: number, o: Orientation, w: number, h: number, pad = 8): { layout: CampusLayout; S: number } {
  const first = gridFor(n, o).cols;
  let best: { layout: CampusLayout; S: number } | null = null;
  const maxC = Math.max(1, Math.min(Math.max(1, n), 12));
  for (let c = 1; c <= maxC; c++) {
    const layout = campusLayout(n, o, c);
    if (best && layout.cols === best.layout.cols) continue;
    const S = w > 0 && h > 0 ? fitScale(layout, w, h, pad) : 10;
    if (!best || S > best.S * 1.015 || (S > best.S * 0.985 && Math.abs(layout.cols - first) < Math.abs(best.layout.cols - first))) best = { layout, S };
  }
  return best ?? { layout: campusLayout(n, o), S: 10 };
}

/** Fit-to-container view: the whole island, centred, with room above for the status badges. */
export function fitView(l: CampusLayout, w: number, h: number, pad = 8): View {
  const b = projectedBounds(l);
  const S = fitScale(l, w, h, pad);
  return { S, yaw: l.yaw, ox: w / 2 - ((b.x0 + b.x1) / 2) * S, oy: PLATE_TOP_PX + (h - PLATE_TOP_PX) / 2 - ((b.y0 + b.y1) / 2) * S };
}

export type Camera = { zoom: number; panX: number; panY: number };
export const MIN_ZOOM = 1, MAX_ZOOM = 4;

export function applyCamera(base: View, cam: Camera, w: number, h: number): View {
  const S = base.S * cam.zoom;
  return { S, yaw: base.yaw, ox: w / 2 - (w / 2 - base.ox) * cam.zoom + cam.panX, oy: h / 2 - (h / 2 - base.oy) * cam.zoom + cam.panY };
}

/** Zoom keeping the screen point (px,py) fixed. */
export function zoomCameraAt(base: View, cam: Camera, w: number, h: number, factor: number, px: number, py: number): Camera {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor));
  if (zoom === cam.zoom) return cam;
  const cur = applyCamera(base, cam, w, h), k = zoom / cam.zoom;
  const ox2 = px - (px - cur.ox) * k, oy2 = py - (py - cur.oy) * k;
  return { zoom, panX: ox2 - (w / 2 - (w / 2 - base.ox) * zoom), panY: oy2 - (h / 2 - (h / 2 - base.oy) * zoom) };
}

/** Keep the island covering the viewport when zoomed in; at zoom 1 it is the fit view, no panning. */
export function clampCamera(base: View, cam: Camera, w: number, h: number, l: CampusLayout): Camera {
  if (cam.zoom <= 1.001) return cam.panX || cam.panY || cam.zoom !== 1 ? { zoom: 1, panX: 0, panY: 0 } : cam;
  const v = applyCamera(base, cam, w, h), b = projectedBounds(l);
  const x0 = b.x0 * v.S + v.ox, x1 = b.x1 * v.S + v.ox, y0 = b.y0 * v.S + v.oy - PLATE_TOP_PX, y1 = b.y1 * v.S + v.oy;
  const dx = x0 > 0 ? -x0 : x1 < w ? w - x1 : 0, dy = y0 > 0 ? -y0 : y1 < h ? h - y1 : 0;
  return dx || dy ? { ...cam, panX: cam.panX + dx, panY: cam.panY + dy } : cam;
}
