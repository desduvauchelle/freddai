import { ComposerAgentPicker } from './ComposerAgentPicker';
import { ProjectTile } from "./ProjectTile";
import { formatProjectName } from "../projectName";
import { dashboardProjectGroups } from "../mobile/dashboard-projects";
import { Dot, labelStatus } from "./ThreadStatus";
import { newThreadDraftKey, useDraft, setDraft } from "./drafts";
import { agentDisplayName } from "./types";
import { BugWalkButton } from "./bug-walk/BugWalkButton";
import { defaultSelection, type AgentSelection } from "./agent-selection";
import { Activity, ArrowUpRight, Check, CircleAlert, Eye, EyeOff, FolderPlus, GripVertical, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@freddai/ui/components/button";
import { Input } from "@freddai/ui/components/input";
import { Permission } from "./AgentRequest";
import { DaySummaries } from "./DaySummaries";
import { mascotState } from "./mascot-state";
import { MicButton, VoiceNotice } from "./VoiceControls";
import { ThreadList } from "./ThreadList";
import { joinDictation } from "./voice";
import { threadListStatus, compareThreadRecency, type Account, type Project, type Session, type Workspace } from "./types";
import type { HomeLaunchPlan } from "./home-launch";
import { homeRunState } from "./home-state";
import { Office, type OfficeProposal, type OfficeSchedule } from "../office/index";
import { CommanderCluster } from "./commander/CommanderCluster";
import { ProjectSheet } from "./ProjectSheet";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, pointerWithin, useDroppable, useSensor, useSensors, type DragEndEvent, type DragOverEvent, type CollisionDetection, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { dropOutcome, withEmptyGroups, type DropPosition } from "./workspace-order";
import "./home.css";
import { OfficeOrder } from "../office/OfficeOrder";
import { HOME_RECENT_ONLY_KEY, RECENT_WINDOW_MS, readRecentOnly, recentProjects, writeRecentOnly } from "../office/officeFilter";

const RECENT_DAYS = Math.round(RECENT_WINDOW_MS / 86_400_000);
const OLD_PROJECTS_HINT = `Projects with no activity in the last ${RECENT_DAYS} days`;

export { homeRunState } from "./home-state";

const isLive = (t: Session) => !t.archived && t.deleted_at == null && t.status !== "archived" && t.status !== "deleted";
export const startOfLocalDay = (now: number) => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

export type HomeProject = { project: Project; working: number; done: number; needs: number; failed: number; lastActivity: number; latest: string | null; recent: Session[]; pending: HomeRecent[] };

/** All configured projects in saved order; activity updates change counters only. */
export type PendingLaunch = { id: string; project: string; title: string; /** Set once the host returned the thread id, so the row can be deduped against `sessions`. */ threadId?: string; failed?: string };
export type HomeRecent = { id: string; title: string; status: string; error?: string };
export const pendingTitle = (prompt: string) => { const line = prompt.trim().split("\n")[0]; return line.length > 60 ? `${line.slice(0, 59)}…` : line; };

export function homeProjects(sessions: readonly Session[], projects: readonly Project[], now: number, pending: readonly PendingLaunch[] = []): HomeProject[] {
  const midnight = startOfLocalDay(now), rows: HomeProject[] = [];
  for (const project of projects) {
    if (project.kind === "commander") continue;
    const mine = sessions.filter(t => t.project === project.id && isLive(t));
    const recent = [...mine].sort(compareThreadRecency).slice(0, 3);
    const today = mine.filter(t => t.updated >= midnight);
    rows.push({
      project,
      working: mine.filter(t => homeRunState(t) === "running").length,
      needs: mine.filter(t => homeRunState(t) === "waiting").length,
      failed: mine.filter(t => homeRunState(t) === "failed" && t.updated >= midnight).length,
      done: today.filter(t => t.status === "done" && !t.pending).length,
      lastActivity: Math.max(0, ...today.map(t => t.updated)),
      latest: recent[0]?.id ?? null,
      recent,
      pending: pending.filter(p => p.project === project.id && !(p.threadId && sessions.some(t => t.id === p.threadId)))
        .map(p => ({ id: `pending:${p.id}`, title: p.title, status: p.failed ? "failed" : "sending", error: p.failed })),
    });
  }
  return rows;
}

export const needsYou = (sessions: readonly Session[]) => sessions.filter(t => isLive(t) && !!t.pending).sort(compareThreadRecency);

export type HomeViewProps = {
  modelConfiguration?: import("./model-levels").ModelConfiguration;
  projectNameUppercase?: boolean;
  homeAccount?: string;
  onHomeAccount?: (account: string) => void;
  native?: boolean;
  homeSelections?: Record<string, AgentSelection>;
  onHomeSelection?: (account: string, selection: AgentSelection) => void;
  sessions: Session[];
  read?: Record<string, number>;
  projects: Project[];
  workspaces?: Workspace[];
  accounts: Account[];
  onMoveProject?: (id: string, target: string, after: boolean) => void;
  /** Drop into another workspace (null = "Other projects", i.e. no workspace), next to `position.targetProjectId` when given. */
  onMoveProjectToWorkspace?: (projectId: string, workspaceId: string | null, position?: DropPosition) => void;
  /** Injectable clock for tests; defaults to Date.now(). */
  now?: number;
  /** False in the browser preview or while a launch is already in flight. */
  canCreate: boolean;
  onOpenThread: (id: string) => void;
  /** Launches in flight (not yet in `sessions`); shown as "Sending…" rows on their project card. */
  pendingLaunches?: readonly PendingLaunch[];
  onAddProject: () => void;
  /** Opens the full project-scoped composer without starting a thread. */
  onNewThread?: (projectId: string) => void;
  /** Creates and starts a thread through the same launch path as the New thread composer. */
  onCreateThread: (projectId: string, prompt: string) => Promise<string | void>;
  /** Resolves the agent a new thread in this project will use (shared with the launch itself). */
  resolveLaunch: (projectId: string) => HomeLaunchPlan;
  onRespond: (thread: Session, allow: boolean, answers: Record<string, unknown>) => Promise<unknown>;
  /** Optional scheduled work, shown at the Office clock shrine. */
  schedules?: OfficeSchedule[];
  /** Commander-in-Chief presence above the project list; omitted when unavailable. */
  /** Renders one thread live inside the project sheet; without it a row click opens the thread in the main view. */
  renderThread?: (id: string) => ReactNode;
  /** Called while a thread is visible in the project sheet so the host can mark it read. */
  onThreadViewed?: (thread: Session) => void;
  commander?: { onOpen: () => void; onSend: (text: string) => Promise<void>; proposals?: readonly OfficeProposal[]; onProposalRespond?: (id: string, approve: boolean) => Promise<unknown> };
};

function Tile({ entry, open, canCreate, plan, onToggle, onCreate, onOpen, onOpenThread, read, uppercase }: {
  uppercase?: boolean;
  read: Record<string, number>; entry: HomeProject; open: boolean; canCreate: boolean; plan: HomeLaunchPlan; onToggle: () => void; onCreate: (prompt: string) => Promise<string | void>; onOpen: () => void; onOpenThread: (id: string) => void;
}) {
  const { project } = entry;
  const [started, setStarted] = useState("");
  useEffect(() => { if (!started) return; const t = setTimeout(() => setStarted(""), 4000); return () => clearTimeout(t); }, [started]);
  const confirm = (prompt: string, title: string | void) => setStarted(`Started · ${(title || prompt).trim().split(/\s+/).slice(0, 8).join(" ")}`);
  const draftKey = newThreadDraftKey(project.id);
  const text = useDraft(draftKey);
  const setText = (value: string | ((previous: string) => string)) => setDraft(draftKey, typeof value === "function" ? value(text) : value);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy || !plan.ok) return;
    setBusy(true); setError("");
    try { const prompt = text.trim(), title = await onCreate(prompt); setText(""); setArmed(false); confirm(prompt, title); onToggle(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  // Voice: the transcript becomes the first message of a new thread in this project (same path as the typed prompt).
  const [micUsed, setMicUsed] = useState(false), [dictating, setDictating] = useState(false), [armed, setArmed] = useState(false);
  async function dictate(transcript: string) {
    setError("");
    if (!plan.ok) { setError(plan.reason); return; }
    setDictating(true);
    try { await onCreate(transcript); setArmed(false); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setDictating(false); }
  }
  return <ProjectTile uppercase={uppercase} project={project} hasThreads={!!entry.latest}
    recent={[...entry.pending, ...entry.recent.map(thread => ({ id: thread.id, title: thread.title, status: threadListStatus(thread, read) }))].slice(0, 3)}
    onOpen={onOpen} onOpenThread={id => { if (!id.startsWith("pending:")) onOpenThread(id); }} actions={      <div className="home-tile-actions" onPointerDownCapture={() => { setMicUsed(true); setArmed(true); }}>
        <Button type="button" variant="outline" size="icon" className="home-tile-add" aria-label={`New thread in ${project.name}`}
          title="New thread" aria-expanded={open} disabled={!canCreate} onClick={onToggle}>
          {open ? <X size={14} /> : <Plus size={14} />}
        </Button>
        <MicButton target={false} onText={t => void dictate(t)} />
      </div>}>
    {micUsed && <VoiceNotice target />}
    {(open || armed || dictating) && <p className="home-agent-chip" data-state={plan.ok ? "ok" : "error"} role={plan.ok ? undefined : "alert"} aria-label={plan.ok ? `Agent: ${plan.label}` : undefined} title={plan.ok ? `Agent for new threads: ${plan.label}` : plan.reason}>
      {plan.ok ? plan.label : plan.reason}</p>}
    {started && <p className="home-started" role="status">{started}</p>}
    {!open && error && <p role="alert" className="inline-error home-tile-error">{error}</p>}
    {open && <form className="home-prompt" onSubmit={e => void submit(e)}>
      <Input autoFocus aria-label={`Prompt for ${project.name}`} placeholder="What should we work on?" value={text} disabled={busy}
        onChange={e => setText(e.target.value)} />
      <MicButton target={false} onText={t => setText(previous => joinDictation(previous, t))} />
      <Button type="submit" size="sm" disabled={!canCreate || busy || !text.trim() || !plan.ok}>{busy ? "Starting…" : "Start"}</Button>
      {error && <p role="alert" className="inline-error">{error}</p>}
    </form>}
  </ProjectTile>;
}

const groupKey = (id: string) => id ? `workspace:${id}` : "other";
// Prefer the card under the pointer (precise reorder), then the group under it (empty groups), else nearest corners.
const collision: CollisionDetection = args => {
  const hits = pointerWithin(args);
  if (hits.length) { const cards = hits.filter(h => !String(h.id).startsWith("workspace:") && h.id !== "other"); return cards.length ? cards : hits; }
  return closestCorners(args);
};
const workspaceOfKey = (key: string) => key === "other" ? null : key.slice("workspace:".length);

function SortableCard({ id, name, reorderable, onAltMove, children }: { id: string; name: string; reorderable: boolean; onAltMove: (offset: -1 | 1) => void; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !reorderable, transition: { duration: 200, easing: "ease" } });
  return <div ref={setNodeRef} className="home-project-card" data-home-project={id} data-dragging={isDragging ? "true" : undefined}
    style={{ transform: CSS.Transform.toString(transform), transition: transition ?? undefined }}>
    {reorderable && <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} className="project-drag-handle home-project-reorder" aria-label={`Reorder ${name}`}
      title="Drag to reorder or move to another workspace · Alt+↑/↓ to move"
      onKeyDown={e => {
        if (e.altKey && ["ArrowUp", "ArrowDown"].includes(e.key)) { e.preventDefault(); onAltMove(e.key === "ArrowUp" ? -1 : 1); return; }
        listeners?.onKeyDown?.(e);
      }}><GripVertical size={13} /></button>}
    {children}
  </div>;
}

function DropGroup({ groupId, name, ids, over, children }: { groupId: string; name: string | null; ids: string[]; over: boolean; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: groupId });
  return <section ref={setNodeRef} className="home-workspace-group" aria-label={name ?? undefined} data-over={over ? "true" : undefined}>
    {name && <h3 className="home-workspace-heading">{name}</h3>}
    <SortableContext items={ids} strategy={rectSortingStrategy}><div className="home-tiles">{children}</div></SortableContext>
  </section>;
}

export function HomeView({ sessions, read = {}, projects, workspaces, accounts, now, canCreate, onOpenThread, pendingLaunches, onAddProject, onNewThread, onCreateThread, resolveLaunch, onRespond, schedules, native = false, homeSelections = {}, onHomeSelection, commander, renderThread, onThreadViewed, onMoveProject, onMoveProjectToWorkspace, homeAccount = "", onHomeAccount, projectNameUppercase = false, modelConfiguration }: HomeViewProps) {
  const [items, setItems] = useState<Record<string, string[]> | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const origin = useRef("");
  const dragging = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const clock = now ?? Date.now();
  const [recentOnly, setRecentOnly] = useState(() => readRecentOnly(HOME_RECENT_ONLY_KEY));
  const setRecent = (value: boolean) => { setRecentOnly(value); writeRecentOnly(value, HOME_RECENT_ONLY_KEY); };
  // Hidden projects stay in `projects` (and therefore in the persisted order); only the rendered tiles are filtered.
  const workplaceProjects = useMemo(() => projects.filter(p => p.kind !== "commander"), [projects]);
  const visibleWorkplace = useMemo(() => recentOnly ? recentProjects(workplaceProjects, sessions, schedules, clock) : workplaceProjects, [recentOnly, workplaceProjects, sessions, schedules, clock]);
  const visibleProjects = useMemo(() => { const keep = new Set(visibleWorkplace.map(p => p.id)); return projects.filter(p => p.kind === "commander" || keep.has(p.id)); }, [projects, visibleWorkplace]);
  const hiddenCount = workplaceProjects.length - visibleWorkplace.length;
  const tiles = useMemo(() => homeProjects(sessions, visibleProjects, clock, pendingLaunches), [sessions, visibleProjects, clock, pendingLaunches]);
  const entries = new Map(tiles.map(entry => [entry.project.id, entry]));
  const baseGroups = dashboardProjectGroups({ projects: visibleProjects, workspaces });
  const layoutKey = JSON.stringify([visibleProjects.map(p => p.id), workspaces?.map(w => w.projects)]);
  // Optimistic layout: kept after a drop until the saved order/membership arrives (or 1.5s passes) so the card never snaps back.
  useEffect(() => {
    if (dragging.current) return;
    setItems(null);
  }, [layoutKey]);
  const baseLayout = useMemo(() => {
    const map: Record<string, string[]> = Object.fromEntries(baseGroups.map(g => [groupKey(g.id), g.projects.map(p => p.id)]));
    return withEmptyGroups(map, (workspaces ?? []).map(w => groupKey(w.id)), !!workspaces?.length);
  }, [layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const layout = items ?? baseLayout;
  // While dragging, every workspace (even empty ones) and "Other projects" is a drop target.
  const groups = [
    ...baseGroups.map(g => ({ key: groupKey(g.id), id: g.id, name: g.name })),
    ...(activeId ? [
      ...(workspaces ?? []).filter(w => !baseGroups.some(g => g.id === w.id)).map(w => ({ key: groupKey(w.id), id: w.id, name: w.name as string | null })),
      ...(workspaces?.length && !baseGroups.some(g => !g.id) ? [{ key: "other", id: "", name: "Other projects" as string | null }] : []),
    ] : []),
  ];
  const findContainer = (id: string, map: Record<string, string[]>) => id in map ? id : Object.keys(map).find(key => map[key].includes(id));
  const dragStart = (e: DragStartEvent) => { dragging.current = true; origin.current = findContainer(String(e.active.id), baseLayout) ?? ""; setItems(baseLayout); setActiveId(String(e.active.id)); };
  const dragOver = ({ active, over }: DragOverEvent) => {
    if (!over || !items) return;
    const id = String(active.id), overId = String(over.id);
    const from = findContainer(id, items), to = findContainer(overId, items);
    if (!from || !to || from === to) return;
    const list = items[to].filter(p => p !== id);
    const overIndex = overId in items ? list.length : list.indexOf(overId);
    const rect = active.rect.current.translated, below = !!rect && !!over.rect && rect.left > over.rect.left + over.rect.width / 2 - 1 && !(overId in items);
    const at = overIndex < 0 ? list.length : overIndex + (below ? 1 : 0);
    setItems({ ...items, [from]: items[from].filter(p => p !== id), [to]: [...list.slice(0, at), id, ...list.slice(at)] });
  };
  const dragEnd = ({ active, over }: DragEndEvent) => {
    dragging.current = false; setActiveId(null);
    const id = String(active.id);
    if (!items || !over) { setItems(null); return; }
    const to = findContainer(id, items);
    if (!to) { setItems(null); return; }
    let list = items[to];
    const overId = String(over.id);
    if (!(overId in items) && findContainer(overId, items) === to && overId !== id) {
      const target = list.indexOf(overId), index = list.indexOf(id);
      if (target >= 0 && index !== target) list = arrayMove(list, index, target);
    }
    setItems({ ...items, [to]: list });
    setTimeout(() => { if (!dragging.current) setItems(null); }, 1500);
    const { crossed, position } = dropOutcome({ id, from: origin.current, to, list });
    if (crossed) onMoveProjectToWorkspace?.(id, workspaceOfKey(to), position);
    else if (position) onMoveProject?.(id, position.targetProjectId, position.after);
  };
  const dragCancel = () => { dragging.current = false; setActiveId(null); setItems(null); };
  const launchAccounts = accounts.filter(account => projects.some(project => { if (project.kind === "commander") return false; const plan = resolveLaunch(project.id); return plan.ok && plan.account === account.id; }));
  const selectedAccount = accounts.find(account => account.id === homeAccount);
  const modelAccounts = selectedAccount ? [selectedAccount] : launchAccounts.slice(0, 1);
  const waiting = useMemo(() => needsYou(sessions), [sessions]);
  const [openProject, setOpenProject] = useState<string | null>(null);
  // Project sheet state is local so the dashboard behind it stays mounted and untouched.
  const [sheet, setSheet] = useState<{ project: string; thread: string | null } | null>(null);
  const sheetThread = sheet?.thread ? sessions.find(t => t.id === sheet.thread) : undefined;
  useEffect(() => { if (sheetThread && onThreadViewed) onThreadViewed(sheetThread); }, [sheetThread?.id, sheetThread?.status, sheetThread?.updated]); // eslint-disable-line react-hooks/exhaustive-deps
  const sheetEntry = sheet ? entries.get(sheet.project) : undefined;
  const sheetSessions = useMemo(() => sheet ? sessions.filter(t => t.project === sheet.project && isLive(t)).sort(compareThreadRecency) : [], [sessions, sheet?.project]);
  const live = sessions.filter(isLive);
  const mood = mascotState(undefined, live);
  const working = live.filter(t => homeRunState(t) === "running").length;
  const projectName = (id: string) => projects.find(p => p.id === id)?.name ?? id;
  const summary = [working ? `${working} working` : "", waiting.length ? `${waiting.length} need${waiting.length === 1 ? "s" : ""} you` : ""].filter(Boolean).join(" · ") || "All quiet";

  const renderTile = (entry: HomeProject) => <Tile uppercase={projectNameUppercase} read={read} entry={entry} canCreate={canCreate} plan={resolveLaunch(entry.project.id)} open={openProject === entry.project.id}
    onToggle={() => onNewThread ? onNewThread(entry.project.id) : setOpenProject(current => current === entry.project.id ? null : entry.project.id)}
    onOpenThread={onOpenThread} onCreate={prompt => onCreateThread(entry.project.id, prompt)} onOpen={() => setSheet({ project: entry.project.id, thread: null })} />;

  return <section className="home-view" aria-label="Home">
    <div className="home-status">
      <div>
        <strong role="status">{mood.label}</strong>
        <span>{summary}</span>
      </div>
    </div>

    {commander && <CommanderCluster onOpen={commander.onOpen} onSend={commander.onSend} bugWalk={native ? <BugWalkButton className="commander-circle-button" /> : undefined} />}

    {waiting.length > 0 && <section className="home-section" aria-label="Needs you">
      <div className="home-section-title"><span>Needs you</span><span className="home-count">{waiting.length}</span></div>
      <div className="home-queue">
        <ThreadList threads={waiting} renderRow={thread => <article className="home-request" aria-label={`Request in ${thread.title}`}>
          <header>
            <span className="home-request-project">{formatProjectName(projectName(thread.project), projectNameUppercase)}</span>
            <strong title={thread.title}>{thread.title}</strong>
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenThread(thread.id)}>Open thread<ArrowUpRight size={12} aria-hidden="true" /></Button>
          </header>
          {thread.pending && <Permission key={`${thread.id}:${JSON.stringify(thread.pending.request_id ?? thread.pending.id)}`}
            pending={thread.pending} provider={accounts.find(a => a.id === thread.account)?.provider || "codex"}
            onReply={(allow, answers) => onRespond(thread, allow, answers)} />}
        </article>} />
      </div>
    </section>}

    <Office projectNameUppercase={projectNameUppercase} proposals={commander?.proposals} onProposalRespond={commander?.onProposalRespond} onOpenCommander={commander?.onOpen} renderTaskControls={(project, onListening) => <OfficeOrder key={project} disabled={!canCreate || !resolveLaunch(project).ok}
      onSend={text => onCreateThread(project, text)} renderMic={(onText, disabled) => <><MicButton target={false} disabled={disabled} onListening={onListening} label={`Give an order to ${projectName(project)}`} onText={onText} /><VoiceNotice target /></>} />} variant="mini" sessions={sessions} projects={projects} schedules={schedules} now={now} onOpenThread={onOpenThread} />

    <section className="home-section" aria-label="Projects">
      <div className="dashboard-project-toolbar">
      <div className="home-section-title"><span>Projects</span>
        <Button type="button" variant="ghost" size="sm" onClick={onAddProject}><FolderPlus size={13} aria-hidden="true" />Add project</Button>
        {(hiddenCount > 0 || !recentOnly) && <Button type="button" variant="ghost" size="sm" aria-pressed={!recentOnly} aria-label={recentOnly ? `Show old projects (${hiddenCount}). ${OLD_PROJECTS_HINT}` : `Hide old projects. ${OLD_PROJECTS_HINT}`} title={OLD_PROJECTS_HINT} onClick={() => setRecent(!recentOnly)}>
          {recentOnly ? <Eye size={13} aria-hidden="true" /> : <EyeOff size={13} aria-hidden="true" />}{recentOnly ? `Show old projects (${hiddenCount})` : "Hide old projects"}</Button>}
      </div>
      <div className="dashboard-launch-controls" role="group" aria-label="Dashboard task defaults">
          {(onHomeAccount || onHomeSelection) && <ComposerAgentPicker displayLabel={modelAccounts[0] ? agentDisplayName(modelAccounts[0]) : undefined} options={[{ id: '', label: 'Project defaults' }, ...accounts.map(account => ({ id: account.id, label: agentDisplayName(account), account }))]} agent={selectedAccount?.id || ''} onAgentChange={id => onHomeAccount?.(id)} account={modelAccounts[0]} native={native} modelConfiguration={modelConfiguration} value={modelAccounts[0] ? homeSelections[modelAccounts[0].id] ?? defaultSelection : defaultSelection} onChange={selection => { if (modelAccounts[0]) onHomeSelection?.(modelAccounts[0].id, selection); }} disabled={!canCreate || !accounts.length}/>}
          
      </div>
      </div>
      {tiles.length ? <DndContext sensors={sensors} collisionDetection={collision} onDragStart={dragStart} onDragOver={dragOver} onDragEnd={dragEnd} onDragCancel={dragCancel}>
        {groups.map(group => { const ids = (layout[group.key] ?? []).filter(id => entries.has(id));
          return <DropGroup key={group.key} groupId={group.key} name={group.name} ids={ids} over={!!activeId && !!items && findContainer(activeId, items) === group.key && origin.current !== group.key}>
          {ids.map((id, index) => { const entry = entries.get(id)!;
            return <SortableCard key={id} id={id} name={entry.project.name} reorderable={!!onMoveProject || !!onMoveProjectToWorkspace}
              onAltMove={offset => { const target = ids[index + offset]; if (target) onMoveProject?.(id, target, offset > 0); }}>
              {renderTile(entry)}</SortableCard>; })}
          </DropGroup>; })}
        <DragOverlay>{activeId && entries.get(activeId) ? <div className="home-project-card home-project-card--overlay">{renderTile(entries.get(activeId)!)}</div> : null}</DragOverlay>
      </DndContext> : hiddenCount > 0 && recentOnly
        ? <p className="home-empty">All {hiddenCount} project{hiddenCount === 1 ? " is" : "s are"} old. <button type="button" className="home-empty-action" onClick={() => setRecent(false)}>Show old projects.</button></p>
        : <p className="home-empty">No projects yet. Add a project to get started.</p>}
    </section>

    <section className="home-section home-summaries" aria-label="Daily summaries">
      <div className="home-section-title"><span>Daily summaries</span></div>
      <DaySummaries now={now === undefined ? undefined : new Date(now)} />
    </section>

    {sheet && sheetEntry && <ProjectSheet uppercase={projectNameUppercase} project={sheetEntry.project} sessions={sheetSessions} pending={sheetEntry.pending} read={read} now={clock}
      threadId={sheet.thread}
      onSelectThread={id => renderThread ? setSheet({ project: sheet.project, thread: id }) : (setSheet(null), onOpenThread(id))}
      onBack={() => setSheet({ project: sheet.project, thread: null })} onClose={() => setSheet(null)}
      onNewThread={() => { const id = sheet.project; setSheet(null); if (onNewThread) onNewThread(id); else setOpenProject(id); }}
      onOpenInMain={id => { setSheet(null); onOpenThread(id); }}
      renderThread={id => renderThread?.(id) ?? null} />}
  </section>;
}
