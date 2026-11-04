import { browserThreadRecencyTracker } from "../thread-recency";
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowLeft, Menu, MoreHorizontal, Square, X, Paperclip, ArrowUp, FolderGit2, Plus, RefreshCw, Search, Monitor } from 'lucide-react';
import { Button } from '@freddai/ui/components/button';
import { Input } from '@freddai/ui/components/input';
import { Textarea } from '@freddai/ui/components/textarea';
import { ScrollArea } from '@freddai/ui/components/scroll-area';
import { disconnectedClient, selectThreads, groupCompanionThreads, type CompanionThread, type CompanionClient, type CompanionSnapshot, type ThreadFilter } from './companion';
import { ThreadTranscript, type PendingOutgoing } from '../conversation/ThreadTranscript';
import { groupThreadsByDay, OLDER_PAGE_SIZE, threadListStatus } from '../desktop/types';
import { Permission } from '../desktop/AgentRequest';
import { useSystemAppearance } from '../appearance/use-system-appearance';
import { Dormouse } from '../desktop/Dormouse';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@freddai/ui/components/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@freddai/ui/components/dialog';
import { ConversationUsage } from '../desktop/ConversationUsage';
import { AgentControls } from '../desktop/AgentControls';
import { PermissionSelect } from '../desktop/PermissionSelect';
import { defaultSelection, type AgentSelection } from '../desktop/agent-selection';
import type { Attachment, PermissionMode } from '../desktop/types';
import './mobile.css';
import { useConnectionStatus } from './use-connection-status';
import { describeConnection } from './connection-status';
import { useNativeShell, setMode as setNativeMode, setComposerText as setNativeComposerText, onComposerSend, setConnection as setNativeConnection, onConnectionTap, setThreads as setNativeThreads, setThreadMeta as setNativeThreadMeta, onThreadAction, onSelectThread, onSearch, onSetFilter, onNewThread, onShowOlder } from './native-shell';
import { migrateLocalRead, readFromThreads } from '../read-sync';
import { buildThreadsModel, bumpOlderPage, createChangeSender, createThreadActionHandler, nativeRunState, createThreadEventHandlers, resolveLaunchThread } from './native-threads';
function savedDrafts(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem('freddai.companion.drafts') || '{}'); } catch { return {}; }
}
function savedLastThread(): string {
  try { return localStorage.getItem('freddai.companion.lastThread') || ''; } catch { return ''; }
}
const initial: CompanionSnapshot = { projects: [], threads: [] };
type Outgoing = { id: string; thread: string; project: string; prompt: string; ordinal: number; acknowledged: boolean; attachments: Attachment[] };
export function MobileApp({ client = disconnectedClient, onPairAgain }: { client?: CompanionClient; onPairAgain?: () => void }) {
  useSystemAppearance();
  const [data, setData] = useState(initial), [error, setError] = useState(''), [loaded, setLoaded] = useState(false);
  const { status: connection, connected, succeeded, failed } = useConnectionStatus();
  const [bannerDismissed, setBannerDismissed] = useState(false), [detailsOpen, setDetailsOpen] = useState(false);
  const [project, setProject] = useState(''), [query, setQuery] = useState(''), [filter, setFilter] = useState<ThreadFilter>('all');
  const [screen, setScreen] = useState<'threads' | 'conversation' | 'new'>('threads'), [selected, setSelected] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>(savedDrafts), [newProject, setNewProject] = useState(''), [working, setWorking] = useState(false), [retry, setRetry] = useState(0);
  // Read state lives on the Mac host (`read_at` per thread, shared with the desktop); the overlay bridges the gap until the next snapshot.
  const [readOverlay, setReadOverlay] = useState<Record<string, number>>({});
  const read = readFromThreads(data.threads, readOverlay);
  const [newAssistants, setNewAssistants] = useState<Record<string, string>>({});
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [olderPages, setOlderPages] = useState<Record<string, number>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [controls, setControls] = useState<Record<string, { selection: AgentSelection; permission: PermissionMode }>>({});
  const [attachments, setAttachments] = useState<Record<string, Attachment[]>>({});
  const [staging, setStaging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const backSwipe = useRef<{ x: number; y: number } | null>(null);
  const [showLatest, setShowLatest] = useState(false);
  const requestIds = useRef<Record<string, string>>({});
  const [trackThreadRecency] = useState(browserThreadRecencyTracker);
  // iOS native shell: the header and composer of a conversation are native UIKit views around this webview.
  const nativeShell = useNativeShell();
  const nativePrompts = useRef<Record<string, string>>({});
  const pendingMessages = outgoing.filter(m => m.thread === selected);
  const task = data.threads.find(t => t.id === selected) || (pendingMessages.length ? {
    id: selected, project: pendingMessages[0].project, title: pendingMessages[0].prompt,
    status: 'starting', updated: 0, messages: [], canReply: false, queued: 0, error: null,
  } : undefined);
  const key = screen === 'new' ? 'new' : selected;
  const draft = drafts[key] || '';
  const newProjectData = data.projects.find(p => p.id === newProject);
  const assistant = newAssistants[newProject] || newProjectData?.defaultAssistant || '';
  const selectedAssistant = newProjectData?.assistants?.find(a => a.id === assistant);
  const newReady = !!newProjectData?.canStart && (!newProjectData.assistants || !!selectedAssistant);
  const provider = screen === 'new' ? selectedAssistant?.provider || newProjectData?.provider : task?.provider;
  const controlKey = screen === 'new' ? `new:${newProject}:${assistant}:${provider || ''}` : selected;
  const selection = controls[controlKey]?.selection || (screen === 'new' ? defaultSelection : { model: task?.options?.model || '', effort: task?.options?.effort || 'default' });
  const permission = controls[controlKey]?.permission || (screen === 'new' ? 'bypass' : task?.options?.permission_mode || 'ask');
  const files = attachments[key] || [];
  const loadModels = useCallback(() => client.models!(screen === 'new' ? { project: newProject, assistant: assistant || undefined } : { thread: selected }), [client, screen, newProject, assistant, selected]);
  useEffect(() => {
    const el = textarea.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 220)}px`; }
  }, [draft, key, screen]);
  // WKWebView keeps a full-height layout viewport while the keyboard reduces the visual viewport.
  useEffect(() => {
    const visual = window.visualViewport;
    if (!visual) return;
    const resize = () => document.documentElement.style.setProperty('--companion-viewport-height', `${visual.height}px`);
    resize(); visual.addEventListener('resize', resize);
    return () => { visual.removeEventListener('resize', resize); document.documentElement.style.removeProperty('--companion-viewport-height'); };
  }, []);
  async function attachFiles(list: FileList | null) {
    if (!list?.length || !client.attach || staging) return;
    const target = key;
    const picked = Array.from(list);
    if (files.length + picked.length > 20 || files.reduce((sum, file) => sum + file.bytes, 0) + picked.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024 || picked.some(file => file.size > 25 * 1024 * 1024)) {
      setError('Attach at most 20 files, 25 MB per file and 100 MB per message.'); return;
    }
    setStaging(true); setError('');
    try {
      for (const file of picked) {
        const attachment = await client.attach(file);
        setAttachments(old => ({ ...old, [target]: [...(old[target] || []), attachment] }));
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setStaging(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function queueAction(action: 'pause' | 'resume' | 'delete' | 'clear', message?: string) {
    if (!client.queue || !connected || working) return;
    const thread = selected;
    setWorking(true); setError('');
    try { await client.queue({ thread, action, message }); setRetry(v => v + 1); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setWorking(false); }
  }
  const readMigrated = useRef(false);
  useEffect(() => {
    if (!connected || !client.mergeRead || readMigrated.current) return;
    readMigrated.current = true;
    void migrateLocalRead('freddai.companion.read', localStorage, cursors => client.mergeRead!(cursors)).then(r => { if (r === 'failed') readMigrated.current = false; });
  }, [connected, client]);
  const readSent = useRef(new Set<string>());
  useEffect(() => {
    // WKWebView may report no document focus until an input receives focus.
    // The visible conversation is sufficient evidence that the reply was opened.
    const markRead = () => {
      if (screen === 'conversation' && (task?.status === 'done' || task?.status === 'failed') && document.visibilityState === 'visible') {
        if ((read[task.id] ?? -1) >= task.updated) return;
        setReadOverlay(old => (old[task.id] ?? -1) >= task.updated ? old : { ...old, [task.id]: task.updated });
        const key = `${task.id}:${task.updated}`;
        if (!client.markRead || readSent.current.has(key)) return;
        readSent.current.add(key);
        client.markRead({ thread: task.id, at: task.updated }).catch(error => {
          readSent.current.delete(key);
          console.error('[read-sync] mark_read failed', { thread: task.id, at: task.updated, error: String(error) });
        });
      }
    };
    markRead(); window.addEventListener('focus', markRead); document.addEventListener('visibilitychange', markRead);
    return () => { window.removeEventListener('focus', markRead); document.removeEventListener('visibilitychange', markRead); };
  }, [screen, task?.id, task?.status, task?.updated, read[task?.id ?? ''], client]);
  useEffect(() => { try { localStorage.setItem('freddai.companion.drafts', JSON.stringify(drafts)); } catch { /* Keep drafts in memory if storage is full. */ } }, [drafts]);
  useEffect(() => {
    if (screen === 'conversation' && viewport.current) {
      viewport.current.scrollTop = viewport.current.scrollHeight;
      nearBottom.current = true; setShowLatest(false);
    }
  }, [selected, screen]);
  useEffect(() => {
    if (screen === 'conversation' && nearBottom.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [task?.updated, task?.messages.length, outgoing, screen]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const next = await client.snapshot(controller.signal);
        if (controller.signal.aborted) return;
        setData({ ...next, threads: trackThreadRecency(next.threads) }); setLoaded(true); succeeded();
        setOutgoing(old => old.filter(message => !message.acknowledged ||
          (next.threads.find(t => t.id === message.thread)?.messages.filter(m => m.role === 'user' && m.text === message.prompt).length || 0) < message.ordinal));
      } catch (e) {
        if (controller.signal.aborted) return;
        failed(String(e instanceof Error ? e.message : e));
      }
      if (!controller.signal.aborted) timer = setTimeout(refresh, document.visibilityState === 'visible' ? 1000 : 3000);
    }
    const foreground = () => { if (document.visibilityState === 'visible') setRetry(value => value + 1); };
    document.addEventListener('visibilitychange', foreground);
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', foreground); };
  }, [client, retry, succeeded, failed]);
  async function send(e?: FormEvent, nativeText?: string) {
    e?.preventDefault();
    const fromNative = nativeText !== undefined;
    const prompt = fromNative ? nativeText : draft;
    // The native composer clears itself on send, so a rejected send must hand the text back.
    const reject = (message: string) => { if (fromNative) { void setNativeComposerText(prompt); setError(message); } };
    if (!connected || working || staging || !prompt.trim()) { reject(!connected ? 'Your Mac is disconnected. Message not sent.' : 'Another action is in progress. Message not sent.'); return; }
    const isNew = screen === 'new';
    if (isNew ? !newReady : !task?.canReply) { reject('This thread cannot take a reply right now. Message not sent.'); return; }
    const sentKey = key;
    // A retry of the same native text keeps its request id; different text gets a new one.
    if (fromNative && nativePrompts.current[sentKey] !== prompt) delete requestIds.current[sentKey];
    if (fromNative) nativePrompts.current[sentKey] = prompt;
    const requestId = requestIds.current[sentKey] ||= crypto.randomUUID();
    const sentFiles = fromNative ? [] : files;
    const options = { model: selection.model.trim() || null, effort: selection.effort === 'default' ? null : selection.effort, permission_mode: provider === 'codex' || provider === 'claude' ? permission : undefined, update_agent_controls: true, attachments: sentFiles.map(file => file.id) };
    const matching = task?.messages.filter(m => m.role === 'user' && m.text === prompt).length || 0;
    const ordinal = isNew ? 1 : Math.max(matching, ...outgoing.filter(m => m.thread === selected && m.prompt === prompt).map(m => m.ordinal)) + 1;
    setOutgoing(old => [...old, { id: requestId, thread: isNew ? '' : selected, project: isNew ? newProject : task!.project, prompt, ordinal, acknowledged: false, attachments: sentFiles }]);
    nearBottom.current = true;
    if (!fromNative) { setDrafts(old => ({ ...old, [sentKey]: '' })); setAttachments(old => ({ ...old, [sentKey]: [] })); }
    setError(''); setWorking(true);
    try {
      if (isNew) {
        const id = await client.start({ assistant: assistant || undefined, project: newProject, prompt, requestId, options });
        setOutgoing(old => old.map(m => m.id === requestId ? { ...m, thread: id, acknowledged: true } : m));
        setSelected(id); setScreen('conversation');
      } else {
        await client.reply({ thread: selected, prompt, requestId, options });
        setOutgoing(old => old.map(m => m.id === requestId ? { ...m, acknowledged: true } : m));
      }
      delete requestIds.current[sentKey]; setRetry(v => v + 1);
    } catch (e) { if (fromNative) void setNativeComposerText(prompt); else { setAttachments(old => ({ ...old, [sentKey]: [...sentFiles, ...(old[sentKey] || [])] })); setDrafts(old => ({ ...old, [sentKey]: old[sentKey] ? `${prompt}\n${old[sentKey]}` : prompt })); } setOutgoing(old => old.filter(m => m.id !== requestId)); setError(e instanceof Error ? e.message : String(e)); }
    finally { setWorking(false); }
  }
  async function respond(allow: boolean, answers: Record<string, unknown>) {
    if (!connected || working || !task?.pending) throw new Error('Decision could not be sent. Try again when connected.');
    setError(''); setWorking(true);
    try {
      await client.respond({ thread: task.id, requestId: JSON.stringify(task.pending.request_id ?? task.pending.id), allow, answers });
      setRetry(v => v + 1);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); throw e; }
    finally { setWorking(false); }
  }
  const busyThread = !!task && ['starting', 'running', 'waiting'].includes(task.status);
  const nativeConversation = nativeShell && screen === 'conversation';
  // Conversation and New thread get the native bar + drawer; the web threads screen exists only outside the native shell.
  const nativeBar = nativeShell && (screen === 'conversation' || screen === 'new');
  const nativeTitle = task?.title || 'Conversation';
  const openDrawerOnLaunch = useRef(false);
  useEffect(() => {
    if (!nativeShell) return;
    const openDrawer = openDrawerOnLaunch.current || undefined;
    openDrawerOnLaunch.current = false;
    void (screen === 'conversation'
      ? setNativeMode('conversation', { title: nativeTitle, placeholder: busyThread ? 'Draft your next message…' : 'Message', openDrawer })
      : screen === 'new' ? setNativeMode('new', { title: 'New thread', openDrawer })
      : setNativeMode('other')).catch(e => setError(`Native shell: ${e instanceof Error ? e.message : String(e)}`));
  }, [nativeShell, screen, nativeTitle, busyThread]);
  // Launch: reopen the last-viewed (or most recent) thread with the drawer open, or go to New thread when there is none.
  const launched = useRef(false);
  useEffect(() => {
    if (!nativeShell || !loaded || launched.current) return;
    launched.current = true;
    openDrawerOnLaunch.current = true;
    const id = resolveLaunchThread(data.threads, savedLastThread(), read);
    if (id) { setSelected(id); setScreen('conversation'); } else start();
  }, [nativeShell, loaded]);
  useEffect(() => {
    if (screen !== 'conversation' || !selected) return;
    try { localStorage.setItem('freddai.companion.lastThread', selected); } catch { /* Last-viewed thread is a convenience only. */ }
  }, [screen, selected]);
  // The native menu calls the same handlers as the web "Thread actions" menu. Delete was already confirmed by a native alert.
  const nativeHandlers = useRef({ send: (_text: string) => {}, threadAction: (_p: { action?: unknown }) => {} });
  nativeHandlers.current = {
    send: text => void send(undefined, text),
    threadAction: createThreadActionHandler({ stop: () => void threadAction('stop'), archive: () => void threadAction('archive'), delete: () => void threadAction('delete'), review: reviewDecision }),
  };
  const threadEvents = useRef(createThreadEventHandlers({ selectThread() {}, setQuery() {}, setFilters() {}, newThread() {}, showOlder() {} }));
  threadEvents.current = createThreadEventHandlers({
    selectThread: id => { setSelected(id); setScreen('conversation'); },
    setQuery: value => { setQuery(value); setOlderPages({}); },
    setFilters: (nextProject, status) => { setProject(nextProject); setFilter(status); setOlderPages({}); },
    newThread: destination => start(destination || undefined),
    showOlder: id => setOlderPages(pages => bumpOlderPage(pages, id)),
  });
  useEffect(() => {
    if (!nativeShell) return;
    let live = true;
    const stops: (() => void)[] = [];
    const keep = (stop: () => void) => { if (live) stops.push(stop); else stop(); };
    const fail = (e: unknown) => setError(`Native shell: ${e instanceof Error ? e.message : String(e)}`);
    onComposerSend(text => nativeHandlers.current.send(text)).then(keep, fail);
    onConnectionTap(() => nativeTapHandler.current()).then(keep, fail);
    onThreadAction(p => nativeHandlers.current.threadAction(p)).then(keep, fail);
    onSelectThread(p => threadEvents.current.selectThread(p)).then(keep, fail);
    onSearch(p => threadEvents.current.search(p)).then(keep, fail);
    onSetFilter(p => threadEvents.current.setFilter(p)).then(keep, fail);
    onNewThread(p => threadEvents.current.newThread(p)).then(keep, fail);
    onShowOlder(p => threadEvents.current.showOlder(p)).then(keep, fail);
    return () => { live = false; stops.forEach(stop => stop()); };
  }, [nativeShell]);
  // The alert comes back only on the next green-to-red transition; going green clears it.
  useEffect(() => { if (connection.state !== 'down') setBannerDismissed(false); }, [connection.state]);
  const connectionInfo = describeConnection(connection);
  useEffect(() => {
    if (!nativeShell) return;
    void setNativeConnection(connection.state, connection.state === 'down' ? connectionInfo.title : undefined).catch(e => setError(`Native shell: ${e instanceof Error ? e.message : String(e)}`));
  }, [nativeShell, connection.state, connectionInfo.title]);
  const connectionTap = () => { setBannerDismissed(false); setDetailsOpen(open => !open); };
  const nativeTapHandler = useRef(connectionTap);
  nativeTapHandler.current = () => { setBannerDismissed(false); setDetailsOpen(true); };
  const showBanner = (connection.state === 'down' && !bannerDismissed) || detailsOpen;
  const connectionButton = <Button variant="ghost" size="icon" className="companion-conn-icon" data-state={connection.state} aria-label={connection.state === 'ok' ? 'Connected to your Mac' : connection.state === 'down' ? 'Mac disconnected' : 'Connecting to your Mac'} onClick={connectionTap}><Monitor size={18} /></Button>;
  const actionsDisabled = !connected || working || !task || !client.action;
  function reviewDecision() { document.querySelector('.thread-transcript fieldset')?.scrollIntoView({ block: 'center' }); }
  async function threadAction(operation: 'stop' | 'archive' | 'delete') {
    if (actionsDisabled || !task || !client.action) return;
    setError(''); setWorking(true);
    try {
      await client.action({ thread: task.id, action: operation });
      setConfirmDelete(false);
      if (operation !== 'stop') leaveThread();
      setRetry(value => value + 1);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setWorking(false); }
  }
  // Native shell has no web threads screen: fall back to the next most recent thread, or New thread.
  function leaveThread() {
    if (!nativeShell) { setScreen('threads'); return; }
    const next = selectThreads(data, '', '', 'all', 'recent', read).find(t => t.id !== selected);
    if (next) { setSelected(next.id); setScreen('conversation'); } else start();
  }
  function start(destination?: string) { setNewProject(destination || project || data.projects.find(p => p.canStart)?.id || ''); setScreen('new'); }
  const nativeProjectName = data.projects.find(p => p.id === (screen === 'new' ? newProject : task?.project))?.name || '';
  const sendMeta = useRef(createChangeSender(setNativeThreadMeta));
  useEffect(() => {
    if (!nativeBar) return;
    const conversation = screen === 'conversation';
    sendMeta.current({
      project: nativeProjectName,
      runState: conversation ? nativeRunState(task) : '',
      canStop: conversation && !actionsDisabled && busyThread,
      canReview: conversation && !!task?.pending,
      canArchive: conversation && !actionsDisabled && !busyThread,
      canDelete: conversation && !actionsDisabled,
    }).catch(e => setError(`Native shell: ${e instanceof Error ? e.message : String(e)}`));
  });
  const threads = selectThreads(data, project, query, filter, 'recent', read);
  const groups = groupCompanionThreads(data, threads, { read, selected: screen === 'conversation' ? selected : '', filter, pages: olderPages, includeEmpty: !query.trim() && filter === 'all', project });
  const sendThreads = useRef(createChangeSender(setNativeThreads));
  const nativeModel = nativeShell ? buildThreadsModel({ data, read, selected: screen === 'conversation' ? selected : '', project, query, filter, olderPages }) : null;
  useEffect(() => {
    if (nativeModel) sendThreads.current(nativeModel).catch(e => setError(`Native shell: ${e instanceof Error ? e.message : String(e)}`));
  });
  function row(t: CompanionThread) {
    const status = threadListStatus(t, read);
    const label = ({unread:'Unread reply',done:'Completed',waiting:'Needs you',running:'Running',starting:'Starting',failed:'Failed',interrupted:'Interrupted'} as Record<string,string>)[status] || status;
    const sent = t.last_user_message_at ?? t.updated;
    return <button className="companion-row" key={t.id} onClick={() => { setSelected(t.id); setScreen('conversation'); }}><span className="companion-state" data-status={status}/><span><strong title={t.title}>{t.title}</strong><small>{label}{t.queued > 0 ? ` · ${t.queued} queued` : ''}</small></span><time dateTime={new Date(sent).toISOString()}>{new Date(sent).toLocaleDateString(undefined, {month:'short',day:'numeric'})}</time></button>;
  }
  function older(group: typeof groups[number]) {
    return <div className="companion-history">
      {groupThreadsByDay(group.older).map(day => <div key={day.label || 'today'}>{day.label && <div className="companion-day-label" role="separator" aria-label={day.label}>{day.label}</div>}{day.threads.map(row)}</div>)}
      {group.remaining > 0 && <Button variant="ghost" onClick={() => setOlderPages(pages => ({...pages,[group.id]:group.pageCount + 1}))}>{group.pageCount ? `Show ${Math.min(OLDER_PAGE_SIZE, group.remaining)} more` : 'Show older threads'} ({group.remaining})</Button>}
      {group.pageCount > 0 && <Button variant="ghost" aria-expanded onClick={() => setOlderPages(pages => ({...pages,[group.id]:0}))}>Hide older threads</Button>}
    </div>;
  }
  const detail = screen === 'conversation' || screen === 'new';
  const canSend = connected && !working && !staging && !!draft.trim() && (screen === 'new' ? newReady : !!task?.canReply);
  function outgoingPreview(messages: Outgoing[]): PendingOutgoing[] {
    return messages.filter(message =>
      (task?.messages.filter(m => m.role === 'user' && m.text === message.prompt).length || 0) < message.ordinal).map(message =>
      ({ id: message.id, text: message.prompt, attachments: message.attachments, status: message.acknowledged ? 'Queued on your Mac' : 'Sending…' }));
  }
  return <main className="companion"
    onTouchStart={event => {
      backSwipe.current = null;
      // In the native shell the drawer owns the left-edge gesture.
      if (nativeShell || screen !== 'conversation' || working || confirmDelete || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const left = event.currentTarget.getBoundingClientRect().left;
      if (touch.clientX - left > 32) return;
      if ((event.target as HTMLElement).closest('button, a, input, textarea, select, [contenteditable], pre, table')) return;
      backSwipe.current = { x: touch.clientX, y: touch.clientY };
    }}
    onTouchMove={event => {
      const start = backSwipe.current;
      if (!start) return;
      if (event.touches.length !== 1 || Math.abs(event.touches[0].clientY - start.y) > 24 || event.touches[0].clientX < start.x - 12) backSwipe.current = null;
    }}
    onTouchCancel={() => { backSwipe.current = null; }}
    onTouchEnd={event => {
      const start = backSwipe.current;
      backSwipe.current = null;
      if (!start || screen !== 'conversation' || working || confirmDelete || event.touches.length || event.changedTouches.length !== 1) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - start.x, dy = Math.abs(touch.clientY - start.y);
      if (dx >= 80 && dy <= 24) setScreen('threads');
    }}>
    {!nativeBar && <header className={`companion-header${screen === 'conversation' ? ' companion-thread-header' : ''}`}>
      {screen === 'conversation' ? <>
        <Button variant="ghost" size="icon" aria-label="Back to threads" title="Thread menu" onClick={() => setScreen('threads')}><Menu /></Button>
        <div className="companion-thread-title"><h1 title={task?.title}>{task?.title || 'Loading conversation…'}</h1><small>{[({ running: 'Running', waiting: 'Needs you', failed: 'Failed' } as Record<string, string>)[nativeRunState(task)], nativeProjectName].filter(Boolean).join(' · ')}</small></div>
        <div className="companion-thread-actions">
          {connectionButton}
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Thread actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="companion-thread-menu">
              <DropdownMenuItem disabled={actionsDisabled || !busyThread} onSelect={() => void threadAction('stop')}>Stop</DropdownMenuItem>
              <DropdownMenuItem disabled={!task?.pending} onSelect={reviewDecision}>Review decision…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={actionsDisabled || busyThread} onSelect={() => void threadAction('archive')}>Archive</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" disabled={actionsDisabled} onSelect={() => setConfirmDelete(true)}>Delete…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </> : <>
      {detail ? <Button variant="ghost" size="icon" aria-label="Back to threads" disabled={working} onClick={() => setScreen('threads')}><ArrowLeft /></Button> : <span className="companion-brand">freddai</span>}
      <h1>{screen === 'new' ? 'New thread' : 'Threads'}</h1>
      {connectionButton}
      {!detail && <Button variant="ghost" size="icon" aria-label="New thread" onClick={() => start()}><Plus /></Button>}
      </>}
    </header>}
    {showBanner && <div className="companion-banner" data-state={connection.state} role={connection.state === 'down' ? 'alert' : 'status'}>
      <div><strong>{connection.state === 'down' ? connectionInfo.title : connection.state === 'ok' ? 'Connected to your Mac' : 'Connecting to your Mac…'}</strong>{connection.state === 'down' && connectionInfo.detail && <small>{connectionInfo.detail}</small>}</div>
      <div className="companion-banner-actions">
        {connection.state === 'down' && onPairAgain && <Button variant="ghost" onClick={onPairAgain}>Pair iPhone</Button>}
        <Button variant="ghost" size="icon" aria-label="Refresh connection" onClick={() => setRetry(v => v + 1)}><RefreshCw size={14} /></Button>
        <Button variant="ghost" size="icon" aria-label="Dismiss connection alert" onClick={() => { setBannerDismissed(true); setDetailsOpen(false); }}><X size={14} /></Button>
      </div>
    </div>}
    {error && <p className="companion-error" role="alert">{error}</p>}
    {!detail && <>
      <div className="companion-search"><Search size={17} /><Input aria-label="Search threads" placeholder="Search projects and threads" value={query} onChange={e => {setQuery(e.target.value);setOlderPages({});}} /></div>
      <div className="companion-filters">
        <select aria-label="Project filter" value={project} onChange={e => {setProject(e.target.value);setOlderPages({});}}><option value="">All projects</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select aria-label="Status filter" value={filter} onChange={e => {setFilter(e.target.value as ThreadFilter);setOlderPages({});}}><option value="all">All threads</option><option value="attention">Needs you</option><option value="running">Running</option><option value="done">Finished</option></select>
      </div>
    </>}
    <div className="companion-body-wrap"><ScrollArea className="companion-body" viewportRef={viewport} viewportProps={{ onScroll: () => {
      const el = viewport.current;
      if (el) { const gap = el.scrollHeight - el.scrollTop - el.clientHeight; nearBottom.current = gap < 80; setShowLatest(gap > 200); }
    } }}>
      {screen === 'threads' ? <>{groups.map(group => <section key={group.id} className="companion-project-group" aria-label={`${group.project?.name || 'Project'} threads`}>
        <div className="companion-project-heading"><FolderGit2 size={16} style={{color:group.project?.color}}/><h2 title={group.project?.name}>{group.project?.name || 'Project'}</h2><Button variant="ghost" size="icon" aria-label={`New task in ${group.project?.name || 'project'}`} disabled={!connected || !group.project?.canStart} onClick={() => start(group.id)}><Plus size={16}/></Button></div>
        {group.active.map(row)}{older(group)}
      </section>)}{!groups.length && <p className="companion-empty">{connected ? 'No threads match your filters.' : 'Check progress, reply, and start work from your iPhone. Your projects and conversations will appear when your Mac is connected.'}</p>}</> : screen === 'new' ? <div className="companion-new"><h2>What would you like to work on?</h2><p>Choose a coding assistant configured on your Mac.</p><label>Project<select aria-label="New thread project" value={newProject} disabled={working} onChange={e => { setNewProject(e.target.value); delete requestIds.current.new; }}><option value="">Choose a project</option>{data.projects.map(p => <option key={p.id} value={p.id} disabled={!p.canStart}>{p.name}</option>)}</select></label>{newProjectData?.assistants && <label>Coding assistant<select aria-label="Coding assistant" value={assistant} disabled={!connected || working} onChange={e => { setNewAssistants(old => ({ ...old, [newProject]: e.target.value })); delete requestIds.current.new; }}><option value="" disabled>Choose a coding assistant</option>{newProjectData.assistants.map(a => <option key={a.id} value={a.id}>{a.name} · {a.provider === 'codex' ? 'Codex' : a.provider === 'claude' ? 'Claude Code' : a.provider}</option>)}</select></label>}{!data.projects.some(p => p.canStart) && <p>Projects must be ready to run on your Mac.</p>}</div> : <ThreadTranscript key={task?.id} density="compact" messages={task?.messages || []} pending={outgoingPreview(pendingMessages)}>{task?.error && <p role="alert">{task.error}</p>}{task?.pending && <fieldset disabled={!connected || working} key={JSON.stringify(task.pending.request_id ?? task.pending.id)}><Permission pending={task.pending} provider={task.provider || ''} onReply={respond} /></fieldset>}{task?.queuePaused && <p>Message queue paused on your Mac.{task.queueError ? ` ${task.queueError}` : ''}</p>}{task && !task.canReply && !task.pending && <p>Continue this thread on your Mac.</p>}</ThreadTranscript>}
      {screen === 'new' && <ThreadTranscript density="compact" messages={[]} pending={outgoingPreview(outgoing.filter(m => !m.thread))} />}
    </ScrollArea>
    {screen === 'conversation' && <button type="button" className="companion-latest" data-visible={showLatest} aria-label="Jump to latest message" tabIndex={showLatest ? 0 : -1} aria-hidden={!showLatest} onClick={() => viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: 'smooth' })}><ArrowDown size={18} /></button>}
    </div>
    {detail && <div className="companion-compose-area">
      {screen === 'conversation' && !nativeShell && <ConversationUsage usage={task?.usage}/>}
      {!!task?.queue?.length && screen === 'conversation' && <section className="companion-queue" aria-label="Message queue">
        <div className="companion-queue-header"><span>{task.queue.length} queued{task.queuePaused ? ' · Paused' : ''}</span><Button type="button" variant="ghost" disabled={!connected || working || !client.queue} onClick={() => void queueAction(task.queuePaused ? 'resume' : 'pause')}>{task.queuePaused ? 'Resume' : 'Pause'}</Button><Button type="button" variant="ghost" disabled={!connected || working || !client.queue} onClick={() => void queueAction('clear')}>Clear queue</Button></div>
        {task.queue.map(message => <div className="companion-queue-message" key={message.id}><p>{message.prompt}{message.attachments > 0 && <small>{message.attachments} file{message.attachments === 1 ? '' : 's'}</small>}</p><Button type="button" variant="ghost" size="icon" aria-label={`Remove queued message: ${message.prompt}`} disabled={!connected || working || !client.queue} onClick={() => void queueAction('delete', message.id)}><X size={16}/></Button></div>)}
      </section>}
      {!nativeConversation && <form className="companion-composer" onSubmit={e => void send(e)}>
        <input ref={fileInput} type="file" multiple hidden aria-label="Choose attachments" onChange={e => void attachFiles(e.target.files)}/>
        {!!files.length && <div className="companion-attachments">{files.map(file => <span key={file.id}><Paperclip size={13}/><span>{file.name}</span><Button type="button" variant="ghost" size="icon" aria-label={`Remove attachment ${file.name}`} onClick={() => setAttachments(old => ({ ...old, [key]: (old[key] || []).filter(item => item.id !== file.id) }))}><X size={14}/></Button></span>)}</div>}
        <Textarea ref={textarea} rows={2} aria-describedby="companion-composer-help" aria-label={screen === 'new' ? 'New thread prompt' : 'Reply'} placeholder={screen === 'new' ? 'Describe the task…' : busyThread ? 'Draft your next message…' : 'Message your agent…'} value={draft} onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
            // The software Return key writes a newline. Hardware Enter and Cmd/Ctrl+Enter send.
            if (e.metaKey || e.ctrlKey || !window.matchMedia('(pointer: coarse)').matches) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); }
          }
        }} onChange={e => { const value = e.target.value; setDrafts(old => ({ ...old, [key]: value })); delete requestIds.current[key]; }} />
        <div className="companion-composer-tools">
          <Button type="button" variant="ghost" size="icon" className="companion-attach" aria-label="Attach files" disabled={!connected || working || staging || !client.attach} onClick={() => fileInput.current?.click()}><Plus size={20}/></Button>
          {provider && <PermissionSelect provider={provider} value={permission} onChange={value => setControls(old => ({ ...old, [controlKey]: { selection, permission: value } }))} disabled={!connected || working}/>}
          <span className="companion-composer-spacer"/>
          <AgentControls key={controlKey} native={!!client.models} provider={provider} loadModels={client.models ? loadModels : undefined} value={selection} onChange={value => setControls(old => ({ ...old, [controlKey]: { selection: value, permission } }))} disabled={!connected || working}/>
          {screen === 'conversation' && busyThread && <Button type="button" variant="ghost" size="icon" aria-label="Stop current turn and pause queue" disabled={actionsDisabled} onClick={() => void threadAction('stop')}><Square size={16}/></Button>}
          <Button type="submit" size="icon" className="companion-send" aria-label={screen === 'new' ? 'Start thread' : busyThread || !!task?.queued ? 'Queue message' : 'Send reply'} disabled={!canSend}><ArrowUp size={20}/></Button>
        </div>
        {staging && <p className="companion-attachment-status" role="status">Copying attachments to your Mac…</p>}
        <p id="companion-composer-help" className="sr-only">Return inserts a new line on iPhone. Command or Control Enter sends. Messages sent during a turn join the queue. Stop pauses pending messages.</p>
      </form>}
    </div>}
    <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}><DialogContent><DialogHeader><DialogTitle>Delete thread?</DialogTitle><DialogDescription>Move “{task?.title}” to Deleted on your Mac. Deleting an active thread also stops its work. You can restore it from Deleted on your Mac.</DialogDescription></DialogHeader><DialogFooter><Button variant="ghost" disabled={working} onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="destructive" disabled={actionsDisabled} onClick={() => void threadAction('delete')}>Move to Deleted</Button></DialogFooter></DialogContent></Dialog>
  </main>;
}
