import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Project, Session } from "../desktop/types";
import { officeModel, STATE_CUE, STATE_LABEL, totalsLabel, type OfficeAgent, type OfficeAgentState, type OfficeModel, type OfficeSchedule } from "./officeModel";
import { BAND_H, CELL_W, CELL_H, FACE, SIDE, SOUTH, TRAY_COLS, TRAY_MAX, WALL, bestFullLayout, floorPlan, miniCols, type Layout, type PlacedRoom, type PlanProject } from "./officeLayout";
import { useOfficeStage, type Char, type Stage } from "./officeStage";
import { Bench, Bubble, Character, CoffeeMachine, DeskFurniture, Folder, Plant, STATE_COLOR, Table, UserAvatar, WallClock, FUR } from "./sprites";
import "./office.css";

export type OfficeProps = {
  sessions: readonly Session[];
  projects: readonly Project[];
  /** Optional scheduled work; rendered as the wall clock in the coffee lounge. Omit and no clock is drawn. */
  schedules?: readonly OfficeSchedule[];
  /** Thread ids with queued runs; a settled thread in this set waits in the lobby. Omit if the host has no queue data. */
  queuedThreadIds?: ReadonlySet<string>;
  /** Injectable clock for tests; defaults to Date.now(). */
  now?: number;
  /** "mini" is an inline card; "full" is a fixed overlay covering the whole window. */
  variant: "mini" | "full";
  onOpenThread: (id: string) => void;
  /** Mini only: called when the user expands the office (the office also opens its own overlay). */
  onExpand?: () => void;
  /** Called when the full overlay is dismissed (close button or Escape). */
  onClose?: () => void;
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
  const key = projects.map(p => `${p.id}\u0000${p.name}\u0000${p.color}`).join("\u0001");
  const ref = useRef<{ key: string; value: PlanProject[] } | null>(null);
  if (!ref.current || ref.current.key !== key) ref.current = { key, value: projects.map(p => ({ id: p.id, name: p.name, color: p.color })) };
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

function RoomShell({ r, id, stage, extra }: { r: PlacedRoom; id: string; stage: Stage; extra: { totals: string; overflow: number } }) {
  const { x, y, w, h, project } = r, color = project.color;
  const door = 34, dx = Math.round(r.doorX - door / 2), floorY = r.floorY;
  const plateW = w - 16, chars = Math.floor((plateW - 12) / 5.6);
  const rugW = 2 * CELL_W - 20, rugH = 2 * CELL_H - 26;
  const owners = stage.destinations.owners.get(r.index);
  const charById = new Map(stage.chars.map(c => [c.agent.id, c] as const));
  const scoreW = extra.overflow ? plateW - 24 : plateW;
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
    {/* name plate and scoreboard on the wall */}
    <rect x={x + 7} y={y + 5} width={plateW + 2} height={15} fill="#1b1a24" /><rect x={x + 8} y={y + 6} width={plateW} height={13} fill="#2c2638" /><rect x={x + 8} y={y + 6} width={plateW} height={3} fill={color} />
    <text x={x + 8 + plateW / 2} y={y + 17} textAnchor="middle" fontSize={9} fontWeight={700} fill="#f4f1fa" fontFamily={MONO}>{clip(project.name, chars)}</text>
    <g role="group" aria-label={`${project.name} scoreboard`}>
      <rect x={x + 7} y={y + 21} width={scoreW + 2} height={13} fill="#1b1a24" /><rect x={x + 8} y={y + 22} width={scoreW} height={11} fill="#14231c" />
      <text x={x + 8 + scoreW / 2} y={y + 30.4} textAnchor="middle" fontSize={7.4} fontWeight={700} fill="#7bd88f" fontFamily={MONO} {...(extra.totals.length * 4.5 > scoreW - 6 ? { textLength: scoreW - 6, lengthAdjust: "spacingAndGlyphs" as const } : {})}>{extra.totals}</text>
      {extra.overflow > 0 && <g><rect x={x + 8 + scoreW + 2} y={y + 21} width={22} height={13} fill="#1b1a24" /><rect x={x + 9 + scoreW + 2} y={y + 22} width={20} height={11} fill="#f2c14e" /><text x={x + 19 + scoreW + 2} y={y + 30.6} textAnchor="middle" fontSize={8} fontWeight={800} fill="#1b1a24" fontFamily={MONO}>+{extra.overflow}</text></g>}
    </g>
    {/* desks: chair, monitor, desk (agents are drawn separately) */}
    {r.desks.map(d => {
      const owner = owners?.get(d.slot), ch = owner ? charById.get(owner.id) : undefined;
      const seated = !!ch && !ch.moving && ch.pose === "seated";
      const screen: OfficeAgentState = !owner ? "idle" : owner.state === "working" ? (seated ? "working" : "idle") : owner.state === "failed" || owner.state === "needs-you" ? owner.state : "idle";
      return <DeskFurniture key={d.slot} x={d.x} y={d.y} state={screen} typing={seated && owner?.state === "working"} fur={FUR[(owner?.variant ?? 0) % 4]} />;
    })}
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
      <Character x={c.x} y={c.y} variant={a.variant} pose={pose} moving={c.moving} frame={c.frame} flip={c.flip} carry={c.carry} folder={a.projectColor} />
    </g>
    {bubble && <g className="office-attn"><Bubble x={c.x - 9} y={c.y - 44} w={18} h={15} glyph={a.state === "failed" ? "!" : "?"} fill={a.state === "failed" ? "#ef5f5f" : "#f2c14e"} size={13} tag={a.state === "needs-you" ? a.tag : null} /></g>}
  </Hot>;
}

function Band({ layout, id, model, stage, now, show, hide, onOpen }: { layout: Layout; id: string; model: OfficeModel; stage: Stage; now: number; show: (a: OfficeAgent, el: Element) => void; hide: () => void; onOpen: (id: string) => void }) {
  const { lobby, lounge, you, reception: rc, coffee, tray, deskUser, band } = layout;
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
      <Character x={rc.x + 62} y={rc.y + 4} variant={2} pose="seated" headset />
      <rect x={rc.x + 6} y={rc.y - 8} width={14} height={9} fill="#23222d" /><rect x={rc.x + 7} y={rc.y - 7} width={12} height={6} fill="#14203a" /><rect x={rc.x + 10} y={rc.y + 1} width={6} height={2} fill="#4a4860" />
      <rect x={rc.x} y={rc.y} width={rc.w} height={13} fill="#b98550" /><rect x={rc.x} y={rc.y} width={rc.w} height={3} fill="#d9a86e" /><rect x={rc.x} y={rc.y + 13} width={rc.w} height={4} fill="#8a5f36" />
      <text x={rc.x + rc.w / 2} y={rc.y + 10.5} textAnchor="middle" fontSize={6.6} fontWeight={800} fill="#2a1a0c" fontFamily={MONO} letterSpacing={0.5}>RECEPTION</text>
      {layout.benches.map(b => <Bench key={b.node} x={b.x} y={b.y} />)}
      <text x={lobby.x + 72} y={by + 96} fontSize={6.4} fontWeight={700} fill="#e8d9c8" fontFamily={MONO}>{lobbyExtra > 0 ? `WAITING · +${lobbyExtra} more` : "WAITING"}</text>
      <Plant x={lobby.x + lobby.w - 16} y={by + 96} />
    </g>

    {/* coffee lounge */}
    <g role="group" aria-label="Coffee lounge">
      <rect x={coffee.x} y={coffee.y + 10} width={coffee.w} height={12} fill="#8a5f36" /><rect x={coffee.x} y={coffee.y + 10} width={coffee.w} height={3} fill="#c79a62" />
      <CoffeeMachine x={coffee.x + 6} y={coffee.y - 8} />
      {[0, 1, 2, 3].map(i => <g key={i}><rect x={coffee.x + 32 + i * 9} y={coffee.y + 6} width={5} height={5} fill="#f4f1e8" /><rect x={coffee.x + 32 + i * 9} y={coffee.y + 6} width={5} height={1} fill="#7a4a2a" /></g>)}
      {plate(coffee.x + coffee.w + 8, by + 6, 74, "COFFEE LOUNGE", 6.6)}
      {layout.tables.map((t, i) => <Table key={i} x={t.x} y={t.y} />)}
      <text x={lounge.x + 44} y={by + 107} fontSize={6.4} fontWeight={700} fill="#4a3a2a" fontFamily={MONO}>{waiting ? `WAITING FOR YOU · ${waiting}${loungeExtra > 0 ? ` (+${loungeExtra} more)` : ""}` : "NOBODY IS WAITING FOR YOU"}</text>
      {model.shrine && model.shrine.next != null && <g role="group" aria-label="Scheduled work">
        <WallClock x={lounge.x + lounge.w - 26} y={by + 6} due={model.shrine.next} />
        <rect x={lounge.x + lounge.w - 78} y={by + 27} width={72} height={20} fill="#1b1a24" /><rect x={lounge.x + lounge.w - 77} y={by + 28} width={70} height={18} fill="#2c2638" />
        <text x={lounge.x + lounge.w - 42} y={by + 36.5} textAnchor="middle" fontSize={7} fontWeight={800} fill="#f2c14e" fontFamily={MONO}>NEXT {timeLabel(model.shrine.next, now)}</text>
        <text x={lounge.x + lounge.w - 42} y={by + 43.5} textAnchor="middle" fontSize={6.4} fill="#c9c6dc" fontFamily={MONO}>{model.shrine.entries.length} scheduled</text>
      </g>}
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

function Scene({ model, layout, variant, now, height, onOpen, onBackground }: { model: OfficeModel; layout: Layout; variant: "mini" | "full"; now: number; height?: number; onOpen: (id: string) => void; onBackground?: () => void }) {
  const rawId = useId(), id = `o${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const reduced = usePrefersReducedMotion();
  const stage = useOfficeStage(model, layout, reduced);
  const stageEl = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const show = useCallback((agent: OfficeAgent, el: Element) => {
    const s = stageEl.current?.getBoundingClientRect(), r = el.getBoundingClientRect();
    if (!s) return;
    const below = r.top - s.top < 56;
    setTip({ agent, x: Math.min(Math.max(r.left - s.left + r.width / 2, 90), Math.max(90, s.width - 90)), y: below ? r.bottom - s.top + 6 : r.top - s.top - 6, below });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  const { width, height: h } = layout;
  return <div ref={stageEl} className="office-stage" data-variant={variant} style={height ? { height } : undefined} onClick={e => { if (onBackground && !(e.target as Element).closest("[role='button']")) onBackground(); }}>
    <svg className="office-svg" viewBox={`0 0 ${width} ${h}`} preserveAspectRatio="xMidYMid meet" role="group" aria-label="Office floor plan" shapeRendering="crispEdges">
      <FloorDefs id={id} rooms={layout.rooms} />
      <clipPath id={`${id}-clip`}><rect width={width} height={h} /></clipPath>
      <rect width={width} height={h} fill="#221e2c" />
      <rect x={WALL} y={WALL} width={layout.innerW} height={h - 2 * WALL} fill={`url(#${id}-hall)`} />
      <Corridors layout={layout} />
      {layout.rooms.map(r => <g key={r.index} role="group" aria-label={`${r.project.name} room`}>
        <RoomShell r={r} id={id} stage={stage} extra={{ totals: totalsLabel(model.rooms[r.index].totals), overflow: stage.destinations.overflow.get(r.index) ?? 0 }} />
      </g>)}
      <Band layout={layout} id={id} model={model} stage={stage} now={now} show={show} hide={hide} onOpen={onOpen} />
      <g clipPath={`url(#${id}-clip)`}>
        {stage.chars.map(c => <CharacterView key={c.id} c={c} onOpen={onOpen} show={show} hide={hide} />)}
      </g>
      <rect x={0} y={0} width={width} height={WALL} fill="#2a2536" />
      <rect x={0} y={0} width={WALL} height={h} fill="#2a2536" /><rect x={width - WALL} y={0} width={WALL} height={h} fill="#2a2536" />
      <rect x={0} y={h - WALL} width={layout.door.x - 4} height={WALL} fill="#2a2536" /><rect x={layout.door.x + 32} y={h - WALL} width={width - layout.door.x - 32} height={WALL} fill="#2a2536" />
    </svg>
    {tip && <div className="office-tip" data-below={tip.below || undefined} style={{ left: tip.x, top: tip.y }} aria-hidden="true">
      <i style={{ background: STATE_COLOR[tip.agent.state] }}>{STATE_CUE[tip.agent.state]}</i>
      <span><b>{tip.agent.projectName}</b> · {tip.agent.title} · {tip.agent.stateLabel}</span>
    </div>}
  </div>;
}

function Legend({ model, children }: { model: OfficeModel; children?: ReactNode }) {
  const counts = new Map<OfficeAgentState, number>();
  for (const a of model.agents) if (a.place !== "tray") counts.set(a.state, (counts.get(a.state) ?? 0) + 1);
  counts.set("done", model.tray.length);
  return <footer className="office-bar">
    <strong>Office</strong><span className="office-summary" role="status">{model.summary}</span>
    <ul className="office-legend" aria-label="Agent states">
      {STATES.map(s => <li key={s} data-state={s} data-zero={!counts.get(s) || undefined}><i aria-hidden="true" style={{ background: STATE_COLOR[s] }}>{STATE_CUE[s]}</i><span>{s === "done" ? "Finished" : STATE_LABEL[s]}</span><b>{counts.get(s) ?? 0}</b></li>)}
      {model.shrine && <li data-state="scheduled"><i aria-hidden="true" className="office-chip-clock">◷</i><span>Scheduled</span><b>{model.shrine.entries.length}</b></li>}
    </ul>
    {children}
  </footer>;
}

const FOCUSABLE = "button:not([disabled]), [role='button'][tabindex='0']";

function Overlay({ model, plan, now, onOpen, onClose }: { model: OfficeModel; plan: PlanProject[]; now: number; onOpen: (id: string) => void; onClose: () => void }) {
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
    <Scene model={model} layout={layout} variant="full" now={now} onOpen={onOpen} />
    <Legend model={model} />
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

export function Office({ sessions, projects, schedules, queuedThreadIds, now, variant, onOpenThread, onExpand, onClose }: OfficeProps) {
  const clock = now ?? Date.now();
  const model = useMemo(() => officeModel(sessions, projects, clock, schedules, queuedThreadIds), [sessions, projects, clock, schedules, queuedThreadIds]);
  const plan = usePlanProjects(projects);
  const [expanded, setExpanded] = useState(false);
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

  if (variant === "full") return <Overlay model={model} plan={plan} now={clock} onOpen={openFromFull} onClose={closeFull} />;
  return <section ref={card} className="office-mini" aria-label="Office" data-narrow={width > 0 && width < 560 ? "2" : width > 0 && width < 860 ? "1" : undefined}>
    <Scene model={model} layout={miniLayout} variant="mini" now={clock} height={stageH} onOpen={onOpenThread} onBackground={expand} />
    <Legend model={model}>
      <button type="button" className="office-btn" aria-label="Expand office" title="Expand office" onClick={expand}><Maximize2 size={13} aria-hidden="true" /></button>
    </Legend>
    {expanded && <Overlay model={model} plan={plan} now={clock} onOpen={openFromFull} onClose={closeFull} />}
  </section>;
}
