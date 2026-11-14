import { createPortal } from "react-dom";
import { Eye, EyeOff, Maximize2, Minus, Plus, ScanLine, Volume2, VolumeX, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createOfficeSound, readSoundEnabled, writeSoundEnabled, type OfficeSound, type SoundKind } from "../officeShared/sound";
import { formatProjectName } from "../projectName";
import { officeModel, type OfficeAgent, type OfficeModel, type OfficeSchedule } from "../office/officeModel";
import { readRecentOnly, recentProjects, writeRecentOnly } from "../office/officeFilter";
import type { OfficeProps } from "../office/index";
import type { SceneProject } from "./draw";
import { dueLabel, shrineCountLabel, shrineEntries } from "./shrine";
import { useCampus, type CampusTip } from "./useCampus";
import { OfficeVersionPicker } from "../officeShared/OfficeVersionPicker";
import "../office/office.css";
import "../officeShared/officeShared.css";
import "./office7.css";

const FOCUSABLE = "button:not([disabled]), select:not([disabled]), [role='button'][tabindex='0']";
const LEGEND: { label: string; color: string; glyph: string }[] = [
  { label: "Working", color: "#2fb36d", glyph: "" }, { label: "Needs you", color: "#f5a524", glyph: "!" }, { label: "Review", color: "#4f7bff", glyph: "R" },
  { label: "Done", color: "#8de0a8", glyph: "✓" }, { label: "Failed", color: "#e5484d", glyph: "×" },
];
const COUNT_PARTS: { state: OfficeAgent["state"]; label: string }[] = [
  { state: "working", label: "working" }, { state: "needs-you", label: "needs you" }, { state: "review", label: "review" },
  { state: "failed", label: "failed" }, { state: "starting", label: "starting" }, { state: "done", label: "done" },
];
function countsFor(agents: readonly OfficeAgent[]): string {
  const n = new Map<string, number>();
  for (const a of agents) n.set(a.state, (n.get(a.state) ?? 0) + 1);
  return COUNT_PARTS.filter(p => n.get(p.state)).map(p => `${n.get(p.state)} ${p.label}`).join(" · ");
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

/** Sound toggle state plus cues when an agent's state changes (never on first render). */
function useCampusSound(agents: readonly OfficeAgent[], muted: boolean): [boolean, () => void] {
  const [on, setOn] = useState(readSoundEnabled);
  const sound = useRef<OfficeSound | null>(null);
  const prev = useRef<Map<string, OfficeAgent["state"]> | null>(null);
  useEffect(() => () => { sound.current?.dispose(); sound.current = null; }, []);
  useEffect(() => {
    const next = new Map(agents.map(a => [a.id, a.state] as const));
    const before = prev.current;
    prev.current = next;
    if (!before || !on || muted) return;
    const cue: Partial<Record<OfficeAgent["state"], SoundKind>> = { "needs-you": "needs-you", done: "complete", failed: "fail", review: "review" };
    for (const [id, st] of next) {
      const k = cue[st];
      if (k && before.get(id) !== st) { try { sound.current ??= createOfficeSound(); sound.current.setEnabled(true); sound.current.play(k); } catch (e) { console.warn("office7.sound.failed", e); } break; }
    }
  }, [agents, on, muted]);
  const toggle = useCallback(() => setOn(v => { writeSoundEnabled(!v); return !v; }), []);
  return [on, toggle];
}

function SoundToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const label = on ? "Sound on — mute" : "Sound off — unmute";
  const Icon = on ? Volume2 : VolumeX;
  return <button type="button" className="office-btn" aria-label={label} title={label} aria-pressed={on} onClick={onToggle}><Icon size={13} aria-hidden="true" /></button>;
}
function RecentToggle({ recentOnly, hidden, onToggle }: RecentProps) {
  const label = recentOnly ? `Showing recent projects only${hidden ? ` (${hidden} hidden)` : ""} — show all` : "Showing all projects — show recent only";
  const Icon = recentOnly ? EyeOff : Eye;
  return <button type="button" className="office-btn" aria-label={label} title={label} aria-pressed={!recentOnly} data-hidden-count={hidden} onClick={onToggle}><Icon size={13} aria-hidden="true" />{recentOnly && hidden > 0 && <span className="office-btn-count">{hidden}</span>}</button>;
}
type RecentProps = { recentOnly: boolean; hidden: number; onToggle: () => void };

function Legend({ summary }: { summary: string }) {
  return <ul className="office7-legend" aria-label="Legend">
    {LEGEND.map(l => <li key={l.label}><i style={{ background: l.color }} aria-hidden="true">{l.glyph}</i>{l.label}</li>)}
    <li className="office7-summary" role="status">{summary}</li>
  </ul>;
}

/** What the clock shrine says, shared by its tooltip and its screen-reader summary. */
type ShrineInfo = { count: string; next: string | null };
function useShrineInfo(schedules: readonly OfficeSchedule[] | undefined, now: number): ShrineInfo {
  return useMemo(() => {
    const entries = shrineEntries(schedules), first = entries[0];
    return { count: shrineCountLabel(entries.length), next: first ? `${first.name} · ${dueLabel(first.next_due, now)}` : null };
  }, [schedules, now]);
}

function ShrineSummary({ info }: { info: ShrineInfo }) {
  return <div className="office7-sr" role="group" aria-label="Clock shrine">{info.next ? `${info.count} · Next due ${info.next}` : "No schedules"}</div>;
}

function Tooltip({ tip, shrine }: { tip: CampusTip | null; shrine: ShrineInfo }) {
  if (!tip) return null;
  if (tip.shrine) return <div className="office7-tooltip" role="tooltip" style={{ left: tip.x, top: tip.y }}><b>Clock shrine</b><span>{shrine.next ? `Next: ${shrine.next}` : "No schedules"}</span>{shrine.count && <span>{shrine.count}</span>}</div>;
  if (tip.agent) {
    const a = tip.agent;
    return <div className="office7-tooltip" role="tooltip" style={{ left: tip.x, top: tip.y }}><b>{a.title}</b><span><i style={{ background: a.projectColor }} aria-hidden="true" />{a.projectName}</span><span>{a.stateLabel}</span></div>;
  }
  if (tip.project) return <div className="office7-tooltip" role="tooltip" style={{ left: tip.x, top: tip.y }}><b>{tip.project.name}</b><span>{countsFor(tip.project.agents) || "Quiet"}</span></div>;
  return null;
}

type Shell = Pick<OfficeProps, "renderTaskControls">;

/** Order panel for the building the user clicked (only when the shell can give orders). The old project-chip row is gone. */
function OrderPanel({ projects, selected, shell, floating, onListening }: { projects: readonly SceneProject[]; selected: string | null; shell: Shell; floating?: boolean; onListening: (v: boolean) => void }) {
  const current = shell.renderTaskControls ? projects.find(p => p.id === selected) : undefined;
  if (!current || !shell.renderTaskControls) return null;
  return <div className={`office7-order${floating ? " office7-order-float" : ""}`} onClick={e => e.stopPropagation()}><strong>{current.name}</strong>{shell.renderTaskControls(current.id, onListening)}</div>;
}

/** Visually hidden list so every agent is reachable from the keyboard / assistive tech, not only the canvas. */
function AgentList({ agents, onOpen }: { agents: readonly OfficeAgent[]; onOpen: (a: OfficeAgent) => void }) {
  return <ul className="office7-sr" aria-label="Agents">
    {agents.map(a => <li key={a.id}><button type="button" onClick={() => onOpen(a)}>{`${a.title} — ${a.projectName} — ${a.stateLabel}`}</button></li>)}
  </ul>;
}

function CampusStage({ campus, full, label, shrine }: { campus: ReturnType<typeof useCampus>; full: boolean; label: string; shrine: ShrineInfo }) {
  const { stageRef, canvasRef, size, handlers, tip, orientation } = campus;
  return <div ref={stageRef} className={`office7-stage${full ? " office7-stage-full" : ""}`} style={full ? undefined : { height: size.h || undefined }} data-orientation={orientation} data-layout={`${campus.layout.cols}x${campus.layout.rows}`}>
    <canvas ref={canvasRef} className="office7-canvas" aria-label={label} style={{ width: size.w || "100%", height: size.h || "100%" }} {...handlers} />
    <ShrineSummary info={shrine} />
    <Tooltip tip={tip} shrine={shrine} />
  </div>;
}

function useScene(model: OfficeModel, projects: readonly { id: string; name: string; color: string }[]): SceneProject[] {
  return useMemo(() => projects.map(p => ({ id: p.id, name: p.name, color: p.color, agents: model.agents.filter(a => a.projectId === p.id) })), [model.agents, projects]);
}
const sceneLabel = (n: number, summary: string) => `Campus with ${n} project${n === 1 ? "" : "s"}. ${summary}`;

type Clocked = { schedules?: readonly OfficeSchedule[]; now: number };

function MiniCard({ model, projects, shell, recent, schedules, now, onOpenThread, onExpand, expanded, children }: { model: OfficeModel; projects: readonly { id: string; name: string; color: string }[]; shell: Shell; recent: RecentProps; onOpenThread: (id: string) => void; onExpand: () => void; expanded: boolean; children?: React.ReactNode } & Clocked) {
  const reduced = usePrefersReducedMotion();
  const scene = useScene(model, projects);
  const [selected, setSelected] = useState<string | null>(null);
  const [sound, toggleSound] = useCampusSound(model.agents, expanded);
  const shrine = useShrineInfo(schedules, now);
  const campus = useCampus({
    mode: "mini", projects: scene, reduced, selected, schedules, now,
    onAgent: a => onOpenThread(a.threadId), onBuilding: id => setSelected(s => (s === id ? null : id)), onBackground: onExpand,
  });
  return <section className="office7-mini" aria-label="Office">
    <CampusStage campus={campus} full={false} label={sceneLabel(projects.length, model.summary)} shrine={shrine} />
    <AgentList agents={model.agents} onOpen={a => onOpenThread(a.threadId)} />
    <OrderPanel projects={scene} selected={selected} shell={shell} onListening={() => {}} />
    <footer className="office-bar office7-bar">
      <Legend summary={model.summary} />
      <RecentToggle {...recent} />
      <SoundToggle on={sound} onToggle={toggleSound} />
      <OfficeVersionPicker />
      <button type="button" className="office-btn" aria-label="Expand office" title="Expand office" onClick={onExpand}><Maximize2 size={13} aria-hidden="true" /></button>
    </footer>
    {children}
  </section>;
}

function Overlay({ model, projects, recent, shell, schedules, now, onOpen, onClose }: { model: OfficeModel; projects: readonly { id: string; name: string; color: string }[]; recent: RecentProps; shell: Shell; onOpen: (id: string) => void; onClose: () => void } & Clocked) {
  const root = useRef<HTMLDivElement>(null), close = useRef<HTMLButtonElement>(null);
  const reduced = usePrefersReducedMotion();
  const scene = useScene(model, projects);
  const [selected, setSelected] = useState<string | null>(null);
  const [sound, toggleSound] = useCampusSound(model.agents, false);
  const shrine = useShrineInfo(schedules, now);
  const campus = useCampus({
    mode: "full", projects: scene, reduced, selected, schedules, now,
    onAgent: a => onOpen(a.threadId), onBuilding: id => setSelected(s => (s === id ? null : id)), onBackground: () => setSelected(null),
  });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => { previous?.focus?.(); };
  }, []);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); onClose(); return; }
    if ((e.target as HTMLElement).tagName === "SELECT" && e.key !== "Tab") return;
    if (e.key === "+" || e.key === "=") { campus.zoomIn(); return; }
    if (e.key === "-" || e.key === "_") { campus.zoomOut(); return; }
    if (e.key === "0") { campus.fit(); return; }
    if (e.key !== "Tab" || !root.current) return;
    const items = [...root.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!items.length) return;
    const first = items[0]!, last = items[items.length - 1]!, active = document.activeElement;
    if (e.shiftKey && (active === first || !root.current.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !root.current.contains(active))) { e.preventDefault(); first.focus(); }
  };
  return createPortal(<div ref={root} className="office7-overlay" role="dialog" aria-modal="true" aria-label="Office" data-orientation={campus.orientation} onKeyDown={onKeyDown}>
    <div className="office7-main">
      <CampusStage campus={campus} full label={sceneLabel(projects.length, model.summary)} shrine={shrine} />
      <AgentList agents={model.agents} onOpen={a => onOpen(a.threadId)} />
      <OrderPanel projects={scene} selected={selected} shell={shell} floating onListening={() => {}} />
    </div>
    <footer className="office-bar office7-bar office7-bar-full">
      <Legend summary={model.summary} />
      <RecentToggle {...recent} />
      <SoundToggle on={sound} onToggle={toggleSound} />
      <button type="button" className="office-btn" aria-label="Zoom out" title="Zoom out (-)" onClick={campus.zoomOut}><Minus size={13} aria-hidden="true" /></button>
      <button type="button" className="office-btn" aria-label="Zoom in" title="Zoom in (+)" onClick={campus.zoomIn}><Plus size={13} aria-hidden="true" /></button>
      <button type="button" className="office-btn" aria-label="Fit to window" title="Fit (0)" onClick={campus.fit}><ScanLine size={13} aria-hidden="true" /></button>
      <OfficeVersionPicker />
      <button ref={close} type="button" className="office-btn" aria-label="Close office" title="Close (Esc)" onClick={onClose}><X size={13} aria-hidden="true" /></button>
    </footer>
  </div>, document.body);
}

export function Office7({ sessions, projects: sourceProjects, projectNameUppercase = false, schedules, queuedThreadIds, now, variant, onOpenThread, onExpand, onClose, renderTaskControls, proposals }: OfficeProps) {
  const allProjects = useMemo(() => sourceProjects.map(p => ({ ...p, name: formatProjectName(p.name, projectNameUppercase) })), [sourceProjects, projectNameUppercase]);
  const clock = now ?? Date.now();
  const [recentOnly, setRecentOnly] = useState(readRecentOnly);
  const toggleRecent = useCallback(() => setRecentOnly(v => { writeRecentOnly(!v); return !v; }), []);
  const workplace = useMemo(() => allProjects.filter(p => p.kind !== "commander"), [allProjects]);
  const projects = useMemo(() => (recentOnly ? recentProjects(workplace, sessions, schedules, clock, queuedThreadIds) : workplace), [recentOnly, workplace, sessions, schedules, clock, queuedThreadIds]);
  const slim = useMemo(() => projects.map(p => ({ id: p.id, name: p.name, color: p.color })), [projects]);
  const model = useMemo(() => officeModel(sessions, projects, clock, schedules, queuedThreadIds, proposals), [sessions, projects, clock, schedules, queuedThreadIds, proposals]);
  const recent: RecentProps = { recentOnly, hidden: workplace.length - projects.length, onToggle: toggleRecent };
  const [expanded, setExpanded] = useState(false);
  const closeFull = useCallback(() => { setExpanded(false); onClose?.(); }, [onClose]);
  const openFromFull = useCallback((id: string) => { closeFull(); onOpenThread(id); }, [closeFull, onOpenThread]);
  const expand = useCallback(() => { setExpanded(true); onExpand?.(); }, [onExpand]);
  const shell: Shell = { renderTaskControls };
  if (variant === "full") return <Overlay model={model} projects={slim} recent={recent} shell={shell} schedules={schedules} now={clock} onOpen={openFromFull} onClose={closeFull} />;
  return <MiniCard model={model} projects={slim} shell={shell} recent={recent} schedules={schedules} now={clock} onOpenThread={onOpenThread} onExpand={expand} expanded={expanded}>
    {expanded && <Overlay model={model} projects={slim} recent={recent} shell={shell} schedules={schedules} now={clock} onOpen={openFromFull} onClose={closeFull} />}
  </MiniCard>;
}
