/* eslint-disable */
import React from "react";
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ShortShell } from "./ShortShell";
import { HookTitle } from "./HookTitle";
import { Turn, TURN_WIPE_SECONDS } from "./Turn";
import { EndCard } from "./EndCard";
import { SHORT_TIMELINES } from "./timelines";
import { C, clamp } from "../theme";
import { FONT_DISPLAY, FONT_MONO } from "../fonts";
import {
  Character, DeskFurniture, Plant, Bench, CoffeeMachine, Table, WallClock, ClockAdmirer, UserAvatar, Folder, Bubble, FUR,
  floorPlan, planRoute, CELL_H, SIDE, FACE, SOUTH, WALL, BAND_H,
} from "../uiOffice";
import type { PlacedRoom, PlanProject, Point } from "../uiOffice";

// Short 09 "office". The pixel Office rebuilt vertically: 2x2 rooms + band, driven by this short's own clock (t = local seconds),
// framed by a CSS camera (scale + focus point) inside a rounded panel. Floor plan, room shells, band and sprites are copied/imported from uiOffice.tsx.
const tl = SHORT_TIMELINES.office;
const TURN = tl.cues.turn;
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const mix = (a: string, b: string, t: number) => {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return "#" + [0, 1, 2].map((i) => Math.round(p(a, i) * (1 - t) + p(b, i) * t).toString(16).padStart(2, "0")).join("");
};
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const PROJECTS: PlanProject[] = [
  { id: "p0", name: "Freddai", color: "#5b7fd1" },
  { id: "p1", name: "Landing page", color: "#d15b7f" },
  { id: "p2", name: "Billing API", color: "#4cae7e" },
  { id: "p3", name: "Mobile app", color: "#9b6bd1" },
];
const LAYOUT = floorPlan(PROJECTS, 2);
// ---- walking schedule ----
type Phase = { at: number; to: string; endPose: "seated" | "stand"; carry?: boolean; arriveBy?: number; speed?: number };
type AgentSpec = { id: string; project: number; variant: number; start: string; startPose: "seated" | "stand"; phases: Phase[]; label: string };
const SPEED = 62; // logical px per second
const FOLDER_OUT = 10.5, FOLDER_IN = 13.0, LEAVE = 12.0, LOUNGE_AT = 13.85;
const AGENTS: AgentSpec[] = [
  // already at work at frame 0
  { id: "a1", project: 0, variant: 0, start: "seat:0:0", startPose: "seated", phases: [], label: "Fix flaky sync test" },
  { id: "a2", project: 1, variant: 1, start: "seat:1:0", startPose: "seated", phases: [], label: "Polish pricing page" },
  { id: "a3", project: 2, variant: 2, start: "seat:2:0", startPose: "seated", phases: [], label: "Add pagination" },
  { id: "a4", project: 3, variant: 3, start: "seat:3:0", startPose: "seated", phases: [], label: "Push notifications" },
  { id: "a8", project: 1, variant: 2, start: "seat:1:2", startPose: "seated", phases: [], label: "Fix nav on tablets" },
  { id: "a9", project: 3, variant: 0, start: "seat:3:3", startPose: "seated", phases: [], label: "Dark mode" },
  // finishes, carries its folder to the in-tray
  { id: "a6", project: 0, variant: 3, start: "seat:0:3", startPose: "seated", label: "Ship invoice export", phases: [{ at: FOLDER_OUT, to: "tray", endPose: "stand", carry: true, arriveBy: FOLDER_IN }] },
  // needs you: walks to the lounge
  { id: "a7", project: 0, variant: 2, start: "seat:0:2", startPose: "seated", label: "Add retry cap to webhooks", phases: [{ at: LEAVE, to: "lounge:1", endPose: "stand", arriveBy: LOUNGE_AT }] },
  // arrivals from the lobby: already walking at frame 0
  { id: "a5", project: 0, variant: 1, start: "seat:0:1", startPose: "seated", label: "Review PR comments", phases: [] },
  { id: "a10", project: 2, variant: 3, start: "seat:2:1", startPose: "seated", label: "Rate limits", phases: [] },
  { id: "a13", project: 2, variant: 1, start: "seat:2:2", startPose: "seated", label: "Webhook retries", phases: [] },
  { id: "a11", project: 1, variant: 0, start: "ready:p1", startPose: "stand", label: "Hero copy", phases: [{ at: -4.5, to: "seat:1:1", endPose: "seated", speed: 110 }] },
  { id: "a12", project: 3, variant: 2, start: "ready:p3", startPose: "stand", label: "Onboarding", phases: [{ at: -3.5, to: "seat:3:1", endPose: "seated", speed: 110 }] },
];
type Resolved = { t0: number; t1: number; pts: Point[]; cum: number[]; to: string; endPose: "seated" | "stand"; carry: boolean; speed: number; flipEnd: boolean };
const resolveAgent = (a: AgentSpec): Resolved[] => {
  let node = a.start;
  return a.phases.map((p) => {
    const names = planRoute(LAYOUT.nav, node, p.to)!;
    const pts = names.map((n) => LAYOUT.nav.nodes[n]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const len = cum[cum.length - 1];
    const speed = p.speed ?? (p.arriveBy !== undefined ? len / (p.arriveBy - p.at) : SPEED);
    const t0 = p.at;
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
// ---------- camera ----------
const W = LAYOUT.width, H = LAYOUT.height;
const roomC = (i: number): Point => ({ x: LAYOUT.rooms[i].x + LAYOUT.rooms[i].w / 2, y: LAYOUT.rooms[i].y + LAYOUT.rooms[i].h / 2 });
const LOUNGE_P = LAYOUT.loungeSpots[1], TRAY_P = LAYOUT.tray.stand;
const WIPE_END = TURN + TURN_WIPE_SECONDS;
type Key = { t: number; s: number; x: number; y: number };
const CAM: Key[] = [
  { t: 0, s: 1.3, x: W / 2, y: 222 },
  { t: WIPE_END, s: 1.3, x: W / 2, y: 222 },
  { t: WIPE_END + 0.03, s: 1.3, x: W / 2, y: H / 2 },     // overview, line 02 starts
  { t: 4.5, s: 1.3, x: W / 2, y: H / 2 },
  { t: 5.3, s: 3.3, x: roomC(0).x, y: roomC(0).y },       // pull across the rooms
  { t: 5.9, s: 3.3, x: roomC(0).x, y: roomC(0).y },
  { t: 6.7, s: 3.3, x: roomC(1).x, y: roomC(1).y },
  { t: 7.2, s: 3.3, x: roomC(1).x, y: roomC(1).y },
  { t: 7.9, s: 3.3, x: roomC(3).x, y: roomC(3).y },
  { t: 8.3, s: 3.3, x: roomC(3).x, y: roomC(3).y },
  { t: 9.1, s: 3.3, x: roomC(2).x, y: roomC(2).y },
  { t: 9.25, s: 3.3, x: roomC(2).x, y: roomC(2).y },
  { t: 9.9, s: 3.6, x: roomC(0).x, y: roomC(0).y + 4 },   // line 03: push into room 0
  { t: 11.6, s: 3.6, x: roomC(0).x, y: roomC(0).y + 4 },
  { t: 12.2, s: 1.3, x: W / 2, y: H / 2 },                // follow the folder out
  { t: 12.4, s: 1.3, x: W / 2, y: H / 2 },
  { t: 13.0, s: 3.2, x: TRAY_P.x - 20, y: TRAY_P.y - 24 },
  { t: 13.3, s: 3.2, x: TRAY_P.x - 20, y: TRAY_P.y - 24 },
  { t: 14.0, s: 3.4, x: LOUNGE_P.x + 6, y: LOUNGE_P.y - 20 }, // line 04: the lounge
];
// keep the view inside the world (no void beyond the walls)
const clampKey = (k: Key): Key => {
  const top = panelTop(k.t), vw = PANEL_W / k.s, vh = (PANEL_BOTTOM - top) / k.s;
  return { ...k, x: vw >= W ? W / 2 : Math.min(W - vw / 2, Math.max(vw / 2, k.x)), y: vh >= H ? H / 2 : Math.min(H - vh / 2, Math.max(vh / 2, k.y)) };
};
const cam = (t: number): Key => clampKey(camRaw(t));
const camRaw = (t: number): Key => {
  if (t <= CAM[0].t) return CAM[0];
  for (let i = 1; i < CAM.length; i++) if (t <= CAM[i].t) {
    const a = CAM[i - 1], b = CAM[i], k = interpolate(t, [a.t, b.t], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
    return { t, s: a.s + (b.s - a.s) * k, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }
  return CAM[CAM.length - 1];
};
const PANEL_X = 40, PANEL_W = 1000, PANEL_BOTTOM = 1100;
const panelTop = (t: number) => (t < WIPE_END + 0.02 ? 560 : 232);
const toPage = (t: number, p: Point) => {
  const c = cam(t), top = panelTop(t), h = PANEL_BOTTOM - top;
  return { x: PANEL_X + PANEL_W / 2 + (p.x - c.x) * c.s, y: top + h / 2 + (p.y - c.y) * c.s };
};

const OfficeSvg: React.FC<{ t: number }> = ({ t }) => {
  const frame = useCurrentFrame(), { fps } = useVideoConfig();
  const now = PLANS.map((p) => agentAt(p, t));
  const toBy = (id: string) => now.find((n) => n.id === id)!;
  const totals = PROJECTS.map((_, i) => {
    const mine = now.filter((n) => n.spec.project === i);
    return { msgs: [14, 9, 11, 6][i] + Math.floor(Math.max(0, t) / 2.1), threads: mine.length, working: mine.filter((n) => !n.moving && n.pose === "seated").length };
  });
  const lounged = now.filter((n) => n.place === "lounge" && !n.moving && n.arrivedAt !== null);
  const trayArr = toBy("a6");
  const folders = [{ color: PROJECTS[0].color, at: -100 }, ...(trayArr.place === "tray" && !trayArr.moving ? [{ color: PROJECTS[0].color, at: trayArr.arrivedAt! }] : [])];
  const drawn = [...now].sort((a, b) => a.y - b.y);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", shapeRendering: "crispEdges" }}>
      <Defs />
      <rect x={-200} y={-200} width={W + 400} height={H + 400} fill="#221e2c" />
      <rect x={WALL} y={WALL} width={LAYOUT.innerW} height={H - 2 * WALL} fill="url(#o-hall)" />
      {LAYOUT.corridors.map((b, i) => (
        <g key={i}>
          <rect x={b.x} y={b.line - 6} width={b.w} height={12} fill="#4b5170" opacity={0.5} />
          {LAYOUT.rooms.filter((r) => Math.abs(r.y + r.h - b.y) < 1).map((r) => <rect key={r.index} x={Math.round(r.doorX - 14)} y={b.y + 1} width={28} height={7} fill="#7a3f52" />)}
        </g>
      ))}
      {LAYOUT.rooms.map((r) => {
        const desks = new Map<number, AgentNow>();
        for (const n of now) {
          const m = /^seat:(\d+):(\d+)$/.exec(n.spec.start);
          if (m && +m[1] === r.index && !(n.moving || n.place !== "desk")) desks.set(+m[2], n);
          for (const ph of PLANS.find((q) => q.spec.id === n.id)!.phases) { const mm = /^seat:(\d+):(\d+)$/.exec(ph.to); if (mm && +mm[1] === r.index && n.place === "desk" && !n.moving) desks.set(+mm[2], n); }
        }
        return <RoomShell key={r.index} r={r} seatedDesks={desks} totals={totals[r.index]} t={t} />;
      })}
      <Band waiting={lounged.length} folders={folders} t={t} />
      {LAYOUT.projectWaiting.map((spot, i) => {
        const walker = PLANS.find((p) => p.spec.start === `ready:${spot.project.id}`);
        const dep = walker ? walker.phases[0].t0 : null;
        const show = dep === null || t > dep + 1.6;
        return show ? <g key={i}>
          <rect x={spot.x - 10} y={spot.y - 2} width={20} height={5} fill={spot.project.color} opacity={0.4} />
          <Character x={spot.x} y={spot.y} variant={(i + 1) % 4} shirtColor={spot.project.color} pose="stand" />
        </g> : null;
      })}
      {drawn.map((n) => {
        const seated = !n.moving && n.pose === "seated";
        const isNeed = n.id === "a7" && !n.moving && n.arrivedAt !== null;
        const k = isNeed ? spring({ frame: Math.round((t - n.arrivedAt!) * fps), fps, config: { damping: 9, stiffness: 240, mass: 0.6 } }) : 0;
        return (
          <g key={n.id}>
            <Character x={n.x} y={n.y} variant={n.spec.variant} shirtColor={PROJECTS[n.spec.project].color} pose={seated ? "seated" : "stand"} moving={n.moving} frame={(Math.floor(frame / 5) % 2) as 0 | 1} flip={n.flip} carry={n.carry} folder={PROJECTS[n.spec.project].color} />
            {isNeed && (
              <g transform={`translate(${n.x} ${n.y - 44}) scale(${Math.max(0.01, k)}) translate(${-n.x} ${-(n.y - 44)})`}>
                <rect x={n.x - 12} y={n.y + 2} width={24} height={6} fill="#f2c14e" opacity={0.28 + 0.14 * Math.sin(frame / 5)} />
                <Bubble x={n.x - 9} y={n.y - 44} w={18} h={15} glyph="?" fill="#f2c14e" size={13} tag={1} />
              </g>
            )}
          </g>
        );
      })}
      <rect x={0} y={0} width={W} height={WALL} fill="#2a2536" /><rect x={0} y={0} width={WALL} height={H} fill="#2a2536" /><rect x={W - WALL} y={0} width={WALL} height={H} fill="#2a2536" />
      <rect x={0} y={H - WALL} width={LAYOUT.door.x - 4} height={WALL} fill="#2a2536" /><rect x={LAYOUT.door.x + 32} y={H - WALL} width={W - LAYOUT.door.x - 32} height={WALL} fill="#2a2536" />
    </svg>
  );
};

const Arrow: React.FC<{ size?: number; ring?: number }> = ({ size = 64, ring = 0 }) => (
  <svg width={size} height={size * 1.4} viewBox="0 0 16 22" style={{ overflow: "visible", filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.5))" }}>
    {ring > 0 && <circle cx={1} cy={1} r={4 + ring * 14} fill="none" stroke="#fff" strokeWidth={0.8} opacity={1 - ring} />}
    <path d="M1 1 L1 17 L5 13 L8 20 L11 19 L8 12 L14 12 Z" fill="#fff" stroke="#111" strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
);

const CLICK_AT = 15.4;

const OfficeStage: React.FC = () => {
  const frame = useCurrentFrame(), { fps } = useVideoConfig();
  const t = frame / fps;
  const c = cam(t), top = panelTop(t), h = PANEL_BOTTOM - top;
  const revealP = t < WIPE_END ? 1 : interpolate(t, [WIPE_END, WIPE_END + 0.25], [0, 1], clamp);
  const now = PLANS.map((p) => agentAt(p, t));
  const working = now.filter((n) => !n.moving && n.pose === "seated").length;
  const need = now.some((n) => n.id === "a7" && !n.moving && n.arrivedAt !== null) ? 1 : 0;
  const chip = [`${working} working`, need ? `${need} needs you` : ""].filter(Boolean).join("  ·  ");

  // agent cursor: glides in from off-screen right, clicks the "?" agent
  const a7 = agentAt(PLANS.find((p) => p.spec.id === "a7")!, CLICK_AT);
  const target = toPage(CLICK_AT, { x: a7.x, y: a7.y - 20 });
  const start = { x: 1180, y: 560 };
  const mk = interpolate(t, [CLICK_AT - 1.3, CLICK_AT - 0.1], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const cx = start.x + (target.x - start.x) * mk, cy = start.y + (target.y - start.y) * mk;
  const clickF = Math.round((t - CLICK_AT) * fps);
  const ring = clickF >= 0 && clickF < 14 ? clickF / 14 : 0;
  const press = clickF >= 0 && clickF < 4 ? 0.86 : 1;
  const sheet = spring({ frame: Math.max(0, clickF - 3), fps, config: { damping: 18, stiffness: 170, mass: 0.9 } });
  const sheetOn = clickF >= 3;
  return (
    <>
      <div style={{ position: "absolute", left: PANEL_X, top, width: PANEL_W, height: h, borderRadius: 32, overflow: "hidden", background: "#1b1a24", boxShadow: "0 30px 90px rgba(40,45,35,0.35), 0 0 0 3px rgba(40,45,35,0.5)", opacity: revealP, transform: `translateY(${(1 - revealP) * 24}px)` }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, transformOrigin: "0 0", transform: `translate(${PANEL_W / 2 - c.x * c.s}px, ${h / 2 - c.y * c.s}px) scale(${c.s})` }}>
          <OfficeSvg t={t} />
        </div>
      </div>
      {t >= WIPE_END && (
        <div style={{ position: "absolute", left: PANEL_X, top: 172, padding: "4px 26px", borderRadius: 999, background: "#1b1a24", color: "#ece8f4", fontFamily: FONT_MONO, fontWeight: 800, fontSize: 38, letterSpacing: 1, opacity: revealP }}>{chip}</div>
      )}
      {mk > 0 && <div style={{ position: "absolute", left: cx, top: cy, transform: `scale(${press})`, transformOrigin: "0 0" }}><Arrow ring={ring} /></div>}
      {sheetOn && (
        <div style={{ position: "absolute", left: 70, width: 940, top: 252, height: 350, borderRadius: 28, background: C.bgDark, border: `3px solid ${C.line}`, boxShadow: "0 30px 90px rgba(0,0,0,0.55)", color: C.textDark, fontFamily: FONT_DISPLAY, padding: "26px 34px", boxSizing: "border-box", opacity: sheet, transform: `translateY(${(1 - sheet) * -120}px)` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 22, height: 22, borderRadius: 6, background: PROJECTS[0].color }} />
            <div style={{ fontSize: 40, fontWeight: 800 }}>Add retry cap</div>
            <div style={{ marginLeft: "auto", fontSize: 36, fontWeight: 800, color: "#1b1a24", background: "#f2c14e", borderRadius: 999, padding: "4px 22px" }}>Needs you</div>
          </div>
          <div style={{ marginTop: 22, border: `2px solid ${C.line}`, borderRadius: 20, padding: "16px 24px", fontSize: 38, lineHeight: 1.25 }}>Retry cap: 5 attempts, or unlimited?</div>
          <div style={{ display: "flex", gap: 20, marginTop: 26 }}>
            {["5 attempts", "Unlimited"].map((o, i) => <div key={o} style={{ flex: 1, textAlign: "center", fontSize: 40, fontWeight: 750, padding: "20px 0", borderRadius: 18, border: `3px solid ${i === 0 ? C.sage : C.line}`, color: i === 0 ? C.sage : C.textDark }}>{o}</div>)}
          </div>
        </div>
      )}
    </>
  );
};

export const Short09Office: React.FC = () => {
  const turnEnd = Math.round(WIPE_END * 30);
  return (
    <ShortShell tl={tl} end={<EndCard at={tl.cues.endcard} />}>
      <OfficeStage />
      <HookWrap until={turnEnd} />
      <Turn at={TURN} />
    </ShortShell>
  );
};

const HookWrap: React.FC<{ until: number }> = ({ until }) => {
  const frame = useCurrentFrame();
  return frame < until ? <HookTitle lines={["Watch your agents", "work. Literally."]} accent="Literally" /> : null;
};
