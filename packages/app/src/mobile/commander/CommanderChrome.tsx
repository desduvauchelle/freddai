import { MessageInput } from "../../conversation/MessageComposer";
import { CommanderSettings } from "../../desktop/commander/CommanderSettings";
import { SubThreads, type SubThread } from "../../desktop/commander/SubThreads";
import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ArrowUpRight, Check, CircleAlert, CircleHelp, Pencil, Plus, X } from 'lucide-react';
import { groupTodos } from '../../desktop/commander/CommanderTools';
import type { CommanderStatus, Proposal, Todo } from '../../desktop/commander/api';
import type { CommanderClient, CompanionClient, CompanionProject } from '../companion';
import type { CommanderData } from './useCommanderData';
import '../../desktop/commander/commander.css';
import './commander-mobile.css';

export type CommanderTab = 'settings' | 'todos' | 'notes' | 'waiting' | 'threads';
export const TABS: { id: CommanderTab; label: string }[] = [{ id: 'todos', label: 'To-dos' }, { id: 'notes', label: 'Notes' }, { id: 'waiting', label: 'Waiting' }, { id: 'threads', label: 'Sub-threads' }, { id: 'settings', label: 'Settings' }];
const msg = (e: unknown) => e instanceof Error ? e.message : String(e);
export const pendingProposals = (proposals: readonly Proposal[]) => proposals.filter(p => p.status === 'pending');
export const reviewTodos = (todos: readonly Todo[]) => todos.filter(t => t.status === 'needs_review');
export const waitingCount = (data: Pick<CommanderData, 'proposals' | 'todos' | 'state'>) =>
  data.state?.status.needs_you ?? pendingProposals(data.proposals).length + reviewTodos(data.todos).length;

/** Todos grouped by project; reuses the desktop grouping (unknown or missing projects land under "No project"). */
export function groupMobileTodos(todos: readonly Todo[], projects: readonly CompanionProject[]) {
  return groupTodos(todos, projects.map(p => ({ ...p, path: '', policy: 'inherit', account: null, last: null })));
}

/** Bottom sheet (medium + large detents, grabber) holding To-dos, Notes and Waiting. Opened from the header avatar. */
export function CommanderSheet({ open, onClose, tab, onTab, waiting, children }: {
  open: boolean; onClose: () => void; tab: CommanderTab; onTab: (tab: CommanderTab) => void; waiting: number; children: ReactNode;
}) {
  const [large, setLarge] = useState(false), drag = useRef<number | null>(null);
  useEffect(() => { if (!open) setLarge(false); }, [open]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, onClose]);
  if (!open) return null;
  const down = (e: ReactPointerEvent) => { drag.current = e.clientY; };
  const up = (e: ReactPointerEvent) => {
    const start = drag.current; drag.current = null;
    if (start === null) return;
    const dy = e.clientY - start;
    if (dy < -30) setLarge(true); else if (dy > 30) { if (large) setLarge(false); else onClose(); } else setLarge(v => !v);
  };
  return <div className="companion-sheet-root">
    <button type="button" className="companion-sheet-backdrop" aria-label="Close Commander sheet" onClick={onClose} />
    <section className="companion-sheet" role="dialog" aria-modal="true" aria-label="Commander" data-detent={large ? 'large' : 'medium'}>
      <button type="button" className="companion-sheet-grabber" aria-label={large ? 'Shrink sheet' : 'Expand sheet'} onPointerDown={down} onPointerUp={up} onPointerCancel={() => { drag.current = null; }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLarge(v => !v); } }}><span aria-hidden="true" /></button>
      <nav className="companion-commander-tabs" role="tablist" aria-label="Commander sections">
        {TABS.map(t => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} data-tab={t.id} onClick={() => onTab(t.id)}>
          {t.label}{t.id === 'waiting' && waiting > 0 && <b aria-label={`${waiting} waiting`}>{waiting}</b>}
        </button>)}
      </nav>
      <div className="companion-sheet-body">{children}</div>
    </section>
  </div>;
}

const promptOf = (p: Proposal) => typeof p.arguments?.prompt === 'string' ? p.arguments.prompt : '';

/** One proposal: Yes / No / Edit while pending; afterwards the inline result, a loud error, and a link to the started thread. */
export function ApprovalCard({ proposal, projectName, projectColor, respond, onDecided, onOpenThread, onDismiss }: {
  proposal: Proposal; projectName?: string; projectColor?: string;
  respond: CommanderClient['respond']; onDecided?: (p: Proposal) => void; onOpenThread?: (id: string) => void; onDismiss?: () => void;
}) {
  const [current, setCurrent] = useState(proposal);
  const [editing, setEditing] = useState(false), [prompt, setPrompt] = useState(promptOf(proposal));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const shown = proposal.status !== 'pending' ? proposal : current;
  const hasPrompt = typeof proposal.arguments?.prompt === 'string';
  async function answer(approve: boolean) {
    setBusy(true); setError('');
    try {
      const edited = approve && editing && prompt !== promptOf(proposal) ? prompt : undefined;
      const result = await respond({ id: proposal.id, approve, ...(edited !== undefined ? { prompt: edited } : {}) });
      setCurrent(result); setEditing(false); onDecided?.(result);
    } catch (e) { console.error('[commander] proposal respond failed', e); setError(msg(e)); }
    finally { setBusy(false); }
  }
  const pending = shown.status === 'pending';
  const failure = shown.error || (shown.status === 'failed' ? 'The action failed.' : '');
  return <article className="commander-card" data-status={shown.status} aria-label={`Proposal: ${shown.summary}`}>
    <p className="commander-card-summary">{shown.summary}</p>
    <div className="commander-card-meta">
      {(projectName || shown.project) && <span className="commander-chip"><i style={{ background: projectColor ?? 'var(--muted-foreground)' }} aria-hidden="true" />{projectName ?? shown.project}</span>}
      <span className="commander-chip" data-muted>{shown.tool.replace(/^freddai_/, '').replace(/_/g, ' ')}</span>
    </div>
    {hasPrompt && (editing
      ? <MessageInput className="commander-card-prompt" aria-label="Task prompt" rows={4} value={prompt} disabled={busy} onValueChange={setPrompt} />
      : <blockquote className="commander-card-quote">{prompt}</blockquote>)}
    {pending && <div className="commander-card-actions">
      <button type="button" className="commander-btn" data-variant="yes" disabled={busy} onClick={() => void answer(true)}><Check size={14} aria-hidden="true" />Yes</button>
      <button type="button" className="commander-btn" data-variant="no" disabled={busy} onClick={() => void answer(false)}><X size={14} aria-hidden="true" />No</button>
      {hasPrompt && <button type="button" className="commander-btn" data-variant="ghost" disabled={busy} aria-pressed={editing} onClick={() => setEditing(v => !v)}><Pencil size={13} aria-hidden="true" />{editing ? 'Done editing' : 'Edit'}</button>}
    </div>}
    {error && <p className="commander-error" role="alert"><CircleAlert size={13} aria-hidden="true" />{error}</p>}
    {!pending && <div className="commander-card-result" data-status={shown.status}>
      {shown.status === 'approved' && <p role="status"><Check size={13} aria-hidden="true" />{shown.result || 'Approved.'}</p>}
      {shown.status === 'declined' && <p role="status"><X size={13} aria-hidden="true" />Declined.</p>}
      {shown.status === 'failed' && <p className="commander-error" role="alert"><CircleAlert size={13} aria-hidden="true" />{failure}</p>}
      <div className="commander-card-actions">
        {shown.thread && onOpenThread && <button type="button" className="commander-link" onClick={() => onOpenThread(shown.thread!)}>Open thread<ArrowUpRight size={12} aria-hidden="true" /></button>}
        {onDismiss && <button type="button" className="commander-link" onClick={onDismiss}>Dismiss</button>}
      </div>
    </div>}
  </article>;
}

const STATUS_LABEL: Record<Todo['status'], string> = { open: 'Open', in_progress: 'In progress', needs_review: 'Needs review', done: 'Done', dropped: 'Dropped' };

export function TodoRow({ todo, commander, onChange, onOpenThread, onError }: {
  todo: Todo; commander: CommanderClient; onChange: () => void; onOpenThread: (id: string) => void; onError: (e: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function set(patch: Partial<Todo>) {
    setBusy(true);
    try { await commander.saveTodo({ id: todo.id, ...patch }); onChange(); } catch (e) { console.error('[commander] todo save failed', e); onError(`Couldn't update "${todo.title}": ${msg(e)}`); } finally { setBusy(false); }
  }
  const finished = todo.status === 'done' || todo.status === 'dropped';
  return <li className="commander-todo" data-status={todo.status}>
    <div className="commander-todo-head">
      <strong>{todo.title}</strong>
      <span className="commander-chip" data-owner={todo.owner}>{todo.owner === 'me' ? 'You' : todo.owner === 'commander' ? 'Commander' : 'Thread'}</span>
      <span className="commander-chip" data-muted>{STATUS_LABEL[todo.status]}</span>
      {todo.due && <span className="commander-chip" data-muted>Due {new Date(todo.due).toLocaleDateString()}</span>}
      {todo.thread && <button type="button" className="commander-link" onClick={() => onOpenThread(todo.thread!)}>Open thread<ArrowUpRight size={12} aria-hidden="true" /></button>}
    </div>
    {todo.description && <p className="commander-todo-desc">{todo.description}</p>}
    {todo.verification.length > 0 && <ul className="commander-checklist" aria-label="Verification">
      {todo.verification.map((v, i) => <li key={i} data-status={v.status}>
        {v.status === 'met' ? <Check size={12} aria-hidden="true" /> : v.status === 'missing' ? <X size={12} aria-hidden="true" /> : <CircleHelp size={12} aria-hidden="true" />}
        <span>{v.requirement}{v.evidence ? <em> — {v.evidence}</em> : null}</span><span className="sr-only">{v.status}</span>
      </li>)}
    </ul>}
    {!finished && <div className="commander-card-actions">
      <button type="button" className="commander-btn" data-variant="yes" disabled={busy} aria-label={`Mark "${todo.title}" done`} onClick={() => void set({ status: 'done', completion_basis: 'user_confirmed' })}><Check size={13} aria-hidden="true" />Mark done</button>
      {todo.status === 'needs_review' && <button type="button" className="commander-btn" data-variant="ghost" disabled={busy} aria-label={`Reopen "${todo.title}"`} onClick={() => void set({ status: 'open' })}>Needs more work</button>}
      <button type="button" className="commander-btn" data-variant="no" disabled={busy} aria-label={`Drop "${todo.title}"`} onClick={() => void set({ status: 'dropped' })}>Drop</button>
    </div>}
  </li>;
}

function TodosTab({ data, commander, projects, commanderId, onOpenThread }: { data: CommanderData; commander: CommanderClient; projects: readonly CompanionProject[]; commanderId?: string; onOpenThread: (id: string) => void }) {
  const [showAll, setShowAll] = useState(false), [error, setError] = useState(''), [title, setTitle] = useState(''), [project, setProject] = useState(commanderId ?? projects[0]?.id ?? '');
  const [adding, setAdding] = useState(false);
  const shown = data.todos.filter(t => showAll || (t.status !== 'done' && t.status !== 'dropped'));
  const groups = useMemo(() => groupMobileTodos(shown, projects), [shown, projects]);
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setAdding(true); setError('');
    try { await commander.saveTodo({ title: title.trim(), project: project || null, owner: 'me', status: 'open' }); setTitle(''); await data.refresh(); }
    catch (err) { console.error('[commander] todo add failed', err); setError(`Couldn't add the to-do: ${msg(err)}`); } finally { setAdding(false); }
  }
  return <div className="commander-stack">
    <form className="commander-inline-form" onSubmit={e => void add(e)}>
      <input aria-label="New to-do" placeholder="Add a to-do…" value={title} onChange={e => setTitle(e.target.value)} disabled={adding} />
      <select aria-label="To-do project" value={project} onChange={e => setProject(e.target.value)}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <button type="submit" className="commander-btn" data-variant="yes" disabled={adding || !title.trim()}><Plus size={13} aria-hidden="true" />Add</button>
    </form>
    <label className="commander-check"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />Show finished</label>
    {(error || data.error) && <p className="commander-error" role="alert"><CircleAlert size={13} aria-hidden="true" />{error || data.error}</p>}
    {!groups.length && !data.error && <p className="commander-empty">No to-dos yet.</p>}
    {groups.map(g => <section key={g.key} className="commander-group" aria-label={`To-dos for ${g.name}`}>
      <h3><i style={{ background: g.color ?? 'var(--muted-foreground)' }} aria-hidden="true" />{g.name}</h3>
      <ul className="commander-list">{g.todos.map(t => <TodoRow key={t.id} todo={t} commander={commander} onChange={() => void data.refresh()} onOpenThread={onOpenThread} onError={setError} />)}</ul>
    </section>)}
  </div>;
}

function NotesTab({ data, commander }: { data: CommanderData; commander: CommanderClient }) {
  const [name, setName] = useState<string | null>(null), [body, setBody] = useState(''), [fresh, setFresh] = useState(''), [isNew, setIsNew] = useState(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  async function open(n: string) {
    setError(''); setSaved(false);
    try { const r = await commander.readNote(n); setIsNew(false); setName(r.name); setBody(r.body); } catch (e) { console.error('[commander] note read failed', e); setError(`Couldn't open note: ${msg(e)}`); }
  }
  async function save() {
    const target = name ?? fresh.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase();
    if (!target) { setError('Give the note a name first.'); return; }
    setBusy(true); setError('');
    try { const r = await commander.writeNote(target, body); setName(r.name); setIsNew(false); setSaved(true); await data.refresh(); }
    catch (e) { console.error('[commander] note write failed', e); setError(`Couldn't save note: ${msg(e)}`); } finally { setBusy(false); }
  }
  const editing = name !== null || isNew;
  return <div className="commander-notes">
    <ul className="commander-list" aria-label="Notes">
      <li><button type="button" className="commander-btn" data-variant="ghost" onClick={() => { setName(null); setBody(''); setFresh(''); setIsNew(true); setSaved(false); }}><Plus size={13} aria-hidden="true" />New note</button></li>
      {data.notes.map(n => <li key={n.name}><button type="button" className="commander-note-item" aria-current={n.name === name} onClick={() => void open(n.name)}><strong>{n.title || n.name}</strong><small>{n.preview}</small></button></li>)}
    </ul>
    {(error || data.error) && <p className="commander-error" role="alert"><CircleAlert size={13} aria-hidden="true" />{error || data.error}</p>}
    {editing && <div className="commander-editor">
      {name === null && <input aria-label="Note name" placeholder="Note name" value={fresh} onChange={e => setFresh(e.target.value)} />}
      <textarea aria-label="Note (markdown)" rows={10} value={body} onChange={e => { setBody(e.target.value); setSaved(false); }} spellCheck />
      <div className="commander-card-actions">
        <button type="button" className="commander-btn" data-variant="yes" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save note'}</button>
        {saved && <span role="status" className="commander-muted">Saved</span>}
      </div>
    </div>}
  </div>;
}

function WaitingTab({ data, commander, projects, onOpenThread, respond }: { data: CommanderData; commander: CommanderClient; projects: readonly CompanionProject[]; onOpenThread: (id: string) => void; respond: CommanderClient['respond'] }) {
  const [error, setError] = useState('');
  // Decided cards stay until dismissed so the result or error is never lost when the proposal leaves the pending list.
  const seen = useRef(new Map<string, Proposal>()), [dismissed, setDismissed] = useState<Set<string>>(new Set());
  for (const p of data.proposals) if (p.status === 'pending' || seen.current.has(p.id)) seen.current.set(p.id, p);
  const cards = [...seen.current.values()].filter(p => !dismissed.has(p.id));
  const review = reviewTodos(data.todos);
  const proj = (id: string | null) => projects.find(p => p.id === id);
  if (!cards.length && !review.length) return <>{data.error && <p className="commander-error" role="alert"><CircleAlert size={13} aria-hidden="true" />{data.error}</p>}<p className="commander-empty">Nothing is waiting on you.</p></>;
  return <div className="commander-stack">
    {(error || data.error) && <p className="commander-error" role="alert"><CircleAlert size={13} aria-hidden="true" />{error || data.error}</p>}
    {cards.map(p => <ApprovalCard key={p.id} proposal={p} projectName={proj(p.project)?.name} projectColor={proj(p.project)?.color} respond={respond}
      onDecided={result => { seen.current.set(p.id, result); void data.refresh(); }} onOpenThread={onOpenThread}
      onDismiss={p.status !== 'pending' ? () => setDismissed(old => new Set(old).add(p.id)) : undefined} />)}
    {review.length > 0 && <ul className="commander-list" aria-label="To-dos to review">{review.map(t => <TodoRow key={t.id} todo={t} commander={commander} onChange={() => void data.refresh()} onOpenThread={onOpenThread} onError={setError} />)}</ul>}
  </div>;
}

/** Sheet content for the active tab. */
export function CommanderPanel({ tab, client, data, projects, commanderId, threads = [], onOpenThread }: {
  threads?: readonly SubThread[]; tab: CommanderTab; client: CompanionClient; data: CommanderData; projects: readonly CompanionProject[]; commanderId?: string; onOpenThread: (id: string) => void;
}) {
  const commander = client.commander;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [tab]);
  if (!commander) return null;
  return <section className="companion-commander-panel" role="tabpanel" aria-label={TABS.find(t => t.id === tab)?.label}>
    <h2 ref={heading} tabIndex={-1} className="sr-only">{TABS.find(t => t.id === tab)?.label}</h2>
    {tab === 'settings' && commander.getCommanderSettings && commander.saveCommanderSettings && <CommanderSettings projects={projects} speechConnection={client.speechConnection} api={commander as Required<Pick<CommanderClient, 'getCommanderSettings' | 'saveCommanderSettings'>>} />}
    {tab === 'todos' && <TodosTab data={data} commander={commander} projects={projects} commanderId={commanderId} onOpenThread={onOpenThread} />}
    {tab === 'threads' && <SubThreads threads={threads} projects={projects} onOpenThread={onOpenThread} />}
    {tab === 'notes' && <NotesTab data={data} commander={commander} />}
    {tab === 'waiting' && <WaitingTab data={data} commander={commander} projects={projects} onOpenThread={onOpenThread} respond={commander.respond} />}
  </section>;
}
