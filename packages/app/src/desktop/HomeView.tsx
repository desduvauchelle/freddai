import { newThreadDraftKey, useDraft, setDraft } from "./drafts";
import { agentDisplayName } from "./types";
import { AgentControls } from "./AgentControls";
import { defaultSelection, type AgentSelection } from "./agent-selection";
import { Activity, ArrowUpRight, Check, CircleAlert, FolderPlus, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@freddai/ui/components/button";
import { Input } from "@freddai/ui/components/input";
import { Permission } from "./AgentRequest";
import { DaySummaries } from "./DaySummaries";
import { Dormouse } from "./Dormouse";
import { MASCOT_PRIORITY, mascotState } from "./mascot-state";
import { MicButton, VoiceNotice } from "./VoiceControls";
import { ThreadList } from "./ThreadList";
import { joinDictation } from "./voice";
import { compareThreadRecency, type Account, type Project, type Session } from "./types";
import type { HomeLaunchPlan } from "./home-launch";
import { homeRunState } from "./home-state";
import { Office, type OfficeSchedule } from "../office/index";
import { CommanderCluster } from "./commander/CommanderCluster";
import "./home.css";

export { homeRunState } from "./home-state";

const isLive = (t: Session) => !t.archived && t.deleted_at == null && t.status !== "archived" && t.status !== "deleted";
export const startOfLocalDay = (now: number) => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

export type HomeProject = { project: Project; working: number; done: number; needs: number; failed: number; lastActivity: number; latest: string | null };

/** All configured projects in saved order; activity updates change counters only. */
export function homeProjects(sessions: readonly Session[], projects: readonly Project[], now: number): HomeProject[] {
  const midnight = startOfLocalDay(now), rows: HomeProject[] = [];
  for (const project of projects) {
    const mine = sessions.filter(t => t.project === project.id && isLive(t));
    const today = mine.filter(t => t.updated >= midnight);
    rows.push({
      project,
      working: mine.filter(t => homeRunState(t) === "running").length,
      needs: mine.filter(t => homeRunState(t) === "waiting").length,
      failed: mine.filter(t => homeRunState(t) === "failed" && t.updated >= midnight).length,
      done: today.filter(t => t.status === "done" && !t.pending).length,
      lastActivity: Math.max(0, ...today.map(t => t.updated)),
      latest: [...mine].sort(compareThreadRecency)[0]?.id ?? null,
    });
  }
  return rows;
}

export const needsYou = (sessions: readonly Session[]) => sessions.filter(t => isLive(t) && !!t.pending).sort(compareThreadRecency);

export type HomeViewProps = {
  native?: boolean;
  homeSelections?: Record<string, AgentSelection>;
  onHomeSelection?: (account: string, selection: AgentSelection) => void;
  sessions: Session[];
  projects: Project[];
  accounts: Account[];
  /** Injectable clock for tests; defaults to Date.now(). */
  now?: number;
  /** False in the browser preview or while a launch is already in flight. */
  canCreate: boolean;
  onOpenThread: (id: string) => void;
  onAddProject: () => void;
  /** Creates and starts a thread through the same launch path as the New thread composer. */
  onCreateThread: (projectId: string, prompt: string) => Promise<string | void>;
  /** Resolves the agent a new thread in this project will use (shared with the launch itself). */
  resolveLaunch: (projectId: string) => HomeLaunchPlan;
  onRespond: (thread: Session, allow: boolean, answers: Record<string, unknown>) => Promise<unknown>;
  /** Optional scheduled work, shown at the Office clock shrine. */
  schedules?: OfficeSchedule[];
  /** Commander-in-Chief presence above the project list; omitted when unavailable. */
  commander?: { onOpen: () => void; onSend: (text: string) => Promise<void> };
};

function Tile({ entry, open, canCreate, plan, onToggle, onCreate, onOpen }: {
  entry: HomeProject; open: boolean; canCreate: boolean; plan: HomeLaunchPlan; onToggle: () => void; onCreate: (prompt: string) => Promise<string | void>; onOpen: () => void;
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
    try { const title = await onCreate(transcript); setArmed(false); confirm(transcript, title); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setDictating(false); }
  }
  return <article className="home-tile" aria-label={`Project ${project.name}`}>
    <header>
      <span className="home-project-dot" style={{ background: project.color }} aria-hidden="true" />
      <button type="button" className="home-tile-open" title={entry.latest ? `Open latest thread in ${project.name}` : `New thread in ${project.name}`} aria-label={entry.latest ? `Open latest thread in ${project.name}` : `Create first thread in ${project.name}`} onClick={onOpen}><strong>{project.name}</strong></button>
      <div className="home-tile-actions" onPointerDownCapture={() => { setMicUsed(true); setArmed(true); }}>
        <MicButton target={false} onText={t => void dictate(t)} />
        <Button type="button" variant="outline" size="icon" className="home-tile-add" aria-label={`New thread in ${project.name}`}
          title="New thread" aria-expanded={open} disabled={!canCreate} onClick={onToggle}>
          {open ? <X size={14} /> : <Plus size={14} />}
        </Button>
      </div>
    </header>
    <ul className="home-counts" aria-label="Thread status">
      <li data-kind="working"><Activity size={12} aria-hidden="true" />{entry.working} working</li>
      <li data-kind="done"><Check size={12} aria-hidden="true" />{entry.done} done</li>
      <li data-kind="needs" data-active={entry.needs > 0}><CircleAlert size={12} aria-hidden="true" />{entry.needs} needs you</li>
      {entry.failed > 0 && <li data-kind="failed"><CircleAlert size={12} aria-hidden="true" />{entry.failed} failed</li>}
    </ul>
    {micUsed && <VoiceNotice target />}
    {dictating && <div className="voice-notice" role="status">Starting thread…</div>}
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
  </article>;
}

export function HomeView({ sessions, projects, accounts, now, canCreate, onOpenThread, onAddProject, onCreateThread, resolveLaunch, onRespond, schedules, native = false, homeSelections = {}, onHomeSelection, commander }: HomeViewProps) {
  const clock = now ?? Date.now();
  const tiles = useMemo(() => homeProjects(sessions, projects, clock), [sessions, projects, clock]);
  const launchAccounts = accounts.filter(account => projects.some(project => { const plan = resolveLaunch(project.id); return plan.ok && plan.account === account.id; }));
  const waiting = useMemo(() => needsYou(sessions), [sessions]);
  const [openProject, setOpenProject] = useState<string | null>(null);
  const live = sessions.filter(isLive);
  const mood = mascotState(undefined, live);
  const working = live.filter(t => homeRunState(t) === "running").length;
  const projectName = (id: string) => projects.find(p => p.id === id)?.name ?? id;
  const summary = [working ? `${working} working` : "", waiting.length ? `${waiting.length} need${waiting.length === 1 ? "s" : ""} you` : ""].filter(Boolean).join(" · ") || "All quiet";

  return <section className="home-view" aria-label="Home">
    <div className="home-status">
      <Dormouse size={56} priority={MASCOT_PRIORITY.hero} mood={mood.mood} label={mood.label} pauseControl={false} />
      <div>
        <strong role="status">{mood.label}</strong>
        <span>{summary}</span>
      </div>
    </div>

    <Office variant="mini" sessions={sessions} projects={projects} schedules={schedules} now={now} onOpenThread={onOpenThread} />

    {commander && <CommanderCluster onOpen={commander.onOpen} onSend={commander.onSend} />}

    <section className="home-section" aria-label="Projects">
      <div className="home-section-title"><span>Projects</span>
        <div className="home-header-actions">
          {onHomeSelection && launchAccounts.map(account => <div key={account.id} className="home-model" aria-label={`Model for ${agentDisplayName(account)}`} title={`Agent for Home microphones and new threads · ${agentDisplayName(account)}`}>
            {launchAccounts.length > 1 && <span>{agentDisplayName(account)}</span>}
            <AgentControls account={account} native={native} value={homeSelections[account.id] ?? defaultSelection} onChange={selection => onHomeSelection(account.id, selection)} disabled={!canCreate} context="Home microphones and new threads" />
          </div>)}
        <Button type="button" variant="ghost" size="sm" onClick={onAddProject}><FolderPlus size={13} aria-hidden="true" />Add project</Button>
        </div>
      </div>
      {tiles.length ? <div className="home-tiles">
        {tiles.map(entry => <Tile key={entry.project.id} entry={entry} canCreate={canCreate} plan={resolveLaunch(entry.project.id)} open={openProject === entry.project.id}
          onToggle={() => setOpenProject(current => current === entry.project.id ? null : entry.project.id)}
          onCreate={prompt => onCreateThread(entry.project.id, prompt)} onOpen={() => { if (entry.latest) onOpenThread(entry.latest); else setOpenProject(entry.project.id); }} />)}
      </div> : <p className="home-empty">No projects yet. Add a project to get started.</p>}
    </section>

    <section className="home-section" aria-label="Needs you">
      <div className="home-section-title"><span>Needs you</span><span className="home-count">{waiting.length}</span></div>
      {waiting.length ? <div className="home-queue">
        <ThreadList threads={waiting} renderRow={thread => <article className="home-request" aria-label={`Request in ${thread.title}`}>
          <header>
            <span className="home-request-project">{projectName(thread.project)}</span>
            <strong title={thread.title}>{thread.title}</strong>
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenThread(thread.id)}>Open thread<ArrowUpRight size={12} aria-hidden="true" /></Button>
          </header>
          {thread.pending && <Permission key={`${thread.id}:${JSON.stringify(thread.pending.request_id ?? thread.pending.id)}`}
            pending={thread.pending} provider={accounts.find(a => a.id === thread.account)?.provider || "codex"}
            onReply={(allow, answers) => onRespond(thread, allow, answers)} />}
        </article>} />
      </div> : <p className="home-empty">Nothing is waiting on you.</p>}
    </section>

    <section className="home-summaries" aria-label="Daily summaries">
      <DaySummaries now={now === undefined ? undefined : new Date(now)} />
    </section>
  </section>;
}
