/** Office v7 "Campus": Canvas2D renderer. Soft shaded toy-town look; all geometry comes from layout.ts, all movement from sim.ts. */
import type { OfficeAgent } from "../office/officeModel";
import { CELL_H, CELL_W, FOOT, HQ, WALL_LOW, deskCount, deskSlots, proj, type CampusLayout, type Cell, type Pt, type View } from "./layout";
import { hash32, type Actor, type CampusSim } from "./sim";
import { clockHands, shrineCountLabel, shrineEntries, type SceneSchedule } from "./shrine";

export { hash32 };
export { nextDueSchedule, type SceneSchedule } from "./shrine";
export type SceneProject = { id: string; name: string; color: string; agents: readonly OfficeAgent[] };
export type SceneInput = {
  w: number; h: number; view: View; layout: CampusLayout; projects: readonly SceneProject[]; sim: CampusSim;
  t: number; reduced: boolean; selected: string | null; hovered: string | null;
  /** Scheduled work for the clock shrine; only enabled ones are shown. */
  schedules?: readonly SceneSchedule[];
  /** Wall-clock ms; the shrine's clock shows it when nothing is scheduled. */
  now?: number;
};
export type AgentHit = { x: number; y: number; r: number; agent: OfficeAgent };
export type BuildingHit = { id: string; x0: number; y0: number; x1: number; y1: number };
export type SignHit = { id: string; text: string; lines: string[]; x: number; y: number; w: number; h: number; fontPx: number };
export type ShrineHit = { x: number; y: number; w: number; h: number; schedules: number };
export type SceneOut = { agents: AgentHit[]; buildings: BuildingHit[]; signs: SignHit[]; shrine?: ShrineHit };

type RGB = [number, number, number];
const FALLBACK: RGB = [96, 132, 214];
export function parseColor(input: string): RGB {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return FALLBACK;
  let s = m[1]!;
  if (s.length === 3) s = s.split("").map(ch => ch + ch).join("");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a: RGB, k: number): RGB => [Math.min(255, a[0] * k), Math.min(255, a[1] * k), Math.min(255, a[2] * k)];
const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const WHITE: RGB = [255, 255, 255], CREAM: RGB = [250, 244, 230], INK: RGB = [28, 34, 51];
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const rnd = (seed: number) => { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

type Ctx = CanvasRenderingContext2D;
type Ent = { key: number; draw: () => void };

function path(c: Ctx, pts: readonly Pt[]) { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); }
function poly(c: Ctx, pts: readonly Pt[], fill: string | CanvasGradient) { path(c, pts); c.fillStyle = fill; c.fill(); }
function lin(c: Ctx, a: Pt, b: Pt, stops: [number, string][]) { const g = c.createLinearGradient(a[0], a[1], b[0], b[1]); stops.forEach(([o, col]) => g.addColorStop(o, col)); return g; }
function circlePts(v: View, cx: number, cy: number, r: number, z: number, n = 28): Pt[] { return Array.from({ length: n }, (_, i) => proj(v, cx + Math.cos((i / n) * Math.PI * 2) * r, cy + Math.sin((i / n) * Math.PI * 2) * r, z)); }
function hull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Pt[] = [], up: Pt[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (up.length >= 2 && cross(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}
function scaleAbout(pts: Pt[], k: number): Pt[] {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k] as Pt);
}
/** Screen bounding box of some points. */
function bbox(pts: readonly Pt[]) { const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]); const x = Math.min(...xs), y = Math.min(...ys); return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }; }
/** Soft contact shadow: a few stacked, growing alpha layers (no filters, cheap). */
function softShadow(c: Ctx, pts: Pt[], alpha = 0.16) { for (const k of [1.14, 1.07, 1]) poly(c, scaleAbout(pts, k), `rgba(28,52,30,${alpha})`); }

type Box = { x0: number; y0: number; x1: number; y1: number; z0: number; z1: number };
function box(c: Ctx, v: View, b: Box, top: string | CanvasGradient, front: string | CanvasGradient, east: string | CanvasGradient) {
  const P = (x: number, y: number, z: number) => proj(v, x, y, z);
  poly(c, [P(b.x1, b.y1, b.z0), P(b.x1, b.y0, b.z0), P(b.x1, b.y0, b.z1), P(b.x1, b.y1, b.z1)], east);
  poly(c, [P(b.x0, b.y1, b.z0), P(b.x1, b.y1, b.z0), P(b.x1, b.y1, b.z1), P(b.x0, b.y1, b.z1)], front);
  poly(c, [P(b.x0, b.y0, b.z1), P(b.x1, b.y0, b.z1), P(b.x1, b.y1, b.z1), P(b.x0, b.y1, b.z1)], top);
}

/* ---------------------------------------------------------------- characters */

type CharOpts = { t: number; phase: number; walking?: boolean; face?: number; variant: number; state?: OfficeAgent["state"]; jump?: number; wave?: number; kick?: boolean };
function drawChar(c: Ctx, px: number, py: number, H: number, tint: RGB, o: CharOpts) {
  const w = H * 0.54, r = w / 2;
  const walk = o.walking ? Math.sin(o.t * 10 + o.phase) : 0;
  const bob = o.walking ? Math.abs(walk) * H * 0.07 : 0;
  const jump = o.jump ?? 0;
  const baseY = py - bob - jump;
  // contact shadow
  const sh = c.createRadialGradient(px, py, 0, px, py, w * 0.85);
  sh.addColorStop(0, "rgba(20,36,24,.38)"); sh.addColorStop(1, "rgba(20,36,24,0)");
  c.save(); c.translate(px, py); c.scale(1, 0.34); c.beginPath(); c.arc(0, 0, w * 0.85 * (1 - Math.min(0.3, jump / (H * 2))), 0, Math.PI * 2); c.fillStyle = sh; c.fill(); c.restore();
  // feet
  const dark = mul(tint, 0.55);
  for (const s of [-1, 1]) {
    const lift = o.kick && s > 0 ? Math.abs(Math.sin(o.t * 3.4 + o.phase)) * H * 0.2 : o.walking ? Math.max(0, Math.sin(o.t * 10 + o.phase + (s > 0 ? Math.PI : 0))) * H * 0.07 : 0;
    c.beginPath(); c.ellipse(px + s * r * 0.45, baseY - lift - H * 0.025, r * 0.38, H * 0.05, 0, 0, Math.PI * 2); c.fillStyle = css(mul(dark, 0.6)); c.fill();
  }
  const top = baseY - H, bot = baseY - H * 0.05;
  const lean = o.walking ? walk * 0.04 * H : 0;
  // arms
  for (const s of [-1, 1]) {
    if (s > 0 && o.wave) {
      const a = Math.sin(o.t * 9 + o.phase) * 0.45 * o.wave;
      c.beginPath(); c.ellipse(px + r + H * 0.1 + lean, baseY - H * 0.78, H * 0.065, H * 0.15, -0.5 + a, 0, Math.PI * 2);
      c.fillStyle = css(mul(tint, 0.9)); c.fill();
      continue;
    }
    const sw = o.walking ? Math.sin(o.t * 10 + o.phase + (s > 0 ? 0 : Math.PI)) * H * 0.06 : 0;
    c.beginPath(); c.ellipse(px + s * (r + H * 0.015) + lean, baseY - H * 0.42 + sw, H * 0.065, H * 0.13, s * 0.25, 0, Math.PI * 2);
    c.fillStyle = css(mul(tint, s < 0 ? 0.92 : 0.7)); c.fill();
  }
  // body capsule
  c.save(); c.translate(lean, 0);
  c.beginPath(); c.roundRect(px - r, top, w, bot - top, r); c.closePath();
  const g = c.createLinearGradient(px - r, 0, px + r, 0);
  g.addColorStop(0, css(mix(tint, WHITE, 0.38))); g.addColorStop(0.45, css(tint)); g.addColorStop(1, css(mul(tint, 0.62)));
  c.fillStyle = g; c.fill();
  c.save(); c.clip();
  const gb = c.createLinearGradient(0, top, 0, bot);
  gb.addColorStop(0.55, "rgba(0,0,0,0)"); gb.addColorStop(1, "rgba(10,14,30,.28)");
  c.fillStyle = gb; c.fillRect(px - r, top, w, bot - top);
  // overall band (toy-overalls) in lower half
  c.fillStyle = css(mix(mul(tint, 0.55), [40, 60, 120], 0.5), 0.55); c.fillRect(px - r, baseY - H * 0.34, w, H * 0.32);
  c.restore();
  // goggle strap + eye(s)
  const ey = top + H * 0.3;
  c.fillStyle = "#2b3040"; c.fillRect(px - r, ey - H * 0.035, w, H * 0.07);
  const two = o.variant % 2 === 1, er = (two ? 0.15 : 0.23) * w * 1.15, face = (o.face ?? 0) * r * 0.12;
  for (const ex of two ? [-r * 0.36, r * 0.36] : [0]) {
    const x = px + ex + face;
    c.beginPath(); c.arc(x, ey, er * 1.28, 0, Math.PI * 2); c.fillStyle = "#9aa3b5"; c.fill();
    c.beginPath(); c.arc(x, ey, er, 0, Math.PI * 2); c.fillStyle = "#fff"; c.fill();
    c.beginPath(); c.arc(x + face * 0.8, ey + er * 0.05, er * 0.5, 0, Math.PI * 2); c.fillStyle = "#2a1d14"; c.fill();
    c.beginPath(); c.arc(x + face * 0.8 - er * 0.17, ey - er * 0.18, er * 0.17, 0, Math.PI * 2); c.fillStyle = "#fff"; c.fill();
  }
  // smile
  c.beginPath(); c.arc(px + face, ey + H * 0.2, r * 0.3, 0.15 * Math.PI, 0.85 * Math.PI); c.strokeStyle = "rgba(30,24,36,.7)"; c.lineWidth = Math.max(1, H * 0.03); c.lineCap = "round"; c.stroke();
  // specular dot
  c.beginPath(); c.ellipse(px - r * 0.45, top + H * 0.09, r * 0.17, H * 0.055, -0.5, 0, Math.PI * 2); c.fillStyle = "rgba(255,255,255,.75)"; c.fill();
  // tuft / antenna by variant
  if (o.variant >= 2) {
    c.beginPath(); c.moveTo(px, top + 1); c.quadraticCurveTo(px + r * 0.1, top - H * 0.1, px + r * 0.05, top - H * 0.14);
    c.strokeStyle = css(mul(tint, 0.5)); c.lineWidth = Math.max(1.2, H * 0.035); c.stroke();
    c.beginPath(); c.arc(px + r * 0.05, top - H * 0.15, H * 0.045, 0, Math.PI * 2); c.fillStyle = css(mix(tint, WHITE, 0.55)); c.fill();
  }
  c.restore();
}


const FONT = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
/** Painter's key: nearer the camera (larger y) draws later. */
const dk = (x: number, y: number) => y + x * 0.01;

/* ---------------------------------------------------------------- name wrapping */

/**
 * Wraps a project name onto at most `maxLines` lines no wider than `maxW`; only text beyond the last line is ellipsised.
 * With `ellipsis: false` the last line keeps all remaining text (it may be wider than `maxW`; the caller clips and fades it).
 */
export function wrapName(measure: (s: string) => number, text: string, maxW: number, maxLines = 2, ellipsis = true): string[] {
  let rest = text.trim() || "Untitled";
  const lines: string[] = [];
  const fit = (s: string) => { let lo = 1, hi = s.length; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (measure(s.slice(0, mid)) <= maxW) lo = mid; else hi = mid - 1; } return lo; };
  while (rest && lines.length < maxLines) {
    if (measure(rest) <= maxW) { lines.push(rest); rest = ""; break; }
    if (lines.length === maxLines - 1) {
      if (!ellipsis) { lines.push(rest); rest = ""; break; }
      let n = fit(rest);
      while (n > 1 && measure(rest.slice(0, n).trimEnd() + "…") > maxW) n--;
      lines.push(rest.slice(0, n).trimEnd() + "…"); rest = ""; break;
    }
    const n = fit(rest);
    let cut = n;
    for (let k = n; k >= 3; k--) if (rest[k] === " " || /[-_./]/.test(rest[k - 1]!)) { cut = k; break; }
    lines.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  return lines;
}

/* ---------------------------------------------------------------- floating badges */

type BadgeKind = "attention" | "review" | "done" | "failed" | "doc";
function drawBadge(c: Ctx, kind: BadgeKind, x: number, headY: number, H: number, t: number, phase: number, reduced: boolean) {
  if (kind === "doc") {
    const w = H * 0.46, h = H * 0.58, hop = reduced ? 0 : Math.sin(t * 5 + phase) * H * 0.05, y = headY - h - H * 0.12 - hop;
    c.save(); c.translate(x, y + h / 2); c.rotate(-0.12);
    c.shadowColor = "rgba(0,0,0,.3)"; c.shadowBlur = 4; c.fillStyle = "#fffdf4"; c.beginPath(); c.roundRect(-w / 2, -h / 2, w, h, 2); c.fill();
    c.shadowBlur = 0; c.strokeStyle = "#b9b09a"; c.lineWidth = 1; c.stroke();
    c.fillStyle = "#e7dfc7"; c.beginPath(); c.moveTo(w / 2 - w * 0.3, -h / 2); c.lineTo(w / 2, -h / 2 + w * 0.3); c.lineTo(w / 2 - w * 0.3, -h / 2 + w * 0.3); c.closePath(); c.fill();
    c.fillStyle = "#6b7a99"; for (let i = 0; i < 3; i++) c.fillRect(-w * 0.34, -h * 0.1 + i * h * 0.2, w * (i === 2 ? 0.4 : 0.68), Math.max(1.2, h * 0.07));
    c.restore(); return;
  }
  if (kind === "failed") {
    const s = H * 0.5, y = headY - s * 0.9 - H * 0.12;
    c.save(); c.translate(x, y);
    c.fillStyle = "#4d5568"; for (const [dx, dy, r] of [[-0.55, 0.15, 0.5], [0, -0.1, 0.62], [0.55, 0.15, 0.5], [0, 0.25, 0.6]] as const) { c.beginPath(); c.arc(dx * s, dy * s, r * s, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = "#ffd23f"; c.beginPath(); c.moveTo(-s * 0.05, s * 0.35); c.lineTo(s * 0.3, s * 0.35); c.lineTo(s * 0.05, s * 0.8); c.lineTo(s * 0.32, s * 0.8); c.lineTo(-s * 0.2, s * 1.4); c.lineTo(-s * 0.05, s * 0.95); c.lineTo(-s * 0.3, s * 0.95); c.closePath(); c.fill();
    c.restore(); return;
  }
  const attention = kind === "attention", r = Math.max(10, H * (attention ? 0.42 : 0.3));
  const hop = reduced || !(attention || kind === "review") ? 0 : Math.abs(Math.sin(t * (attention ? 5 : 3) + phase)) * H * (attention ? 0.42 : 0.2);
  const y = headY - r - H * 0.16 - hop;
  const [c0, c1, fg, glyph] = attention ? ["#ffd45a", "#ff9500", "#4a2a00", "!"] : kind === "review" ? ["#bcd0ff", "#4f7bff", "#0d2260", "R"] : ["#b6f0c6", "#2fb36d", "#073a1b", "✓"];
  c.save(); if (attention) { c.shadowColor = "rgba(255,170,0,.8)"; c.shadowBlur = 10; }
  c.beginPath(); c.moveTo(x - r * 0.35, y + r * 0.85); c.lineTo(x, y + r * 1.4); c.lineTo(x + r * 0.35, y + r * 0.85); c.closePath(); c.fillStyle = c1; c.fill();
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
  const g = c.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r); g.addColorStop(0, c0); g.addColorStop(1, c1); c.fillStyle = g; c.fill(); c.restore();
  c.lineWidth = 2; c.strokeStyle = "#fff"; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
  c.fillStyle = fg; c.font = `800 ${Math.round(r * 1.3)}px ${FONT}`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(glyph, x, y + r * 0.06);
}

/* ---------------------------------------------------------------- scene */

const STATE_COLOR: Record<string, string> = { "needs-you": "#f5a524", failed: "#e5484d", working: "#2fb36d", review: "#4f7bff", starting: "#9a96b5", done: "#8a8fa3" };
const PRIORITY = ["needs-you", "failed", "working", "starting", "review", "done"];
const MAX_FIELD = 14;
const HQ_PAL = { wall: [92, 112, 176] as RGB, trim: [232, 190, 84] as RGB, floor: [214, 200, 172] as RGB };

export function drawScene(c: Ctx, s: SceneInput): SceneOut {
  const { w, h, view: v, layout: l, t, reduced, sim } = s;
  const out: SceneOut = { agents: [], buildings: [], signs: [] };
  const P = (x: number, y: number, z = 0) => proj(v, x, y, z);
  const S = v.S;
  const Hc = clamp(S * 1.35, 17, 42);
  const bubbles: (() => void)[] = [], plates: (() => void)[] = [], props: Ent[] = [], blds: Ent[] = [];

  // sky
  const sky = c.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#bfe8f7"); sky.addColorStop(1, "#e8f6ea");
  c.fillStyle = sky; c.fillRect(0, 0, w, h);

  /* ---- island slab ---- */
  const b = l.bounds, depth = 0.5;
  poly(c, [P(b.x1, b.y1, 0), P(b.x1, b.y0, 0), P(b.x1, b.y0, -depth), P(b.x1, b.y1, -depth)], "#6b4f33");
  poly(c, [P(b.x0, b.y1, 0), P(b.x1, b.y1, 0), P(b.x1, b.y1, -depth), P(b.x0, b.y1, -depth)], "#85613c");
  poly(c, [P(b.x0, b.y0), P(b.x1, b.y0), P(b.x1, b.y1), P(b.x0, b.y1)], lin(c, P(b.x0, b.y0), P(b.x1, b.y1), [[0, "#a4dd6a"], [0.5, "#92d25a"], [1, "#7fc44d"]]));

  /* ---- walkways ---- */
  const band = (x0: number, y0: number, x1: number, y1: number, fill: string | CanvasGradient = "#eadfc4") => poly(c, [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], fill);
  const lastAve = l.avenueYs[l.avenueYs.length - 1]!;
  const roads: (readonly [number, number, number, number])[] = [
    ...l.avenueYs.map(y => [-0.2, y - 0.7, l.gridW + 0.2, y + 0.7] as const),
    ...Array.from({ length: l.cols + 1 }, (_, k) => [k * CELL_W - 0.45, l.avenueYs[0]! - 0.7, k * CELL_W + 0.45, lastAve + 0.7] as const),
    ...[l.corridor.l, l.corridor.r].map(x => [x - 0.5, lastAve - 0.7, x + 0.5, l.zone.y1 - 0.5] as const),
    [l.corridor.l - 0.5, l.hq.front - 0.6, l.corridor.r + 0.5, l.hq.front + 0.6] as const,
    [l.cx - 0.7, l.hq.doorY, l.cx + 0.7, l.hq.front] as const,
  ];
  for (const [x0, y0, x1, y1] of roads) band(x0 - 0.15, y0 - 0.15, x1 + 0.15, y1 + 0.15, "#cdbf9d");
  for (const [x0, y0, x1, y1] of roads) band(x0, y0, x1, y1);

  /* ---- lawns for the field ---- */
  for (const r of [l.field.ball, l.field.picnic]) {
    poly(c, [P(r.x0, r.y0), P(r.x1, r.y0), P(r.x1, r.y1), P(r.x0, r.y1)], "rgba(255,255,255,.13)");
    c.lineWidth = Math.max(1, S * 0.07); c.strokeStyle = "rgba(255,255,255,.35)"; path(c, [P(r.x0, r.y0), P(r.x1, r.y0), P(r.x1, r.y1), P(r.x0, r.y1)]); c.stroke();
  }
  const [ka, kb] = l.field.kick;
  c.lineWidth = Math.max(1, S * 0.05); c.strokeStyle = "rgba(255,255,255,.5)"; path(c, circlePts(v, (ka[0] + kb[0]) / 2, ka[1], 1.0, 0, 20)); c.stroke();

  /* ---- shrine courtyard: a paved third in front of the HQ ---- */
  {
    const ct = l.courtyard, sh = l.shrine;
    band(ct.x0 - 0.15, ct.y0 - 0.15, ct.x1 + 0.15, ct.y1 + 0.15, "#cdbf9d");
    band(ct.x0, ct.y0, ct.x1, ct.y1, lin(c, P(ct.x0, ct.y0), P(ct.x0, ct.y1), [[0, "#f6efdd"], [1, "#e6dbc1"]]));
    c.strokeStyle = "rgba(150,128,90,.18)"; c.lineWidth = 1;
    for (let x = ct.x0 + 1.2; x < ct.x1 - 0.3; x += 1.2) { const a2 = P(x, ct.y0), b2 = P(x, ct.y1); c.beginPath(); c.moveTo(a2[0], a2[1]); c.lineTo(b2[0], b2[1]); c.stroke(); }
    for (let y = ct.y0 + 1.2; y < ct.y1 - 0.3; y += 1.2) { const a2 = P(ct.x0, y), b2 = P(ct.x1, y); c.beginPath(); c.moveTo(a2[0], a2[1]); c.lineTo(b2[0], b2[1]); c.stroke(); }
    const ringR = Math.min(sh.r * 1.55, (ct.x1 - ct.x0) / 2 - 0.3, (ct.y1 - ct.y0) / 2 + 0.2);
    poly(c, circlePts(v, sh.cx, sh.cy, ringR, 0, 40), "#e3d6b8");
    poly(c, circlePts(v, sh.cx, sh.cy, ringR - 0.25, 0, 40), "#f1e8d3");
  }

  /* ---- clock shrine: stepped stone plinth, a clock on a short pillar, up to four admirers ---- */
  {
    const sh = l.shrine, entries = shrineEntries(s.schedules), next = entries[0];
    const hands = clockHands(next ? next.next_due : (s.now ?? Date.now()));
    const R = sh.r, clockR = Math.max(9, S * 0.8), pillarTop = 2.0;
    const clockAt = (): Pt => { const [px, py] = P(sh.cx, sh.cy, pillarTop); return [px, py - clockR * 0.85]; };
    props.push({ key: dk(sh.cx, sh.cy), draw: () => {
      softShadow(c, [P(sh.cx - R, sh.cy - R), P(sh.cx + R * 1.45, sh.cy - R), P(sh.cx + R * 1.45, sh.cy + R * 1.3), P(sh.cx - R, sh.cy + R * 1.3)], 0.13);
      const steps: [number, number, number][] = [[R, 0, 0.22], [R * 0.78, 0.22, 0.44], [R * 0.56, 0.44, 0.66]];
      for (const [hw, z0, z1] of steps) box(c, v, { x0: sh.cx - hw, x1: sh.cx + hw, y0: sh.cy - hw, y1: sh.cy + hw, z0, z1 }, "#e4d8bb", "#c2b393", "#a39373");
      box(c, v, { x0: sh.cx - 0.28, x1: sh.cx + 0.28, y0: sh.cy - 0.28, y1: sh.cy + 0.28, z0: 0.66, z1: pillarTop }, "#e2d9c3", "#c9bea4", "#a99e85");
      box(c, v, { x0: sh.cx - 0.4, x1: sh.cx + 0.4, y0: sh.cy - 0.4, y1: sh.cy + 0.4, z0: pillarTop - 0.12, z1: pillarTop }, "#e8be54", "#c99a36", "#a87d24");
      const [kx, ky] = clockAt();
      c.save(); c.shadowColor = "rgba(20,30,50,.3)"; c.shadowBlur = 4; c.shadowOffsetY = 1.5;
      c.beginPath(); c.arc(kx, ky, clockR, 0, Math.PI * 2); c.fillStyle = "#2b3040"; c.fill(); c.restore();
      const face = c.createRadialGradient(kx - clockR * 0.3, ky - clockR * 0.35, clockR * 0.1, kx, ky, clockR);
      face.addColorStop(0, "#ffffff"); face.addColorStop(1, "#e8ecf3");
      c.beginPath(); c.arc(kx, ky, clockR * 0.82, 0, Math.PI * 2); c.fillStyle = face; c.fill();
      c.fillStyle = "#2b3040";
      for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2, rr = clockR * 0.66, d = k % 3 === 0 ? clockR * 0.09 : clockR * 0.05; c.beginPath(); c.arc(kx + Math.sin(a) * rr, ky - Math.cos(a) * rr, Math.max(0.6, d), 0, Math.PI * 2); c.fill(); }
      c.lineCap = "round"; c.strokeStyle = "#1c2233";
      for (const [a, len, lw] of [[hands.hour, 0.42, 0.13], [hands.minute, 0.62, 0.08]] as const) {
        c.lineWidth = Math.max(1.2, clockR * lw); c.beginPath(); c.moveTo(kx, ky); c.lineTo(kx + Math.sin(a) * clockR * len, ky - Math.cos(a) * clockR * len); c.stroke();
      }
      c.beginPath(); c.arc(kx, ky, Math.max(1.2, clockR * 0.1), 0, Math.PI * 2); c.fillStyle = "#e8be54"; c.fill();
      if (entries.length) { // sparkle
        const tw2 = reduced ? 1 : 0.55 + 0.45 * Math.sin(t * 4), sx = kx + clockR * 0.95, sy = ky - clockR * 1.05, r = Math.max(3, clockR * 0.42) * (reduced ? 1 : 0.8 + 0.2 * tw2);
        c.save(); c.translate(sx, sy); c.rotate(reduced ? 0 : t * 0.8); c.globalAlpha = 0.5 + 0.5 * tw2; c.fillStyle = "#ffe08a";
        c.beginPath(); for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2, rr = k % 2 ? r * 0.3 : r; c[k ? "lineTo" : "moveTo"](Math.cos(a) * rr, Math.sin(a) * rr); } c.closePath(); c.fill(); c.restore();
      }
      const pts = [P(sh.cx - R, sh.cy + R), P(sh.cx + R, sh.cy + R), P(sh.cx - R, sh.cy - R, 0.22), P(sh.cx + R, sh.cy - R, 0.22), [kx - clockR, ky - clockR] as Pt, [kx + clockR, ky - clockR] as Pt];
      out.shrine = { ...bbox(pts), schedules: entries.length };
    } });
    const ADMIRER: RGB[] = [[232, 120, 94], [92, 160, 220], [120, 190, 110], [196, 132, 214], [236, 178, 72], [82, 184, 176]];
    const spots: [number, number][] = [[-R * 0.7, R * 1.3], [R * 0.7, R * 1.3], [-R * 1.45, R * 0.3], [R * 1.45, R * 0.3]];
    entries.slice(0, 4).forEach((e, i) => {
      const [ox, oy] = spots[i]!, x = sh.cx + ox, y = sh.cy + oy, hsh = hash32(e.id);
      props.push({ key: dk(x, y), draw: () => {
        const [px, py] = P(x, y);
        drawChar(c, px, py, Hc, ADMIRER[hsh % ADMIRER.length]!, { t: reduced ? 0 : t, phase: (hsh % 100) / 12, variant: hsh % 4, face: ox < 0 ? 1 : -1 });
      } });
    });
    const label = shrineCountLabel(entries.length);
    if (label) bubbles.push(() => {
      const [x, y] = P(sh.cx, sh.cy + R * 1.42);
      c.font = `800 11px ${FONT}`; const tw2 = c.measureText(label).width + 14;
      c.beginPath(); c.roundRect(x - tw2 / 2, y - 9, tw2, 18, 9); c.fillStyle = "#2a3350"; c.fill();
      c.fillStyle = "#ffe08a"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(label, x, y + 0.5);
    });
  }

  /* ---- field props: benches, picnic table, ball, a few trees ---- */
  const bench = (bx: number, by: number) => props.push({ key: dk(bx, by) - 0.2, draw: () => {
    softShadow(c, [P(bx - 0.9, by - 0.3), P(bx + 1.5, by - 0.3), P(bx + 1.5, by + 0.9), P(bx - 0.9, by + 0.9)], 0.12);
    box(c, v, { x0: bx - 0.85, x1: bx + 0.85, y0: by - 0.3, y1: by + 0.3, z0: 0.2, z1: 0.42 }, "#d9a45f", "#b9843f", "#8c6129");
    box(c, v, { x0: bx - 0.85, x1: bx + 0.85, y0: by - 0.36, y1: by - 0.26, z0: 0.42, z1: 0.9 }, "#d9a45f", "#c5914a", "#8c6129");
  } });
  for (const [bx, by] of l.field.benches) bench(bx, by);
  const [tx, ty] = l.field.table;
  props.push({ key: dk(tx, ty), draw: () => {
    box(c, v, { x0: tx - 1.1, x1: tx + 1.1, y0: ty - 0.55, y1: ty + 0.55, z0: 0.6, z1: 0.72 }, "#e8c78a", "#c9a15e", "#9a7640");
    for (const [lx, ly] of [[-0.9, -0.4], [0.9, -0.4], [-0.9, 0.4], [0.9, 0.4]] as const) box(c, v, { x0: tx + lx - 0.06, x1: tx + lx + 0.06, y0: ty + ly - 0.06, y1: ty + ly + 0.06, z0: 0, z1: 0.6 }, "#a98550", "#8c6a3a", "#6d5230");
    const [sx, sy] = P(tx, ty, 0.72);
    c.fillStyle = "#fff"; c.beginPath(); c.arc(sx - S * 0.3, sy - S * 0.08, S * 0.12, 0, Math.PI * 2); c.fill(); c.fillStyle = "#ff8f6b"; c.beginPath(); c.arc(sx + S * 0.3, sy - S * 0.05, S * 0.12, 0, Math.PI * 2); c.fill();
  } });
  const pair = sim.kickPair();
  const ballAt = (() => {
    const ph = reduced ? 0.5 : (t / 2.4) % 1, k = ph < 0.5 ? ph * 2 : 2 - ph * 2;
    if (!pair) return { x: (ka[0] + kb[0]) / 2, y: ka[1], z: 0 };
    return { x: ka[0] + (kb[0] - ka[0]) * k, y: ka[1] + 0.35, z: Math.sin(k * Math.PI) * 0.9 };
  })();
  props.push({ key: dk(ballAt.x, ballAt.y) + 0.1, draw: () => {
    const [gx, gy] = P(ballAt.x, ballAt.y, 0), [bx2, by2] = P(ballAt.x, ballAt.y, ballAt.z + 0.22), r = Math.max(3, S * 0.2);
    c.beginPath(); c.ellipse(gx, gy, r * 0.9, r * 0.35, 0, 0, Math.PI * 2); c.fillStyle = "rgba(20,40,20,.25)"; c.fill();
    c.beginPath(); c.arc(bx2, by2 - r * 0.6, r, 0, Math.PI * 2); c.fillStyle = "#fff"; c.fill(); c.lineWidth = 1.2; c.strokeStyle = "#2b3040"; c.stroke();
    c.beginPath(); c.arc(bx2, by2 - r * 0.6, r * 0.38, 0, Math.PI * 2); c.fillStyle = "#2b3040"; c.fill();
  } });
  const tree = (x: number, y: number, r: number, seed: number) => props.push({ key: dk(x, y), draw: () => {
    box(c, v, { x0: x - 0.07, x1: x + 0.07, y0: y - 0.07, y1: y + 0.07, z0: 0, z1: r * 0.9 }, "#8a6a45", "#7a5a38", "#5d4128");
    const [sx, sy] = P(x, y, r * 1.6), R = r * S * 1.05, g2 = c.createRadialGradient(sx - R * 0.35, sy - R * 0.4, R * 0.08, sx, sy, R);
    const hue = rnd(seed); g2.addColorStop(0, css(mix([190, 232, 110], [150, 224, 130], hue))); g2.addColorStop(0.55, css(mix([86, 168, 62], [60, 150, 86], hue))); g2.addColorStop(1, css(mix([48, 112, 52], [34, 98, 70], hue)));
    c.beginPath(); c.arc(sx, sy, R, 0, Math.PI * 2); c.fillStyle = g2; c.fill();
  } });
  const zx0 = l.zone.x0 + 0.6, zx1 = l.zone.x1 - 0.6, zt = l.gridH + 1.0;
  tree(zx0, zt, 0.7, 1); tree(zx1, zt, 0.7, 2); tree(zx0 + 0.4, l.zone.y1 - 1.0, 0.6, 3); tree(zx1 - 0.4, l.zone.y1 - 1.0, 0.6, 4);

  /* ---- buildings ---- */
  const actors = [...sim.actors.values()];
  const fieldActors = actors.filter(a => a.target === "field").sort((a, b2) => b2.agent.updated - a.agent.updated);
  const hiddenField = new Set(fieldActors.slice(MAX_FIELD).map(a => a.id));
  const interior = new Map<string, Ent[]>();
  const hqInterior: Ent[] = [];
  const projIdx = new Map(s.projects.map((p, i) => [p.id, i] as const));
  const inFoot = (a: Actor, x0: number, x1: number, y0: number, y1: number) => a.x > x0 && a.x < x1 && a.y > y0 && a.y < y1 - 0.02;

  const bodyTint = (a: Actor, base: RGB): RGB => mix(base, WHITE, (a.agent.variant % 4) * 0.07);
  const placeActor = (a: Actor, base: RGB, into: Ent[] | null) => {
    if (a.hidden || hiddenField.has(a.id)) return;
    const seated = (a.phase === "at-desk") || (a.phase === "idle" && a.mode === "sit");
    const lift = a.phase === "idle" && a.mode === "sit" ? 0.3 : 0;
    const ph = (hash32(a.id) % 100) / 12;
    const ent: Ent = { key: dk(a.x, a.y) + (a.phase === "at-desk" ? 0 : 0.05), draw: () => {
      const [sx, sy] = P(a.x, a.y + (a.phase === "at-desk" ? 0.15 : 0), lift);
      const H = seated ? Hc * 0.92 : Hc;
      const waving = a.phase === "at-door";
      if (a.phase === "at-desk") { // chair back
        const [cx2, cy2] = P(a.x, a.y - 0.25, 0.15);
        c.fillStyle = "#58627a"; c.beginPath(); c.roundRect(cx2 - Hc * 0.34, cy2 - Hc * 0.62, Hc * 0.68, Hc * 0.55, Hc * 0.18); c.fill();
      }
      drawChar(c, sx, sy, H, bodyTint(a, base), { t: reduced ? 0 : t, phase: ph, walking: a.walking && !reduced, face: a.face, variant: a.agent.variant, state: a.state, wave: waving && !reduced ? 1 : waving ? 0.5 : 0, kick: a.phase === "idle" && a.mode === "kick" && !!pair && !reduced });
      out.agents.push({ x: sx, y: sy - H * 0.5, r: Math.max(12, H * 0.6), agent: a.agent });
      bubbles.push(() => {
        const hx = sx, hy = sy - H;
        if (a.phase === "at-door") drawBadge(c, a.state === "review" ? "review" : "attention", hx, hy, H, t, ph, reduced);
        else if (a.outcome === "failed" && (a.doc || a.stamp > 0 || a.phase === "handover" || a.phase === "walking-to-hq")) drawBadge(c, "failed", hx, hy, H, t, ph, reduced);
        else if (a.doc) drawBadge(c, "doc", hx, hy, H, t, ph, reduced);
        else if (a.stamp > 0 && a.outcome === "done") drawBadge(c, "done", hx, hy, H, t, ph, reduced);
      });
    } };
    (into ?? props).push(ent);
  };

  /**
   * Back-wall frame: maps wall-local px (u along the wall from its top-left corner, w straight down) to the screen. proj is
   * affine, so the wall face is a parallelogram and one canvas transform puts text exactly on it.
   */
  const wallFrame = (x0: number, x1: number, y: number, zTop: number, zBot: number) => {
    const A = P(x0, y, zTop), B = P(x1, y, zTop), D = P(x0, y, zBot);
    const W = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1, Hh = Math.hypot(D[0] - A[0], D[1] - A[1]) || 1;
    const m = [(B[0] - A[0]) / W, (B[1] - A[1]) / W, (D[0] - A[0]) / Hh, (D[1] - A[1]) / Hh, A[0], A[1]] as const;
    const at = (u: number, wv: number): Pt => [m[4] + m[0] * u + m[2] * wv, m[5] + m[1] * u + m[3] * wv];
    return { W, H: Hh, m, at };
  };

  const drawShell = (g: { x0: number; x1: number; y0: number; y1: number; H: number; cx: number }, wallC: RGB, trimC: RGB, floorC: RGB, glow: number, pulse: number, ring: string | null, interiorEnts: Ent[], door: number, hqStyle: boolean, wallArt?: () => void) => {
    const H = g.H, P3 = P;
    const wallIn = mix(wallC, WHITE, 0.35);
    // soft ground shadow
    const sx = H * 0.55, sy = H * 0.3, foot: Pt[] = [];
    for (const [x, y] of [[g.x0, g.y0], [g.x1, g.y0], [g.x1, g.y1], [g.x0, g.y1]] as const) foot.push(P(x, y), P(x + sx, y + sy));
    softShadow(c, hull(foot), 0.17);
    if (ring) { path(c, [P(g.x0 - 0.5, g.y0 - 0.5), P(g.x1 + 0.5, g.y0 - 0.5), P(g.x1 + 0.5, g.y1 + 0.5), P(g.x0 - 0.5, g.y1 + 0.5)]); c.lineWidth = 4; c.strokeStyle = ring; c.stroke(); }
    // floor
    const floor = [P3(g.x0, g.y0, 0), P3(g.x1, g.y0, 0), P3(g.x1, g.y1, 0), P3(g.x0, g.y1, 0)] as const;
    poly(c, floor, lin(c, floor[0], floor[3], [[0, css(mul(floorC, 0.94))], [1, css(mul(floorC, 1.04))]]));
    c.strokeStyle = "rgba(120,90,50,.16)"; c.lineWidth = 1;
    for (let k = 1; k < 5; k++) { const yy = g.y0 + ((g.y1 - g.y0) * k) / 5, a = P3(g.x0, yy, 0), z = P3(g.x1, yy, 0); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(z[0], z[1]); c.stroke(); }
    // back wall + west wall (inner faces)
    c.save();
    if (glow > 0) { c.shadowColor = "rgba(255,226,140,.9)"; c.shadowBlur = 6 + glow * 10; }
    poly(c, [P3(g.x0, g.y0, 0), P3(g.x1, g.y0, 0), P3(g.x1, g.y0, H), P3(g.x0, g.y0, H)], lin(c, P3(g.x0, g.y0, H), P3(g.x0, g.y0, 0), [[0, css(mul(wallIn, 1.04))], [1, css(mul(wallIn, 0.9))]]));
    c.restore();
    poly(c, [P3(g.x0, g.y1, 0), P3(g.x0, g.y0, 0), P3(g.x0, g.y0, H), P3(g.x0, g.y1, H)], lin(c, P3(g.x0, g.y1, H), P3(g.x0, g.y0, 0), [[0, css(mul(wallIn, 0.8))], [1, css(mul(wallIn, 0.68))]]));
    // hq wall banner stripe
    if (hqStyle) poly(c, [P3(g.x0, g.y0, H * 0.78), P3(g.x1, g.y0, H * 0.78), P3(g.x1, g.y0, H * 0.84), P3(g.x0, g.y0, H * 0.84)], css(trimC));
    // lettering painted on the back wall: after the wall, before desks and people so they overlap it
    wallArt?.();
    // interior
    interiorEnts.sort((a, b2) => a.key - b2.key);
    for (const e of interiorEnts) e.draw();
    // wall caps (back + west)
    poly(c, [P3(g.x0 - 0.3, g.y0 - 0.3, H), P3(g.x1 + 0.1, g.y0 - 0.3, H), P3(g.x1 + 0.1, g.y0, H), P3(g.x0 - 0.3, g.y0, H)], css(mul(trimC, 1.1)));
    poly(c, [P3(g.x0 - 0.3, g.y0, H), P3(g.x0, g.y0, H), P3(g.x0, g.y1 + 0.1, H), P3(g.x0 - 0.3, g.y1 + 0.1, H)], css(mul(trimC, 0.85)));
    poly(c, [P3(g.x0 - 0.3, g.y1 + 0.1, 0), P3(g.x0 - 0.3, g.y0 - 0.3, 0), P3(g.x0 - 0.3, g.y0 - 0.3, H), P3(g.x0 - 0.3, g.y1 + 0.1, H)], css(mul(wallC, 0.62)));
    // low east wall
    poly(c, [P3(g.x1, g.y1, 0), P3(g.x1, g.y0, 0), P3(g.x1, g.y0, WALL_LOW), P3(g.x1, g.y1, WALL_LOW)], css(mul(wallC, 0.7)));
    poly(c, [P3(g.x1 - 0.18, g.y1, WALL_LOW), P3(g.x1, g.y1, WALL_LOW), P3(g.x1, g.y0, WALL_LOW), P3(g.x1 - 0.18, g.y0, WALL_LOW)], css(trimC));
    // low front wall with a door gap
    const gap = door;
    for (const [xa, xb] of [[g.x0, g.cx - gap], [g.cx + gap, g.x1]] as const) {
      poly(c, [P3(xa, g.y1, 0), P3(xb, g.y1, 0), P3(xb, g.y1, WALL_LOW), P3(xa, g.y1, WALL_LOW)], lin(c, P3(xa, g.y1, WALL_LOW), P3(xa, g.y1, 0), [[0, css(mul(wallC, 1.05))], [1, css(mul(wallC, 0.85))]]));
      poly(c, [P3(xa, g.y1 - 0.18, WALL_LOW), P3(xb, g.y1 - 0.18, WALL_LOW), P3(xb, g.y1, WALL_LOW), P3(xa, g.y1, WALL_LOW)], css(trimC));
    }
    for (const xx of [g.cx - gap, g.cx + gap]) poly(c, [P3(xx - 0.1, g.y1, 0), P3(xx + 0.1, g.y1, 0), P3(xx + 0.1, g.y1, WALL_LOW + 0.25), P3(xx - 0.1, g.y1, WALL_LOW + 0.25)], css(trimC));
    // doormat
    poly(c, [P3(g.cx - gap + 0.1, g.y1 + 0.05, 0), P3(g.cx + gap - 0.1, g.y1 + 0.05, 0), P3(g.cx + gap - 0.1, g.y1 + 0.5, 0), P3(g.cx - gap + 0.1, g.y1 + 0.5, 0)], css(mul(trimC, 0.8)));
    void pulse;
  };

  // desk entity
  const deskEnt = (dx: number, dy: number, wd: number, dd: number, occ: Actor | null, kind: "work" | "boss", seed: number, tint: RGB): Ent => ({ key: dk(dx, dy), draw: () => {
    const z1 = kind === "boss" ? 0.5 : 0.42;
    box(c, v, { x0: dx - wd / 2, x1: dx + wd / 2, y0: dy - dd / 2, y1: dy + dd / 2, z0: 0, z1 }, kind === "boss" ? "#8a5a34" : "#d9ae6c", kind === "boss" ? "#6d4526" : "#b98a4a", kind === "boss" ? "#4f321b" : "#8a6330");
    const active = !!occ && (occ.state === "working" || occ.state === "starting" || kind === "boss");
    // monitor (screen-aligned, faces the viewer)
    const mw = Math.max(S * (kind === "boss" ? 0.62 : 0.66), 9), mh = mw * 0.62, mxw = kind === "boss" ? dx - wd * 0.28 : dx + wd * 0.3;
    for (const mx of kind === "boss" ? [dx - wd * 0.28, dx + wd * 0.28] : [mxw]) {
      const [mpx, mpy] = P(mx, dy + 0.02, z1 + 0.05);
      const lit = kind === "boss" ? true : active, fail = occ?.state === "failed";
      c.fillStyle = "#c9d0de"; c.fillRect(mpx - 1.5, mpy - mh * 0.12, 3, mh * 0.2);
      c.save(); if (lit) { c.shadowColor = fail ? "rgba(255,120,100,.95)" : "rgba(120,220,255,.95)"; c.shadowBlur = 8 + (reduced ? 4 : 4 * Math.sin(t * 3 + seed)); }
      c.fillStyle = "#222a3b"; c.beginPath(); c.roundRect(mpx - mw / 2 - 1.5, mpy - mh - 1.5, mw + 3, mh + 3, 2); c.fill(); c.restore();
      const g2 = c.createLinearGradient(0, mpy - mh, 0, mpy);
      if (lit) { g2.addColorStop(0, fail ? "#ffd1c8" : "#e8fbff"); g2.addColorStop(1, fail ? "#ff7a66" : "#4fc3f7"); } else { g2.addColorStop(0, "#4a566e"); g2.addColorStop(1, "#343d52"); }
      c.fillStyle = g2; c.beginPath(); c.roundRect(mpx - mw / 2, mpy - mh, mw, mh, 1.5); c.fill();
      if (lit && mw > 12) {
        c.save(); c.beginPath(); c.rect(mpx - mw / 2, mpy - mh, mw, mh); c.clip();
        c.fillStyle = "rgba(20,60,90,.55)";
        for (let k = 0; k < 4; k++) { const off = reduced ? 0 : ((t * 6 + seed + k * 3) % 5) * 0.06 * mw; c.fillRect(mpx - mw / 2 + mw * 0.12, mpy - mh + mh * (0.16 + k * 0.2), mw * (0.35 + ((k * 37 + seed * 7) % 5) * 0.09) - off, Math.max(1, mh * 0.09)); }
        c.restore();
      }
    }
    // keyboard + hands
    const [kx, ky] = P(dx - (kind === "boss" ? 0 : wd * 0.08), dy + dd * 0.28, z1);
    c.fillStyle = "#eef0f6"; c.fillRect(kx - S * 0.22, ky - S * 0.03, S * 0.44, S * 0.07);
    if (occ && !reduced && occ.state !== "needs-you") { c.fillStyle = "#f3c9a5"; for (const sgn of [-1, 1]) { c.beginPath(); c.arc(kx + sgn * S * 0.13, ky - S * 0.05 - Math.max(0, Math.sin(t * 14 + seed + sgn)) * S * 0.04, Math.max(1.6, S * 0.06), 0, Math.PI * 2); c.fill(); } }
    if (kind === "boss") { const [px, py] = P(dx, dy + dd * 0.5, z1 + 0.02); c.fillStyle = "#e8be54"; c.fillRect(px - S * 0.35, py - S * 0.12, S * 0.7, S * 0.12); }
    void tint;
  } });

  s.projects.forEach((p, i) => {
    const cell = l.cells[i]; if (!cell) return;
    const base = parseColor(p.color), seed = hash32(p.id) % 100;
    const g = { x0: cell.ox + FOOT.x0, x1: cell.ox + FOOT.x1, y0: cell.oy + FOOT.y0, y1: cell.oy + FOOT.y1, H: FOOT.h, cx: cell.ox + (FOOT.x0 + FOOT.x1) / 2 };
    const needs = p.agents.filter(a => a.state === "needs-you").length, reviews = p.agents.filter(a => a.state === "review").length;
    const working = p.agents.filter(a => a.state === "working" || a.state === "starting").length;
    const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * 4 + seed);
    const hot = needs > 0 || reviews > 0;
    const selected = s.selected === p.id || s.hovered === p.id;
    const ring = hot ? `rgba(${needs ? "255,170,20" : "79,123,255"},${0.35 + 0.6 * pulse})` : selected ? "rgba(255,255,255,.95)" : null;
    const ents: Ent[] = [];
    interior.set(p.id, ents);
    const slots = deskSlots(cell, deskCount(p.agents.length));
    // path from door to the avenue
    poly(c, [P(g.cx - 0.7, g.y1), P(g.cx + 0.7, g.y1), P(g.cx + 0.7, l.avenueYs[cell.row]!), P(g.cx - 0.7, l.avenueYs[cell.row]!)], "#eadfc4");
    slots.forEach((sl, k) => {
      const occ = sim.seatOwner(p.id, k);
      if (occ && !reduced && false) void occ;
      const ent = deskEnt(sl.desk.x, sl.desk.y, 1.55, 0.62, occ && !occ.walking ? occ : null, "work", seed + k, base);
      ents.push(ent);
      if (occ && !occ.walking && (occ.state === "working" || occ.state === "starting")) {
        // lit floor pool under an occupied desk
        ents.push({ key: -1e6, draw: () => { const [gx, gy] = P(sl.desk.x, sl.desk.y + 0.3, 0); const R = S * 1.6; const gg = c.createRadialGradient(gx, gy, 0, gx, gy, R); gg.addColorStop(0, "rgba(130,215,255,.38)"); gg.addColorStop(1, "rgba(130,215,255,0)"); c.fillStyle = gg; c.save(); c.translate(gx, gy); c.scale(1, 0.55); c.translate(-gx, -gy); c.beginPath(); c.arc(gx, gy, R, 0, Math.PI * 2); c.fill(); c.restore(); } });
      }
    });
    // plant in the corner
    ents.push({ key: dk(g.x1 - 0.6, g.y0 + 0.7), draw: () => { const [px, py] = P(g.x1 - 0.6, g.y0 + 0.7, 0); c.fillStyle = "#b9663b"; c.fillRect(px - S * 0.14, py - S * 0.24, S * 0.28, S * 0.24); c.fillStyle = "#4fae5d"; c.beginPath(); c.arc(px, py - S * 0.42, S * 0.25, 0, Math.PI * 2); c.fill(); c.fillStyle = "#6fcf7c"; c.beginPath(); c.arc(px - S * 0.08, py - S * 0.5, S * 0.14, 0, Math.PI * 2); c.fill(); } });
    for (const a of actors) if (a.projectId === p.id) {
      if (inFoot(a, l.hq.x0, l.hq.x1, l.hq.y0, l.hq.y1)) continue;
      if (inFoot(a, g.x0, g.x1, g.y0, g.y1)) placeActor(a, base, ents); else placeActor(a, base, null);
    }
    const status = PRIORITY.find(k => p.agents.some(a => a.state === k));
    // Project name painted on the back wall: a light signage strip with bold lettering, upper part of the wall.
    // Name painted on the back wall. Scales with the wall (down to ~6px), never ellipsised: an overflowing name is
    // left-aligned, clipped to the strip and faded out over its last 18%. The strip hugs short names.
    const stripC = mix(mix(mix(CREAM, base, 0.3), WHITE, 0.35), [255, 252, 242], 0.85);
    const wallSign = () => {
      const f = wallFrame(g.x0, g.x1, g.y0, g.H, 0);
      const padX = clamp(f.H * 0.14, 3, 12), bar = clamp(f.H * 0.07, 2, 6), maxW = f.W - padX * 2 - bar - 6;
      if (maxW < 4) return;
      const name = p.name.trim() || "Untitled";
      const measure = (str: string) => c.measureText(str).width;
      const font = (px: number) => { c.font = `800 ${px}px ${FONT}`; };
      const top = Math.max(1, f.H * 0.08), room = f.H * 0.88 - top; // seated heads reach ~15% up the wall
      const fs0 = clamp(Math.round(f.H * 0.32), 6, 22);
      let fs = fs0, lines: string[];
      font(fs);
      const lineH = (px: number) => Math.round(px * 1.12), padYOf = (px: number) => Math.max(1, Math.round(px * 0.2));
      if (measure(name) <= maxW) lines = [name];
      else if (fs >= 10 && room >= lineH(fs) * 2 + padYOf(fs) * 2) lines = wrapName(measure, name, maxW, 2, false);
      else {
        // short wall: one line, shrink a little toward the width, keep at least ~6px
        fs = Math.max(6, Math.min(fs0, Math.floor(fs0 * maxW / measure(name)), Math.max(6, Math.round(fs0 * 0.8))));
        font(fs); lines = [name];
      }
      const lh = lineH(fs), padY = padYOf(fs);
      const tw = Math.max(...lines.map(measure)), overflow = tw > maxW + 0.5;
      const bw = overflow ? f.W - 6 : tw + padX * 2 + bar, bh = Math.min(room, lines.length * lh + padY * 2);
      const u0 = (f.W - bw) / 2, w0 = top;
      c.save(); c.transform(...f.m);
      c.beginPath(); c.roundRect(u0, w0, bw, bh, Math.min(6, bh * 0.25)); c.fillStyle = css(stripC); c.fill();
      c.lineWidth = 1.2; c.strokeStyle = css(mul(base, 0.75), 0.6); c.stroke();
      c.save(); c.clip();
      c.fillStyle = status ? STATE_COLOR[status]! : css(base); c.fillRect(u0, w0, bar, bh);
      c.fillStyle = css(mix(INK, mul(base, 0.45), 0.3)); c.textBaseline = "middle";
      const tx0 = u0 + bar + padX;
      lines.forEach((ln, k) => {
        const y = w0 + padY + lh * (k + 0.5) + 0.5;
        if (overflow) { c.textAlign = "left"; c.fillText(ln, tx0, y); } else { c.textAlign = "center"; c.fillText(ln, u0 + bar + (bw - bar) / 2, y); }
      });
      if (overflow) {
        const fx = u0 + bw * 0.82, fade = c.createLinearGradient(fx, 0, u0 + bw, 0);
        fade.addColorStop(0, css(stripC, 0)); fade.addColorStop(0.75, css(stripC)); fade.addColorStop(1, css(stripC));
        c.fillStyle = fade; c.fillRect(fx, w0, u0 + bw - fx, bh);
      }
      c.restore();
      c.restore();
      const r = bbox([f.at(u0, w0), f.at(u0 + bw, w0), f.at(u0 + bw, w0 + bh), f.at(u0, w0 + bh)]);
      out.signs.push({ id: p.id, text: p.name, lines, ...r, fontPx: fs });
    };
    blds.push({ key: dk(g.cx, g.y1), draw: () => {
      drawShell(g, mix(CREAM, base, 0.3), mix(base, [60, 66, 96], 0.25), mix(CREAM, [233, 205, 150], 0.7), working ? 1 : 0, pulse, ring, ents, 0.8, false, wallSign);
      const [fx, fy] = P(g.x0, g.y1, 0), [ex, ey] = P(g.x1, g.y0, g.H), [wx, wy] = P(g.x0, g.y0, g.H);
      out.buildings.push({ id: p.id, x0: Math.min(fx, wx) - 4, x1: ex + 6, y0: Math.min(ey, wy) - 6, y1: fy + 4 });
    } });

    // status badge pinned on the wall's top-right corner (screen space, above the cap)
    const badge = needs ? `!${needs}` : reviews ? `R${reviews}` : working ? String(working) : "";
    if (badge) plates.push(() => {
      const [ex, ey] = P(g.x1, g.y0, g.H);
      c.font = `800 12px ${FONT}`; const bw = Math.max(20, c.measureText(badge).width + 10), bx = ex - bw + 4, by = ey - 13;
      c.beginPath(); c.roundRect(bx, by, bw, 18, 9); c.fillStyle = needs ? "#f5a524" : reviews ? "#4f7bff" : "#2fb36d"; c.fill(); c.lineWidth = 1.5; c.strokeStyle = "#fff"; c.stroke();
      c.fillStyle = needs ? "#3a2200" : "#fff"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(badge, bx + bw / 2, by + 9.5);
    });
  });

  /* ---- HQ ---- */
  {
    const hq = l.hq, g = { x0: hq.x0, x1: hq.x1, y0: hq.y0, y1: hq.y1, H: HQ.h, cx: hq.cx };
    const ents: Ent[] = hqInterior;
    ents.push(deskEnt(hq.cx, hq.y0 + 1.7, 4.0, 0.9, null, "boss", 7, WHITE));
    for (const sx2 of [-1, 1]) ents.push({ key: dk(hq.cx + sx2 * 4.2, hq.y0 + 0.9), draw: () => { const [px, py] = P(hq.cx + sx2 * 4.2, hq.y0 + 0.9, 0); c.fillStyle = "#b9663b"; c.fillRect(px - S * 0.2, py - S * 0.34, S * 0.4, S * 0.34); c.fillStyle = "#3f9e55"; c.beginPath(); c.arc(px, py - S * 0.6, S * 0.34, 0, Math.PI * 2); c.fill(); c.fillStyle = "#62c474"; c.beginPath(); c.arc(px - S * 0.1, py - S * 0.72, S * 0.2, 0, Math.PI * 2); c.fill(); } });
    // boss, seated behind the big desk
    ents.push({ key: dk(hq.cx, hq.y0 + 1.7) - 0.1, draw: () => {
      const [sx, sy] = P(hq.cx, hq.y0 + 1.05, 0), H = Hc * 1.02;
      const [cx2, cy2] = P(hq.cx, hq.y0 + 0.8, 0.15); c.fillStyle = "#222a3b"; c.beginPath(); c.roundRect(cx2 - Hc * 0.45, cy2 - Hc * 1.0, Hc * 0.9, Hc * 0.95, Hc * 0.22); c.fill();
      drawChar(c, sx, sy, H, [214, 168, 60], { t: reduced ? 0 : t, phase: 3, variant: 2, face: 0 });
      const ty = sy - H * 0.52; c.fillStyle = "#c0322f"; c.beginPath(); c.moveTo(sx - H * 0.05, ty); c.lineTo(sx + H * 0.05, ty); c.lineTo(sx + H * 0.08, ty + H * 0.26); c.lineTo(sx, ty + H * 0.33); c.lineTo(sx - H * 0.08, ty + H * 0.26); c.closePath(); c.fill();
      c.fillStyle = "#1f2433"; c.fillRect(sx - H * 0.22, sy - H * 1.02, H * 0.44, H * 0.1);
    } });
    for (const a of actors) if (inFoot(a, g.x0, g.x1, g.y0, g.y1)) placeActor(a, parseColor(s.projects[projIdx.get(a.projectId) ?? 0]?.color ?? "#5b7fd1"), ents);
    // "HQ" painted in gold on a navy plaque that interrupts the gold banner stripe
    const hqSign = () => {
      const f = wallFrame(g.x0, g.x1, g.y0, g.H, 0);
      const fs = clamp(Math.round(f.H * 0.24), 12, 30);
      c.save(); c.transform(...f.m);
      c.font = `800 ${fs}px ${FONT}`;
      const tw = c.measureText("HQ").width, pw = tw + fs * 1.4, ph2 = fs * 1.35, cy = f.H * (1 - 0.81), u0 = (f.W - pw) / 2;
      c.beginPath(); c.roundRect(u0, cy - ph2 / 2, pw, ph2, Math.min(6, ph2 * 0.22)); c.fillStyle = "#26335f"; c.fill();
      c.lineWidth = Math.max(1.5, fs * 0.08); c.strokeStyle = "#e8be54"; c.stroke();
      c.fillStyle = "#ffe08a"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("HQ", f.W / 2, cy + 1);
      c.restore();
    };
    blds.push({ key: dk(g.cx, g.y1), draw: () => {
      drawShell(g, HQ_PAL.wall, HQ_PAL.trim, HQ_PAL.floor, 0, 0, null, ents, 0.9, true, hqSign);
      // flag
      const [fx, fy] = P(g.x1 - 0.3, g.y0 - 0.1, g.H), [ft, fyt] = P(g.x1 - 0.3, g.y0 - 0.1, g.H + 1.7);
      c.strokeStyle = "#d8dce8"; c.lineWidth = 2; c.beginPath(); c.moveTo(fx, fy); c.lineTo(ft, fyt); c.stroke();
      const wv = reduced ? 0 : Math.sin(t * 3) * 2; c.fillStyle = "#e8be54"; c.beginPath(); c.moveTo(ft, fyt); c.lineTo(ft + S * 0.9, fyt + S * 0.2 + wv); c.lineTo(ft, fyt + S * 0.5); c.closePath(); c.fill();
    } });
  }
  // hidden-field overflow chip
  if (fieldActors.length > MAX_FIELD) {
    const n = fieldActors.length - MAX_FIELD;
    bubbles.push(() => { const [x, y] = P(l.field.ball.x0 + 1, l.field.ball.y1 - 0.5); c.font = `800 12px ${FONT}`; const txt = `+${n}`, tw = c.measureText(txt).width + 12; c.beginPath(); c.roundRect(x, y - 9, tw, 18, 9); c.fillStyle = "#2a3350"; c.fill(); c.fillStyle = "#fff"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(txt, x + tw / 2, y + 0.5); });
  }

  blds.sort((a, b2) => a.key - b2.key);
  for (const e of blds) e.draw();
  for (const q of plates) q();
  props.sort((a, b2) => a.key - b2.key);
  for (const e of props) e.draw();
  for (const q of bubbles) q();
  return out;
}

