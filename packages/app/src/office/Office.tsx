import { Maximize2, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Project, Session } from "../desktop/types";
import { officeModel, STATE_CUE, STATE_LABEL, type OfficeAgent, type OfficeAgentState, type OfficeModel, type OfficeSchedule } from "./officeModel";
import { CELL_W, CELL_H, FACE, MINI_MAX_ROOMS, SIDE, SOUTH, WALL, bestFullLayout, layoutOffice, type Layout, type PlacedRoom } from "./officeLayout";
import { Cooler, DeskCell, Plant, Shelf, STATE_COLOR, UserAvatar, WallClock, WallWindow } from "./sprites";
import "./office.css";

export type OfficeProps = {
  sessions: readonly Session[];
  projects: readonly Project[];
  /** Optional scheduled work; rendered as the wall clock in the corridor. Omit and no clock is drawn. */
  schedules?: readonly OfficeSchedule[];
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
const MINI_MIN_SCALE = 0.85;
const STATES: OfficeAgentState[] = ["needs-you", "working", "review", "failed", "done", "idle"];

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

function FloorDefs({ id, rooms }: { id: string; rooms: PlacedRoom[] }) {
  return <defs>
    <clipPath id="office-scr"><rect x={12} y={28} width={32} height={14} /></clipPath>
    <pattern id={`${id}-hall`} width={32} height={32} patternUnits="userSpaceOnUse"><rect width={32} height={32} fill="#3a3e50" /><rect width={16} height={16} fill="#434858" /><rect x={16} y={16} width={16} height={16} fill="#434858" /></pattern>
    <pattern id={`${id}-lobby`} width={32} height={8} patternUnits="userSpaceOnUse"><rect width={32} height={8} fill="#6a4a38" /><rect width={32} height={1} fill="#5a3e2e" /><rect x={14} width={1} height={8} fill="#5a3e2e" /></pattern>
    {rooms.map(r => {
      const a = mix(r.room.color, "#2e2a3a", 0.34), b = mix(r.room.color, "#2e2a3a", 0.44), k = r.index % 4;
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

function RoomShell({ r, id }: { r: PlacedRoom; id: string }) {
  const { x, y, w, h, room } = r, color = room.color;
  const door = 34, dx = Math.round(r.doorX - door / 2);
  const signW = Math.min(w - 2 * SIDE - 12, Math.max(64, room.name.length * 5.4 + 16)), signX = Math.round(x + (w - signW) / 2);
  const chars = Math.floor((signW - 12) / 5), floorY = y + FACE;
  const rugW = r.cols * CELL_W - 20, rugH = Math.max(1, r.rows) * CELL_H - 26;
  return <g>
    {/* floor, rug */}
    <rect x={x} y={floorY} width={w} height={h - FACE} fill={`url(#${id}-f${r.index})`} />
    <rect x={x + SIDE + 10} y={floorY + 18} width={rugW} height={rugH} fill={mix(color, "#241f2e", 0.3)} opacity={0.75} /><rect x={x + SIDE + 12} y={floorY + 20} width={rugW - 4} height={rugH - 4} fill="none" stroke={mix(color, "#ffffff", 0.55)} strokeWidth={1} opacity={0.5} />
    {/* north wall: cap + face */}
    <rect x={x} y={y} width={w} height={4} fill="#2a2536" /><rect x={x} y={y + 4} width={w} height={FACE - 4} fill="#e0d7c6" /><rect x={x} y={y + FACE - 4} width={w} height={4} fill="#b9ae9a" /><rect x={x} y={y + FACE - 1} width={w} height={1} fill="#6b6275" />
    {signX - (x + SIDE) >= 34 && <WallWindow x={x + SIDE + 6} y={y + 8} />}{x + w - SIDE - (signX + signW) >= 36 && <Shelf x={x + w - SIDE - 30} y={y + 8} w={24} h={16} />}
    {/* side + south walls with a doorway */}
    <rect x={x} y={y} width={SIDE} height={h} fill="#2a2536" /><rect x={x + w - SIDE} y={y} width={SIDE} height={h} fill="#2a2536" />
    <rect x={x} y={y + h - SOUTH} width={dx - x} height={SOUTH} fill="#2a2536" /><rect x={dx + door} y={y + h - SOUTH} width={x + w - dx - door} height={SOUTH} fill="#2a2536" />
    <rect x={dx - 2} y={y + h - SOUTH} width={2} height={SOUTH} fill="#8a5f36" /><rect x={dx + door} y={y + h - SOUTH} width={2} height={SOUTH} fill="#8a5f36" />
    <rect x={dx} y={y + h - SOUTH} width={door} height={SOUTH} fill={mix(color, "#1b1a24", 0.5)} opacity={0.55} />
    {/* sign above the door */}
    <rect x={signX - 1} y={y + 6} width={signW + 2} height={18} fill="#1b1a24" /><rect x={signX} y={y + 7} width={signW} height={16} fill="#2c2638" /><rect x={signX} y={y + 7} width={signW} height={3} fill={color} />
    <text x={signX + signW / 2} y={y + 19.5} textAnchor="middle" fontSize={8.5} fontWeight={700} fill="#f4f1fa" fontFamily={MONO}>{clip(room.name, chars)}</text>
    {r.hidden > 0 && <g><rect x={signX + signW - 1} y={y + 20} width={20} height={8} fill="#1b1a24" /><text x={signX + signW + 9} y={y + 26.5} textAnchor="middle" fontSize={6.5} fontWeight={700} fill="#c9c6dc" fontFamily={MONO}>+{r.hidden}</text></g>}
    {room.needsYou > 0 && <g className="office-attn" aria-hidden="true"><rect x={signX + signW - 8} y={y - 1} width={16} height={14} fill="#1b1a24" /><rect x={signX + signW - 7} y={y} width={14} height={12} fill="#f2c14e" /><text x={signX + signW} y={y + 9.5} textAnchor="middle" fontSize={9.5} fontWeight={800} fill="#1b1a24" fontFamily={MONO}>{room.needsYou}</text></g>}
    {/* spare cells: furniture; corner plants */}
    {r.spare.map((c, i) => i === 0 ? <g key={i}><Shelf x={c.x + 22} y={c.y + 8} w={30} h={42} /><rect x={c.x + 20} y={c.y + 50} width={34} height={3} fill="#1b1a24" opacity={0.25} /></g> : <g key={i}><Plant x={c.x + 34} y={c.y + 40} big /></g>)}
    <Plant x={x + SIDE + 2} y={y + h - SOUTH - 14} /><Plant x={x + w - SIDE - 14} y={y + h - SOUTH - 14} />
  </g>;
}

function Reception({ layout, id, onOpen }: { layout: Layout; id: string; onOpen: (id: string) => void }) {
  const { reception: rc, entrance, needs, lobby } = layout;
  const rowH = 14, bottomY = rc.y + rc.h;
  const left = lobby ? rc.x + 8 : rc.x + 152, right = rc.x + rc.w - 8;
  const chips: ReactNodeChip[] = [];
  let shown = 0;
  if (lobby) {
    const top = rc.y + 84, rowsFit = Math.max(0, Math.floor((bottomY - 20 - top) / rowH));
    for (const n of needs) { if (shown >= rowsFit) break; chips.push({ ...n, x: left, y: top + shown * rowH, w: right - left, label: clip(n.agent.title, Math.floor((right - left - 24) / 4.4)) }); shown++; }
  } else {
    let cx = left, row = 0;
    const rowsY = [rc.y + 22, rc.y + 38];
    for (const n of needs) {
      const label = clip(n.agent.title, 24), cw = 18 + label.length * 4.4 + 6;
      if (cx + cw > rc.x + rc.w - 12) { row++; cx = left; }
      if (row > 1) break;
      chips.push({ ...n, x: cx, y: rowsY[row], w: cw, label });
      cx += cw + 6; shown++;
    }
  }
  const more = needs.length - shown;
  const ax = lobby ? rc.x + 56 : rc.x + 26, ay = lobby ? rc.y + 32 : rc.y + 12, cxn = lobby ? rc.x + 38 : rc.x + 8, cyn = ay + 16;
  const headY = lobby ? rc.y + 76 : rc.y + 14;
  return <g aria-label="Reception" role="group">
    <rect x={rc.x} y={rc.y} width={rc.w} height={rc.h} fill={`url(#${id}-lobby)`} />
    {!lobby && <rect x={rc.x} y={rc.y} width={rc.w} height={3} fill="#2a2536" />}
    {lobby && <rect x={rc.x + rc.w - 3} y={rc.y} width={3} height={rc.h} fill="#2a2536" />}
    <UserAvatar x={ax} y={ay} />
    <rect x={cxn} y={cyn} width={64} height={12} fill="#b98550" /><rect x={cxn} y={cyn} width={64} height={1} fill="#d9a86e" /><rect x={cxn} y={cyn + 12} width={64} height={5} fill="#8a5f36" />
    <rect x={cxn + 28} y={cyn + 3} width={8} height={5} fill="#f4f1e8" /><text x={cxn + 32} y={cyn + 7.5} textAnchor="middle" fontSize={4.5} fontWeight={800} fill="#1b1a24" fontFamily={MONO}>YOU</text>
    {(() => { const sx = lobby ? rc.x + 44 : rc.x + 76, sy = lobby ? rc.y + 8 : rc.y + 8; return <><rect x={sx} y={sy} width={62} height={11} fill="#1b1a24" /><rect x={sx + 1} y={sy + 1} width={60} height={9} fill="#2c2638" /><text x={sx + 31} y={sy + 8.2} textAnchor="middle" fontSize={7.5} fontWeight={800} fill="#f4f1fa" fontFamily={MONO} letterSpacing={0.4}>RECEPTION</text></>; })()}
    {/* entrance door in the building's south wall */}
    <rect x={entrance.x} y={bottomY - 1} width={entrance.w} height={WALL + 1} fill="#9fd4ea" /><rect x={entrance.x + entrance.w / 2 - 1} y={bottomY - 1} width={2} height={WALL + 1} fill="#5a7a8a" />
    <rect x={entrance.x - 2} y={bottomY - 1} width={2} height={WALL + 1} fill="#8a5f36" /><rect x={entrance.x + entrance.w} y={bottomY - 1} width={2} height={WALL + 1} fill="#8a5f36" />
    <rect x={entrance.x + 2} y={bottomY - 8} width={entrance.w - 4} height={6} fill="#6b3f4a" />
    {/* needs-you list */}
    <text x={left} y={headY} fontSize={7.5} fontWeight={800} fill={needs.length ? "#f2c14e" : "#e8d9c8"} fontFamily={MONO} letterSpacing={0.4}>{needs.length ? `WAITING FOR YOU · ${needs.length}` : lobby ? "NOTHING WAITING" : "NOBODY IS WAITING FOR YOU"}</text>
    {chips.map(c => <g key={c.tag} className="office-chip-tag" aria-hidden="true" onClick={e => { e.stopPropagation(); onOpen(c.agent.threadId); }}>
      <rect x={c.x - 1} y={c.y - 1} width={c.w + 2} height={13} fill="#1b1a24" /><rect x={c.x} y={c.y} width={c.w} height={11} fill="#f4e7bf" /><rect x={c.x} y={c.y} width={11} height={11} fill="#f2c14e" />
      <text x={c.x + 5.5} y={c.y + 8.6} textAnchor="middle" fontSize={8} fontWeight={800} fill="#1b1a24" fontFamily={MONO}>{c.tag}</text>
      <text x={c.x + 15} y={c.y + 8.4} fontSize={7} fontWeight={600} fill="#2a2536" fontFamily={MONO}>{c.label}</text>
    </g>)}
    {more > 0 && <text x={left} y={lobby ? bottomY - 14 : rc.y + 56} fontSize={7} fill="#e8d9c8" fontFamily={MONO}>+{more} more waiting</text>}
  </g>;
}
type ReactNodeChip = { tag: number; agent: OfficeAgent; x: number; y: number; w: number; label: string };

function Corridor({ b, layout, schedule, now, index }: { b: Layout["corridors"][number]; layout: Layout; schedule: OfficeModel["shrine"]; now: number; index: number }) {
  const doors = layout.rooms.filter(r => Math.abs(r.y + r.h - b.y) < 1);
  const px = (xx: number) => Math.round(xx);
  return <g>
    <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="#454a5c" opacity={0.0} />
    <rect x={b.x} y={b.y + b.h / 2 - 5} width={b.w} height={10} fill="#4b5170" opacity={0.55} />
    {doors.map(r => <rect key={r.index} x={px(r.doorX - 14)} y={b.y + 1} width={28} height={7} fill="#7a3f52" />)}
    {b.last && !layout.empty ? <Cooler x={b.x + 12} y={b.y + 18} /> : <Plant x={b.x + 14} y={b.y + 22} />}
    {b.last && layout.empty && <text x={b.x + b.w / 2} y={b.y + b.h / 2 + 3} textAnchor="middle" fontSize={9} fill="#c9c6dc" fontFamily={MONO}>Nobody is at a desk. Active threads show up here.</text>}
    <Plant x={b.x + b.w - 26} y={b.y + 22} />
    {b.last && schedule && schedule.next != null && <g role="group" aria-label="Scheduled work">
      <WallClock x={b.x + b.w - 130} y={b.y + 11} due={schedule.next} />
      <rect x={b.x + b.w - 108} y={b.y + 9} width={72} height={22} fill="#1b1a24" /><rect x={b.x + b.w - 107} y={b.y + 10} width={70} height={20} fill="#2c2638" />
      <text x={b.x + b.w - 72} y={b.y + 19.5} textAnchor="middle" fontSize={8} fontWeight={800} fill="#f2c14e" fontFamily={MONO}>NEXT {timeLabel(schedule.next, now)}</text>
      <text x={b.x + b.w - 72} y={b.y + 27.5} textAnchor="middle" fontSize={6.5} fill="#c9c6dc" fontFamily={MONO}>{schedule.entries.length} scheduled</text>
    </g>}
  </g>;
}

function Scene({ model, layout, variant, now, onOpen, onBackground }: { model: OfficeModel; layout: Layout; variant: "mini" | "full"; now: number; onOpen: (id: string) => void; onBackground?: () => void }) {
  const rawId = useId(), id = `o${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const stage = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const show = (agent: OfficeAgent, el: Element) => {
    const s = stage.current?.getBoundingClientRect(), r = el.getBoundingClientRect();
    if (!s) return;
    const below = r.top - s.top < 56;
    setTip({ agent, x: Math.min(Math.max(r.left - s.left + r.width / 2, 90), Math.max(90, s.width - 90)), y: below ? r.bottom - s.top + 6 : r.top - s.top - 6, below });
  };
  const hide = () => setTip(null);
  const { width, height } = layout;
  return <div ref={stage} className="office-stage" data-variant={variant} onClick={e => { if (onBackground && !(e.target as Element).closest("[role='button']")) onBackground(); }}>
    <svg className="office-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="group" aria-label="Office floor plan" shapeRendering="crispEdges">
      <FloorDefs id={id} rooms={layout.rooms} />
      <rect width={width} height={height} fill="#221e2c" />
      <rect x={WALL} y={WALL} width={layout.innerW} height={height - 2 * WALL} fill={`url(#${id}-hall)`} />
      {layout.corridors.map((c, i) => <Corridor key={i} b={c} layout={layout} schedule={model.shrine} now={now} index={i} />)}
      {layout.rooms.map(r => <RoomShell key={r.index} r={r} id={id} />)}
      <Reception layout={layout} id={id} onOpen={onOpen} />
      {layout.rooms.map(r => <g key={r.index} role="group" aria-label={`${r.room.name} room`}>
        {r.agents.map(p => {
          const a = p.agent, text = `${a.projectName} · ${a.title} · ${a.stateLabel}`;
          return <g key={a.id} className="office-agent" data-state={a.state} role="button" tabIndex={0} aria-label={text} style={{ cursor: "pointer" }}
            onClick={e => { e.stopPropagation(); onOpen(a.threadId); }}
            onKeyDown={(e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onOpen(a.threadId); } }}
            onPointerEnter={e => show(a, e.currentTarget)} onPointerLeave={hide} onFocus={e => show(a, e.currentTarget)} onBlur={hide}>
            <rect className="office-hit" x={p.x} y={p.y} width={CELL_W - 4} height={CELL_H - 4} fill="transparent" />
            <DeskCell x={p.x} y={p.y} variant={a.variant} state={a.state} tag={p.tag} />
            <rect className="office-focus" x={p.x} y={p.y} width={CELL_W - 4} height={CELL_H - 4} fill="none" strokeWidth={2} />
          </g>;
        })}
      </g>)}
      <rect x={0} y={0} width={width} height={WALL} fill="#2a2536" /><rect x={0} y={height - WALL} width={width} height={WALL} fill="#2a2536" opacity={0} />
      <rect x={0} y={0} width={WALL} height={height} fill="#2a2536" /><rect x={width - WALL} y={0} width={WALL} height={height} fill="#2a2536" />
      <rect x={0} y={height - WALL} width={layout.entrance.x - 0} height={WALL} fill="#2a2536" /><rect x={layout.entrance.x + layout.entrance.w} y={height - WALL} width={width - layout.entrance.x - layout.entrance.w} height={WALL} fill="#2a2536" />
    </svg>
    {tip && <div className="office-tip" data-below={tip.below || undefined} style={{ left: tip.x, top: tip.y }} aria-hidden="true">
      <i style={{ background: STATE_COLOR[tip.agent.state] }}>{STATE_CUE[tip.agent.state]}</i>
      <span><b>{tip.agent.projectName}</b> · {tip.agent.title} · {tip.agent.stateLabel}</span>
    </div>}
  </div>;
}

function Legend({ model, layout, now, children }: { model: OfficeModel; layout: Layout; now: number; children?: React.ReactNode }) {
  const counts = new Map<OfficeAgentState, number>();
  for (const a of model.agents) counts.set(a.state, (counts.get(a.state) ?? 0) + 1);
  void now;
  return <footer className="office-bar">
    <strong>Office</strong><span className="office-summary" role="status">{model.summary}</span>
    <ul className="office-legend" aria-label="Agent states">
      {STATES.map(s => <li key={s} data-state={s} data-zero={!counts.get(s) || undefined}><i aria-hidden="true" style={{ background: STATE_COLOR[s] }}>{STATE_CUE[s]}</i><span>{STATE_LABEL[s]}</span><b>{counts.get(s) ?? 0}</b></li>)}
      {model.shrine && <li data-state="scheduled"><i aria-hidden="true" className="office-chip-clock">◷</i><span>Scheduled</span><b>{model.shrine.entries.length}</b></li>}
    </ul>
    {layout.hiddenRooms > 0 && <span className="office-more">+{layout.hiddenRooms} more room{layout.hiddenRooms === 1 ? "" : "s"}</span>}
    {children}
  </footer>;
}

const FOCUSABLE = "button:not([disabled]), [role='button'][tabindex='0']";

function Overlay({ model, now, onOpen, onClose }: { model: OfficeModel; now: number; onOpen: (id: string) => void; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null), close = useRef<HTMLButtonElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(entries => { const r = entries[0]?.contentRect; if (r) setBox({ w: Math.round(r.width), h: Math.round(r.height) }); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Scene area = window minus the legend bar and stage padding.
  const layout = useMemo(() => bestFullLayout(model, box.w - 36, box.h - 36 - 22), [model, box]);
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
  return <div ref={root} className="office-overlay" role="dialog" aria-modal="true" aria-label="Office" onKeyDown={onKeyDown}>
    <Scene model={model} layout={layout} variant="full" now={now} onOpen={onOpen} />
    <Legend model={model} layout={layout} now={now}>
      <button ref={close} type="button" className="office-btn" aria-label="Close office" title="Close (Esc)" onClick={onClose}><X size={14} aria-hidden="true" /></button>
    </Legend>
  </div>;
}

export function Office({ sessions, projects, schedules, now, variant, onOpenThread, onExpand, onClose }: OfficeProps) {
  const clock = now ?? Date.now();
  const model = useMemo(() => officeModel(sessions, projects, clock, schedules), [sessions, projects, clock, schedules]);
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
  /** Show as many rooms as stay legible: pick the largest count whose scene scales to at least MINI_MIN_SCALE. */
  const miniLayout = useMemo(() => {
    let best = layoutOffice(model, "mini", MINI_MAX_ROOMS);
    if (width <= 0) return best;
    for (let k = MINI_MAX_ROOMS; k >= 2; k--) {
      best = layoutOffice(model, "mini", k);
      if ((width - 18) / best.width >= MINI_MIN_SCALE) break;
    }
    return best;
  }, [model, width]);

  if (variant === "full") return <Overlay model={model} now={clock} onOpen={openFromFull} onClose={closeFull} />;
  return <section ref={card} className="office-mini" aria-label="Office" data-narrow={width > 0 && width < 560 ? "2" : width > 0 && width < 860 ? "1" : undefined}>
    <Scene model={model} layout={miniLayout} variant="mini" now={clock} onOpen={onOpenThread} onBackground={expand} />
    <Legend model={model} layout={miniLayout} now={clock}>
      <button type="button" className="office-btn" aria-label="Expand office" title="Expand office" onClick={expand}><Maximize2 size={13} aria-hidden="true" /></button>
    </Legend>
    {expanded && <Overlay model={model} now={clock} onOpen={openFromFull} onClose={closeFull} />}
  </section>;
}
