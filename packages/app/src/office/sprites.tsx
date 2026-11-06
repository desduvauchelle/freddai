import type { ReactElement } from "react";
import type { OfficeAgentState } from "./officeModel";

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
  if (state === "working") {
    const widths = [20, 12, 26, 16, 22, 9, 18, 24];
    const cols = ["#7bd88f", "#8fb0ff", "#7bd88f", "#f2c14e", "#7bd88f", "#8fb0ff", "#7bd88f", "#bfe9c9"];
    const lines = [...widths, ...widths].map((w, i) => <rect key={i} x={x + 2 + (i % 3) * 2} y={y + 1 + i * 3} width={w} height={2} fill={cols[i % 8]} />);
    return <g className="office-code"><g className="office-scroll">{lines}</g></g>;
  }
  if (state === "needs-you") return <><rect x={x + 2} y={y + 2} width={18} height={2} fill="#f2c14e" /><rect x={x + 2} y={y + 6} width={24} height={2} fill="#c79a2e" /><rect className="office-cursor" x={x + 2} y={y + 10} width={4} height={2} fill="#ffe08a" /></>;
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
    {typing && <><rect className="office-paw-l" x={22} y={48} width={3} height={2} fill={fur} /><rect className="office-paw-r" x={31} y={48} width={3} height={2} fill={fur} /></>}
    {state === "failed" && <><rect x={12} y={28} width={32} height={14} fill="none" stroke="#ff9a9a" strokeWidth={1} /><g className="office-smoke">{[0, 1, 2].map(i => <rect key={i} className={`office-puff office-puff-${i}`} x={34 + i * 3} y={22} width={3} height={3} fill="#a09eb0" />)}</g></>}
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
    {pose === "cup" && <g><rect x={8} y={-15} width={5} height={5} fill="#f4f1e8" /><rect x={8} y={-15} width={5} height={1} fill="#7a4a2a" /><rect x={13} y={-14} width={1} height={3} fill="#f4f1e8" /><rect className="office-steam" x={9} y={-19} width={1} height={3} fill="#d9d6e8" /><rect className="office-steam office-steam-b" x={11} y={-20} width={1} height={3} fill="#d9d6e8" /></g>}
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
