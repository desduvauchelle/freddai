import { WorkspaceSettings } from '../desktop/WorkspaceSettings';
import '../workspace.css';
import { useNavigationState } from '../hooks/use-navigation-state';
import { hasNativeDashboardContent } from './native-shell';
import { useNativeSummaries } from './native-summaries';
import { buildDashboardModel, dashboardAssistantFor, dashboardControlKey, type DashboardAction } from './native-dashboard';
import { setDashboard as setNativeDashboard, onDashboardAction } from './native-shell';
import { ScheduleManager } from "../desktop/ScheduleManager";
import { CompanionDashboard } from './CompanionDashboard';
import { ConnectionLoading } from './ConnectionLoading';
import { browserThreadRecencyTracker } from "../thread-recency";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, Menu, MoreHorizontal, Square, X, Paperclip, ArrowUp, FolderGit2, Plus, Search, Monitor, ChevronDown, ShieldAlert, ShieldCheck, Cpu, Bot } from 'lucide-react';
import { Button } from '@freddai/ui/components/button';
import { Input } from '@freddai/ui/components/input';
import { Textarea } from '@freddai/ui/components/textarea';
import { ScrollArea } from '@freddai/ui/components/scroll-area';
import { ConnectionBanner } from './ConnectionBanner';
import { companionStatusRead, disconnectedClient, scopeCompanion, selectThreads, groupCompanionThreads, type CompanionThread, type CompanionClient, type CompanionSnapshot, type ThreadFilter } from './companion';
import { ThreadTranscript, type PendingOutgoing } from '../conversation/ThreadTranscript';
import { TodoPanel } from '../conversation/TodoList';
import { groupThreadsByDay, OLDER_PAGE_SIZE, threadListStatus } from '../desktop/types';
import { Permission } from '../desktop/AgentRequest';
import { useSystemAppearance } from '../appearance/use-system-appearance';
import { MascotHero } from '../desktop/MascotScenes';
import { ThreadActivity } from './ThreadActivity';
import { MessageQueue } from './MessageQueue';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@freddai/ui/components/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@freddai/ui/components/dialog';
import { ConversationUsage } from '../desktop/ConversationUsage';
import { AgentControls } from '../desktop/AgentControls';
import { PermissionSelect } from '../desktop/PermissionSelect';
import { defaultSelection, type AgentSelection, type Model } from '../desktop/agent-selection';
import { providerName } from '../desktop/types';
import type { Attachment, PermissionMode } from '../desktop/types';
import './mobile.css';
import { useConnectionStatus } from './use-connection-status';
import { describeConnection } from './connection-status';
import { useNativeShell, setMode as setNativeMode, setComposerText as setNativeComposerText, discardFiles as discardNativeFiles, setVoice as setNativeVoice, appendComposerText as appendNativeComposerText, onVoiceRecorded, onVoiceError, pickOption, type NativeFile, onNavBack, onComposerSend, setConnection as setNativeConnection, onConnectionTap, setThreads as setNativeThreads, setThreadMeta as setNativeThreadMeta, onThreadAction, onSelectThread, onSearch, onSetFilter, onNewThread, onShowOlder, onDashboard } from './native-shell';
import { migrateLocalRead, readFromThreads } from '../read-sync';
import { buildThreadsModel, companionThreadFaded, bumpOlderPage, createChangeSender, createThreadActionHandler, nativeRunState, createThreadEventHandlers } from './native-threads';
import type { PickerOption } from './native-shell';
import { assistantOptions, assistantLabel, attachmentLimitError, effortOptions, modelOptions, modelPillLabel, pickNewProject, PERMISSION_OPTIONS, permissionLabel, projectOptions, saveLastProject, savedLastProject, supportsPermissions } from './native-home';
function savedDrafts(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem('freddai.companion.drafts') || '{}'); } catch { return {}; }
}
function Pill({ icon, label, value, onClick, disabled }: { icon: ReactNode; label: string; value: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="companion-pill" aria-label={`${label}: ${value}`} disabled={disabled} onClick={onClick}>
    {icon}<span className="companion-pill-value">{value}</span><ChevronDown size={13} aria-hidden="true"/>
  </button>;
}
const initial: CompanionSnapshot = { projects: [], threads: [] };
type Outgoing = { id: string; thread: string; project: string; prompt: string; ordinal: number; startsTurn: boolean; acknowledged: boolean; uploadStatus?: string; attachments: Attachment[] };
export function MobileApp({ client = disconnectedClient, onPairAgain }: { client?: CompanionClient; onPairAgain?: () => void }) {
  useSystemAppearance();
  const [data, setData] = useState(initial), [error, setError] = useState(''), [loaded, setLoaded] = useState(false);
  const { status: connection, connected, attempt, succeeded, failed, nextDelay } = useConnectionStatus();
  const attemptReason = useRef<'poll' | 'manual' | 'foreground'>('poll'), [recovered, setRecovered] = useState(false), previousState = useRef(connection.state);
  const [bannerDismissed, setBannerDismissed] = useState(false), [detailsOpen, setDetailsOpen] = useState(false);
  const [project, setProject] = useState(''), [query, setQuery] = useState(''), [filter, setFilter] = useState<ThreadFilter>('all');
  const [workspacesOpen, setWorkspacesOpen] = useState(false);
  const [workspace, setWorkspace] = useState(() => { try { return localStorage.getItem('freddai.companion.workspace') || ''; } catch { return ''; } });
  const scopedData = scopeCompanion(data, workspace);
  function chooseWorkspace(id: string) {
    if (id === '__manage_workspaces') { setWorkspacesOpen(true); return; }
    setWorkspace(id); setProject(''); setQuery(''); setFilter('all'); setOlderPages({});
    try { localStorage.setItem('freddai.companion.workspace', id); } catch { /* Optional local preference. */ }
  }
  useEffect(() => { if (loaded && workspace && !data.workspaces?.some(w => w.id === workspace)) chooseWorkspace(''); }, [loaded, workspace, data.workspaces]);
  const navigationRevision = useRef(0);
  const [screen, setScreen] = useNavigationState<'threads' | 'conversation' | 'new' | 'dashboard'>('threads', navigationRevision), [selected, setSelected] = useNavigationState('', navigationRevision);
  const snapshotThread = screen === 'conversation' ? selected : undefined;
  const [drafts, setDrafts] = useState<Record<string, string>>(savedDrafts), [newProject, setNewProject] = useState(''), [working, setWorking] = useState(false), [retry, setRetry] = useState(0);
  // Read state lives on the Mac host (`read_at` per thread, shared with the desktop); the overlay bridges the gap until the next snapshot.
  const [readOverlay, setReadOverlay] = useState<Record<string, number>>({});
  const actualRead = readFromThreads(data.threads, readOverlay);
  const read = companionStatusRead(data, actualRead);
  const [dashboardAssistant, setDashboardAssistant] = useState('');
  const [officeExpanded, setOfficeExpanded] = useState(false);
  useEffect(() => { if (screen !== 'dashboard') setOfficeExpanded(false); }, [screen]);
  const [dashboardBusy, setDashboardBusy] = useState(false);
  const dashboardInFlight = useRef(false);
  const dashboardContext = useRef({ screen, drafts });
  dashboardContext.current = { screen, drafts };
  const [newAssistants, setNewAssistants] = useState<Record<string, string>>({});
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [olderPages, setOlderPages] = useState<Record<string, number>>({});
  const [schedulesOpen,setSchedulesOpen] = useState(false);
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
  // Native attachments already uploaded to the Mac, by tmp path, so a retried send does not upload twice.
  const uploaded = useRef<Record<string, Attachment>>({});
  const [models, setModels] = useState<{ key: string; list: Model[] }>({ key: '', list: [] });
  const pendingMessages = outgoing.filter(m => m.thread === selected);
  const snapshotTask = data.threads.find(t => t.id === selected) || (pendingMessages.length ? {
    id: selected, project: pendingMessages[0].project, title: pendingMessages[0].prompt,
    status: 'starting', updated: 0, messages: [], canReply: false, queued: 0, error: null,
  } : undefined);
  // A persisted FIFO item is an implementation detail when it is starting an idle turn.
  // Keep that intent visible until the host echoes the user message, instead of flashing Completed/Up next.
  const startingMessages = pendingMessages.filter(m => m.startsTurn &&
    (snapshotTask?.messages.filter(item => item.role === 'user' && item.text === m.prompt).length || 0) < m.ordinal);
  const task = snapshotTask && startingMessages.length && !snapshotTask.pending &&
    !snapshotTask.queuePaused && !snapshotTask.queueError &&
    (startingMessages.some(m => !m.acknowledged) || !['failed', 'interrupted'].includes(snapshotTask.status))
    ? { ...snapshotTask, status: ['running', 'waiting'].includes(snapshotTask.status) ? snapshotTask.status : 'starting',
        queue: snapshotTask.queue?.filter(item => !startingMessages.some(m => `phone:${m.id}` === item.id)),
        queued: Math.max(0, snapshotTask.queued - (snapshotTask.queue?.filter(item => startingMessages.some(m => `phone:${m.id}` === item.id)).length || 0)) }
    : snapshotTask;
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
  async function queueAction(action: 'pause' | 'resume' | 'delete' | 'clear' | 'steer', message?: string) {
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
      if (screen === 'conversation' && task?.messagesLoaded !== false && (task?.status === 'done' || task?.status === 'failed') && document.visibilityState === 'visible') {
        if ((actualRead[task.id] ?? -1) >= task.updated) return;
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
  }, [screen, task?.id, task?.status, task?.updated, task?.messagesLoaded, actualRead[task?.id ?? ''], client]);
  useEffect(() => { try { localStorage.setItem('freddai.companion.drafts', JSON.stringify(drafts)); } catch { /* Keep drafts in memory if storage is full. */ } }, [drafts]);
  const lastCount = useRef(0);
  useEffect(() => {
    if (screen === 'conversation' && viewport.current) {
      viewport.current.scrollTop = viewport.current.scrollHeight;
      nearBottom.current = true; setShowLatest(false);
    }
  }, [selected, screen]);
  useEffect(() => {
    const el = viewport.current;
    const count = (task?.messages.length ?? 0) + outgoing.length;
    const appended = count - lastCount.current;
    lastCount.current = count;
    if (screen === 'conversation' && nearBottom.current && el) {
      if (appended > 0 && appended < 4 && typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      else el.scrollTop = el.scrollHeight;
    }
  }, [task?.updated, task?.messages.length, outgoing, screen]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      // A manual check was already marked in flight by the tap; other reasons are recorded here.
      const reason = attemptReason.current; attemptReason.current = 'poll';
      if (reason !== 'manual') attempt(reason);
      try {
        const next = await client.snapshot(controller.signal, snapshotThread);
        if (controller.signal.aborted) return;
        setData({ ...next, threads: trackThreadRecency(next.threads) }); setLoaded(true); succeeded();
        setOutgoing(old => old.filter(message => {
          if (!message.acknowledged) return true;
          const thread = next.threads.find(t => t.id === message.thread);
          // Once a real queue owns the message, clearing/deleting it must not revive a chat bubble.
          if ((!message.startsTurn || thread?.queuePaused || thread?.queueError) && thread?.queue?.some(item => item.id === `phone:${message.id}`)) return false;
          return (thread?.messages.filter(m => m.role === 'user' && m.text === message.prompt).length || 0) < message.ordinal;
        }));
      } catch (e) {
        if (controller.signal.aborted) return;
        failed(String(e instanceof Error ? e.message : e));
      }
      if (!controller.signal.aborted) timer = setTimeout(refresh, nextDelay(document.visibilityState === 'visible'));
    }
    const foreground = () => { if (document.visibilityState === 'visible') { if (attemptReason.current !== 'manual') attemptReason.current = 'foreground'; setRetry(value => value + 1); } };
    document.addEventListener('visibilitychange', foreground);
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', foreground); };
  }, [client, retry, snapshotThread, attempt, succeeded, failed, nextDelay]);
  async function send(e?: FormEvent, nativeText?: string, nativeFiles: NativeFile[] = []) {
    e?.preventDefault();
    const fromNative = nativeText !== undefined;
    const prompt = fromNative ? nativeText : draft;
    // The native composer clears itself on send, so a rejected send must hand the text back.
    const reject = (message: string) => { if (fromNative) { void setNativeComposerText(prompt, nativeFiles); setError(message); } };
    if (!connected || working || staging || !prompt.trim()) { reject(!connected ? 'Your Mac is disconnected. Message not sent.' : 'Another action is in progress. Message not sent.'); return; }
    const isNew = screen === 'new';
    if (isNew ? !newReady : !task?.canReply || task.messagesLoaded === false) { reject(isNew ? 'Choose a project and coding agent that are ready on your Mac. Message not sent.' : 'This thread cannot take a reply right now. Message not sent.'); return; }
    const limit = attachmentLimitError(nativeFiles);
    if (limit || (nativeFiles.length && !client.attachPath)) { reject(limit || 'Attachments are not available in this build. Message not sent.'); return; }
    const sentNavigation = navigationRevision.current;
    const sentKey = key;
    // A retry of the same native text keeps its request id; different text gets a new one.
    const signature = JSON.stringify([prompt, nativeFiles.map(file => file.path)]);
    if (fromNative && nativePrompts.current[sentKey] !== signature) delete requestIds.current[sentKey];
    if (fromNative) nativePrompts.current[sentKey] = signature;
    const requestId = requestIds.current[sentKey] ||= crypto.randomUUID();
    // Native files show in the pending bubble right away; their real ids come from the upload below.
    let sentFiles: Attachment[] = fromNative ? nativeFiles.map(file => ({ id: file.path, name: file.name, bytes: file.bytes, mime: file.mime, sha256: '' })) : files;
    const baseOptions = { model: selection.model.trim() || null, effort: selection.effort === 'default' ? null : selection.effort, permission_mode: provider === 'codex' || provider === 'claude' ? permission : undefined, update_agent_controls: true };
    const matching = task?.messages.filter(m => m.role === 'user' && m.text === prompt).length || 0;
    const ordinal = isNew ? 1 : Math.max(matching, ...outgoing.filter(m => m.thread === selected && m.prompt === prompt).map(m => m.ordinal)) + 1;
    setOutgoing(old => [...old, { id: requestId, thread: isNew ? '' : selected, project: isNew ? newProject : task!.project, prompt, ordinal, startsTurn: isNew || (!busyThread && !task?.queued && !task?.queuePaused), acknowledged: false, attachments: sentFiles }]);
    nearBottom.current = true;
    if (!fromNative) { setDrafts(old => ({ ...old, [sentKey]: '' })); setAttachments(old => ({ ...old, [sentKey]: [] })); }
    setError(''); setWorking(true);
    try {
      if (fromNative && nativeFiles.length) {
        for (const [index, file] of nativeFiles.entries()) {
          setOutgoing(old => old.map(message => message.id === requestId ? { ...message, uploadStatus: `Uploading ${index + 1} of ${nativeFiles.length}: ${file.name}…` } : message));
          uploaded.current[file.path] ||= await client.attachPath!(file);
        }
        setOutgoing(old => old.map(message => message.id === requestId ? { ...message, uploadStatus: undefined } : message));
        sentFiles = nativeFiles.map(file => uploaded.current[file.path]);
      }
      const options = { ...baseOptions, attachments: sentFiles.map(file => file.id) };
      if (isNew) {
        const id = await client.start({ assistant: assistant || undefined, project: newProject, prompt, requestId, options });
        setOutgoing(old => old.map(m => m.id === requestId ? { ...m, thread: id, acknowledged: true } : m));
        // A delayed acknowledgment must not undo a newer thread selection.
        if (navigationRevision.current === sentNavigation) { setSelected(id); setScreen('conversation'); }
      } else {
        await client.reply({ thread: selected, prompt, requestId, options });
        setOutgoing(old => old.map(m => m.id === requestId ? { ...m, acknowledged: true } : m));
      }
      delete requestIds.current[sentKey]; setRetry(v => v + 1);
      if (fromNative && nativeFiles.length) {
        for (const file of nativeFiles) delete uploaded.current[file.path];
        discardNativeFiles(nativeFiles.map(file => file.path)).catch(e => setError(`Native shell: ${e instanceof Error ? e.message : String(e)}`));
      }
    } catch (e) { if (fromNative) void setNativeComposerText(prompt, nativeFiles); else { setAttachments(old => ({ ...old, [sentKey]: [...sentFiles, ...(old[sentKey] || [])] })); setDrafts(old => ({ ...old, [sentKey]: old[sentKey] ? `${prompt}\n${old[sentKey]}` : prompt })); } setOutgoing(old => old.filter(m => m.id !== requestId)); setError(e instanceof Error ? e.message : String(e)); }
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
  const nativeNew = nativeShell && screen === 'new';

  // Model catalog for the native pills (only Codex has one; Claude uses fixed aliases, like AgentControls).
  const modelKey = `${screen === 'new' ? `new:${newProject}:${assistant}` : selected}:${provider || ''}`;
  useEffect(() => {
    if (!(nativeNew || nativeConversation) || provider !== 'codex' || !client.models || !connected) return;
    let live = true;
    loadModels().then(list => { if (live) setModels({ key: modelKey, list }); })
      .catch(e => { if (live) setError(`Couldn’t load models: ${e instanceof Error ? e.message : String(e)}`); });
    return () => { live = false; };
  }, [nativeNew, nativeConversation, provider, modelKey, connected, client]);
  const modelList = models.key === modelKey ? models.list : [];
  const pickerBusy = !connected || working;
  async function choose(title: string, options: PickerOption[], selected?: string): Promise<string | null> {
    try { return await pickOption({ title, options, selected }); }
    catch (e) { setError(`Native shell: ${e instanceof Error ? e.message : String(e)}`); return null; }
  }
  async function pickProject() {
    const id = await choose('Project', projectOptions(scopedData.projects), newProject);
    if (id && id !== newProject) { setNewProject(id); delete requestIds.current.new; }
  }
  async function pickAssistant() {
    const options = assistantOptions(newProjectData);
    if (options.length < 2) return;
    const id = await choose('Coding agent', options, assistant);
    if (id) { setNewAssistants(old => ({ ...old, [newProject]: id })); delete requestIds.current.new; }
  }
  async function pickModel() {
    const model = await choose('Model', modelOptions(provider, modelList), selection.model);
    if (model === null) return;
    const efforts = effortOptions(provider, model, modelList);
    let effort = 'default';
    if (efforts.length > 1) {
      const chosen = await choose('Reasoning effort', efforts, model === selection.model ? selection.effort : 'default');
      if (chosen === null) return;
      effort = chosen;
    }
    setControls(old => ({ ...old, [controlKey]: { selection: { model, effort }, permission } }));
  }
  async function pickPermission() {
    const mode = await choose('Permissions', PERMISSION_OPTIONS, permission);
    if (mode === 'ask' || mode === 'bypass') setControls(old => ({ ...old, [controlKey]: { selection, permission: mode } }));
  }
  const launchingNew = outgoing.filter(m => !m.thread);
  const home = <div className="companion-home">
    {!loaded ? <ConnectionLoading down={connection.state === 'down'} /> : <MascotHero line="What should we work on today?" size={112}/> }
    {loaded && <div className="companion-pills" role="group" aria-label="New thread options">
      <Pill icon={<FolderGit2 size={14}/>} label="Project" value={newProjectData?.name || (loaded ? 'Choose a project' : connection.state === 'down' ? 'Waiting for your Mac' : 'Loading…')} disabled={pickerBusy || !data.projects.length} onClick={() => void pickProject()}/>
      {(provider || newProjectData?.assistants) && <Pill icon={<Bot size={14}/>} label="Coding agent" value={selectedAssistant ? assistantLabel(selectedAssistant) : provider ? providerName(provider) : 'Choose a coding agent'} disabled={pickerBusy || (newProjectData?.assistants?.length ?? 0) < 2} onClick={() => void pickAssistant()}/>}
    </div>}
    {loaded && !data.projects.some(p => p.canStart) && <p className="companion-home-note">Projects must be ready to run on your Mac.</p>}
  </div>;
  // Conversation and New thread get the native bar + drawer; the web threads screen exists only outside the native shell.
  const nativeBar = nativeShell && screen !== 'threads';
  const nativeTitle = task?.title || 'Conversation';
  useEffect(() => {
    if (!nativeShell) return;
    void (workspacesOpen || schedulesOpen && screen === 'dashboard' ? setNativeMode('other') : screen === 'conversation'
      ? setNativeMode('conversation', { title: nativeTitle, placeholder: busyThread ? 'Draft your next message…' : 'Message' })
      : screen === 'new' ? setNativeMode('new', { title: 'New thread', placeholder: 'What should we work on?' })
      : screen === 'dashboard' ? setNativeMode('dashboard', { title: 'Dashboard' }) : setNativeMode('other')).catch(e => setError(`Native shell: ${e instanceof Error ? e.message : String(e)}`));
  }, [nativeShell, screen, nativeTitle, busyThread, schedulesOpen, workspacesOpen]);
  // Launch: the native app always opens on the New thread home (drawer closed), like the Mac. Threads are one drawer swipe away.
  const launched = useRef(false);
  useEffect(() => {
    if (!nativeShell || launched.current) return;
    launched.current = true;
    setScreen('new');
  }, [nativeShell]);
  // The home needs a project: last used if it still exists, else the first one that can start threads.
  useEffect(() => {
    if (!nativeShell || screen !== 'new' || !loaded || scopedData.projects.some(p => p.id === newProject && p.canStart)) return;
    setNewProject(pickNewProject(scopedData.projects, project, savedLastProject()));
  }, [nativeShell, screen, loaded, data.projects, data.workspaces, workspace, newProject, project]);
  useEffect(() => { if (nativeShell && screen === 'new' && newProject) saveLastProject(newProject); }, [nativeShell, screen, newProject]);
  // Push-to-talk dictation: the mic only shows while the Mac reports voice enabled + ready, rechecked at most every 30 s.
  const voiceReady = useRef(false), voiceCheckedAt = useRef(0);
  const checkVoice = useCallback(async (force: boolean) => {
    if (!nativeShell || !client.voice) return;
    if (!force && Date.now() - voiceCheckedAt.current < 30_000) return;
    voiceCheckedAt.current = Date.now();
    let ready = false;
    try { const status = await client.voice(); ready = !!status.enabled && !!status.ready; console.info('[voice]', 'status', status); }
    catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn('[voice]', 'status check failed; dictation hidden', message);
      setError(`Dictation unavailable: ${message}`);
    }
    voiceReady.current = ready;
    await setNativeVoice(ready).catch(e => setError(`Native shell: ${e instanceof Error ? e.message : String(e)}`));
  }, [nativeShell, client]);
  useEffect(() => {
    if (!nativeShell || !client.voice) return;
    if (!connected) { voiceReady.current = false; voiceCheckedAt.current = 0; void setNativeVoice(false).catch(() => {}); return; }
    void checkVoice(true);
    const tick = setInterval(() => void checkVoice(false), 30_000);
    const foreground = () => { if (document.visibilityState === 'visible') void checkVoice(false); };
    document.addEventListener('visibilitychange', foreground);
    return () => { clearInterval(tick); document.removeEventListener('visibilitychange', foreground); };
  }, [nativeShell, client, connected, checkVoice]);
  async function dictate(path: string) {
    if (!client.transcribe) { setError('Dictation is not available in this build.'); void discardNativeFiles([path]).catch(() => {}); return; }
    setError('');
    await setNativeVoice(voiceReady.current, 'transcribing').catch(() => {});
    try {
      const started = Date.now();
      const result = await client.transcribe({ path });
      console.info('[voice]', 'transcribed', { chars: result.text.length, model: result.model, audioMs: result.durationMs, roundTripMs: Date.now() - started });
      if (result.text.trim()) await appendNativeComposerText(result.text, true);
      else setError("Didn't catch anything");
    } catch (e) {
      console.warn('[voice]', 'transcribe failed', e instanceof Error ? e.message : e);
      setError(`Dictation failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      void setNativeVoice(voiceReady.current, 'idle').catch(() => {});
    }
  }
  const nativeDashboardContent = nativeShell && hasNativeDashboardContent();
  const nativeSummaries = useNativeSummaries(client.summaries, nativeDashboardContent && screen === 'dashboard' && connected);
  const dashboardHandler = useRef<(action: DashboardAction) => void>(() => {});
  dashboardHandler.current = event => { void (async () => {
    if (dashboardInFlight.current) { if (event.path) void discardNativeFiles([event.path]); return; }
    if (event.action === 'summary') { await nativeSummaries.generate(event.project || ''); return; }
    if (event.action === 'schedules') { setSchedulesOpen(true); return; }
    if (event.action === 'agent' && connected) {
      const assistants = [...new Map(data.projects.flatMap(p => p.assistants ?? []).map(a => [a.id, a])).values()];
      const choice = await choose('Coding agent', [{ id: '', label: 'Project defaults' }, ...assistants.map(a => ({ id: a.id, label: assistantLabel(a) }))], dashboardAssistant);
      if (choice !== null) setDashboardAssistant(choice);
      return;
    }
    const target = data.projects.find(p => p.id === event.project);
    if (!target) { if (event.path) { void discardNativeFiles([event.path]); await setNativeDashboard(buildDashboardModel(scopedData, connected, dashboardAssistant, controls, false)); } return; }
    if (event.action === 'open') {
      setProject(target.id); setQuery(''); setFilter('all'); setOlderPages({});
      await setNativeMode('dashboard', { title: 'Dashboard', openDrawer: true }); return;
    }
    const chosen = dashboardAssistantFor(target, event.assistant ?? dashboardAssistant);
    if (!connected || !target.canStart || (target.assistants && !chosen)) {
      if (event.path) { void discardNativeFiles([event.path]); await setNativeDashboard(buildDashboardModel(scopedData, connected, dashboardAssistant, controls, false)); }
      setError('Connect to your Mac and make this project ready before starting a task.'); return;
    }
    if (event.action === 'new') { startDashboard(target.id, chosen?.id); return; }
    if (event.action === 'model') {
      const provider = chosen?.provider || target.provider;
      const key = dashboardControlKey(target, chosen?.id || '');
      const current = controls[key]?.selection ?? defaultSelection;
      const catalog = provider === 'codex' && client.models ? await client.models({ project: target.id, assistant: chosen?.id }) : [];
      const model = await choose('Model', modelOptions(provider, catalog), current.model);
      if (model === null) return;
      const options = effortOptions(provider, model, catalog);
      const effort = options.length > 1 ? await choose('Reasoning effort', options, model === current.model ? current.effort : 'default') : 'default';
      if (effort !== null) setControls(old => ({ ...old, [key]: { permission: old[key]?.permission ?? 'bypass', selection: { model, effort } } }));
      return;
    }
    if (event.action !== 'voice' || !event.path) return;
    dashboardInFlight.current = true; setDashboardBusy(true); setError('');
    try {
      if (!client.transcribe) { await discardNativeFiles([event.path]); throw new Error('Dictation is not available in this build.'); }
      const result = await client.transcribe({ path: event.path });
      if (!result.text.trim()) { setError("Didn't catch anything. Hold the microphone and try again."); return; }
      if (dashboardContext.current.screen === 'dashboard') {
        setDrafts(old => ({ ...old, new: [old.new, result.text].filter(Boolean).join('\n') }));
        startDashboard(target.id, chosen?.id);
        // Keep any text already typed in the native composer; release never submits it.
        await appendNativeComposerText(result.text, false);
      } else {
        // A late transcript belongs to the captured project/agent, never the newly selected conversation.
        const savedKey = `dashboard:${target.id}:${chosen?.id || ''}`;
        setDrafts(old => ({ ...old, [savedKey]: [old[savedKey], result.text].filter(Boolean).join('\n') }));
        setError(`Dictation saved for ${target.name}. Choose New thread on its dashboard card to review it.`);
      }
    } finally { dashboardInFlight.current = false; setDashboardBusy(false); }
  })().catch(e => setError(`Dashboard: ${e instanceof Error ? e.message : String(e)}`)); };
  const dashboardModel = nativeShell ? buildDashboardModel(scopedData, connected, dashboardAssistant, controls, dashboardBusy, Date.now(), officeExpanded) : null;
  if (dashboardModel) { dashboardModel.message = error; dashboardModel.summaries = nativeSummaries.summaries; dashboardModel.schedules = !!client.scheduleCommand; }
  const sendDashboard = useRef(createChangeSender(setNativeDashboard));
  useEffect(() => {
    if (dashboardModel) void sendDashboard.current(dashboardModel).catch(e => setError(`Native dashboard: ${String(e)}`));
  });
  // The native menu calls the same handlers as the web "Thread actions" menu. Delete was already confirmed by a native alert.
  const nativeHandlers = useRef({ send: (_text: string, _files: NativeFile[]) => {}, threadAction: (_p: { action?: unknown }) => {}, voiceRecorded: (_path: string) => {}, voiceError: (_message: string) => {} });
  nativeHandlers.current = {
    voiceRecorded: path => void dictate(path),
    voiceError: message => { console.info('[voice]', 'native error', message); setError(message); },
    send: (text, files) => void send(undefined, text, files),
    threadAction: p => {
      if (p.action === 'model') { if (!pickerBusy && provider) void pickModel(); return; }
      if (p.action === 'permissions') { if (!pickerBusy && supportsPermissions(provider)) void pickPermission(); return; }
      if (p.action === 'pin' || p.action === 'unpin') { void threadAction(p.action); return; }
      createThreadActionHandler({ stop: () => void threadAction('stop'), archive: () => void threadAction('archive'), delete: () => void threadAction('delete'), review: reviewDecision })(p);
    },
  };
  const threadEvents = useRef(createThreadEventHandlers({ selectThread() {}, setQuery() {}, setFilters() {}, newThread() {}, showOlder() {} }));
  threadEvents.current = createThreadEventHandlers({
    selectThread: id => { setSelected(id); setScreen('conversation'); },
    setQuery: value => { setQuery(value); setOlderPages({}); },
    workspace, setWorkspace: chooseWorkspace,
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
    onDashboard(() => setScreen('dashboard')).then(keep, fail);
    onDashboardAction(event => dashboardHandler.current(event)).then(keep, fail);
    onNavBack(() => setScreen('new')).then(keep, fail);
    onComposerSend((text, files) => nativeHandlers.current.send(text, files)).then(keep, fail);
    onVoiceRecorded(path => nativeHandlers.current.voiceRecorded(path)).then(keep, fail);
    onVoiceError(message => nativeHandlers.current.voiceError(message)).then(keep, fail);
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
  // Coming back from an outage shows a brief green "Connected", then hides itself.
  useEffect(() => {
    const was = previousState.current; previousState.current = connection.state;
    if (was !== 'down' || connection.state !== 'ok') return;
    setRecovered(true); const t = setTimeout(() => setRecovered(false), 2000); return () => clearTimeout(t);
  }, [connection.state]);
  const tryAgain = () => { attemptReason.current = 'manual'; attempt('manual'); setRetry(v => v + 1); };
  const connectionInfo = describeConnection(connection);
  useEffect(() => {
    if (!nativeShell) return;
    void setNativeConnection(connection.state, connection.state === 'down' ? connectionInfo.title : undefined).catch(e => setError(`Native shell: ${e instanceof Error ? e.message : String(e)}`));
  }, [nativeShell, connection.state, connectionInfo.title]);
  const connectionTap = () => { setBannerDismissed(false); setDetailsOpen(open => !open); };
  const nativeTapHandler = useRef(connectionTap);
  nativeTapHandler.current = () => { setBannerDismissed(false); setDetailsOpen(true); };
  const showBanner = (connection.state === 'down' && !bannerDismissed) || detailsOpen || (recovered && connection.state === 'ok');
  const connectionButton = <Button variant="ghost" size="icon" className="companion-conn-icon" data-state={connection.state} aria-label={connection.state === 'ok' ? 'Connected to your Mac' : connection.state === 'down' ? 'Mac disconnected' : 'Connecting to your Mac'} onClick={connectionTap}><Monitor size={18} /></Button>;
  const actionsDisabled = !connected || working || !task || !client.action;
  function reviewDecision() { document.querySelector('.thread-transcript fieldset')?.scrollIntoView({ block: 'center' }); }
  async function threadAction(operation: 'stop' | 'archive' | 'delete' | 'pin' | 'unpin') {
    if (actionsDisabled || !task || !client.action) return;
    setError(''); setWorking(true);
    try {
      await client.action({ thread: task.id, action: operation });
      setConfirmDelete(false);
      if (operation === 'archive' || operation === 'delete') leaveThread();
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
  function startDashboard(destination: string, assistant?: string) {
    if (assistant) setNewAssistants(old => ({ ...old, [destination]: assistant }));
    start(destination);
    const savedKey = `dashboard:${destination}:${assistant || ''}`;
    const saved = drafts[savedKey];
    if (saved) {
      setDrafts(old => ({ ...old, [savedKey]: '', new: [old.new, saved].filter(Boolean).join('\n') }));
      void appendNativeComposerText(saved, false); setError('');
    }
  }
  function start(destination?: string) { setNewProject(pickNewProject(scopedData.projects, destination || '', project, nativeShell ? savedLastProject() : '')); setScreen('new'); }
  const nativeProjectName = data.projects.find(p => p.id === (screen === 'new' ? newProject : task?.project))?.name || '';
  const sendMeta = useRef(createChangeSender(setNativeThreadMeta));
  useEffect(() => {
    if (!nativeBar) return;
    const conversation = screen === 'conversation';
    sendMeta.current({
      project: screen === 'dashboard' ? '' : nativeProjectName,
      model: screen !== 'dashboard' && provider ? modelPillLabel(provider, selection, modelList) : null,
      access: screen !== 'dashboard' && supportsPermissions(provider) ? permissionLabel(permission) : null,
      controlsDisabled: pickerBusy,
      runState: conversation ? nativeRunState(task) : '',
      canPin: conversation && !actionsDisabled && typeof task?.pinned === "boolean",
      pinned: !!task?.pinned,
      canStop: conversation && !actionsDisabled && busyThread,
      canReview: conversation && !!task?.pending,
      canArchive: conversation && !actionsDisabled && !busyThread,
      canDelete: conversation && !actionsDisabled,
    }).catch(e => setError(`Native shell: ${e instanceof Error ? e.message : String(e)}`));
  });
  const threads = selectThreads(scopedData, project, query, filter, 'recent', read);
  const groups = groupCompanionThreads(scopedData, threads, { read, selected: screen === 'conversation' ? selected : '', filter, pages: olderPages, includeEmpty: !query.trim() && filter === 'all', project });
  const sendThreads = useRef(createChangeSender(setNativeThreads));
  const nativeModel = nativeShell ? buildThreadsModel({ data, workspace, canManageWorkspaces: !!client.saveWorkspaces && !!data.workspaces, read, selected: screen === 'conversation' ? selected : '', project, query, filter, olderPages }) : null;
  useEffect(() => {
    if (nativeModel) sendThreads.current(nativeModel).catch(e => setError(`Native shell: ${e instanceof Error ? e.message : String(e)}`));
  });
  function row(t: CompanionThread) {
    const status = threadListStatus(t, read);
    const label = ({unread:'Unread reply',done:'Completed',waiting:'Needs you',running:'Running',starting:'Starting',failed:'Failed',interrupted:'Interrupted'} as Record<string,string>)[status] || status;
    const sent = t.last_user_message_at ?? t.updated;
    return <button className="companion-row" data-faded={companionThreadFaded(t, read)} key={t.id} onClick={() => { setSelected(t.id); setScreen('conversation'); }}><span className="companion-state" data-status={status}/><span><strong title={t.title}>{t.pinned && <span aria-label="Pinned">📌 </span>}{t.title}</strong><small>{label}{t.queued > 0 ? ` · ${t.queued} queued` : ''}</small></span><time dateTime={new Date(sent).toISOString()}>{new Date(sent).toLocaleDateString(undefined, {month:'short',day:'numeric'})}</time></button>;
  }
  function older(group: typeof groups[number]) {
    return <div className="companion-history">
      {groupThreadsByDay(group.older).map(day => <div key={day.label || 'today'}>{day.label && <div className="companion-day-label" role="separator" aria-label={day.label}>{day.label}</div>}{day.threads.map(row)}</div>)}
      {group.remaining > 0 && <Button variant="ghost" onClick={() => setOlderPages(pages => ({...pages,[group.id]:group.pageCount + 1}))}>{group.pageCount ? `Show ${Math.min(OLDER_PAGE_SIZE, group.remaining)} more` : 'Show older threads'} ({group.remaining})</Button>}
      {group.pageCount > 0 && <Button variant="ghost" aria-expanded onClick={() => setOlderPages(pages => ({...pages,[group.id]:0}))}>Hide older threads</Button>}
    </div>;
  }
  const detail = screen === 'conversation' || screen === 'new';
  const canSend = connected && !working && !staging && !!draft.trim() && (screen === 'new' ? newReady : (!!task?.canReply && task.messagesLoaded !== false));
  function outgoingPreview(messages: Outgoing[]): PendingOutgoing[] {
    return messages.filter(message =>
      (task?.messages.filter(m => m.role === 'user' && m.text === message.prompt).length || 0) < message.ordinal &&
      !task?.queue?.some(item => item.id === `phone:${message.id}`)).map(message =>
      ({ id: message.id, text: message.prompt, attachments: message.attachments, status: message.acknowledged ? undefined : message.uploadStatus || 'Sending…', sending: !message.acknowledged }));
  }
  return <main className="companion" data-screen={screen} data-native-dashboard={nativeDashboardContent && screen === 'dashboard' || undefined}
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
              <DropdownMenuItem disabled={actionsDisabled || typeof task?.pinned !== 'boolean'} onSelect={() => void threadAction(task?.pinned ? 'unpin' : 'pin')}>{task?.pinned ? 'Unpin' : 'Pin'} thread</DropdownMenuItem>
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
      <h1>{screen === 'dashboard' ? 'Dashboard' : screen === 'new' ? 'New thread' : 'Threads'}</h1>
      {connectionButton}
      {screen === 'dashboard' && <Button variant="ghost" onClick={() => setScreen('threads')}>Threads</Button>}
      {!detail && <Button variant="ghost" size="icon" aria-label="New thread" onClick={() => start()}><Plus /></Button>}
      </>}
    </header>}
    {showBanner && !(nativeDashboardContent && screen === 'dashboard') && <ConnectionBanner status={connection} client={client} onTryAgain={tryAgain} onPairAgain={onPairAgain} onDismiss={() => { setBannerDismissed(true); setDetailsOpen(false); setRecovered(false); }} onAwake={tryAgain}/>}
    {client.scheduleCommand && (screen === 'threads' || (screen === 'dashboard' && !nativeDashboardContent)) && <Button variant="ghost" onClick={()=>setSchedulesOpen(true)}>Schedules</Button>}
    <Dialog open={workspacesOpen} onOpenChange={setWorkspacesOpen}><DialogContent className="companion-workspaces"><DialogHeader><DialogTitle>Workspaces</DialogTitle><DialogDescription>Organize projects on your Mac and companions.</DialogDescription></DialogHeader>
      <WorkspaceSettings projects={data.projects} workspaces={data.workspaces || []} disabled={!connected || working || !client.saveWorkspaces || !data.workspaces} onSave={async next => {
        if (!client.saveWorkspaces || working || !connected) return;
        setWorking(true); setError('');
        try { await client.saveWorkspaces(next); setData(await client.snapshot(new AbortController().signal, snapshotThread)); return true; }
        catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        finally { setWorking(false); }
      }}/>
      {error && <p role="alert">{error}</p>}
    </DialogContent></Dialog>
    <Dialog open={schedulesOpen} onOpenChange={setSchedulesOpen}><DialogContent className="companion-schedules"><DialogHeader><DialogTitle>Schedules</DialogTitle><DialogDescription>Recurring work runs on your Mac while it is awake. Connect to manage it.</DialogDescription></DialogHeader><ScheduleManager db={{projects:data.projects,accounts:data.projects[0]?.assistants||[],schedules:data.schedules}} native={connected} command={client.scheduleCommand} onRefresh={async()=>{setData(await client.snapshot(new AbortController().signal,snapshotThread));}} onSelect={id=>{setSelected(id);setScreen('conversation');setSchedulesOpen(false);}}/></DialogContent></Dialog>
    {error && !(nativeDashboardContent && screen === 'dashboard') && <p className="companion-error" role="alert">{error}</p>}
    {!detail && screen !== 'dashboard' && <>
      <Button variant="ghost" onClick={() => setScreen('dashboard')}>Dashboard</Button>
      <div className="companion-search"><Search size={17} /><Input aria-label="Search threads" placeholder="Search projects and threads" value={query} onChange={e => {setQuery(e.target.value);setOlderPages({});}} /></div>
      <div className="companion-filters">
        {!!client.saveWorkspaces && !!data.workspaces && <Button variant="ghost" onClick={() => setWorkspacesOpen(true)}>Manage workspaces</Button>}
        {!!data.workspaces?.length && <select aria-label="Workspace filter" value={workspace} onChange={e => chooseWorkspace(e.target.value)}><option value="">All workspaces</option>{data.workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>}
        <select aria-label="Project filter" value={project} onChange={e => {setProject(e.target.value);setOlderPages({});}}><option value="">All projects</option>{scopedData.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select aria-label="Status filter" value={filter} onChange={e => {setFilter(e.target.value as ThreadFilter);setOlderPages({});}}><option value="all">All threads</option><option value="attention">Needs you</option><option value="running">{data.threadList?.ignoreUnread ? "Working" : "Running"}</option><option value="done">{data.threadList?.ignoreUnread ? "Done" : "Finished"}</option></select>
      </div>
    </>}
    <div className="companion-body-wrap">{nativeNew && !launchingNew.length ? home : <ScrollArea className="companion-body" viewportRef={viewport} viewportProps={{ onScroll: () => {
      const el = viewport.current;
      if (el) { const gap = el.scrollHeight - el.scrollTop - el.clientHeight; nearBottom.current = gap < 80; setShowLatest(gap > 200); }
    } }}>
      {screen === 'dashboard' ? <CompanionDashboard onOfficeExpandedChange={setOfficeExpanded} nativeCards={nativeShell} nativeContent={nativeDashboardContent} read={read} globalAssistant={dashboardAssistant} onGlobalAssistantChange={setDashboardAssistant} client={client} assistantSelections={newAssistants} onAssistantChange={(project, assistant) => setNewAssistants(old => ({ ...old, [project]: assistant }))}
        controls={controls} onSelectionChange={(key, selection) => setControls(old => ({ ...old, [key]: { selection, permission: old[key]?.permission || 'bypass' } }))}
        onDictation={(project, text, assistant) => { setDrafts(old => ({ ...old, new: [old.new, text].filter(Boolean).join('\n') })); startDashboard(project, assistant); void setNativeComposerText([drafts.new, text].filter(Boolean).join('\n')); }} snapshot={scopedData} connected={connected} onOpen={id => { setSelected(id); setScreen('conversation'); }} onNew={startDashboard} /> : screen === 'threads' ? <>{groups.map(group => <section key={group.id} className="companion-project-group" aria-label={`${group.project?.name || 'Project'} threads`}>
        <div className="companion-project-heading"><button className="companion-project-toggle" aria-expanded={!collapsedProjects[group.id]} onClick={() => setCollapsedProjects(old => ({ ...old, [group.id]: !old[group.id] }))}><ChevronDown size={14} style={{transform: collapsedProjects[group.id] ? "rotate(-90deg)" : undefined}}/><FolderGit2 size={16} style={{color:group.project?.color}}/><h2 title={group.project?.name} style={{color:group.project?.color}}>{group.project?.name || 'Project'}</h2></button><Button variant="ghost" size="icon" aria-label={`New task in ${group.project?.name || 'project'}`} disabled={!connected || !group.project?.canStart} onClick={() => start(group.id)}><Plus size={16}/></Button></div>
        {!collapsedProjects[group.id] && <>{group.active.map(row)}{older(group)}</>}
      </section>)}{!groups.length && <p className="companion-empty">{connected ? 'No threads match your filters.' : 'Check progress, reply, and start work from your iPhone. Your projects and conversations will appear when your Mac is connected.'}</p>}</> : screen === 'new' ? (nativeNew ? null : <div className="companion-new"><h2>What would you like to work on?</h2><p>Choose a coding assistant configured on your Mac.</p><label>Project<select aria-label="New thread project" value={newProject} disabled={working} onChange={e => { setNewProject(e.target.value); delete requestIds.current.new; }}><option value="">Choose a project</option>{scopedData.projects.map(p => <option key={p.id} value={p.id} disabled={!p.canStart}>{p.name}</option>)}</select></label>{newProjectData?.assistants && <label>Coding assistant<select aria-label="Coding assistant" value={assistant} disabled={!connected || working} onChange={e => { setNewAssistants(old => ({ ...old, [newProject]: e.target.value })); delete requestIds.current.new; }}><option value="" disabled>Choose a coding assistant</option>{newProjectData.assistants.map(a => <option key={a.id} value={a.id}>{assistantLabel(a)}</option>)}</select></label>}{!data.projects.some(p => p.canStart) && <p>Projects must be ready to run on your Mac.</p>}</div>) : task?.messagesLoaded === false ? <p className="companion-transcript-loading" role="status">Loading conversation…</p> : <ThreadTranscript readGeneratedFile={task && client.generatedFile ? (href, offset) => client.generatedFile!(task.id, href, offset) : undefined} key={task?.id} density="compact" messages={task?.messages || []} tasks={task?.tasks} active={!!task && ['starting', 'running', 'waiting'].includes(task.status)} pending={outgoingPreview(pendingMessages)}>{task?.error && <p role="alert">{task.error}</p>}{task?.pending && <fieldset disabled={!connected || working} key={JSON.stringify(task.pending.request_id ?? task.pending.id)}><Permission pending={task.pending} provider={task.provider || ''} onReply={respond} /></fieldset>}{task?.queueError && !task.queue?.length && <p role="alert">{task.queueError}</p>}{task && !task.canReply && !task.pending && !busyThread && !pendingMessages.length && <p>This thread cannot take replies. Start a new thread to continue.</p>}</ThreadTranscript>}
      {screen === 'conversation' && <ThreadActivity thread={task} connection={connection.state} />}
      {screen === 'conversation' && !!task?.queue?.length && <MessageQueue key={task.id} messages={task.queue} active={busyThread} paused={task.queuePaused} error={task.queueError} disabled={!connected || working || !client.queue} onAction={(action, message) => void queueAction(action, message)} />}
      {screen === 'new' && <ThreadTranscript density="compact" messages={[]} pending={outgoingPreview(outgoing.filter(m => !m.thread))} />}
    </ScrollArea>}
    {screen === 'conversation' && <button type="button" className="companion-latest" data-visible={showLatest} aria-label="Jump to latest message" tabIndex={showLatest ? 0 : -1} aria-hidden={!showLatest} onClick={() => viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: 'smooth' })}><ArrowDown size={18} /></button>}
    </div>
    {detail && !nativeNew && <div className="companion-compose-area">
      {screen === 'conversation' && task && <TodoPanel key={`todos-${task.id}`} messages={task.messages} active={['starting', 'running', 'waiting'].includes(task.status)}/>}
      {screen === 'conversation' && !nativeShell && <ConversationUsage usage={task?.usage}/>}

      {!nativeBar && <form className="companion-composer" onSubmit={e => void send(e)}>
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
          <AgentControls iconOnly key={controlKey} native={!!client.models} provider={provider} loadModels={client.models ? loadModels : undefined} value={selection} onChange={value => setControls(old => ({ ...old, [controlKey]: { selection: value, permission } }))} disabled={!connected || working}/>
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
