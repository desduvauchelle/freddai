import { formatProjectName } from "../projectName";
import { createPortal } from "react-dom";
import { OfficeVersionPicker } from "../officeShared/OfficeVersionPicker";
import { Eye, EyeOff, Maximize2, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Project, Session } from "../desktop/types";
import { officeModel, STATE_CUE, STATE_LABEL, type OfficeAgent, type OfficeAgentState, type OfficeCard, type OfficeModel, type OfficeProposal, type OfficeSchedule } from "./officeModel";
import { BAND_H, CELL_H, FACE, SIDE, SOUTH, TRAY_COLS, TRAY_MAX, WALL, bestFullLayout, floorPlan, miniCols, type Layout, type PlacedRoom, type PlanProject } from "./officeLayout";
import { readRecentOnly, recentProjects, writeRecentOnly } from "./officeFilter";
import { useOfficeStage, type Char, type Stage } from "./officeStage";
import { Bench, Bubble, Character, ClockAdmirer, CoffeeMachine, DeskFurniture, Folder, Plant, STATE_COLOR, Table, UserAvatar, WallClock, FUR } from "./sprites";
import "./office.css";

export type OfficeProps = {
  projectNameUppercase?: boolean;
  sessions: readonly Session[];
  projects: readonly Project[];
  /** Commander proposals; pending `freddai_start_task` holds appear as sticky notes on empty desks. */
  proposals?: readonly OfficeProposal[];
  /** Approve (true) or dismiss (false) a held proposal. Omit for view-only cards. Must reject on failure; the office shows the error. */
  onProposalRespond?: (proposalId: string, approve: boolean) => Promise<unknown>;
  /** Optional scheduled work; represented by admirers at the clock shrine beside the coffee lounge. */
  schedules?: readonly OfficeSchedule[];
  /** Thread ids with queued runs; a settled thread in this set waits in the lobby. Omit if the host has no queue data. */
  queuedThreadIds?: ReadonlySet<string>;
  /** Injectable clock for tests; defaults to Date.now(). */
  now?: number;
  /** "mini" is an inline card; "full" is a fixed overlay covering the whole window. */
  variant: "mini" | "full";
  onOpenThread: (id: string) => void;
  /** Opens the dedicated executive office instead of creating a project task. */
  onOpenCommander?: () => void;
  /** Mini only: called when the user expands the office (the office also opens its own overlay). */
  onExpand?: () => void;
  /** Called when the full overlay is dismissed (close button or Escape). */
  onClose?: () => void;
  /** Project-scoped hold-to-talk controls, shared by mini and expanded offices. */
  renderTaskControls?: (project: string, onListening: (listening: boolean) => void) => ReactNode;
};

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const MINI_PAD = 16;
const STATES: OfficeAgentState[] = ["working", "needs-you", "failed", "starting", "done"];

const timeLabel = (due: number, now: number) => {
  const d = new Date(due), t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return new Date(now).toDateString() === d.toDateString() ? t : `${d.toLocaleDateString([], { weekday: "short" })} ${t}`;
};
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1))}…`);

const channel = (hex: string) => { const h = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? "888888"; return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
/** `amount` of `hex` over `base`. */
function mix(hex: string, base: string, amount: number) {
  const a = channel(hex), b = channel(base);
  return `#${a.map((v, i) => Math.round(b[i] + (v - b[i]) * amount).toString(16).padStart(2, "0")).join("")}`;
}

type Tip = { agent: OfficeAgent; x: number; y: number; below: boolean };

/** The plan inputs, kept referentially stable until a project is added, removed, renamed or recoloured. */
function usePlanProjects(projects: readonly Project[]): PlanProject[] {
  "use no memo"; // compares against a ref during render so the identity only changes with the project list
  const key = projects.map(p => `${p.id}\u0000${p.name}\u0000${p.color}\u0000${p.kind ?? ""}`).join("\u0001");
  const ref = useRef<{ key: string; value: PlanProject[] } | null>(null);
  if (!ref.current || ref.current.key !== key) ref.current = { key, value: projects.map(p => ({ id: p.id, name: p.name, color: p.color, kind: p.kind })) };
  return ref.current.value;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

function FloorDefs({ id, rooms }: { id: string; rooms: PlacedRoom[] }) {
  return <defs>
    <clipPath id="office-scr"><rect x={12} y={28} width={32} height={14} /></clipPath>
    <pattern id={`${id}-hall`} width={32} height={32} patternUnits="userSpaceOnUse"><rect width={32} height={32} fill="#3a3e50" /><rect width={16} height={16} fill="#434858" /><rect x={16} y={16} width={16} height={16} fill="#434858" /></pattern>
    <pattern id={`${id}-lobby`} width={32} height={8} patternUnits="userSpaceOnUse"><rect width={32} height={8} fill="#6a4a38" /><rect width={32} height={1} fill="#5a3e2e" /><rect x={14} width={1} height={8} fill="#5a3e2e" /></pattern>
    <pattern id={`${id}-lounge`} width={16} height={16} patternUnits="userSpaceOnUse"><rect width={16} height={16} fill="#d7c8ad" /><rect width={8} height={8} fill="#c8b794" /><rect x={8} y={8} width={8} height={8} fill="#c8b794" /></pattern>
    <pattern id={`${id}-you`} width={8} height={8} patternUnits="userSpaceOnUse"><rect width={8} height={8} fill="#3c4a72" /><rect width={4} height={4} fill="#43527c" /><rect x={4} y={4} width={4} height={4} fill="#43527c" /></pattern>
    {rooms.map(r => {
      const a = mix(r.project.color, "#2e2a3a", 0.34), b = mix(r.project.color, "#2e2a3a", 0.44), k = r.index % 4;
      return <pattern key={r.index} id={`${id}-f${r.index}`} width={32} height={32} patternUnits="userSpaceOnUse">
        <rect width={32} height={32} fill={a} />
        {k === 0 && <><rect width={16} height={16} fill={b} /><rect x={16} y={16} width={16} height={16} fill={b} /></>}
        {k === 1 && [0, 8, 16, 24].map(y => <rect key={y} y={y} width={32} height={1} fill={b} />)}
        {k === 2 && <><rect width={32} height={1} fill={b} /><rect width={1} height={32} fill={b} /><rect x={16} width={1} height={32} fill={b} /><rect y={16} width={32} height={1} fill={b} /></>}
        {k === 3 && [0, 16].map(x => <rect key={x} x={x} width={8} height={32} fill={b} />)}
      </pattern>;
    })}
  </defs>;
}

/** A single executive presence, never a clone for each Commander conversation. */
function BossRoom({ r, commander }: { r: PlacedRoom; commander: OfficeModel["commander"] }) {
  const { x, y, w, h, floorY, project } = r, cx = x + Math.round(w / 2);
  const working = commander?.state === "working";
  return <g className="office-boss-suite" data-state={commander?.state ?? "idle"}>
    <rect className="office-floor" x={x} y={floorY} width={w} height={h - FACE} fill="#343043" />
    <rect x={x + SIDE + 8} y={floorY + 12} width={w - 2 * SIDE - 16} height={h - FACE - 26} fill="#504060" />
    <rect x={x + SIDE + 11} y={floorY + 15} width={w - 2 * SIDE - 22} height={h - FACE - 32} fill="none" stroke="#c7a966" strokeWidth={2} />
    <rect x={x} y={y} width={w} height={FACE} fill="#302938" />
    <rect x={x + 8} y={y + 6} width={w - 16} height={25} fill="#211d29" stroke="#c7a966" strokeWidth={2} />
    <text x={cx} y={y + 18} textAnchor="middle" fontFamily={MONO} fontSize={11} fontWeight={800} fill="#f5d58f">BOSS'S OFFICE</text>
    <text x={cx} y={y + 27} textAnchor="middle" fontFamily={MONO} fontSize={7} fill="#ece0c5">{clip(project.name, Math.floor((w - 28) / 4.3))}{working ? " · working" : ""}</text>
    <rect x={x} y={y} width={SIDE} height={h} fill="#211d29" /><rect x={x + w - SIDE} y={y} width={SIDE} height={h} fill="#211d29" />
    <rect x={x} y={y + h - SOUTH} width={w / 2 - 17} height={SOUTH} fill="#211d29" /><rect x={cx + 17} y={y + h - SOUTH} width={w / 2 - 17} height={SOUTH} fill="#211d29" />
    <g className="office-executive-desk" aria-hidden="true">
      <rect x={cx - 15} y={floorY + 33} width={30} height={30} rx={3} fill="#262332" stroke="#c7a966" />
      <Character x={cx} y={floorY + 55} variant={2} shirtColor="#c7a966" pose="seated" />
      {working && <g className="office-attn"><Bubble x={cx + 8} y={floorY + 20} w={20} h={14} glyph="..." fill="#7bd88f" size={11} /></g>}
      <rect x={cx - 32} y={floorY + 51} width={20} height={10} fill={working ? "#6fcf97" : "#496c65"} />
      <rect x={cx - 53} y={floorY + 56} width={106} height={24} fill="#875937" /><rect x={cx - 53} y={floorY + 56} width={106} height={4} fill="#c89e65" />
      <rect x={cx - 45} y={floorY + 80} width={14} height={11} fill="#5a3d2c" /><rect x={cx + 31} y={floorY + 80} width={14} height={11} fill="#5a3d2c" />
      <rect x={cx - 34} y={floorY + 49} width={24} height={15} fill="#1e222c" /><rect x={cx - 32} y={floorY + 51} width={20} height={10} fill="#496c65" />
      <rect x={cx + 15} y={floorY + 64} width={16} height={10} fill="#f3e7d3" /><rect x={cx - 13} y={floorY + 72} width={26} height={6} fill="#d5b16a" />
      <rect x={cx - 34} y={floorY + 112} width={68} height={18} fill="#805f49" /><rect x={cx - 31} y={floorY + 114} width={62} height={12} fill="#a7896a" />
      <Plant x={x + SIDE + 12} y={y + h - SOUTH - 24} /><Plant x={x + w - SIDE - 24} y={y + h - SOUTH - 24} />
    </g>
  </g>;
}

type CardActions = { respond?: (card: OfficeCard, approve: boolean) => void; busy: ReadonlySet<string> };

/** A sticky note on a desk or the reception: task title plus Approve / Dismiss when the host can answer proposals. */
function StickyCard({ x, y, card, actions }: { x: number; y: number; card: OfficeCard; actions: CardActions }) {
  const w = 46, h = 36, busy = actions.busy.has(card.proposalId), title = card.title.trim();
  const l1 = clip(title, 13), l2 = title.length > 13 ? clip(title.slice(13).trim(), 13) : "";
  const btn = (bx: number, label: string, glyph: string, fill: string, approve: boolean) => <g role="button" tabIndex={busy ? -1 : 0} aria-disabled={busy || undefined} aria-label={`${label}: ${title}`} className="office-card-btn"
    onClick={e => { e.stopPropagation(); if (!busy) actions.respond?.(card, approve); }}
    onKeyDown={(e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); if (!busy) actions.respond?.(card, approve); } }}>
    <rect x={bx} y={y + h - 12} width={19} height={10} fill={fill} stroke="#1b1a24" strokeWidth={0.8} opacity={busy ? 0.5 : 1} /><text x={bx + 9.5} y={y + h - 4.6} textAnchor="middle" fontSize={7} fontWeight={800} fill="#1b1a24" fontFamily={MONO}>{glyph}</text>
  </g>;
  return <g className="office-card" role="group" aria-label={`Proposed task: ${title}`}>
    <title>{title}</title>
    <rect x={x + 1} y={y + 2} width={w} height={h} fill="#000" opacity={0.25} /><rect x={x} y={y} width={w} height={h} fill="#f6e27a" /><rect x={x} y={y} width={w} height={4} fill="#e3c84f" />
    <text x={x + 3} y={y + 11} fontSize={5.4} fontWeight={700} fill="#3a3010" fontFamily={MONO}>{l1}</text>
    {l2 && <text x={x + 3} y={y + 18} fontSize={5.4} fontWeight={700} fill="#3a3010" fontFamily={MONO}>{l2}</text>}
    {actions.respond && <>{btn(x + 3, "Approve", "OK", "#7bd88f", true)}{btn(x + w - 22, "Dismiss", "NO", "#ef8f8f", false)}</>}
  </g>;
}

function RoomShell({ r, id, stage, extra, commander, cards, actions }: { r: PlacedRoom; id: string; stage: Stage; extra: { overflow: number }; commander: OfficeModel["commander"]; cards: OfficeCard[]; actions: CardActions }) {
  if (r.project.kind === "commander") return <BossRoom r={r} commander={commander} />;
  const { x, y, w, h, project } = r, color = project.color;
  const door = 34, dx = Math.round(r.doorX - door / 2), floorY = r.floorY;
  const plateW = w - 16, chars = Math.floor((plateW - 12) / 8.1);
  const name = project.name.trim();
  const split = name.length > chars ? Math.max(name.lastIndexOf(" ", chars), 0) || chars : name.length;
  const nameLines = [name.slice(0, split), name.slice(split).trim()].filter(Boolean);
  const rugW = w - 2 * SIDE - 20, rugH = 2 * CELL_H - 26;
  const owners = stage.destinations.owners.get(r.index);
  const charById = new Map(stage.chars.map(c => [c.agent.id, c] as const));
  return <g>
    {/* floor, rug */}
    <rect className="office-floor" x={x} y={floorY} width={w} height={h - FACE} fill={`url(#${id}-f${r.index})`} />
    <rect x={x + SIDE + 10} y={floorY + 18} width={rugW} height={rugH} fill={mix(color, "#241f2e", 0.3)} opacity={0.75} /><rect x={x + SIDE + 12} y={floorY + 20} width={rugW - 4} height={rugH - 4} fill="none" stroke={mix(color, "#ffffff", 0.55)} strokeWidth={1} opacity={0.5} />
    {/* north wall */}
    <rect x={x} y={y} width={w} height={4} fill="#2a2536" /><rect x={x} y={y + 4} width={w} height={FACE - 4} fill="#e0d7c6" /><rect x={x} y={y + FACE - 4} width={w} height={4} fill="#b9ae9a" /><rect x={x} y={y + FACE - 1} width={w} height={1} fill="#6b6275" />
    {/* side + south walls with a doorway */}
    <rect x={x} y={y} width={SIDE} height={h} fill="#2a2536" /><rect x={x + w - SIDE} y={y} width={SIDE} height={h} fill="#2a2536" />
    <rect x={x} y={y + h - SOUTH} width={dx - x} height={SOUTH} fill="#2a2536" /><rect x={dx + door} y={y + h - SOUTH} width={x + w - dx - door} height={SOUTH} fill="#2a2536" />
    <rect x={dx - 2} y={y + h - SOUTH} width={2} height={SOUTH} fill="#8a5f36" /><rect x={dx + door} y={y + h - SOUTH} width={2} height={SOUTH} fill="#8a5f36" />
    <rect x={dx} y={y + h - SOUTH} width={door} height={SOUTH} fill={mix(color, "#1b1a24", 0.5)} opacity={0.55} />
    {/* Project titles use the whole wall sign on every screen size. */}
    <rect className="office-project-plate-border" x={x + 7} y={y + 5} width={plateW + 2} height={30} fill="#1b1a24" /><rect className="office-project-plate" x={x + 8} y={y + 6} width={plateW} height={28} fill="#2c2638" /><rect x={x + 8} y={y + 6} width={plateW} height={3} fill={color} />
    <text className="office-project-name" x={x + 8 + plateW / 2} y={y + (nameLines.length > 1 ? 20 : 27)} textAnchor="middle" fontSize={13} fontWeight={700} fill="#f4f1fa" fontFamily={MONO}>
      {nameLines.map((line, i) => <tspan key={i} x={x + 8 + plateW / 2} dy={i ? 12 : 0}>{clip(line, chars)}</tspan>)}
    </text>
    {extra.overflow > 0 && <g aria-label={`${extra.overflow} more agents`}><rect x={x + w - 30} y={y + 36} width={22} height={13} fill="#1b1a24" /><rect x={x + w - 29} y={y + 37} width={20} height={11} fill="#f2c14e" /><text x={x + w - 19} y={y + 45.6} textAnchor="middle" fontSize={8} fontWeight={800} fill="#1b1a24" fontFamily={MONO}>+{extra.overflow}</text></g>}
    {/* desks: chair, monitor, desk (agents are drawn separately) */}
    {r.desks.map(d => {
      const owner = owners?.get(d.slot), ch = owner ? charById.get(owner.id) : undefined;
      const seated = !!ch && !ch.moving && ch.pose === "seated";
      const screen: OfficeAgentState = !owner ? "idle" : owner.state === "working" ? (seated ? "working" : "idle") : owner.state === "failed" || owner.state === "needs-you" ? owner.state : "idle";
      return <DeskFurniture key={d.slot} x={d.x} y={d.y} state={screen} typing={seated && owner?.state === "working"} fur={FUR[(owner?.variant ?? 0) % 4]} />;
    })}
    {(() => { const free = r.desks.filter(d => !owners?.has(d.slot)).reverse(); return cards.slice(0, free.length).map((c, i) => <StickyCard key={c.id} x={free[i].x + 5} y={free[i].y + 10} card={c} actions={actions} />); })()}
    <Plant x={x + SIDE + 2} y={y + h - SOUTH - 14} /><Plant x={x + w - SIDE - 14} y={y + h - SOUTH - 14} />
  </g>;
}

/** Interactive wrapper shared by characters and tray folders: button semantics, keyboard open, tooltip. */
function Hot({ agent, label, onOpen, show, hide, children, rect }: { agent: OfficeAgent; label: string; onOpen: (id: string) => void; show: (a: OfficeAgent, el: Element) => void; hide: () => void; children: ReactNode; rect: { x: number; y: number; w: number; h: number } }) {
  return <g className="office-agent" data-state={agent.state} role="button" tabIndex={0} aria-label={label} style={{ cursor: "pointer" }}
    onClick={e => { e.stopPropagation(); onOpen(agent.threadId); }}
    onKeyDown={(e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onOpen(agent.threadId); } }}
    onPointerEnter={e => show(agent, e.currentTarget)} onPointerLeave={hide} onFocus={e => show(agent, e.currentTarget)} onBlur={hide}>
    <rect className="office-hit" x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="transparent" />
    {children}
    <rect className="office-focus" x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="none" strokeWidth={2} />
  </g>;
}

function CharacterView({ c, onOpen, show, hide }: { c: Char; onOpen: (id: string) => void; show: (a: OfficeAgent, el: Element) => void; hide: () => void }) {
  const a = c.agent, seated = c.pose === "seated" && !c.moving;
  const pose = c.moving ? "stand" : c.pose;
  const rect = seated ? { x: c.x - 26, y: c.y - 16, w: 52, h: 44 } : { x: c.x - 11, y: c.y - 24, w: 22, h: 26 };
  const bubble = !seated && (a.state === "needs-you" || a.state === "failed");
  return <Hot agent={a} label={`${a.projectName} · ${a.title} · ${a.stateLabel}`} onOpen={onOpen} show={show} hide={hide} rect={rect}>
    <g className={c.leaving ? "office-char office-leaving" : "office-char"}>
      <Character x={c.x} y={c.y} variant={a.variant} shirtColor={a.projectColor} pose={pose} moving={c.moving} frame={c.frame} flip={c.flip} carry={c.carry} folder={a.projectColor} />
    </g>
    {bubble && <g className="office-attn"><Bubble x={c.x - 9} y={c.y - 44} w={18} h={15} glyph={a.state === "failed" ? "!" : "?"} fill={a.state === "failed" ? "#ef5f5f" : "#f2c14e"} size={13} tag={a.state === "needs-you" ? a.tag : null} /></g>}
  </Hot>;
}

function Band({ layout, id, model, stage, now, show, hide, onOpen, actions }: { actions: CardActions; layout: Layout; id: string; model: OfficeModel; stage: Stage; now: number; show: (a: OfficeAgent, el: Element) => void; hide: () => void; onOpen: (id: string) => void }) {
  const { lobby, lounge, shrine, you, reception: rc, coffee, tray, deskUser, band } = layout;
  const by = band.y, doorX = layout.door.x;
  const { lobbyExtra, loungeExtra } = stage.destinations;
  const folders = model.tray.filter(a => !stage.carrying.has(a.id));
  const shown = folders.slice(0, TRAY_MAX), more = folders.length - shown.length;
  const plate = (x: number, y: number, w: number, text: string, size = 7) => <g><rect x={x - 1} y={y - 1} width={w + 2} height={11} fill="#1b1a24" /><rect x={x} y={y} width={w} height={9} fill="#2c2638" /><text x={x + w / 2} y={y + 7.2} textAnchor="middle" fontSize={size} fontWeight={800} fill="#f4f1fa" fontFamily={MONO} letterSpacing={0.4}>{text}</text></g>;
  const waiting = model.agents.filter(a => a.place === "lounge").length;
  return <g>
    {/* floors */}
    <rect className="office-floor" x={lobby.x} y={by} width={lobby.w} height={BAND_H} fill={`url(#${id}-lobby)`} />
    <rect className="office-floor" x={lounge.x} y={by} width={lounge.w} height={BAND_H} fill={`url(#${id}-lounge)`} />
    <rect className="office-floor" x={you.x} y={by} width={you.w} height={BAND_H} fill={`url(#${id}-you)`} />
    <rect x={lounge.x - 1} y={by + 6} width={3} height={BAND_H - 6} fill="#2a2536" /><rect x={you.x - 1} y={by + 6} width={3} height={BAND_H - 6} fill="#2a2536" />
    <rect x={WALL} y={by} width={band.w} height={2} fill="#2a2536" opacity={0.5} />

    {/* lobby: reception desk with the receptionist, waiting benches, front door */}
    <g role="group" aria-label="Lobby">
      {plate(lobby.x + 38, by + 5, 50, "LOBBY")}
      {model.cards.filter(c => c.projectId === null).slice(0, 2).map((c, i) => <StickyCard key={c.id} x={lobby.x + 92 + i * 50} y={by + 4} card={c} actions={actions} />)}
      <Character x={rc.x + rc.w - 12} y={rc.y + 4} variant={2} pose="seated" headset />
      <rect x={rc.x + 6} y={rc.y - 8} width={14} height={9} fill="#23222d" /><rect x={rc.x + 7} y={rc.y - 7} width={12} height={6} fill="#14203a" /><rect x={rc.x + 10} y={rc.y + 1} width={6} height={2} fill="#4a4860" />
      <rect x={rc.x} y={rc.y} width={rc.w} height={13} fill="#b98550" /><rect x={rc.x} y={rc.y} width={rc.w} height={3} fill="#d9a86e" /><rect x={rc.x} y={rc.y + 13} width={rc.w} height={4} fill="#8a5f36" />
      <text x={rc.x + rc.w / 2} y={rc.y + 10.5} textAnchor="middle" fontSize={5} fontWeight={800} fill="#2a1a0c" fontFamily={MONO} letterSpacing={0.5}>RECEPTION</text>
      {layout.benches.map(b => <Bench key={b.node} x={b.x} y={b.y} />)}
      <text x={lobby.x + 34} y={by + 94} fontSize={6.4} fontWeight={700} fill="#e8d9c8" fontFamily={MONO}>{lobbyExtra > 0 ? `WAITING +${lobbyExtra}` : "WAITING"}</text>
      {layout.projectWaiting.map((spot, i) => {
        // The reserve becomes the departing task; replenish once it clears the waiting spot.
        const departing = stage.chars.some(c => c.agent.projectId === spot.project.id && c.moving && Math.hypot(c.x - spot.x, c.y - spot.y) < 24);
        return departing ? null : <g key={spot.project.id} role="img" aria-label={`${spot.project.name} · Ready for a task`}>
          <title>{spot.project.name} · Ready for a task</title>
          <rect x={spot.x - 10} y={spot.y - 2} width={20} height={5} fill={spot.project.color} opacity={0.4} />
          <Character x={spot.x} y={spot.y} variant={i % 4} shirtColor={spot.project.color} pose="stand" />
        </g>;
      })}
    </g>

    {/* coffee lounge */}
    <g role="group" aria-label="Coffee lounge">
      <rect x={coffee.x} y={coffee.y + 10} width={coffee.w} height={12} fill="#8a5f36" /><rect x={coffee.x} y={coffee.y + 10} width={coffee.w} height={3} fill="#c79a62" />
      <CoffeeMachine x={coffee.x + 6} y={coffee.y - 8} />
      {[0, 1, 2, 3].map(i => <g key={i}><rect x={coffee.x + 32 + i * 9} y={coffee.y + 6} width={5} height={5} fill="#f4f1e8" /><rect x={coffee.x + 32 + i * 9} y={coffee.y + 6} width={5} height={1} fill="#7a4a2a" /></g>)}
      {plate(coffee.x + coffee.w + 8, by + 6, 74, "COFFEE LOUNGE", 6.6)}
      {layout.tables.map((t, i) => <Table key={i} x={t.x} y={t.y} />)}
      <text x={lounge.x + 44} y={by + 107} fontSize={6.4} fontWeight={700} fill="#4a3a2a" fontFamily={MONO}>{waiting ? `WAITING FOR YOU · ${waiting}${loungeExtra > 0 ? ` (+${loungeExtra} more)` : ""}` : "NOBODY IS WAITING FOR YOU"}</text>
    </g>

    {/* Scheduled tasks admire the clock; they are schedules, not runnable thread buttons. */}
    <g role="group" aria-label="Clock shrine">
      <rect className="office-floor" x={shrine.x} y={by} width={shrine.w} height={BAND_H} fill="#37304b" />
      <rect x={shrine.x} y={by + 6} width={3} height={BAND_H - 6} fill="#211c30" />
      <rect x={shrine.x + 12} y={by + 58} width={shrine.w - 24} height={34} fill="#514064" />
      <rect x={shrine.x + 15} y={by + 60} width={shrine.w - 30} height={30} fill="none" stroke="#b49a65" />
      {plate(shrine.x + 32, by + 4, 92, "CLOCK SHRINE", 7)}
      <rect x={shrine.x + 60} y={by + 45} width={36} height={10} fill="#9c7546" />
      <rect x={shrine.x + 51} y={by + 53} width={54} height={5} fill="#dfbb72" />
      <g transform={`translate(${shrine.x + 60} ${by + 17}) scale(2)`}>
        <WallClock x={0} y={0} due={model.shrine?.next ?? now} />
      </g>
      {[shrine.x + 42, shrine.x + 110].map(x => <g key={x}>
        <rect x={x} y={by + 43} width={4} height={10} fill="#f4e5bc" />
        <rect x={x + 1} y={by + 39} width={2} height={4} fill="#ffd371" />
      </g>)}
      {model.shrine ? <g role="group" aria-label="Scheduled work">
        {model.shrine.entries.slice(0, 4).map((entry, i, entries) => <g key={entry.id} role="img" aria-label={`${entry.projectName} · ${entry.name} · Scheduled ${timeLabel(entry.due, now)}`}>
          <title>{entry.projectName} · {entry.name} · {timeLabel(entry.due, now)}</title>
          <ClockAdmirer x={shrine.x + shrine.w / 2 + (i - (entries.length - 1) / 2) * 28} y={by + 87} variant={entry.variant} />
        </g>)}
        <text x={shrine.x + shrine.w / 2} y={by + 99} textAnchor="middle" fontSize={7} fontWeight={800} fill="#ffe49a" fontFamily={MONO}>NEXT {timeLabel(model.shrine.next!, now)}</text>
        <text x={shrine.x + shrine.w / 2} y={by + 108} textAnchor="middle" fontSize={6.4} fill="#e0d7ed" fontFamily={MONO}>{model.shrine.entries.length} scheduled{model.shrine.entries.length > 4 ? ` · +${model.shrine.entries.length - 4} more` : ""}</text>
      </g> : <text x={shrine.x + shrine.w / 2} y={by + 104} textAnchor="middle" fontSize={7} fill="#c9c6dc" fontFamily={MONO}>NO SCHEDULED TASKS</text>}
    </g>

    {/* you: desk and in-tray */}
    <g role="group" aria-label="Your desk">
      <UserAvatar x={tray.x + 46} y={by + 3} />
      <rect x={deskUser.x} y={deskUser.y} width={deskUser.w} height={12} fill="#b98550" /><rect x={deskUser.x} y={deskUser.y} width={deskUser.w} height={2} fill="#d9a86e" /><rect x={deskUser.x} y={deskUser.y + 12} width={deskUser.w} height={4} fill="#8a5f36" />
      <rect x={deskUser.x + deskUser.w / 2 - 12} y={deskUser.y + 3} width={24} height={8} fill="#f4f1e8" /><text x={deskUser.x + deskUser.w / 2} y={deskUser.y + 9.4} textAnchor="middle" fontSize={6.6} fontWeight={800} fill="#1b1a24" fontFamily={MONO}>YOU</text>
      <rect x={tray.x - 1} y={tray.y - 1} width={tray.w + 2} height={tray.h + 2} fill="#1b1a24" /><rect x={tray.x} y={tray.y} width={tray.w} height={tray.h} fill="#3a3446" /><rect x={tray.x + 2} y={tray.y + 10} width={tray.w - 4} height={tray.h - 12} fill="#241f2e" />
      <text x={tray.x + 5} y={tray.y + 8} fontSize={6.6} fontWeight={800} fill="#e8d9c8" fontFamily={MONO} letterSpacing={0.5}>{more > 0 ? `IN-TRAY · +${more}` : "IN-TRAY"}</text>
      {shown.map((a, i) => {
        const cell = tray.cells[i];
        return <Hot key={a.id} agent={a} label={`${a.projectName} · ${a.title} · ${a.stateLabel}`} onOpen={onOpen} show={show} hide={hide} rect={{ x: cell.x - 2, y: cell.y - 2, w: 22, h: 16 }}>
          <Folder x={cell.x} y={cell.y} color={a.projectColor} />
        </Hot>;
      })}
      {folders.length === 0 && <text x={tray.x + tray.w / 2} y={tray.y + 28} textAnchor="middle" fontSize={6.6} fill="#8b88a0" fontFamily={MONO}>no finished work</text>}
    </g>

    {/* front door in the south wall, under the lobby column */}
    <rect x={doorX - 2} y={layout.height - WALL} width={32} height={WALL} fill="#9fd4ea" /><rect x={doorX + 13} y={layout.height - WALL} width={2} height={WALL} fill="#5a7a8a" />
    <rect x={doorX - 4} y={layout.height - WALL} width={2} height={WALL} fill="#8a5f36" /><rect x={doorX + 30} y={layout.height - WALL} width={2} height={WALL} fill="#8a5f36" />
    <rect x={doorX} y={by + BAND_H - 8} width={28} height={6} fill="#6b3f4a" />
    <text x={doorX + 38} y={by + BAND_H - 4} fontSize={6.4} fontWeight={700} fill="#e8d9c8" fontFamily={MONO}>FRONT DOOR</text>
  </g>;
}

function Corridors({ layout }: { layout: Layout }) {
  return <g>
    {layout.corridors.map((b, i) => <g key={i}>
      <rect x={b.x} y={b.line - 6} width={b.w} height={12} fill="#4b5170" opacity={0.5} />
      {layout.rooms.filter(r => Math.abs(r.y + r.h - b.y) < 1).map(r => <rect key={r.index} x={Math.round(r.doorX - 14)} y={b.y + 1} width={28} height={7} fill="#7a3f52" />)}
    </g>)}
    {layout.rooms.length === 0 && <text x={layout.width / 2} y={layout.corridors[0].line + 3} textAnchor="middle" fontSize={9} fill="#c9c6dc" fontFamily={MONO}>No projects yet. Each project gets a room here.</text>}
  </g>;
}

function Scene({ overview, model, layout, variant, now, height, onOpen, onBackground, renderTaskControls, initialProject = "", onSelectRoom, onOpenCommander, onProposalRespond }: { overview: boolean; onProposalRespond?: OfficeProps["onProposalRespond"]; onOpenCommander?: () => void; initialProject?: string; onSelectRoom?: (project: string) => void; renderTaskControls?: OfficeProps["renderTaskControls"]; model: OfficeModel; layout: Layout; variant: "mini" | "full"; now: number; height?: number; onOpen: (id: string) => void; onBackground?: () => void }) {
  const rawId = useId(), id = `o${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const reduced = usePrefersReducedMotion();
  const stage = useOfficeStage(model, layout, reduced);
  const stageEl = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [selectedProject, setSelectedProject] = useState(initialProject);
  const [listening, setListening] = useState(false);
  const [busyCards, setBusyCards] = useState<ReadonlySet<string>>(new Set()), [cardError, setCardError] = useState("");
  const actions: CardActions = {
    busy: busyCards,
    respond: onProposalRespond ? (card, approve) => {
      setCardError(""); setBusyCards(s => new Set(s).add(card.proposalId));
      onProposalRespond(card.proposalId, approve).catch(e => setCardError(`Couldn't ${approve ? "approve" : "dismiss"} "${card.title}": ${e instanceof Error ? e.message : String(e)}`))
        .finally(() => setBusyCards(s => { const n = new Set(s); n.delete(card.proposalId); return n; }));
    } : undefined,
  };
  const selectedRoom = layout.rooms.find(r => r.project.id === selectedProject);
  const show = useCallback((agent: OfficeAgent, el: Element) => {
    const s = stageEl.current?.getBoundingClientRect(), r = el.getBoundingClientRect();
    if (!s) return;
    const below = r.top - s.top < 56;
    setTip({ agent, x: Math.min(Math.max(r.left - s.left + r.width / 2, 90), Math.max(90, s.width - 90)), y: below ? r.bottom - s.top + 6 : r.top - s.top - 6, below });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  const { width, height: h } = layout;
  return <div ref={stageEl} className="office-stage" data-variant={variant} style={height ? { height: height + (selectedRoom && renderTaskControls ? 140 : 0) } : undefined} onClick={e => { if (onBackground && !(e.target as Element).closest("[role='button']")) onBackground(); }}>
    <div className="office-map" onScroll={hide}>
    <svg className="office-svg" style={overview ? undefined : { width: `max(100%, ${width * 1.65}px)`, height: `max(100%, ${h * 1.65}px)` }} viewBox={`0 0 ${width} ${h}`} preserveAspectRatio="xMidYMid meet" role="group" aria-label="Office floor plan" shapeRendering="crispEdges">
      <FloorDefs id={id} rooms={layout.rooms} />
      <clipPath id={`${id}-clip`}><rect width={width} height={h} /></clipPath>
      <rect width={width} height={h} fill="#221e2c" />
      <rect x={WALL} y={WALL} width={layout.innerW} height={h - 2 * WALL} fill={`url(#${id}-hall)`} />
      <Corridors layout={layout} />
      {layout.rooms.map(r => {
        const boss = r.project.kind === "commander", interactive = boss ? !!onOpenCommander : !!renderTaskControls;
        const select = () => { if (listening) return; if (boss) onOpenCommander?.(); else if (onSelectRoom) onSelectRoom(r.project.id); else setSelectedProject(r.project.id); };
        return <g key={r.index} role={interactive ? "button" : "group"} tabIndex={interactive ? 0 : undefined}
          className="office-room" data-kind={boss ? "boss" : "project"} data-selected={selectedProject === r.project.id || undefined}
          aria-label={boss ? `Boss's office · ${r.project.name}` : renderTaskControls ? `Give an order to ${r.project.name}` : `${r.project.name} room`}
          aria-pressed={!boss && renderTaskControls ? selectedProject === r.project.id : undefined}
          onClick={interactive ? e => { e.stopPropagation(); select(); } : undefined}
          onKeyDown={interactive ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); select(); } } : undefined}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="transparent" />
          <RoomShell r={r} id={id} stage={stage} extra={{ overflow: stage.destinations.overflow.get(r.index) ?? 0 }} commander={model.commander} cards={model.cards.filter(c => c.projectId === r.project.id)} actions={actions} />
        </g>;
      })}
      {listening && selectedRoom && <g className="office-listening" aria-hidden="true">
        <rect x={selectedRoom.x + 3} y={selectedRoom.y + 3} width={selectedRoom.w - 6} height={selectedRoom.h - 6} fill="none" stroke="#7bd88f" strokeWidth={3} />
        {[0, 1, 2].map(i => <g key={i} className="office-listener" style={{ animationDelay: `${i * -0.18}s` }}>
          <Character x={selectedRoom.x + 35 + i * 34} y={selectedRoom.y + selectedRoom.h - 24} variant={i} shirtColor={selectedRoom.project.color} pose="stand" moving frame={i % 2 === 0 ? 0 : 1} />
        </g>)}
      </g>}
      <Band layout={layout} id={id} model={model} stage={stage} now={now} show={show} hide={hide} onOpen={onOpen} actions={actions} />
      <g clipPath={`url(#${id}-clip)`}>
        {stage.chars.map(c => <CharacterView key={c.id} c={c} onOpen={onOpen} show={show} hide={hide} />)}
      </g>
      <rect x={0} y={0} width={width} height={WALL} fill="#2a2536" />
      <rect x={0} y={0} width={WALL} height={h} fill="#2a2536" /><rect x={width - WALL} y={0} width={WALL} height={h} fill="#2a2536" />
      <rect x={0} y={h - WALL} width={layout.door.x - 4} height={WALL} fill="#2a2536" /><rect x={layout.door.x + 32} y={h - WALL} width={width - layout.door.x - 32} height={WALL} fill="#2a2536" />
    </svg>
    </div>
    {cardError && <p className="office-card-error" role="alert">{cardError}</p>}
    {selectedRoom && renderTaskControls && <div className="office-order" onClick={e => e.stopPropagation()}><strong>{selectedRoom.project.name}</strong>{renderTaskControls(selectedProject, setListening)}</div>}
    {!overview && <span className="office-pan-hint">Scroll to explore</span>}
    {tip && <div className="office-tip" data-below={tip.below || undefined} style={{ left: tip.x, top: tip.y }} aria-hidden="true">
      <i style={{ background: STATE_COLOR[tip.agent.state] }}>{STATE_CUE[tip.agent.state]}</i>
      <span><b>{tip.agent.projectName}</b> · {tip.agent.title} · {tip.agent.stateLabel}</span>
    </div>}
  </div>;
}

function ZoomControl({ overview, onToggle }: { overview: boolean; onToggle: () => void }) {
  return <button type="button" className="office-view-toggle" aria-pressed={!overview} onClick={onToggle}>{overview ? "Zoom in" : "Fit all"}</button>;
}

function RecentToggle({ recentOnly, hidden, onToggle }: { recentOnly: boolean; hidden: number; onToggle: () => void }) {
  const label = recentOnly
    ? `Showing recent projects only${hidden ? ` (${hidden} hidden)` : ""} — show all`
    : "Showing all projects — show recent only";
  const Icon = recentOnly ? EyeOff : Eye;
  return <button type="button" className="office-btn" aria-label={label} title={label} aria-pressed={!recentOnly} data-hidden-count={hidden} onClick={onToggle}><Icon size={13} aria-hidden="true" />{recentOnly && hidden > 0 && <span className="office-btn-count">{hidden}</span>}</button>;
}

function Legend({ model, showStates = true, children }: { model: OfficeModel; showStates?: boolean; children?: ReactNode }) {
  const counts = new Map<OfficeAgentState, number>();
  for (const a of model.agents) if (a.place !== "tray") counts.set(a.state, (counts.get(a.state) ?? 0) + 1);
  counts.set("done", model.tray.length);
  return <footer className="office-bar" data-no-legend={showStates ? undefined : ""}>
    <strong>Office</strong><span className="office-summary" role="status">{model.summary}</span>
    {showStates && <ul className="office-legend" aria-label="Agent states">
      {STATES.map(s => <li key={s} data-state={s} data-zero={!counts.get(s) || undefined}><i aria-hidden="true" style={{ background: STATE_COLOR[s] }}>{STATE_CUE[s]}</i><span>{s === "done" ? "Finished" : STATE_LABEL[s]}</span><b>{counts.get(s) ?? 0}</b></li>)}
      {model.shrine && <li data-state="scheduled"><i aria-hidden="true" className="office-chip-clock">◷</i><span>Scheduled</span><b>{model.shrine.entries.length}</b></li>}
    </ul>}
    {children}
  </footer>;
}

const FOCUSABLE = "button:not([disabled]), [role='button'][tabindex='0']";

type RecentProps = { recentOnly: boolean; hidden: number; onToggleRecent: () => void };

function Overlay({ recent, model, plan, now, onOpen, onClose, renderTaskControls, initialProject, onOpenCommander, onProposalRespond }: { recent: RecentProps; onProposalRespond?: OfficeProps["onProposalRespond"]; onOpenCommander?: () => void; initialProject?: string; renderTaskControls?: OfficeProps["renderTaskControls"]; model: OfficeModel; plan: PlanProject[]; now: number; onOpen: (id: string) => void; onClose: () => void }) {
  const [overview, setOverview] = useState(true);
  const root = useRef<HTMLDivElement>(null), close = useRef<HTMLButtonElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const stage = el.querySelector(".office-stage");
    if (!stage) return;
    const ro = new ResizeObserver(entries => { const r = entries[0]?.contentRect; if (r) setBox({ w: Math.round(r.width), h: Math.round(r.height) }); });
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);
  // Observe the scene content box so safe areas and controls are included in the fit.
  const layout = useMemo(() => bestFullLayout(plan, box.w, box.h), [plan, box.w, box.h]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => { previous?.focus?.(); };
  }, []);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); onClose(); return; }
    if (e.key !== "Tab" || !root.current) return;
    const items = [...root.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1], active = document.activeElement;
    if (e.shiftKey && (active === first || !root.current.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !root.current.contains(active))) { e.preventDefault(); first.focus(); }
  };
  return createPortal(<div ref={root} className="office-overlay" role="dialog" aria-modal="true" aria-label="Office" onKeyDown={onKeyDown}>
    <Scene overview={overview} onProposalRespond={onProposalRespond} onOpenCommander={onOpenCommander ? () => { onClose(); onOpenCommander(); } : undefined} initialProject={initialProject} renderTaskControls={renderTaskControls} model={model} layout={layout} variant="full" now={now} onOpen={onOpen} />
    <Legend model={model}><RecentToggle recentOnly={recent.recentOnly} hidden={recent.hidden} onToggle={recent.onToggleRecent} /><ZoomControl overview={overview} onToggle={() => setOverview(v => !v)} /><OfficeVersionPicker /></Legend>
      <button ref={close} type="button" className="office-btn" aria-label="Close office" title="Close (Esc)" onClick={onClose}><X size={14} aria-hidden="true" /></button>
  </div>, document.body);
}

function useViewportHeight(): number {
  const [h, setH] = useState(() => (typeof window === "undefined" ? 900 : window.innerHeight));
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return h;
}

export function Office({ sessions, projects: sourceProjects, projectNameUppercase = false, schedules, queuedThreadIds, now, variant, onOpenThread, onExpand, onClose, renderTaskControls, onOpenCommander, proposals, onProposalRespond }: OfficeProps) {
  // Presentation copies only: ids, stored names and task routing remain unchanged.
  const allProjects = useMemo(() => sourceProjects.map(p => ({ ...p, name: formatProjectName(p.name, projectNameUppercase) })), [sourceProjects, projectNameUppercase]);
  const clock = now ?? Date.now();
  const [recentOnly, setRecentOnly] = useState(readRecentOnly);
  const toggleRecent = useCallback(() => setRecentOnly(v => { writeRecentOnly(!v); return !v; }), []);
  // Commander already has a dedicated dashboard section outside the workplace.
  const workplaceProjects = useMemo(() => allProjects.filter(p => p.kind !== "commander"), [allProjects]);
  const projects = useMemo(() => (recentOnly ? recentProjects(workplaceProjects, sessions, schedules, clock, queuedThreadIds) : workplaceProjects), [recentOnly, workplaceProjects, sessions, schedules, clock, queuedThreadIds]);
  const hiddenCount = workplaceProjects.length - projects.length;
  const recent: RecentProps = { recentOnly, hidden: hiddenCount, onToggleRecent: toggleRecent };
  const model = useMemo(() => officeModel(sessions, projects, clock, schedules, queuedThreadIds, proposals), [sessions, projects, clock, schedules, queuedThreadIds, proposals]);
  const plan = usePlanProjects(projects);
  const [expanded, setExpanded] = useState(false);
  const [overview, setOverview] = useState(true);
  const [selectedProject, setSelectedProject] = useState("");
  const closeFull = useCallback(() => { setExpanded(false); onClose?.(); }, [onClose]);
  const openFromFull = useCallback((id: string) => { closeFull(); onOpenThread(id); }, [closeFull, onOpenThread]);
  const expand = () => { setExpanded(true); onExpand?.(); };
  const card = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = card.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(entries => setWidth(Math.round(entries[0]?.contentRect.width ?? 0)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [variant]);
  // The same fixed map, scaled to the card width; only the card width and the project list can change its shape.
  const avail = width - MINI_PAD;
  const vh = useViewportHeight();
  const miniLayout = useMemo(() => floorPlan(plan, miniCols(plan.length, avail, 0.45 * vh)), [plan, avail, vh]);
  // Stage height follows the map's aspect ratio at full card width; CSS max-height (45vh) is only a safety net.
  const stageH = width > 0 ? Math.ceil((miniLayout.height * avail) / miniLayout.width) + 8 : 240;

  if (variant === "full") return <Overlay recent={recent} onProposalRespond={onProposalRespond} onOpenCommander={onOpenCommander} initialProject={selectedProject} renderTaskControls={renderTaskControls} model={model} plan={plan} now={clock} onOpen={openFromFull} onClose={closeFull} />;
  return <section ref={card} className="office-mini" aria-label="Office" data-narrow={width > 0 && width < 560 ? "2" : width > 0 && width < 860 ? "1" : undefined}>
    <Scene overview={overview} onProposalRespond={onProposalRespond} onOpenCommander={onOpenCommander} onSelectRoom={project => { setSelectedProject(project); expand(); }} renderTaskControls={renderTaskControls} model={model} layout={miniLayout} variant="mini" now={clock} height={stageH} onOpen={onOpenThread} onBackground={expand} />
    <Legend model={model} showStates={false}>
      <RecentToggle recentOnly={recentOnly} hidden={hiddenCount} onToggle={toggleRecent} />
      <ZoomControl overview={overview} onToggle={() => setOverview(v => !v)} />
      <OfficeVersionPicker />
      <button type="button" className="office-btn" aria-label="Expand office" title="Expand office" onClick={expand}><Maximize2 size={13} aria-hidden="true" /></button>
    </Legend>
    {expanded && <Overlay recent={recent} onProposalRespond={onProposalRespond} onOpenCommander={onOpenCommander} initialProject={selectedProject} renderTaskControls={renderTaskControls} model={model} plan={plan} now={clock} onOpen={openFromFull} onClose={closeFull} />}
  </section>;
}
