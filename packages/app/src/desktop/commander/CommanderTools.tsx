import { SubThreads, type SubThread } from "./SubThreads";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowUpRight, Check, CircleAlert, CircleHelp, Plus, X } from "lucide-react";
import type { Project, Schedule } from "../types";
import { ApprovalCard } from "./ApprovalCard";
import { commanderApi, type NoteSummary, type Proposal, type Todo } from "./api";
import type { CommanderData } from "./useCommander";
import { MemoryTab, msg, useLoad } from "./CommanderMemory";
import { CommanderProfile } from "./CommanderProfile";

export type ToolsTab = "threads" | "waiting" | "todos" | "notes" | "memory" | "schedules" | "connections";
const TABS: { id: ToolsTab; label: string }[] = [
  { id: "waiting", label: "Waiting on you" }, { id: "todos", label: "To-dos" }, { id: "notes", label: "Notes" },
  { id: "memory", label: "Memory" }, { id: "schedules", label: "Schedules" }, { id: "connections", label: "Connections" }, { id: "threads", label: "Sub-threads" },
];
export const pendingProposals = (proposals: readonly Proposal[]) => proposals.filter(p => p.status === "pending");
export const reviewTodos = (todos: readonly Todo[]) => todos.filter(t => t.status === "needs_review");

/** Groups open work by project, in the order the projects are given; unknown/none go last under "No project". */
export function groupTodos(todos: readonly Todo[], projects: readonly Project[]) {
  const groups: { key: string; name: string; color?: string; todos: Todo[] }[] = [];
  for (const p of projects) {
    const mine = todos.filter(t => t.project === p.id);
    if (mine.length) groups.push({ key: p.id, name: p.name, color: p.color, todos: mine });
  }
  const known = new Set(projects.map(p => p.id)), rest = todos.filter(t => !t.project || !known.has(t.project));
  if (rest.length) groups.push({ key: "none", name: "No project", todos: rest });
  return groups;
}

const STATUS_LABEL: Record<Todo["status"], string> = { open: "Open", in_progress: "In progress", needs_review: "Needs review", done: "Done", dropped: "Dropped" };

function TodoRow({ todo, onChange, onOpenThread, onError }: { todo: Todo; onChange: () => void; onOpenThread: (id: string) => void; onError: (e: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function set(patch: Partial<Todo>) {
    setBusy(true);
    try { await commanderApi.todoSave({ id: todo.id, ...patch }); onChange(); } catch (e) { onError(`Couldn't update "${todo.title}": ${msg(e)}`); } finally { setBusy(false); }
  }
  const finished = todo.status === "done" || todo.status === "dropped";
  return <li className="commander-todo" data-status={todo.status}>
    <div className="commander-todo-head">
      <strong>{todo.title}</strong>
      <span className="commander-chip" data-owner={todo.owner}>{todo.owner === "me" ? "You" : todo.owner === "commander" ? "Commander" : "Thread"}</span>
      <span className="commander-chip" data-muted>{STATUS_LABEL[todo.status]}</span>
      {todo.due && <span className="commander-chip" data-muted>Due {new Date(todo.due).toLocaleDateString()}</span>}
      {todo.thread && <button type="button" className="commander-link" onClick={() => onOpenThread(todo.thread!)}>Open thread<ArrowUpRight size={12} aria-hidden="true" /></button>}
    </div>
    {todo.description && <p className="commander-todo-desc">{todo.description}</p>}
    {todo.verification.length > 0 && <ul className="commander-checklist" aria-label="Verification">
      {todo.verification.map((v, i) => <li key={i} data-status={v.status}>
        {v.status === "met" ? <Check size={12} aria-hidden="true" /> : v.status === "missing" ? <X size={12} aria-hidden="true" /> : <CircleHelp size={12} aria-hidden="true" />}
        <span>{v.requirement}{v.evidence ? <em> — {v.evidence}</em> : null}</span><span className="sr-only">{v.status}</span>
      </li>)}
    </ul>}
    {!finished && <div className="commander-card-actions">
      <button type="button" className="commander-btn" data-variant="yes" disabled={busy} aria-label={`Mark "${todo.title}" done`} onClick={() => void set({ status: "done", completion_basis: "user_confirmed" })}><Check size={13} aria-hidden="true" />Mark done</button>
      {todo.status === "needs_review" && <button type="button" className="commander-btn" data-variant="ghost" disabled={busy} aria-label={`Reopen "${todo.title}"`} onClick={() => void set({ status: "open" })}>Needs more work</button>}
      <button type="button" className="commander-btn" data-variant="no" disabled={busy} aria-label={`Drop "${todo.title}"`} onClick={() => void set({ status: "dropped" })}>Drop</button>
    </div>}
  </li>;
}

function WaitingTab({ data, projects, onOpenThread }: { data: CommanderData; projects: Project[]; onOpenThread: (id: string) => void }) {
  const [error, setError] = useState("");
  const pend = pendingProposals(data.proposals), review = reviewTodos(data.todos);
  const proj = (id: string | null) => projects.find(p => p.id === id);
  if (!pend.length && !review.length) return <p className="commander-empty">Nothing is waiting on you.</p>;
  return <div className="commander-stack">
    {error && <p className="commander-error" role="alert"><CircleAlert size={13} aria-hidden="true" />{error}</p>}
    {pend.map(p => <ApprovalCard key={p.id} proposal={p} projectName={proj(p.project)?.name} projectColor={proj(p.project)?.color} onDecided={() => void data.refresh()} onOpenThread={onOpenThread} />)}
    {review.length > 0 && <ul className="commander-list" aria-label="To-dos to review">{review.map(t => <TodoRow key={t.id} todo={t} onChange={() => void data.refresh()} onOpenThread={onOpenThread} onError={setError} />)}</ul>}
  </div>;
}

function TodosTab({ data, projects, commanderId, onOpenThread }: { data: CommanderData; projects: Project[]; commanderId?: string; onOpenThread: (id: string) => void }) {
  const [showAll, setShowAll] = useState(false), [error, setError] = useState(""), [title, setTitle] = useState(""), [project, setProject] = useState(commanderId ?? projects[0]?.id ?? "");
  const [adding, setAdding] = useState(false);
  const shown = data.todos.filter(t => showAll || (t.status !== "done" && t.status !== "dropped"));
  const groups = useMemo(() => groupTodos(shown, projects), [shown, projects]);
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setAdding(true); setError("");
    try { await commanderApi.todoSave({ title: title.trim(), project: project || null, owner: "me", status: "open" }); setTitle(""); await data.refresh(); }
    catch (err) { setError(`Couldn't add the to-do: ${msg(err)}`); } finally { setAdding(false); }
  }
  return <div className="commander-stack">
    <form className="commander-inline-form" onSubmit={e => void add(e)}>
      <input aria-label="New to-do" placeholder="Add a to-do…" value={title} onChange={e => setTitle(e.target.value)} disabled={adding} />
      <select aria-label="To-do project" value={project} onChange={e => setProject(e.target.value)}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <button type="submit" className="commander-btn" data-variant="yes" disabled={adding || !title.trim()}><Plus size={13} aria-hidden="true" />Add</button>
    </form>
    <label className="commander-check"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />Show finished</label>
    {error && <p className="commander-error" role="alert"><CircleAlert size={13} aria-hidden="true" />{error}</p>}
    {!groups.length && <p className="commander-empty">No to-dos yet.</p>}
    {groups.map(g => <section key={g.key} className="commander-group" aria-label={`To-dos for ${g.name}`}>
      <h3><i style={{ background: g.color ?? "var(--muted-foreground)" }} aria-hidden="true" />{g.name}</h3>
      <ul className="commander-list">{g.todos.map(t => <TodoRow key={t.id} todo={t} onChange={() => void data.refresh()} onOpenThread={onOpenThread} onError={setError} />)}</ul>
    </section>)}
  </div>;
}

function NotesTab() {
  const notes = useLoad<NoteSummary[]>(() => commanderApi.notes(), []);
  const [name, setName] = useState<string | null>(null), [body, setBody] = useState(""), [fresh, setFresh] = useState(""), [isNew, setIsNew] = useState(false), [error, setError] = useState(""), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  async function open(n: string) {
    setError(""); setSaved(false);
    try { const r = await commanderApi.noteRead(n); setIsNew(false); setName(r.name); setBody(r.body); } catch (e) { setError(`Couldn't open note: ${msg(e)}`); }
  }
  async function save() {
    const target = name ?? fresh.trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-").toLowerCase();
    if (!target) { setError("Give the note a name first."); return; }
    setBusy(true); setError("");
    try { const r = await commanderApi.noteWrite(target, body); setName(r.name); setIsNew(false); setSaved(true); await notes.reload(); }
    catch (e) { setError(`Couldn't save note: ${msg(e)}`); } finally { setBusy(false); }
  }
  const editing = name !== null || isNew;
  return <div className="commander-notes">
    <ul className="commander-list" aria-label="Notes">
      <li><button type="button" className="commander-btn" data-variant="ghost" onClick={() => { setName(null); setBody(""); setFresh(""); setIsNew(true); setSaved(false); }}><Plus size={13} aria-hidden="true" />New note</button></li>
      {notes.value.map(n => <li key={n.name}><button type="button" className="commander-note-item" aria-current={n.name === name} onClick={() => void open(n.name)}><strong>{n.title || n.name}</strong><small>{n.preview}</small></button></li>)}
    </ul>
    {(error || notes.error) && <p className="commander-error" role="alert"><CircleAlert size={13} aria-hidden="true" />{error || notes.error}</p>}
    {editing && <div className="commander-editor">
      {name === null && <input aria-label="Note name" placeholder="Note name" value={fresh} onChange={e => setFresh(e.target.value)} />}
      <textarea aria-label="Note (markdown)" rows={12} value={body} onChange={e => { setBody(e.target.value); setSaved(false); }} spellCheck />
      <div className="commander-card-actions">
        <button type="button" className="commander-btn" data-variant="yes" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save note"}</button>
        {saved && <span role="status" className="commander-muted">Saved</span>}
      </div>
    </div>}
  </div>;
}

function SchedulesTab({ schedules, projectId, onManage }: { schedules: Schedule[]; projectId?: string; onManage?: () => void }) {
  const mine = schedules.filter(s => s.project === projectId);
  return <div className="commander-stack">
    {!mine.length && <p className="commander-empty">No recurring tasks for Commander yet.</p>}
    <ul className="commander-list">{mine.map(s => <li key={s.id}><strong>{s.name}</strong> <small className="commander-muted">{s.enabled ? `Next ${new Date(s.next_due).toLocaleString()}` : "Paused"}</small></li>)}</ul>
    {onManage && <button type="button" className="commander-btn" data-variant="ghost" onClick={onManage}>Manage schedules<ArrowUpRight size={12} aria-hidden="true" /></button>}
  </div>;
}

export function CommanderTools({ data, projects, schedules = [], threads = [], commanderId, initialTab = "waiting", onOpenThread, onManageSchedules, onClose }: {
  data: CommanderData; projects: Project[]; schedules?: Schedule[]; threads?: readonly SubThread[]; commanderId?: string; initialTab?: ToolsTab;
  onOpenThread: (id: string) => void; onManageSchedules?: () => void; onClose: () => void;
}) {
  const [tab, setTab] = useState<ToolsTab>(initialTab), [profile, setProfile] = useState(false), [profileDirty, setProfileDirty] = useState(false);
  const waiting = pendingProposals(data.proposals).length + reviewTodos(data.todos).length;
  return <section className="commander-tools" role="dialog" aria-label="Commander tools" onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
    <header>
      <div role="tablist" aria-label="Commander tools">
        {TABS.map(t => <button key={t.id} type="button" role="tab" id={`cmd-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="cmd-tabpanel" onClick={() => setTab(t.id)}>
          {t.label}{t.id === "waiting" && waiting > 0 && <b aria-label={`${waiting} waiting`}>{waiting}</b>}</button>)}
      </div>
      <button type="button" className="commander-icon-btn" aria-label="Close tools" onClick={onClose}><X size={16} aria-hidden="true" /></button>
    </header>
    {profile ? <div className="commander-tools-body">
      <button type="button" className="commander-link" onClick={() => { if (!profileDirty || window.confirm("Discard unsaved changes?")) { setProfile(false); setProfileDirty(false); } }}>Back to tools</button>
      <CommanderProfile onSaved={() => void data.refresh()} onDirtyChange={setProfileDirty} />
    </div> : <>
    <div id="cmd-tabpanel" role="tabpanel" aria-labelledby={`cmd-tab-${tab}`} className="commander-tools-body">
      {tab === "waiting" && <WaitingTab data={data} projects={projects} onOpenThread={onOpenThread} />}
      {tab === "todos" && <TodosTab data={data} projects={projects} commanderId={commanderId} onOpenThread={onOpenThread} />}
      {tab === "threads" && <SubThreads threads={threads} projects={projects} onOpenThread={onOpenThread} />}
      {tab === "notes" && <NotesTab />}
      {tab === "memory" && <MemoryTab />}
      {tab === "schedules" && <SchedulesTab schedules={schedules} projectId={commanderId} onManage={onManageSchedules} />}
      {tab === "connections" && <p className="commander-empty">Coming soon.</p>}
    </div>
    <footer className="commander-tools-foot"><button type="button" className="commander-link commander-quiet" onClick={() => setProfile(true)}>Personality &amp; memory</button></footer>
    </>}
  </section>;
}
