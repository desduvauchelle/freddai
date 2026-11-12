import { SubThreads } from "../desktop/commander/SubThreads";
import { selectionLevel } from '../desktop/model-levels';
import { chooseAssistantSettings } from './native-home';
import { ComposerAgentPicker } from "../desktop/ComposerAgentPicker";
import { ModelConfigurationSettings } from "../desktop/ModelConfigurationSettings";
import { CompanionCommandCard } from './CompanionCommandCard';
import { ProjectBrowser } from './ProjectBrowser';
import { DashboardCall, IDLE_CALL_STATE, END_CALL_EVENT, TOGGLE_MUTE_EVENT, DISMISS_REVIEW_EVENT, type DashboardCallState } from "../desktop/DashboardCall";
import { companionCallIo } from "./companion-call";
import { CompanionCall } from "./CompanionCall";
import { OrganizationSettings } from "./OrganizationSettings";
import { ProductUsageFooter } from "./ProductUsageFooter";
import { isCommanderThread } from "../commanderThreads";
import { countUnreflected, logClassified, logMisclassified, sendDisposition } from './send-disposition';
import { readOutbox, saveOutbox, retryableDelivery, retryDelayMs, queuedStatus, type Outgoing } from './outbox';
import { WorkspaceSettings } from '../desktop/WorkspaceSettings';
import '../workspace.css';
import { ProjectThreadList } from './ProjectThreadList';
import { useNavigationState } from '../hooks/use-navigation-state';
import { hasNativeDashboardContent } from './native-shell';
import { useNativeSummaries } from './native-summaries';
import { buildDashboardModel, dashboardAssistantFor, dashboardControlKey, type DashboardAction } from './native-dashboard';
import { setDashboard as setNativeDashboard, onDashboardAction } from './native-shell';
import { SchedulesScreen } from "./SchedulesScreen";
import { ConnectedAccounts } from "./ConnectedAccounts";
import { CompanionDashboard } from './CompanionDashboard';
import { ConnectionLoading } from './ConnectionLoading';
import { CommanderPanel, CommanderSheet, waitingCount, type CommanderTab } from './commander/CommanderChrome';
import { ThreadHeader } from './ThreadHeader';
import { useCommanderData } from './commander/useCommanderData';
import { browserThreadRecencyTracker } from "../thread-recency";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Pin, CalendarClock, ArrowDown, ArrowLeft, Menu, MoreHorizontal, Square, X, Paperclip, ArrowUp, FolderGit2, Plus, Search, Monitor, ChevronDown, ShieldAlert, ShieldCheck, Cpu, Bot, FolderPlus, Settings, LayoutDashboard } from 'lucide-react';
import { ActiveFilterChips, type ActiveFilterChip } from '../ActiveFilterChips';
import { Button } from '@freddai/ui/components/button';
import { RecentThreadsFooter } from '../RecentThreadsControls';
import { COMPANION_RECENT_PAGING, asThreadNavView, selectRecentThreads, type ThreadNavView } from '../recentThreads';
import { Input } from '@freddai/ui/components/input';
import { Textarea } from '@freddai/ui/components/textarea';
import { ScrollArea } from '@freddai/ui/components/scroll-area';
import { ConnectionBanner } from './ConnectionBanner';
import { ProjectReorderHandle } from './ProjectReorderHandle';
import { formatProjectName } from '../projectName';
import { companionStatusRead, disconnectedClient, scopeCompanion, selectThreads, groupCompanionThreads, type CompanionThread, type CompanionClient, type CompanionSnapshot, type ThreadFilter } from './companion';
import { ThreadTranscript, type PendingOutgoing } from '../conversation/ThreadTranscript';
import { ThreadLinksProvider } from '../conversation/ThreadLinksContext';
import { PreviewContext } from '../conversation/localhostPreview';
import { previewOpen } from './native-client';
import { TodoPanel } from '../conversation/TodoList';
import { groupThreadsByDay, threadListStatus } from '../desktop/types';
import { Permission } from '../desktop/AgentRequest';
import { useSystemAppearance } from '../appearance/use-system-appearance';
import { MascotHero } from '../desktop/MascotScenes';
import { ThreadActivity, companionActivity } from './ThreadActivity';
import { MessageQueue } from './MessageQueue';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@freddai/ui/components/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@freddai/ui/components/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@freddai/ui/components/sheet';
import { ConversationUsage } from '../desktop/ConversationUsage';
import { PermissionSelect } from '../desktop/PermissionSelect';
import { defaultSelection, type AgentSelection, type Model } from '../desktop/agent-selection';
import { providerName } from '../desktop/types';
import type { Attachment, PermissionMode } from '../desktop/types';
import './mobile.css';
import { useConnectionStatus } from './use-connection-status';
import { describeConnection } from './connection-status';
import { useNativeShell, setMode as setNativeModeRaw, type NativeMode, setComposerText as setNativeComposerText, discardFiles as discardNativeFiles, setVoice as setNativeVoice, appendComposerText as appendNativeComposerText, onVoiceRecorded, onVoiceError, pickOption, type NativeFile, type RecordedDraft, onNavBack, onComposerSend, setConnection as setNativeConnection, onConnectionTap, setThreads as setNativeThreads, setThreadMeta as setNativeThreadMeta, onThreadAction, onSelectThread, onSearch, onSetFilter, onNewThread, onMoveProject, onShowOlder, onShowLess, onSetView, onRecentPage, onDashboard } from './native-shell';
import { migrateLocalRead, readFromThreads } from '../read-sync';
import { buildThreadsModel, companionThreadFaded, bumpOlderPage, createChangeSender, createThreadActionHandler, nativeRunState, createThreadEventHandlers } from './native-threads';
import type { PickerOption } from './native-shell';
import { assistantOptions, assistantLabel, attachmentLimitError, chooseSelection, modelPillLabel, pickNewProject, PERMISSION_OPTIONS, permissionLabel, projectOptions, saveLastProject, savedLastProject, saveLastAssistant, lastAssistantFor, savedControls, saveControls, supportsPermissions } from './native-home';
function savedDrafts(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem('freddai.companion.drafts') || '{}'); } catch { return {}; }
}
function Pill({ icon, label, value, onClick, disabled }: { icon: ReactNode; label: string; value: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="companion-pill" aria-label={`${label}: ${value}`} disabled={disabled} onClick={onClick}>
    {icon}<span className="companion-pill-value">{value}</span><ChevronDown size={13} aria-hidden="true"/>
  </button>;
}
const initial: CompanionSnapshot = { projects: [], threads: [] };

export function MobileApp({ client = disconnectedClient, onPairAgain, desktop = false, deviceSettings }: { client?: CompanionClient; onPairAgain?: () => void; desktop?: boolean; deviceSettings?: ReactNode }) {
  useSystemAppearance();
  const [navigatorOpen, setNavigatorOpen] = useState(true);
  const [data, setData] = useState(initial), [error, setError] = useState(''), [loaded, setLoaded] = useState(false);
  const { status: connection, connected, attempt, succeeded, failed, nextDelay } = useConnectionStatus();
  const attemptReason = useRef<'poll' | 'manual' | 'foreground'>('poll'), [recovered, setRecovered] = useState(false), previousState = useRef(connection.state);
  const [bannerDismissed, setBannerDismissed] = useState(false), [detailsOpen, setDetailsOpen] = useState(false);
  const [project, setProject] = useState(''), [query, setQuery] = useState(''), [filter, setFilter] = useState<ThreadFilter>('all');
  const [projectBrowserOpen, setProjectBrowserOpen] = useState(false);
  const [workspacesOpen, setWorkspacesOpen] = useState(false);
  const [workspace, setWorkspace] = useState(() => { try { return localStorage.getItem('freddai.companion.workspace') || ''; } catch { return ''; } });
  const scopedData = scopeCompanion(data, workspace);
  const projectName = (name: string | null | undefined) => formatProjectName(name, data.threadList?.projectNameUppercase);
  function chooseWorkspace(id: string) {
    if (id === '__manage_workspaces') { setWorkspacesOpen(true); return; }
    setWorkspace(id); setProject(''); setQuery(''); setFilter('all'); setOlderPages({});
    try { localStorage.setItem('freddai.companion.workspace', id); } catch { /* Optional local preference. */ }
  }
  useEffect(() => { if (loaded && workspace && !data.workspaces?.some(w => w.id === workspace)) chooseWorkspace(''); }, [loaded, workspace, data.workspaces]);
  const navigationRevision = useRef(0);
  const [screen, setScreenState] = useNavigationState<'threads' | 'conversation' | 'new' | 'dashboard' | 'project' | 'schedules'>(desktop ? 'dashboard' : 'threads', navigationRevision), [selected, setSelected] = useNavigationState('', navigationRevision);
  const snapshotThread = screen === 'conversation' ? selected : undefined;
  const [drafts, setDrafts] = useState<Record<string, string>>(savedDrafts), [newProject, setNewProject] = useState(''), [working, setWorking] = useState(false), [retry, setRetry] = useState(0);
  // Presentation belongs to the entry point, never to the conversation screen itself.
  const [threadSheet, setThreadSheet] = useState(false);
  const sheetReturn = useRef<{ screen: typeof screen; selected: string } | null>(null);
  // Project sheet: list -> conversation inside one sheet. `thread` is set while a conversation from the list is open.
  const [projectSheet, setProjectSheet] = useState<{ project: string; thread: string | null } | null>(null);
  const setScreen: typeof setScreenState = useCallback(next => {
    sheetReturn.current = null;
    setThreadSheet(false);
    setProjectSheet(null);
    setScreenState(next);
  }, [setScreenState]);
  function openThreadSheet(id: string) {
    if (desktop) { setSelected(id); setScreen('conversation'); return; }
    if (!sheetReturn.current) sheetReturn.current = { screen, selected };
    setSelected(id);
    setScreenState('conversation');
    setThreadSheet(true);
  }
  /** Opens a project's thread list as a sheet over the retained dashboard. Never goes through setScreen('dashboard'). */
  function openProjectSheet(id: string) {
    if (!sheetReturn.current) sheetReturn.current = { screen, selected };
    setProjectSheet({ project: id, thread: null });
    setScreenState('project');
    setThreadSheet(true);
  }
  function openProjectSheetThread(id: string) {
    setSelected(id);
    setProjectSheet(sheet => sheet && { ...sheet, thread: id });
    setScreenState('conversation');
  }
  function backToProjectList() {
    setProjectSheet(sheet => sheet && { ...sheet, thread: null });
    setScreenState('project');
  }
  function sheetBack() {
    // Swiping the native review sheet away reports navBack, which cancels the review exactly like the X button.
    if (dashboardReviewingRef.current) { window.dispatchEvent(new Event(DISMISS_REVIEW_EVENT)); return; }
    if (projectSheet?.thread) backToProjectList(); else closeThreadSheet();
  }
  function closeThreadSheet() {
    const destination = sheetReturn.current;
    setScreen(destination?.screen ?? (screen === 'dashboard' ? 'new' : 'dashboard'));
    if (destination) setSelected(destination.selected);
  }
  const threadSheetRef = useRef(false);
  threadSheetRef.current = threadSheet;
  /** Opens the new-thread composer as a sheet over the native dashboard, so swiping down returns to it. */
  function openNewSheet() {
    if (!sheetReturn.current) sheetReturn.current = { screen, selected };
    setProjectSheet(null);
    setScreenState('new');
    setThreadSheet(true);
  }
  const dashboardRetained = screen === 'dashboard' || (threadSheet && sheetReturn.current?.screen === 'dashboard');
  const sheetBackRef = useRef(sheetBack);
  sheetBackRef.current = sheetBack;
  // Read state lives on the Mac host (`read_at` per thread, shared with the desktop); the overlay bridges the gap until the next snapshot.
  const [readOverlay, setReadOverlay] = useState<Record<string, number>>({});
  const actualRead = readFromThreads(data.threads, readOverlay);
  const read = companionStatusRead(data, actualRead);
  const [dashboardAssistant, setDashboardAssistant] = useState('');
  const [officeHeight, setOfficeHeight] = useState(240);
  const [officeExpanded, setOfficeExpanded] = useState(false);
  useEffect(() => { if (screen !== 'dashboard') setOfficeExpanded(false); }, [screen]);
  const [dashboardBusy, setDashboardBusy] = useState(false);
  const dashboardInFlight = useRef(false);
  // Each recording keeps its card busy from transcription through host acknowledgement.
  const [transcribing, setTranscribing] = useState<Record<string, string>>({});
  const clearTranscribing = (id: string) => setTranscribing(old => {
    if (!(id in old)) return old;
    const next = { ...old }; delete next[id]; return next;
  });
  const dashboardSends = useRef(new Map<string, string>());
  const dashboardContext = useRef({ screen, drafts });
  dashboardContext.current = { screen, drafts };
  const [newAssistants, setNewAssistants] = useState<Record<string, string>>({});
  const [outgoing, setOutgoing] = useState<Outgoing[]>(readOutbox);
  const dictationDestinations = useRef(new Map<string, { id: string; thread?: string }>());
  const transcriptionTail = useRef(Promise.resolve());
  const transcriptionPending = useRef(0);
  const dictationSequence = useRef(0);
  const dictationView = useRef('');
  const dictationLive = useRef(true);
  useEffect(() => { dictationLive.current = true; return () => { dictationLive.current = false; }; }, []);
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [olderPages, setOlderPages] = useState<Record<string, number>>({});
  const [navView, setNavViewState] = useState<ThreadNavView>(() => { try { return asThreadNavView(localStorage.getItem('freddai.companion.threadNavView')); } catch { return 'projects'; } });
  const [recentPages, setRecentPages] = useState(0);
  // The always-visible Recent section at the bottom of the Projects view pages independently (5, +10).
  const [sectionPages, setSectionPages] = useState(0);
  // Paging is relative to the current result set, so any search/filter/workspace change starts over at the first page.
  useEffect(() => { setRecentPages(0); setSectionPages(0); }, [query, project, filter, workspace]);
  function setNavView(view: ThreadNavView) {
    setNavViewState(view); setRecentPages(0); setSectionPages(0);
    try { localStorage.setItem('freddai.companion.threadNavView', view); } catch { /* Optional local preference. */ }
  }
  const schedulesFrom = useRef<'threads' | 'dashboard'>('threads');
  const openSchedules = () => { schedulesFrom.current = screen === 'dashboard' ? 'dashboard' : 'threads'; setScreen('schedules'); };
  const [googleOpen,setGoogleOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [controls, setControls] = useState<Record<string, { selection: AgentSelection; permission: PermissionMode }>>(() => Object.fromEntries(Object.entries(savedControls()).map(([key, selection]) => [key, { selection, permission: 'bypass' as PermissionMode }])));
  useEffect(() => { saveControls(controls); }, [controls]);
  const [attachments, setAttachments] = useState<Record<string, Attachment[]>>({});
  const [staging, setStaging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const backSwipe = useRef<{ x: number; y: number } | null>(null);
  const [showLatest, setShowLatest] = useState(false);
  const requestIds = useRef<Record<string, string>>({});
  const deliveryNavigation = useRef<Record<string, number>>({});
  const [trackThreadRecency] = useState(browserThreadRecencyTracker);
  // iOS native shell: the header and composer of a conversation are native UIKit views around this webview.
  const nativeShell = useNativeShell();
  const newCallRequest = useRef<string | null>(null);
  const [threadCallActive, setCallActive] = useState(false);
  const [dashboardCallActive, setDashboardCallActive] = useState(false);
  const [dashboardCall, setDashboardCall] = useState<DashboardCallState>(IDLE_CALL_STATE);
  // While the Commander review card is open on native, the web view is presented in the native page sheet (mode 'callReview').
  const [dashboardReviewing, setDashboardReviewing] = useState(false);
  const dashboardCallRef = useRef(dashboardCall);
  dashboardCallRef.current = dashboardCall;
  /** Every native mode change carries the current dashboard call state so the native header indicator never resets. */
  const setNativeMode = (mode: NativeMode, options: Parameters<typeof setNativeModeRaw>[1] = {}) => setNativeModeRaw(mode, { ...options, call: options.call ?? dashboardCallRef.current });
  const dashboardReviewingRef = useRef(false);
  dashboardReviewingRef.current = dashboardReviewing;
  const callActive = threadCallActive || dashboardCallActive;
  const dashboardCallIo = useMemo(() => companionCallIo(client), [client, nativeShell]);
  const callActiveRef = useRef(callActive);
  callActiveRef.current = callActive;
  useEffect(() => { if (!callActive) newCallRequest.current = null; }, [callActive]);
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
  const startingMessages = pendingMessages.filter(m => !m.blocked && m.startsTurn &&
    (snapshotTask?.messages.filter(item => item.role === 'user' && item.text === m.prompt).length || 0) < m.ordinal);
  const task = snapshotTask && startingMessages.length && !snapshotTask.pending &&
    !snapshotTask.queuePaused && !snapshotTask.queueError &&
    (startingMessages.some(m => !m.acknowledged) || !['failed', 'interrupted'].includes(snapshotTask.status))
    ? { ...snapshotTask, status: ['running', 'waiting'].includes(snapshotTask.status) ? snapshotTask.status : 'starting',
        queue: snapshotTask.queue?.filter(item => !startingMessages.some(m => `phone:${m.id}` === item.id)),
        queued: Math.max(0, snapshotTask.queued - (snapshotTask.queue?.filter(item => startingMessages.some(m => `phone:${m.id}` === item.id)).length || 0)) }
    : snapshotTask;
  const key = screen === 'new' ? 'new' : selected;
  // Commander-in-Chief is the conversation of the project marked kind 'commander'; its header avatar opens a bottom sheet (To-dos, Notes, Waiting) over the normal chat.
  const commanderProject = data.projects.find(p => p.kind === 'commander');
  const isCommander = !!commanderProject && screen === 'conversation' && task?.project === commanderProject.id;
  const [commanderTab, setCommanderTab] = useState<CommanderTab>('waiting'), [sheetOpen, setSheetOpen] = useState(false);
  const commanderOnDashboard = nativeShell && dashboardRetained && !!commanderProject;
  const commanderData = useCommanderData(client, (isCommander || commanderOnDashboard || dashboardCallActive) && connected, { lists: isCommander });
  const [callCommander, setCallCommander] = useState<CompanionThread | undefined>();
  const [callSyncError, setCallSyncError] = useState('');
  useEffect(() => {
    if (!dashboardCallActive || !connected || !commanderData.state?.thread_id) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await client.snapshot(abort.signal, commanderData.state!.thread_id!);
        if (!abort.signal.aborted) { setCallCommander(next.threads.find(t => t.id === commanderData.state!.thread_id)); setCallSyncError(''); }
      } catch (error) { if (!abort.signal.aborted) setCallSyncError(`Call replies: ${String(error)}`); }
      finally { if (!abort.signal.aborted) timer = setTimeout(poll, 2000); }
    };
    void poll();
    return () => { abort.abort(); clearTimeout(timer); setCallCommander(undefined); };
  }, [dashboardCallActive, connected, client, commanderData.state?.thread_id]);
  const commanderThreadId = async () => (await client.commander?.state())?.thread_id;
  async function openCommander() {
    if (!commanderProject) return;
    setSheetOpen(false);
    try {
      const id = await commanderThreadId();
      if (id) { setSelected(id); setScreen('conversation'); }
      else { setNewProject(commanderProject.id); setScreen('new'); }
    } catch (e) { setError(`Couldn't open Commander: ${e instanceof Error ? e.message : String(e)}`); }
  }
  async function sendToCommander(text: string) {
    if (!commanderProject) throw new Error('Commander is not available on your Mac yet.');
    const id = await commanderThreadId(), requestId = crypto.randomUUID();
    if (id) await client.reply({ thread: id, prompt: text, requestId });
    else await client.start({ project: commanderProject.id, prompt: text, requestId });
    setRetry(v => v + 1);
  }
  const draft = drafts[key] || '';
  const newProjectData = data.projects.find(p => p.id === newProject);
  const assistant = newAssistants[newProject] || lastAssistantFor(newProjectData) || newProjectData?.defaultAssistant || '';
  const selectedAssistant = newProjectData?.assistants?.find(a => a.id === assistant);
  const newReady = !!newProjectData?.canStart && (!newProjectData.assistants || !!selectedAssistant);
  const conversationProject = data.projects.find(p => p.id === task?.project);
  const conversationAgent = controls[selected]?.selection.agent || task?.agent || '';
  const conversationAssistant = conversationProject?.assistants?.find(a => a.id === conversationAgent);
  const provider = screen === 'new' ? selectedAssistant?.provider || newProjectData?.provider : conversationAssistant?.provider || task?.provider;
  const controlKey = screen === 'new' ? `new:${newProject}:${assistant}:${provider || ''}` : selected;
  const selection = controls[controlKey]?.selection || (screen === 'new' ? defaultSelection : { model: task?.options?.model || '', effort: task?.options?.effort || 'default', speed: task?.options?.speed === 'fast' ? 'fast' : undefined });
  const permission = controls[controlKey]?.permission || (screen === 'new' ? 'bypass' : task?.options?.permission_mode || 'ask');
  const files = attachments[key] || [];
  const loadModels = useCallback(() => client.models!(screen === 'new' ? { project: newProject, assistant: assistant || undefined } : { thread: selected, assistant: conversationAgent || undefined }), [client, screen, newProject, assistant, selected, conversationAgent]);
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
  async function queueAction(action: 'pause' | 'resume' | 'delete' | 'clear' | 'steer' | 'edit', message?: string, prompt?: string) {
    if (!client.queue || !connected || working) return;
    const thread = selected;
    setWorking(true); setError('');
    try { await client.queue({ thread, action, message, prompt }); setRetry(v => v + 1); return true; }
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
        snapshotAt.current = Date.now();
        for (const [id, c] of classifiedBubbles.current) {
          const t = next.threads.find(x => x.id === c.thread);
          const queueIndex = t?.queue?.findIndex(item => item.id === `phone:${id}`) ?? -1;
          if (t && queueIndex >= 0 && !misclassWarned.current.has(id)) {
            misclassWarned.current.add(id);
            logMisclassified({ env: 'mobile', thread: c.thread, id, disposition: 'bubble', status: t.status, queued: t.queued, queuePaused: !!t.queuePaused, queueIndex, queueLength: t.queue?.length ?? 0, unreflectedLocal: countUnreflected(live.current.outgoing.filter(m => m.id !== id), c.thread, t.messages), snapshotAgeMs: 0 });
          } else if (Date.now() - c.at > 120_000 && !live.current.outgoing.some(m => m.id === id)) classifiedBubbles.current.delete(id);
        }
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
    window.addEventListener('online', foreground);
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', foreground); window.removeEventListener('online', foreground); };
  }, [client, retry, snapshotThread, attempt, succeeded, failed, nextDelay]);
  async function send(e?: FormEvent, nativeText?: string, nativeFiles: NativeFile[] = []) {
    e?.preventDefault();
    const fromNative = nativeText !== undefined;
    const prompt = fromNative ? nativeText : draft;
    // The native composer clears itself on send, so a rejected send must hand the text back.
    const reject = (message: string) => { if (fromNative) { void setNativeComposerText(prompt, nativeFiles); setError(message); } };
    if (working || staging || !prompt.trim()) { reject(!connected ? 'Your Mac is disconnected. Message not sent.' : 'Another action is in progress. Message not sent.'); return; }
    const isNew = screen === 'new';
    if (isNew ? !newReady : !task?.canReply || task.messagesLoaded === false) { reject(isNew ? 'Choose a project and coding agent that are ready on your Mac. Message not sent.' : 'This thread cannot take a reply right now. Message not sent.'); return; }
    const limit = attachmentLimitError(nativeFiles);
    if (limit || (nativeFiles.length && !client.attachPath)) { reject(limit || 'Attachments are not available in this build. Message not sent.'); return; }
    const sentKey = key;
    // A retry of the same native text keeps its request id; different text gets a new one.
    const signature = JSON.stringify([prompt, nativeFiles.map(file => file.path)]);
    if (fromNative && nativePrompts.current[sentKey] !== signature) delete requestIds.current[sentKey];
    if (fromNative) nativePrompts.current[sentKey] = signature;
    const requestId = requestIds.current[sentKey] ||= crypto.randomUUID();
    // Native files show in the pending bubble right away; their real ids come from the upload below.
    const sentFiles: Attachment[] = fromNative ? nativeFiles.map(file => ({ id: file.path, name: file.name, bytes: file.bytes, mime: file.mime, sha256: '' })) : files;
    const baseOptions = { agent: selection.agent, model: selection.model.trim() || null, effort: selection.effort === 'default' ? null : selection.effort, speed: selection.speed === 'fast' ? 'fast' : null, permission_mode: provider === 'codex' || provider === 'claude' ? permission : undefined, update_agent_controls: true };
    const matching = task?.messages.filter(m => m.role === 'user' && m.text === prompt).length || 0;
    const ordinal = isNew ? 1 : Math.max(matching, ...outgoing.filter(m => m.thread === selected && m.prompt === prompt).map(m => m.ordinal)) + 1;
    const message: Outgoing = { id: requestId, thread: isNew ? '' : selected, project: isNew ? newProject : task!.project, prompt, ordinal, startsTurn: classifySend(isNew ? '' : selected, requestId, { isNew }), acknowledged: false, attachments: sentFiles, nativeFiles, assistant: assistant || undefined, options: baseOptions };
    try { saveOutbox([...outgoing, message]); }
    catch { reject('Could not save the message on this device. Free storage and try again.'); setError('Could not save the message on this device.'); return; }
    deliveryNavigation.current[requestId] = navigationRevision.current;
    if (isNew) saveLastAssistant(message.project, message.assistant);
    setOutgoing(old => [...old, message]); trackLive(message);
    nearBottom.current = true;
    if (!fromNative) { setDrafts(old => ({ ...old, [sentKey]: '' })); setAttachments(old => ({ ...old, [sentKey]: [] })); }
    delete requestIds.current[sentKey];
    setError('');
  }
  useEffect(() => {
    for (const [id, name] of [...dashboardSends.current]) {
      const item = outgoing.find(m => m.id === id);
      if (item?.acknowledged) dashboardSends.current.delete(id);
      else if (item?.blocked) {
        dashboardSends.current.delete(id);
        console.warn('[voice]', 'dashboard send blocked', { project: name, error: item.deliveryError });
        setError(`Couldn't send to ${name}: ${item.deliveryError || 'delivery failed'}`);
      }
    }
  }, [outgoing]);
  const deliveryInFlight = useRef(false);
  const [delivering, setDelivering] = useState('');
  const [deliveryTick, setDeliveryTick] = useState(0);
  const retryAt = useRef(0);
  const deliveryToken = useRef(0);
  useEffect(() => { try { saveOutbox(outgoing); } catch { setError('Message queue storage is full. Keep this app open until messages are delivered.'); } }, [outgoing]);
  // 1s clock while anything is unsent: drives the backoff timer and the "retrying in Ns" status.
  const hasUnsent = outgoing.some(item => !item.acknowledged);
  useEffect(() => {
    if (!hasUnsent) return;
    const timer = setInterval(() => setDeliveryTick(value => value + 1), 1_000);
    return () => clearInterval(timer);
  }, [hasUnsent]);
  // Network path change, foreground, focus and host reconnect all retry immediately and reset the backoff.
  const retryNow = useCallback((reason: string) => {
    if (!hasUnsent) return;
    console.info('[companion-outbox]', JSON.stringify({ event: 'retry_trigger', reason, online: navigator.onLine }));
    retryAt.current = 0;
    setOutgoing(old => old.map(m => m.acknowledged ? m : { ...m, retryAt: undefined }));
    setDeliveryTick(value => value + 1);
  }, [hasUnsent]);
  useEffect(() => {
    const online = () => retryNow('online');
    const foreground = () => { if (document.visibilityState === 'visible') retryNow('foreground'); };
    const focus = () => retryNow('focus');
    window.addEventListener('online', online); window.addEventListener('focus', focus); document.addEventListener('visibilitychange', foreground);
    const network = (navigator as Navigator & { connection?: EventTarget }).connection;
    network?.addEventListener('change', online);
    return () => { window.removeEventListener('online', online); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', foreground); network?.removeEventListener('change', online); };
  }, [retryNow]);
  const wasConnected = useRef(connected);
  useEffect(() => { if (connected && !wasConnected.current) retryNow('host-reconnected'); wasConnected.current = connected; }, [connected, retryNow]);
  useEffect(() => {
    const message = outgoing.find(item => !item.acknowledged);
    if (!message || message.replyTo || message.blocked || !connected || deliveryInFlight.current || Date.now() < retryAt.current) return;
    deliveryInFlight.current = true;
    const token = ++deliveryToken.current;
    const attempt = (message.attempts ?? 0) + 1;
    const startedAt = Date.now();
    const log = (result: string, error?: string) => console.info('[companion-outbox]', JSON.stringify({ event: 'delivery_attempt', id: message.id, attempt, thread: message.thread || null, files: (message.nativeFiles?.length ?? 0) + message.attachments.length, connected, online: navigator.onLine, relayHint: connection.state, result, error, ms: Date.now() - startedAt }));
    setDelivering(message.id);
    setOutgoing(old => old.map(m => m.id === message.id ? { ...m, attempts: attempt } : m));
    const revision = deliveryNavigation.current[message.id];
    // A dead socket after a network switch must not wedge the queue: abandon the attempt and retry (the host dedupes by request id).
    const watchdog = setTimeout(() => {
      if (deliveryToken.current !== token) return;
      deliveryToken.current++; deliveryInFlight.current = false; setDelivering('');
      const deliveryError = 'No response from your Mac after 120s';
      log('watchdog_timeout', deliveryError);
      retryAt.current = Date.now() + retryDelayMs(attempt);
      setOutgoing(old => old.map(m => m.id === message.id ? { ...m, uploadStatus: undefined, deliveryError, retryAt: retryAt.current } : m));
    }, 120_000);
    void (async () => {
      try {
        const sentFiles = [...message.attachments];
        for (const [index, file] of (message.nativeFiles || []).entries()) {
          setOutgoing(old => old.map(m => m.id === message.id ? { ...m, uploadStatus: `Uploading ${index + 1} of ${message.nativeFiles!.length}: ${file.name}…` } : m));
          uploaded.current[file.path] ||= await client.attachPath!(file);
          sentFiles[index] = uploaded.current[file.path];
        }
        setOutgoing(old => old.map(m => m.id === message.id ? { ...m, uploadStatus: undefined } : m));
        const options = { ...message.options, attachments: sentFiles.map(file => file.id) };
        const existing = message.thread || (data.projects.find(p => p.id === message.project)?.kind === 'commander' ? await commanderThreadId() : null);
        const thread = existing || await client.start({ project: message.project, assistant: message.assistant, prompt: message.prompt, requestId: message.id, options });
        if (existing) await client.reply({ thread, prompt: message.prompt, requestId: message.id, options });
        for (const destination of dictationDestinations.current.values()) {
          if (destination.id === message.id) destination.thread = thread;
        }
        setOutgoing(old => old.map(m => m.id === message.id ? { ...m, thread, acknowledged: true, uploadStatus: undefined, deliveryError: undefined }
          : m.replyTo === message.id ? { ...m, thread, replyTo: undefined } : m));
        if (!message.thread && navigationRevision.current === revision) {
          // From the new-thread sheet, stay in the sheet and show the conversation; otherwise navigate as before.
          if (threadSheetRef.current) { setSelected(thread); setScreenState('conversation'); }
          else { setSelected(thread); setScreen('conversation'); }
        }
        if (message.nativeFiles?.length) void discardNativeFiles(message.nativeFiles.map(file => file.path)).catch(console.error);
        log('ok');
        retryAt.current = 0;
        setRetry(v => v + 1);
      } catch (e) {
        const deliveryError = e instanceof Error ? e.message : String(e);
        if (deliveryToken.current !== token) { log('late_failure_ignored', deliveryError); return; }
        if (!retryableDelivery(deliveryError)) {
          log('blocked', deliveryError);
          setOutgoing(old => old.map(m => m.id === message.id ? { ...m, uploadStatus: undefined, deliveryError, blocked: true } : m));
          return;
        }
        log('retryable_failure', deliveryError);
        retryAt.current = Date.now() + retryDelayMs(attempt);
        setOutgoing(old => old.map(m => m.id === message.id ? { ...m, uploadStatus: undefined, deliveryError, retryAt: retryAt.current } : m));
      } finally {
        clearTimeout(watchdog);
        if (deliveryToken.current === token) { deliveryInFlight.current = false; setDelivering(''); }
      }
    })();
  }, [outgoing, connected, client, deliveryTick]);

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
  // Latest values for send sites that run after an await (dictation, voice call): classification must use
  // the state at delivery time, not the render that started the recording.
  const live = useRef<{ task: typeof task; outgoing: Outgoing[]; threads: typeof data.threads; selected: string }>({ task, outgoing, threads: data.threads, selected });
  live.current = { task, outgoing, threads: data.threads, selected };
  const snapshotAt = useRef(0);
  /** Make a just-queued message visible to the next classification before React re-renders. */
  const trackLive = (message: Outgoing) => { live.current.outgoing = [...live.current.outgoing, message]; };
  // Messages classified 'bubble' at send time, watched for later showing up in the host queue (see the snapshot effect).
  const classifiedBubbles = useRef(new Map<string, { thread: string; at: number }>());
  const misclassWarned = useRef(new Set<string>());
  /** The single send-time classification used by every mobile send site. Logs one structured line. */
  function classifySend(thread: string, id: string, opts: { isNew?: boolean; extraInFlight?: number } = {}): boolean {
    const { task: liveTask, outgoing: liveOutgoing, threads, selected: liveSelected } = live.current;
    const target = thread ? (thread === liveSelected ? liveTask : threads.find(t => t.id === thread)) : undefined;
    const unreflectedLocal = (opts.isNew ? 0 : countUnreflected(liveOutgoing, thread, target?.messages)) + (opts.extraInFlight ?? 0);
    const queued = Math.max(target?.queued ?? 0, target?.queue?.length ?? 0);
    const disposition = sendDisposition({ isNewThread: opts.isNew, status: target?.status, queued, queuePaused: target?.queuePaused, queueError: target?.queueError, unreflectedLocal });
    logClassified({ env: 'mobile', thread, id, disposition, status: target?.status, queued, queuePaused: !!target?.queuePaused, unreflectedLocal, ...(snapshotAt.current ? { snapshotAgeMs: Date.now() - snapshotAt.current } : {}) });
    if (disposition === 'bubble') classifiedBubbles.current.set(id, { thread, at: Date.now() });
    return disposition === 'bubble';
  }
  const nativeConversation = nativeShell && screen === 'conversation';
  const nativeNew = nativeShell && screen === 'new';
  // Commander and (in the native shell) every regular thread share the translucent floating header; the native bar draws the buttons on its row.
  const floatingHeader = isCommander || nativeConversation;
  useEffect(() => { if (!isCommander) setSheetOpen(false); }, [isCommander]);

  // Model catalog for the native pills (only Codex has one; Claude uses fixed aliases, like AgentControls).
  const modelKey = `${screen === 'new' ? `new:${newProject}:${assistant}` : `${selected}:${conversationAgent}`}:${provider || ''}`;
  useEffect(() => {
    if (!(nativeNew || nativeConversation) || provider !== 'codex' || !client.models || !connected) return;
    let live = true;
    loadModels().then(list => { if (live) setModels({ key: modelKey, list }); })
      .catch(e => { if (live) setError(`Couldn’t load models: ${e instanceof Error ? e.message : String(e)}`); });
    return () => { live = false; };
  }, [nativeNew, nativeConversation, provider, modelKey, connected, client, loadModels]);
  const modelList = models.key === modelKey ? models.list : [];
  const pickerBusy = !connected || working;
  async function choose(title: string, options: PickerOption[], selected?: string): Promise<string | null> {
    try { return await pickOption({ title, options, selected }); }
    catch (e) { setError(`Native shell: ${e instanceof Error ? e.message : String(e)}`); return null; }
  }
  async function pickProject() {
    const id = await choose('Project', projectOptions(scopedData.projects, data.threadList?.projectNameUppercase), newProject);
    if (id && id !== newProject) { setNewProject(id); delete requestIds.current.new; }
  }
  async function pickAssistant() { await pickComposerSettings(); }
  async function pickComposerSettings() {
    const project = screen === 'new' ? newProjectData : conversationProject;
    const current = screen === 'new' ? assistant : conversationAgent;
    const picked = await chooseAssistantSettings(choose, project?.assistants || [], current, false, data.modelConfiguration);
    if (!picked) return;
    const nextProvider = project?.assistants?.find(a => a.id === picked.agent)?.provider || provider;
    const catalog = picked.model === '__custom' && client.models ? await client.models(screen === 'new' ? { project: newProject, assistant: picked.agent } : { thread: selected, assistant: picked.agent }) : [];
    const result = picked.model === '__custom' ? await chooseSelection(choose, nextProvider, catalog, selection, data.modelConfiguration, true) : { model: picked.model, effort: 'default' };
    if (!result) return;
    const { model, effort, speed } = result;
    const key = screen === 'new' ? `new:${newProject}:${picked.agent}:${nextProvider || ''}` : controlKey;
    if (screen === 'new') { rememberAssistant(newProject, picked.agent); delete requestIds.current.new; }
    setControls(old => ({ ...old, [key]: { permission, selection: { agent: picked.agent, model, effort, speed } } }));
  }
  async function pickModel() {
    const result = await chooseSelection(choose, provider, modelList, selection, data.modelConfiguration);
    if (!result) return;
    setControls(old => ({ ...old, [controlKey]: { selection: { ...selection, ...result }, permission } }));
  }
  async function pickPermission() {
    const mode = await choose('Permissions', PERMISSION_OPTIONS, permission);
    if (mode === 'ask' || mode === 'bypass') setControls(old => ({ ...old, [controlKey]: { selection, permission: mode } }));
  }
  const rememberAssistant = (project: string, id: string) => { setNewAssistants(old => ({ ...old, [project]: id })); saveLastAssistant(project, id); };
  const launchingNew = outgoing.filter(m => !m.thread);
  const home = <div className="companion-home">
    {!loaded ? <ConnectionLoading down={connection.state === 'down'} /> : <MascotHero line="What should we work on today?" size={112}/> }
    {loaded && <div className="companion-pills" role="group" aria-label="New thread options">
      <Pill icon={<FolderGit2 size={14}/>} label="Project" value={projectName(newProjectData?.name) || (loaded ? 'Choose a project' : connection.state === 'down' ? 'Waiting for your Mac' : 'Loading…')} disabled={pickerBusy || !data.projects.length} onClick={() => void pickProject()}/>
      {(provider || newProjectData?.assistants) && <Pill icon={<Bot size={14}/>} label="Coding agent" value={selectedAssistant ? assistantLabel(selectedAssistant) : provider ? providerName(provider) : 'Choose a coding agent'} disabled={pickerBusy || !newProjectData?.assistants?.length} onClick={() => void pickAssistant()}/>}
    </div>}
    {loaded && !newProjectData && <p className="new-thread-project-required" role="status">Choose a project above to send your message.</p>}
    {loaded && !data.projects.some(p => p.canStart) && <p className="companion-home-note">Projects must be ready to run on your Mac.</p>}
  </div>;
  // Conversation and New thread get the native bar + drawer; the web threads screen exists only outside the native shell.
  const nativeBar = nativeShell && screen !== 'threads';
  const nativeTitle = task?.title || 'Conversation';
  const projectSheetName = projectName(data.projects.find(p => p.id === projectSheet?.project)?.name) || 'Project';
  useEffect(() => {
    if (!nativeShell) return;
    void (dashboardReviewing ? setNativeMode('callReview', { title: 'Review command', threadSheet: true }) : projectBrowserOpen || workspacesOpen || screen === 'schedules' || officeExpanded && screen === 'dashboard' ? setNativeMode('other') : screen === 'conversation'
      ? setNativeMode(isCommander ? 'commander' : 'conversation', { title: isCommander ? commanderProject!.name : nativeTitle, placeholder: busyThread ? 'Draft your next message…' : 'Message', threadSheet, ...(projectSheet?.thread ? { back: true } : {}) })
      : screen === 'project' ? setNativeMode('project', { title: projectSheetName, threadSheet: true })
      : screen === 'new' ? setNativeMode('new', { title: 'New thread', placeholder: 'What should we work on?', threadSheet })
      : screen === 'dashboard' ? setNativeMode('dashboard', { title: 'Dashboard' }) : setNativeMode('other')).catch(e => setError(`Native shell: ${e instanceof Error ? e.message : String(e)}`));
  }, [nativeShell, screen, nativeTitle, busyThread, dashboardReviewing, dashboardCall, workspacesOpen, projectBrowserOpen, officeExpanded, isCommander, threadSheet, projectSheet?.thread, projectSheetName]);
  // Launch: native companions open on Dashboard with the drawer closed. New thread stays an explicit action.
  const launched = useRef(false);
  useEffect(() => {
    if (!nativeShell || launched.current) return;
    launched.current = true;
    setScreen('dashboard');
  }, [nativeShell]);
  // The home needs a project: last used if it still exists, else the first one that can start threads.
  useEffect(() => {
    if (screen !== 'new' || !loaded || scopedData.projects.some(p => p.id === newProject && p.canStart)) return;
    setNewProject(pickNewProject(scopedData.projects, project, savedLastProject()));
  }, [nativeShell, screen, loaded, data.projects, data.workspaces, workspace, newProject, project]);
  useEffect(() => { if (nativeShell && screen === 'new' && newProject) saveLastProject(newProject); }, [nativeShell, screen, newProject]);
  // Push-to-talk dictation: the mic only shows while the Mac reports voice enabled + ready, rechecked at most every 30 s.
  const voiceReady = useRef(false), voiceCheckedAt = useRef(0);
  const checkVoice = useCallback(async (force: boolean) => {
    if (!nativeShell || !client.voice) return;
    if (!force && Date.now() - voiceCheckedAt.current < 30_000) return;
    voiceCheckedAt.current = Date.now();
    let ready = voiceReady.current;
    try { const status = await client.voice(); ready = !!status.enabled && !!status.ready; console.info('[voice]', 'status', status); }
    catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn('[voice]', 'status check failed; retaining last readiness', message);
      setError(`Dictation unavailable: ${message}`);
    }
    voiceReady.current = ready;
    await setNativeVoice(ready && !callActiveRef.current).catch(e => setError(`Native shell: ${e instanceof Error ? e.message : String(e)}`));
  }, [nativeShell, client]);
  useEffect(() => {
    if (!nativeShell || !client.voice) return;
    if (!connected) { voiceCheckedAt.current = 0; return; }
    void checkVoice(true);
    const tick = setInterval(() => void checkVoice(false), 30_000);
    const foreground = () => { if (document.visibilityState === 'visible') void checkVoice(false); };
    document.addEventListener('visibilitychange', foreground);
    return () => { clearInterval(tick); document.removeEventListener('visibilitychange', foreground); window.removeEventListener('online', foreground); };
  }, [nativeShell, client, connected, checkVoice]);
  useEffect(() => { if (nativeShell) void setNativeVoice(voiceReady.current && !callActive, 'idle').catch(() => {}); }, [nativeShell, callActive]);
  // Capture each recording's destination and controls before joining the transcription FIFO.
  dictationView.current = `${screen}:${key}:${newProject}`;
  function dictate(path: string, capturedDraft?: RecordedDraft) {
    if (!client.transcribe) { setError('Dictation is not available in this build.'); void discardNativeFiles([path]).catch(() => {}); return; }
    const sequence = ++dictationSequence.current;
    const destinationView = dictationView.current;
    const revision = navigationRevision.current;
    const draftOnly = !connected || working || staging || (screen === 'new' && !newReady) || (screen !== 'new' && screen !== 'conversation') || (screen === 'conversation' && (!task || task.messagesLoaded === false || (!task.canReply && !busyThread)));
    const targetThread = screen === 'conversation' ? selected : '';
    const targetProject = screen === 'new' ? newProject : task?.project || newProject;
    const targetKey = key;
    const options = { agent: selection.agent, model: selection.model.trim() || null, effort: selection.effort === 'default' ? null : selection.effort, speed: selection.speed === 'fast' ? 'fast' : null,
      permission_mode: provider === 'codex' || provider === 'claude' ? permission : undefined, update_agent_controls: true };
    const group = `${revision}:${targetProject}:${assistant}`;
    let newDestination = screen === 'new' ? dictationDestinations.current.get(group) : undefined;
    if (screen === 'new' && !newDestination) {
      newDestination = { id: '' };
      dictationDestinations.current.set(group, newDestination);
    }
    const id = crypto.randomUUID();
    const targetAssistant = assistant || undefined;
    transcriptionPending.current++;
    setError('');
    void setNativeVoice(voiceReady.current && !callActiveRef.current, 'transcribing').catch(() => {});
    const run = transcriptionTail.current.then(async () => {
      if (!dictationLive.current) return;
      try {
        const started = Date.now();
        const result = await client.transcribe!({ path });
        if (!dictationLive.current) return;
        console.info('[voice]', 'transcribed', { chars: result.text.length, model: result.model, audioMs: result.durationMs, roundTripMs: Date.now() - started });
        if (!result.text.trim()) {
          setError("Didn't catch anything");
          if (capturedDraft && dictationSequence.current === sequence && dictationView.current === destinationView) await setNativeComposerText(capturedDraft.text, capturedDraft.files);
          return;
        }
        if (!capturedDraft) {
          // Compatibility with older native bundles that still own the draft.
          if (dictationView.current === destinationView) await appendNativeComposerText(result.text, !draftOnly);
          else setDrafts(old => ({ ...old, [targetKey]: [old[targetKey], result.text].filter(Boolean).join(' ') }));
          return;
        }
        const prompt = [capturedDraft.text.trim(), result.text.trim()].filter(Boolean).join(' ');
        if (draftOnly) {
          if (dictationView.current === destinationView) await setNativeComposerText(prompt, capturedDraft.files);
          else setDrafts(old => ({ ...old, [targetKey]: [old[targetKey], prompt].filter(Boolean).join(' ') }));
          return;
        }
        const firstInNew = !!newDestination && !newDestination.id;
        if (firstInNew) newDestination!.id = id;
        const thread = targetThread || newDestination?.thread || '';
        const message: Outgoing = { id, thread, replyTo: !thread && newDestination && !firstInNew ? newDestination.id : undefined,
          project: targetProject, prompt, ordinal: 1, startsTurn: classifySend(thread, id, { isNew: !thread && !!firstInNew, extraInFlight: !thread && !firstInNew ? 1 : 0 }),
          acknowledged: false, nativeFiles: capturedDraft.files, assistant: targetAssistant, options,
          attachments: capturedDraft.files.map(file => ({ id: file.path, name: file.name, bytes: file.bytes, mime: file.mime, sha256: '' })) };
        deliveryNavigation.current[id] = revision;
        setOutgoing(old => {
          const matching = task?.messages.filter(m => m.role === 'user' && m.text === prompt).length || 0;
          const ordinal = Math.max(matching, ...old.filter(m => m.thread === thread && m.prompt === prompt).map(m => m.ordinal)) + 1;
          return [...old, { ...message, ordinal, startsTurn: message.startsTurn && !old.some(m => m.thread === thread && !m.acknowledged) }]; // a concurrent dictation queued ahead of this one
        });
        trackLive({ ...message, ordinal: 1 });
        nearBottom.current = true;
      } catch (e) {
        if (!dictationLive.current) return;
        console.warn('[voice]', 'transcribe failed', e instanceof Error ? e.message : e);
        setError(`Dictation failed: ${e instanceof Error ? e.message : String(e)}`);
        if (capturedDraft && dictationSequence.current === sequence && dictationView.current === destinationView) await setNativeComposerText(capturedDraft.text, capturedDraft.files).catch(() => {});
      } finally {
        transcriptionPending.current--;
        if (dictationLive.current && transcriptionPending.current === 0) void setNativeVoice(voiceReady.current && !callActiveRef.current, 'idle').catch(() => {});
      }
    });
    transcriptionTail.current = run.catch(() => {});
    return run;
  }
  const nativeDashboardContent = nativeShell && hasNativeDashboardContent();
  const nativeSummaries = useNativeSummaries(client.summaries, nativeDashboardContent && dashboardRetained && connected);
  const dashboardHandler = useRef<(action: DashboardAction) => void>(() => {});
  /** Delivers a dashboard-originated new thread through the outbox. -1 never equals a navigation revision, so delivery does not pull the user off the dashboard. */
  function enqueueDashboard(message: Outgoing, name: string) {
    deliveryNavigation.current[message.id] = -1;
    dashboardSends.current.set(message.id, name);
    saveLastAssistant(message.project, message.assistant);
    setOutgoing(old => old.some(m => m.id === message.id) ? old : [...old, message]);
    clearTranscribing(message.id);
  }
  dashboardHandler.current = event => { void (async () => {
    if (dashboardInFlight.current && !(event.action === 'voice' && event.send)) { if (event.path) void discardNativeFiles([event.path]); return; }
    if (event.action === 'summary') { await nativeSummaries.generate(event.project || ''); return; }
    if (event.action === 'workspace') {
      const choice = await choose('Workspace', [{ id: '', label: 'All workspaces' }, ...(data.workspaces || []).map(w => ({ id: w.id, label: w.name })), ...(client.saveWorkspaces && data.workspaces ? [{ id: '__manage_workspaces', label: 'Manage workspaces…' }] : [])], workspace);
      if (choice !== null) chooseWorkspace(choice);
      return;
    }
    if (event.action === 'organization') { setWorkspacesOpen(true); return; }
    if (event.action === 'schedules') { openSchedules(); return; }
    if (event.action === 'commander') { openCommander(); return; }
    let pickedDashboard: { agent: string; model: string } | null = null;
    if ((event.action === 'agent' || event.action === 'dashboard-model' || event.action === 'dashboard-effort') && connected) {
      const assistants = [...new Map(data.projects.flatMap(p => p.assistants ?? []).map(a => [a.id, a])).values()];
      pickedDashboard = await chooseAssistantSettings(choose, assistants, dashboardAssistant, true, data.modelConfiguration);
      if (!pickedDashboard) return;
      setDashboardAssistant(pickedDashboard.agent);
    }
    if (pickedDashboard && connected) {
      const dashboardAssistant = pickedDashboard.agent;
      const target = data.projects.find(p => p.kind !== 'commander' && (!dashboardAssistant || p.assistants?.some(a => a.id === dashboardAssistant)));
      if (!target) return;
      const chosen = dashboardAssistantFor(target, dashboardAssistant);
      const provider = chosen?.provider || target.provider;
      if (!provider) return;
      const current = controls[dashboardControlKey(target, dashboardAssistant)]?.selection ?? defaultSelection;
      const catalog = pickedDashboard.model === '__custom' && provider === 'codex' && client.models ? await client.models({ project: target.id, assistant: chosen?.id }) : [];
      const result = pickedDashboard.model === '__custom' ? await chooseSelection(choose, provider, catalog, current, data.modelConfiguration, true) : { model: pickedDashboard.model, effort: 'default' };
      if (!result) return;
      const { model, effort, speed } = result;
      setControls(old => {
        const next = { ...old };
        for (const project of data.projects) {
          const assistant = dashboardAssistantFor(project, dashboardAssistant);
          if ((assistant?.provider || project.provider) !== provider) continue;
          const key = dashboardControlKey(project, dashboardAssistant);
          next[key] = { permission: old[key]?.permission ?? 'bypass', selection: { model, effort, speed } };
        }
        return next;
      });
      return;
    }
    const target = data.projects.find(p => p.id === event.project);
    if (!target) { if (event.path) { void discardNativeFiles([event.path]); await setNativeDashboard(buildDashboardModel(data, connected, dashboardAssistant, controls, false)); } return; }
    if (event.action === 'open') {
      if (desktop) { setProject(target.id); setQuery(''); setFilter('all'); setOlderPages({}); await setNativeMode('dashboard', { title: 'Dashboard', openDrawer: true }); return; }
      openProjectSheet(target.id); return;
    }
    if (event.action === 'thread') {
      // A pending row is a message still on its way: reopen the composer for its project, never a conversation.
      if (event.thread?.startsWith('outbox:')) { startDashboard(target.id); return; }
      if (data.threads.some(t => t.id === event.thread && t.project === target.id)) { openThreadSheet(event.thread!); }
      return;
    }
    const chosen = dashboardAssistantFor(target, event.assistant ?? dashboardAssistant);
    if (!connected || !target.canStart || (target.assistants && !chosen)) {
      if (event.path) { void discardNativeFiles([event.path]); await setNativeDashboard(buildDashboardModel(data, connected, dashboardAssistant, controls, false)); }
      setError('Connect to your Mac and make this project ready before starting a task.'); return;
    }
    if (event.action === 'new') { startDashboard(target.id, chosen?.id); return; }
    if (event.action === 'model') {
      const provider = chosen?.provider || target.provider;
      const key = dashboardControlKey(target, chosen?.id || '');
      const current = controls[key]?.selection ?? defaultSelection;
      const catalog = provider === 'codex' && client.models ? await client.models({ project: target.id, assistant: chosen?.id }) : [];
      const result = await chooseSelection(choose, provider, catalog, current, data.modelConfiguration);
      if (result) setControls(old => ({ ...old, [key]: { permission: old[key]?.permission ?? 'bypass', selection: result } }));
      return;
    }
    if (event.action !== 'voice' || !event.path) return;
    if (event.send) {
      // Send mode: transcribe and deliver straight through the outbox without the global busy lock, so several dictations can be in flight.
      const path = event.path, name = target.name, id = crypto.randomUUID();
      const fail = (reason: string, cause?: unknown) => { console.warn('[voice]', 'dashboard send failed', { project: name, reason, cause: cause instanceof Error ? cause.message : cause }); clearTranscribing(id); setError(`Couldn't send to ${name}: ${reason}`); };
      setTranscribing(old => ({ ...old, [id]: target.id }));
      if (!client.transcribe) { void discardNativeFiles([path]).catch(() => {}); fail('Dictation is not available in this build.'); return; }
      let text: string;
      try { text = (await client.transcribe({ path })).text.trim(); }
      catch (e) { void discardNativeFiles([path]).catch(() => {}); fail(e instanceof Error ? e.message : String(e), e); return; }
      if (!dictationLive.current) return;
      if (!text) { fail("Didn't catch anything. Hold the microphone and try again."); return; }
      const provider = chosen?.provider || target.provider, commander = target.kind === 'commander';
      const saved = controls[dashboardControlKey(target, chosen?.id || '')];
      const message: Outgoing = { id, thread: '', project: target.id, prompt: text, ordinal: 1, startsTurn: true, acknowledged: false, attachments: [],
        assistant: commander ? undefined : chosen?.id,
        options: commander ? undefined : { model: saved?.selection.model.trim() || null, effort: !saved || saved.selection.effort === 'default' ? null : saved.selection.effort, speed: saved?.selection.speed === 'fast' ? 'fast' : null,
          permission_mode: provider === 'codex' || provider === 'claude' ? saved?.permission ?? 'bypass' : undefined, update_agent_controls: true } };
      enqueueDashboard(message, name);
      return;
    }
    dashboardInFlight.current = true; setDashboardBusy(true); setError('');
    try {
      if (!client.transcribe) { await discardNativeFiles([event.path]); throw new Error('Dictation is not available in this build.'); }
      const result = await client.transcribe({ path: event.path });
      if (!result.text.trim()) { setError("Didn't catch anything. Hold the microphone and try again."); return; }
      if (dashboardContext.current.screen === 'dashboard' && target.kind === 'commander') {
        // Dictation to Commander opens its chat with the transcript as a draft; release never submits it.
        openCommander();
        await appendNativeComposerText(result.text, false);
      } else if (dashboardContext.current.screen === 'dashboard') {
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
  // Voice recordings still being transcribed show up as pending rows too, under the id their outbox item will take.
  const pendingItems: Outgoing[] = [...outgoing, ...Object.entries(transcribing).filter(([id]) => !outgoing.some(m => m.id === id))
    .map(([id, project]): Outgoing => ({ id, thread: '', project, prompt: 'Transcribing…', ordinal: 1, startsTurn: true, acknowledged: false, attachments: [] }))];
  const dashboardModel = nativeShell ? buildDashboardModel(data, connected, dashboardAssistant, controls, dashboardBusy, Date.now(), officeExpanded, actualRead, pendingItems) : null;
  if (dashboardModel?.commander && commanderData.state) { const st = commanderData.state.status; dashboardModel.commander = { ...dashboardModel.commander, needsYou: st.needs_you ?? dashboardModel.commander.needsYou, running: st.running ?? dashboardModel.commander.running, doneToday: st.done_today ?? dashboardModel.commander.doneToday }; }
  if (dashboardModel) { dashboardModel.workspaceHeight = officeHeight; dashboardModel.workspace = null; dashboardModel.message = error || (commanderOnDashboard ? commanderData.error : ''); dashboardModel.summaries = nativeSummaries.summaries; dashboardModel.schedules = !!client.scheduleCommand; }
  const sendDashboard = useRef(createChangeSender(setNativeDashboard));
  useEffect(() => {
    if (dashboardModel) void sendDashboard.current(dashboardModel).catch(e => setError(`Native dashboard: ${String(e)}`));
  });
  // The native menu calls the same handlers as the web "Thread actions" menu. Delete was already confirmed by a native alert.
  const nativeHandlers = useRef({ send: (_text: string, _files: NativeFile[]) => {}, threadAction: (_p: { action?: unknown }) => {}, voiceRecorded: (_path: string, _draft?: RecordedDraft) => {}, voiceError: (_message: string) => {} });
  nativeHandlers.current = {
    voiceRecorded: (path, draft) => void dictate(path, draft),
    voiceError: message => { console.info('[voice]', 'native error', message); setError(message); },
    send: (text, files) => void send(undefined, text, files),
    threadAction: p => {
      if (p.action === 'organization') { setWorkspacesOpen(true); return; }
      if (p.action === 'hangup') { window.dispatchEvent(new Event(END_CALL_EVENT)); return; }
      if (p.action === 'mute') { window.dispatchEvent(new Event(TOGGLE_MUTE_EVENT)); return; }
      if (p.action === 'call') { window.dispatchEvent(new Event(screen === 'dashboard' || dashboardCallActive ? 'freddai:start-dashboard-call' : 'freddai:start-call')); return; }
      if (p.action === 'agent') { if (!pickerBusy) void pickComposerSettings(); return; }
      if (p.action === 'model') { if (!pickerBusy && provider) void pickComposerSettings(); return; }
      if (p.action === 'permissions') { if (!pickerBusy && supportsPermissions(provider)) void pickPermission(); return; }
      if (p.action === 'pin' || p.action === 'unpin') { void threadAction(p.action); return; }
      createThreadActionHandler({ stop: () => void threadAction('stop'), archive: () => void threadAction('archive'), delete: () => void threadAction('delete'), review: reviewDecision })(p);
    },
  };
  const reorderBusy = useRef(false);
  const moveProject = useRef<(project: string, target: string, after: boolean) => void>(() => {});
  moveProject.current = (project, target, after) => {
    if (!connected || !client.moveProject || !data.canReorderProjects || reorderBusy.current || project === target) return;
    reorderBusy.current = true;
    void client.moveProject(project, target, after).then(order => {
      setData(previous => ({ ...previous, threadList: { ...previous.threadList, projectOrder: order } }));
    }).catch(e => setError(String(e))).finally(() => { reorderBusy.current = false; });
  };
  const openCommanderRef = useRef(() => {});
  openCommanderRef.current = openCommander;
  const threadEvents = useRef(createThreadEventHandlers({ selectThread() {}, setQuery() {}, setFilters() {}, newThread() {}, showOlder() {} }));
  threadEvents.current = createThreadEventHandlers({
    selectThread: id => { if (id.startsWith('outbox:')) { setScreen('new'); return; } if (id === 'commander:open') { openCommanderRef.current(); return; } setSelected(id); setScreen('conversation'); },
    setQuery: value => { setQuery(value); setOlderPages({}); },
    workspace, setWorkspace: chooseWorkspace,
    setFilters: (nextProject, status) => { setProject(nextProject); setFilter(status); setOlderPages({}); },
    newThread: destination => { if (destination === 'freddai:add-project') setProjectBrowserOpen(true); else start(destination || undefined); },
    showOlder: id => setOlderPages(pages => bumpOlderPage(pages, id)),
    showLess: id => setOlderPages(pages => ({ ...pages, [id]: 0 })),
    setView: setNavView,
    recentPage: (action, section) => (section ? setSectionPages : setRecentPages)(pages => action === 'more' ? pages + 1 : 0),
  });
  useEffect(() => {
    if (!nativeShell) return;
    let live = true;
    const stops: (() => void)[] = [];
    const keep = (stop: () => void) => { if (live) stops.push(stop); else stop(); };
    const fail = (e: unknown) => setError(`Native shell: ${e instanceof Error ? e.message : String(e)}`);
    onDashboard(() => setScreen('dashboard')).then(keep, fail);
    onDashboardAction(event => dashboardHandler.current(event)).then(keep, fail);
    onNavBack(() => sheetBackRef.current()).then(keep, fail);
    onComposerSend((text, files) => nativeHandlers.current.send(text, files)).then(keep, fail);
    onVoiceRecorded((path, _duration, draft) => nativeHandlers.current.voiceRecorded(path, draft)).then(keep, fail);
    onVoiceError(message => nativeHandlers.current.voiceError(message)).then(keep, fail);
    onConnectionTap(() => nativeTapHandler.current()).then(keep, fail);
    onThreadAction(p => nativeHandlers.current.threadAction(p)).then(keep, fail);
    onSelectThread(p => threadEvents.current.selectThread(p)).then(keep, fail);
    onSearch(p => threadEvents.current.search(p)).then(keep, fail);
    onSetFilter(p => threadEvents.current.setFilter(p)).then(keep, fail);
    onNewThread(p => threadEvents.current.newThread(p)).then(keep, fail);
    onMoveProject(p => {
      if (typeof p.project === 'string' && typeof p.target === 'string') moveProject.current(p.project, p.target, p.after === true);
    }).then(keep, fail);
    onShowOlder(p => threadEvents.current.showOlder(p)).then(keep, fail);
    onShowLess(p => threadEvents.current.showLess(p)).then(keep, fail);
    onSetView(p => threadEvents.current.setView(p)).then(keep, fail);
    onRecentPage(p => threadEvents.current.recentPage(p)).then(keep, fail);
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
      if (operation === 'delete') { setSelected(''); setScreen('dashboard'); }
      else if (operation === 'archive') leaveThread();
      setRetry(value => value + 1);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setWorking(false); }
  }
  async function resumeInterruptedThread() {
    if (!connected || working || !task?.canReply || task.status !== 'interrupted' || !client.resume) return;
    setError(''); setWorking(true);
    try { await client.resume({ thread: task.id, requestId: crypto.randomUUID() }); setRetry(value => value + 1); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setWorking(false); }
  }
  // Native shell has no web threads screen: fall back to the next most recent thread, or New thread.
  function leaveThread() {
    if (projectSheet) { backToProjectList(); return; }
    if (threadSheet) { closeThreadSheet(); return; }
    if (!nativeShell) { setScreen('threads'); return; }
    const next = selectThreads(data, '', '', 'all', 'recent', read).find(t => t.id !== selected);
    if (next) { setSelected(next.id); setScreen('conversation'); } else start();
  }
  function startDashboard(destination: string, assistant?: string) {
    if (assistant) setNewAssistants(old => ({ ...old, [destination]: assistant }));
    start(destination, true);
    const savedKey = `dashboard:${destination}:${assistant || ''}`;
    const saved = drafts[savedKey];
    if (saved) {
      setDrafts(old => ({ ...old, [savedKey]: '', new: [old.new, saved].filter(Boolean).join('\n') }));
      void appendNativeComposerText(saved, false); setError('');
    }
  }
  const openLinkedThread = openThreadSheet;
  function start(destination?: string, sheet = false) {
    setNewProject(pickNewProject(scopedData.projects, destination || '', project, nativeShell ? savedLastProject() : ''));
    if (sheet && !desktop && nativeDashboardContent && (screen === 'dashboard' || screen === 'project')) openNewSheet(); else setScreen('new');
  }
  const nativeProjectName = projectName(data.projects.find(p => p.id === (screen === 'new' ? newProject : task?.project))?.name);
  const sendMeta = useRef(createChangeSender(setNativeThreadMeta));
  useEffect(() => {
    if (!nativeBar) return;
    const conversation = screen === 'conversation';
    sendMeta.current({
      agent: screen === 'new' ? selectedAssistant ? assistantLabel(selectedAssistant) : providerName(provider || '') : conversationAssistant ? assistantLabel(conversationAssistant) : providerName(provider || ''),
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
  // The online FIFO head is sending, not a backlog. Show only messages actually
  // waiting behind it, retrying after failure, blocked, or waiting for connection.
  const sendingHead = outgoing.find(m => !m.acknowledged);
  const waitingMessages = outgoing.filter(m => !m.acknowledged &&
    (!connected || m.blocked || m.deliveryError || m.id !== sendingHead?.id));
  const queueThreads: CompanionThread[] = waitingMessages.filter(m => !m.thread).map(m => ({ id: `outbox:${m.id}`, project: m.project, title: `◷ Queued · ${m.prompt.slice(0, 100)}`, status: 'queued', updated: 0, messages: [], canReply: false, queued: 1, error: null }));
  const displayData = { ...data, threads: [...data.threads.map(t => waitingMessages.some(m => m.thread === t.id) ? { ...t, title: `◷ Queued · ${t.title}`, queued: t.queued + 1 } : t), ...queueThreads] };
  const displayScoped = scopeCompanion(displayData, workspace);
  const threads = selectThreads(displayScoped, project, query, filter, 'recent', read);
  const groups = groupCompanionThreads(displayScoped, threads, { read, selected: screen === 'conversation' ? selected : '', filter, pages: olderPages, includeEmpty: !query.trim() && filter === 'all', project });
  const sendThreads = useRef(createChangeSender(setNativeThreads));
  const nativeModel = nativeShell ? buildThreadsModel({ data: displayData, workspace, canManageWorkspaces: !!client.saveWorkspaces && !!data.workspaces, read, selected: screen === 'conversation' ? selected : '', project, query, filter, olderPages, view: navView, recentPages, sectionPages }) : null;
  useEffect(() => {
    if (nativeModel) sendThreads.current({ ...nativeModel, canReorderProjects: connected && !!client.moveProject && data.canReorderProjects === true }).catch(e => setError(`Native shell: ${e instanceof Error ? e.message : String(e)}`));
  });
  // "Recent": one flat newest-first list across projects, honouring the same search/project/status filters.
  const recent = selectRecentThreads(threads, recentPages, COMPANION_RECENT_PAGING);
  const recentSection = selectRecentThreads(threads, sectionPages);
  const row = (t: CompanionThread) => renderRow(t, navView === 'recent');
  const sectionRow = (t: CompanionThread) => renderRow(t, true);
  function renderRow(t: CompanionThread, showProject: boolean) {
    const owner = showProject ? scopedData.projects.find(p => p.id === t.project) : undefined;
    const status = threadListStatus(t, read);
    const label = ({unread:'Unread reply',done:'Completed',waiting:'Needs you',running:'Running',starting:'Starting',failed:'Failed',interrupted:'Interrupted'} as Record<string,string>)[status] || status;
    const sent = t.last_user_message_at ?? t.updated;
    return <button className="companion-row" aria-current={selected === t.id ? "page" : undefined} data-faded={companionThreadFaded(t, read)} key={t.id} onClick={() => { if (t.id.startsWith('outbox:')) { setScreen('new'); return; } setSelected(t.id); setScreen('conversation'); }}><span className="companion-state" data-status={status}/><span><strong title={t.title}>{t.title}</strong><small>{owner && <span className="companion-project-chip" title={projectName(owner.name)} style={{color: owner.color}}>{projectName(owner.name)}</span>}{label}{t.queued > 0 ? ` · ${t.queued} queued` : ''}</small></span>{t.pinned && <Pin size={14} aria-label="Pinned" style={{ flexShrink: 0 }} />}{t.scheduled && <CalendarClock size={14} aria-label="Scheduled task" style={{ flexShrink: 0 }} />}<time dateTime={new Date(sent).toISOString()}>{new Date(sent).toLocaleDateString(undefined, {month:'short',day:'numeric'})}</time></button>;
  }
  function older(group: typeof groups[number]) {
    return <div className="companion-history">
      {groupThreadsByDay(group.older).map(day => <div key={day.label || 'today'}>{day.label && <div className="companion-day-label" role="separator" aria-label={day.label}>{day.label}</div>}{day.threads.map(row)}</div>)}
      {(group.remaining > 0 || group.pageCount > 0) && <div className="companion-history-actions">
        {group.remaining > 0 && <Button variant="ghost" data-testid={`older-more-${group.id}`} onClick={() => setOlderPages(pages => ({...pages,[group.id]:group.pageCount + 1}))}>{group.pageCount ? 'Show more' : 'Show older threads'} ({group.remaining})</Button>}
        {group.pageCount > 0 && <Button variant="ghost" data-testid={`older-less-${group.id}`} aria-expanded onClick={() => setOlderPages(pages => ({...pages,[group.id]:0}))}>Show less</Button>}
      </div>}
    </div>;
  }
  const detail = screen === 'conversation' || screen === 'new';
  const canSend = !working && !staging && !!draft.trim() && (screen === 'new' ? newReady : (!!task?.canReply && task.messagesLoaded !== false));
  // Classify from the latest known status before delivery; keep the local queue
  // row until the host snapshot owns it, without a transient transcript bubble.
  const localQueue = pendingMessages.filter(message => !message.startsTurn &&
    !task?.queue?.some(item => item.id === `phone:${message.id}`) &&
    (task?.messages.filter(item => item.role === 'user' && item.text === message.prompt).length || 0) < message.ordinal);
  const queueMessages = [...(task?.queue || []), ...localQueue.map(message => ({
    id: `phone:${message.id}`, prompt: message.prompt, attachments: message.attachments.length,
  }))];
  const pendingQueueIds = new Set(localQueue.map(message => `phone:${message.id}`));
  function outgoingPreview(messages: Outgoing[]): PendingOutgoing[] {
    return messages.filter(message => (!message.thread || message.startsTurn) &&
      (task?.messages.filter(m => m.role === 'user' && m.text === message.prompt).length || 0) < message.ordinal &&
      !task?.queue?.some(item => item.id === `phone:${message.id}`)).map(message =>
      ({ id: message.id, text: message.prompt, attachments: message.attachments, status: message.blocked ? `Not sent · ${message.deliveryError}` : message.acknowledged ? undefined : message.uploadStatus || (message.deliveryError || !connected ? queuedStatus(message, connected, Date.now()) : 'Sending…'), sending: !message.acknowledged && !message.blocked }));
  }
  const statusLabels: Record<ThreadFilter, string> = { all: 'All threads', attention: 'Needs you', running: data.threadList?.ignoreUnread ? 'Working' : 'Running', done: data.threadList?.ignoreUnread ? 'Done' : 'Finished' };
  const filterChips: ActiveFilterChip[] = [
    ...(workspace ? [{ kind: 'workspace' as const, label: data.workspaces?.find(w => w.id === workspace)?.name || workspace, onClear: () => chooseWorkspace('') }] : []),
    ...(project ? [{ kind: 'project' as const, label: projectName(data.projects.find(p => p.id === project)?.name) || project, onClear: () => { setProject(''); setOlderPages({}); } }] : []),
    ...(filter !== 'all' ? [{ kind: 'status' as const, label: statusLabels[filter], onClear: () => { setFilter('all'); setOlderPages({}); } }] : []),
  ];
  const titleActions = (<div className="companion-title-actions">
    {client.addProject && <Button variant="ghost" size="icon" className="companion-title-action" aria-label="Add project" title="Add project" disabled={!connected} onClick={() => setProjectBrowserOpen(true)}><FolderPlus /></Button>}
    {!nativeShell && <Button variant="ghost" size="icon" className="companion-title-action" aria-label="Settings" title="Settings" onClick={() => setWorkspacesOpen(true)}><Settings /></Button>}
  </div>);
  const navigation = (<>
      <nav aria-label="Companion navigation" className="companion-nav-tiles">
      <Button variant="ghost" className="companion-nav-tile" onClick={() => setScreen('dashboard')}><LayoutDashboard aria-hidden="true" />Dashboard</Button>
      {commanderProject && <Button variant="ghost" className="companion-nav-tile" onClick={() => void openCommander()}><Bot aria-hidden="true" />Commander</Button>}
      </nav>
      <div className="companion-search"><Search size={17} /><Input aria-label="Search threads" placeholder="Search projects and threads" value={query} onChange={e => {setQuery(e.target.value);setOlderPages({});}} /></div>
      <div className="companion-filters">
        <select aria-label="Thread view" value={navView} onChange={e => setNavView(asThreadNavView(e.target.value))}><option value="projects">Projects</option><option value="recent">Recent</option></select>
        {!!client.saveWorkspaces && !!data.workspaces && <Button variant="ghost" onClick={() => setWorkspacesOpen(true)}>Manage workspaces</Button>}
        {!!data.workspaces?.length && <select aria-label="Workspace filter" value={workspace} onChange={e => chooseWorkspace(e.target.value)}><option value="">All workspaces</option>{data.workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>}
        <select aria-label="Project filter" value={project} onChange={e => {setProject(e.target.value);setOlderPages({});}}><option value="">All projects</option>{scopedData.projects.map(p => <option key={p.id} value={p.id}>{projectName(p.name)}</option>)}</select>
        <select aria-label="Status filter" value={filter} onChange={e => {setFilter(e.target.value as ThreadFilter);setOlderPages({});}}><option value="all">All threads</option><option value="attention">Needs you</option><option value="running">{data.threadList?.ignoreUnread ? "Working" : "Running"}</option><option value="done">{data.threadList?.ignoreUnread ? "Done" : "Finished"}</option></select>
      </div>
      <ActiveFilterChips chips={filterChips} />
    </>);
  const visibleGroups = groups.filter(group => group.project?.kind !== 'commander');
  const threadListing = (navView === 'recent' ? <div className="companion-recent">
        {recent.threads.map(row)}
        <RecentThreadsFooter remaining={recent.remaining} expanded={recent.expanded} onMore={() => setRecentPages(p => p + 1)} onLess={() => setRecentPages(0)} />
        {!recent.threads.length && <p className="companion-empty">No recent threads</p>}
      </div> : <>{visibleGroups.map(group => <section key={group.id} className="companion-project-group" aria-label={`${projectName(group.project?.name) || 'Project'} threads`}>
        <div className="companion-project-heading" data-project-reorder={group.id}>{connected && client.moveProject && data.canReorderProjects && group.id && <ProjectReorderHandle id={group.id} name={projectName(group.project?.name) || 'Project'} order={groups.map(g => g.id)} onMove={(...args) => moveProject.current(...args)}/>}<button className="companion-project-toggle" aria-expanded={!collapsedProjects[group.id]} onClick={() => { if (group.project?.kind === "commander") { void openCommander(); return; } setCollapsedProjects(old => ({ ...old, [group.id]: !old[group.id] })); }}>{group.project?.kind !== "commander" && <ChevronDown size={14} style={{transform: collapsedProjects[group.id] ? "rotate(-90deg)" : undefined}}/>}<FolderGit2 size={16} style={{color:group.project?.color}}/><h2 title={projectName(group.project?.name)} style={{color:group.project?.color}}>{projectName(group.project?.name) || 'Project'}</h2></button>{group.project?.kind !== "commander" && <Button variant="ghost" size="icon" aria-label={`New task in ${projectName(group.project?.name) || 'project'}`} disabled={!connected || !group.project?.canStart} onClick={() => start(group.id)}><Plus size={16}/></Button>}</div>
        {group.project?.kind !== "commander" && !collapsedProjects[group.id] && <>{group.active.map(row)}{older(group)}</>}
      </section>)}{recentSection.total > 0 && <section className="companion-project-group companion-recent-section" aria-label="Recent threads">
        <div className="companion-project-heading"><h2>Recent</h2></div>
        {recentSection.threads.map(sectionRow)}
        <RecentThreadsFooter remaining={recentSection.remaining} expanded={recentSection.expanded} onMore={() => setSectionPages(p => p + 1)} onLess={() => setSectionPages(0)} />
      </section>}{!visibleGroups.length && <p className="companion-empty">{connected ? 'No threads match your filters.' : 'Check progress, reply, and start work from your iPhone. Your projects and conversations will appear when your Mac is connected.'}</p>}</>);
  return <div className={desktop ? "companion-desktop" : "companion-container"} data-navigator={navigatorOpen}>
    {desktop && navigatorOpen && <aside className="companion-desktop-sidebar" aria-label="Thread navigator">
      <div className="companion-desktop-brand" data-tauri-drag-region><span>freddai</span>{titleActions}</div>
      <Button variant="ghost" onClick={() => start()}>New thread</Button>
      {navigation}
      <ScrollArea className="companion-desktop-threads">{threadListing}</ScrollArea>
      {client.scheduleCommand && <Button variant="ghost" onClick={openSchedules}>Schedules</Button>}
    </aside>}
    <main className="companion" data-screen={screen} data-commander={isCommander || undefined} data-floating-header={floatingHeader || undefined} data-native-dashboard={nativeDashboardContent && screen === 'dashboard' || undefined}
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
    {desktop && <div className="companion-desktop-toolbar" data-tauri-drag-region><Button variant="ghost" size="icon" aria-label="Toggle thread navigator" aria-expanded={navigatorOpen} onClick={() => setNavigatorOpen(open => !open)}><Menu /></Button>{!navigatorOpen && <><Button variant="ghost" onClick={() => setScreen('dashboard')}>Dashboard</Button><Button variant="ghost" onClick={() => setWorkspacesOpen(true)}>Settings</Button></>}</div>}
    {!nativeShell && (detail || screen === 'project') && threadSheet && <button className="companion-sheet-handle" aria-label="Close thread"
      onClick={closeThreadSheet}
      onTouchMove={event => event.stopPropagation()}
      onTouchStart={event => { event.stopPropagation(); backSwipe.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }}
      onTouchEnd={event => { const start = backSwipe.current; backSwipe.current = null; if (start && event.changedTouches[0].clientY - start.y > 60) { event.stopPropagation(); closeThreadSheet(); } }}><span /></button>}
    {(!desktop || detail || screen === 'project') && screen !== 'schedules' && !officeExpanded && !nativeBar && !floatingHeader && <header className={`companion-header${screen === 'conversation' ? ' companion-thread-header' : ''}`}>
      {screen === 'conversation' ? <>
        {threadSheet ? (projectSheet?.thread ? <Button variant="ghost" size="icon" aria-label="Back to project" onClick={backToProjectList}><ArrowLeft /></Button> : null) : <Button variant="ghost" size="icon" aria-label={desktop ? "Toggle thread navigator" : "Back to threads"} title="Thread menu" onClick={() => desktop ? setNavigatorOpen(open => !open) : projectSheet ? backToProjectList() : setScreen('threads')}><Menu /></Button>}
        <div className="companion-thread-title"><h1 title={task?.title}>{task?.title || 'Loading conversation…'}</h1><small>{[({ running: 'Running', waiting: 'Needs you', failed: 'Failed' } as Record<string, string>)[nativeRunState(task)], nativeProjectName].filter(Boolean).join(' · ')}</small></div>
        <div className="companion-thread-actions"><span id="companion-call-action" />
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
      {desktop ? null : screen === 'project' ? <Button variant="ghost" size="icon" aria-label="Back" onClick={closeThreadSheet}><ArrowLeft /></Button> : detail ? <Button variant="ghost" size="icon" aria-label="Back to threads" disabled={working} onClick={() => setScreen('threads')}><ArrowLeft /></Button> : <span className="companion-brand">freddai</span>}
      <h1>{screen === 'project' ? projectSheetName : screen === 'dashboard' ? 'Dashboard' : screen === 'new' ? 'New thread' : 'Threads'}</h1>
      {screen === 'new' && <span id="companion-call-action" />}
      {connectionButton}
      {!desktop && screen === 'dashboard' && <Button variant="ghost" onClick={() => setScreen('threads')}>Threads</Button>}
      {!detail && titleActions}
      {!detail && <Button variant="ghost" size="icon" aria-label="New thread" onClick={() => start()}><Plus /></Button>}
      </>}
    </header>}
    {showBanner && !(nativeDashboardContent && screen === 'dashboard') && <ConnectionBanner status={connection} client={client} onTryAgain={tryAgain} onPairAgain={onPairAgain} onDismiss={() => { setBannerDismissed(true); setDetailsOpen(false); setRecovered(false); }} onAwake={tryAgain}/>}
    {!desktop && client.scheduleCommand && (screen === 'threads' || (screen === 'dashboard' && !nativeDashboardContent)) && <Button variant="ghost" onClick={openSchedules}>Schedules</Button>}
    <Sheet open={workspacesOpen} onOpenChange={setWorkspacesOpen}><SheetContent side="bottom" className="companion-settings-sheet"><div className="companion-settings-grabber" aria-hidden="true" /><SheetHeader><SheetTitle>Settings</SheetTitle><SheetDescription>Organize your projects and customize Freddai.</SheetDescription></SheetHeader><div className="companion-workspaces">{deviceSettings && <details className="companion-settings-group"><summary>This device<span>Connection and device preferences</span></summary><div>{deviceSettings}</div></details>}


      {!connected && <p>Connect to your Mac to edit organization settings.</p>}
      <details className="companion-settings-group" open><summary>Workspaces<span>Group projects for easy navigation</span></summary><div>
      <WorkspaceSettings projects={data.projects} workspaces={data.workspaces || []} disabled={!connected || working || !client.saveWorkspaces || !data.workspaces} onSave={async next => {
        if (!client.saveWorkspaces || working || !connected) return;
        setWorking(true); setError('');
        try { await client.saveWorkspaces(next); setData(await client.snapshot(new AbortController().signal, snapshotThread)); return true; }
        catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
        finally { setWorking(false); }
      }}/>
      </div></details>
      <details className="companion-settings-group"><summary>Projects<span>Add folders, edit names and colors, change order</span></summary><div>
      {client.addProject && <Button disabled={!connected} onClick={() => setProjectBrowserOpen(true)}>Add project folder</Button>}
      <OrganizationSettings projectEditor={client.projectEditor} snapshot={data} disabled={!connected || working}
        onSave={client.updateProjectOrganization ? async (id, name, color) => {
          if (working || !connected) return;
          setWorking(true); setError('');
          try { await client.updateProjectOrganization!(id, name, color); setData(await client.snapshot(new AbortController().signal, snapshotThread)); }
          catch (e) { setError(e instanceof Error ? e.message : String(e)); }
          finally { setWorking(false); }
        } : undefined}
        onMove={client.moveProject ? async (id, target, after) => {
          if (working || !connected) return;
          setWorking(true); setError('');
          try { await client.moveProject!(id, target, after); setData(await client.snapshot(new AbortController().signal, snapshotThread)); }
          catch (e) { setError(e instanceof Error ? e.message : String(e)); }
          finally { setWorking(false); }
        } : undefined}/>
      </div></details>
      <details className="companion-settings-group"><summary>Models<span>Default models and reasoning preferences</span></summary><div><ModelConfigurationSettings configuration={data.modelConfiguration} providers={data.projects.flatMap(p => p.assistants?.map(a => a.provider) ?? (p.provider ? [p.provider] : []))} disabled={!connected || !client.saveModelConfiguration} onSave={async configuration => { if (!client.saveModelConfiguration) throw new Error('Update the companion to save model configuration.'); await client.saveModelConfiguration(configuration); setData(await client.snapshot(new AbortController().signal, snapshotThread)); }}/></div></details>
      {client.googleCommand && <details className="companion-settings-group"><summary>Connected accounts<span>Google accounts and automatic triggers</span></summary><div>
        <p>Google accounts and the triggers that start agent work from Gmail, Calendar and Drive.</p>
        <Button variant="outline" onClick={() => setGoogleOpen(true)}>Manage connected accounts</Button>
      </div></details>}
      {error && <p role="alert">{error}</p>}
    </div></SheetContent></Sheet>
    <Sheet open={projectBrowserOpen} onOpenChange={setProjectBrowserOpen}><SheetContent side="bottom" className="companion-settings-sheet"><SheetHeader><SheetTitle>Add project</SheetTitle><SheetDescription>Folders on your Mac</SheetDescription></SheetHeader>
      {projectBrowserOpen && client.projectFolders && client.addProject && <ProjectBrowser client={client} connected={connected} onAdded={async id => {
        setData(await client.snapshot(new AbortController().signal, snapshotThread));
        setNewProject(id); setProjectBrowserOpen(false);
      }}/>}
    </SheetContent></Sheet>
    {client.googleCommand && <Dialog open={googleOpen} onOpenChange={setGoogleOpen}><DialogContent className="companion-schedules companion-google-dialog"><DialogHeader><DialogTitle>Connected accounts</DialogTitle><DialogDescription>Google accounts and triggers on your Mac.</DialogDescription></DialogHeader><ConnectedAccounts command={client.googleCommand} connected={connected} db={{projects:data.projects,accounts:data.projects[0]?.assistants||[]}}/></DialogContent></Dialog>}
    {error && !(nativeDashboardContent && screen === 'dashboard') && <p className="companion-error" role="alert">{error}</p>}
    {!desktop && !detail && screen !== 'dashboard' && screen !== 'project' && screen !== 'schedules' && navigation}
    {!!waitingMessages.length && <aside className="companion-outbox" role="status" aria-label="Messages on this device">
      <div className="companion-outbox-heading"><span className="companion-outbox-dot" />{waitingMessages.length} {waitingMessages.length === 1 ? 'message' : 'messages'} queued on this device</div>
      {waitingMessages.map(m => <div className="companion-outbox-item" key={m.id}>
        <button className="companion-outbox-preview" type="button" onClick={() => { setSelected(m.thread); setScreen(m.thread ? 'conversation' : 'new'); }}>{m.prompt.slice(0, 70)}</button>
        {(m.blocked || m.deliveryError) && <p className="companion-outbox-error">{m.blocked ? m.deliveryError : queuedStatus(m, connected, Date.now()).replace('◷ Queued · ', '')}</p>}
        <div className="companion-outbox-actions">
          {m.blocked && <>
            {!!m.attachments.length && <button className="companion-outbox-recover" type="button" disabled={delivering === m.id} onClick={() => { retryAt.current = 0; setOutgoing(old => old.map(item => item.id === m.id ? { ...item, attachments: [], nativeFiles: [], blocked: false, deliveryError: undefined, uploadStatus: undefined } : item)); }}>Send without attachments</button>}
          </>}
          <button className="companion-outbox-retry" type="button" disabled={delivering === m.id} onClick={() => { console.info('[companion-outbox]', JSON.stringify({ event: 'retry_trigger', reason: 'manual', id: m.id, online: navigator.onLine })); retryAt.current = 0; setOutgoing(old => old.map(item => item.id === m.id ? { ...item, blocked: false, retryAt: undefined, ...(item.blocked ? { deliveryError: undefined } : {}) } : item)); setDeliveryTick(v => v + 1); }}>Retry now</button>
          <button className="companion-outbox-cancel" type="button" aria-label="Cancel queued message" disabled={delivering === m.id} onClick={() => setOutgoing(old => old.filter(item => item.id !== m.id))}>Cancel message</button>
        </div>
      </div>)}
    </aside>}
    {screen === 'schedules' && <SchedulesScreen desktop={desktop} schedules={data.schedules || []} projects={data.projects} accounts={[...new Map(data.projects.flatMap(p => p.assistants ?? []).map(a => [a.id, a])).values()]}
      defaultAccount={data.projects[0]?.defaultAssistant} connected={connected} command={client.scheduleCommand}
      onRefresh={async () => { setData(await client.snapshot(new AbortController().signal, snapshotThread)); }}
      onOpenThread={id => { setSelected(id); setScreen('conversation'); }} onBack={() => setScreen(schedulesFrom.current)} />}
    <div className="companion-body-wrap">{floatingHeader && (() => { const act = companionActivity(task, connection.state), waiting = isCommander ? waitingCount(commanderData) : 0;
      return <ThreadHeader title={isCommander ? commanderProject!.name : nativeTitle} mood={isCommander ? ((commanderData.state?.status.running ?? 0) > 0 ? 2 : waiting ? 4 : 0) : act.mood} mascotLabel={act.label}
        badge={waiting} avatarLabel={isCommander ? `${commanderProject!.name}: open To-dos, Notes, Waiting and Sub-threads${waiting ? ` (${waiting} need you)` : ''}` : commanderProject ? `Open ${commanderProject.name}` : undefined}
        onAvatar={isCommander ? () => { if (!sheetOpen && waiting > 0) setCommanderTab('waiting'); setSheetOpen(v => !v); } : commanderProject ? openCommander : undefined} expanded={isCommander ? sheetOpen : undefined}
        error={isCommander ? commanderData.error : undefined} callAction={!nativeShell} onBack={isCommander && !nativeShell ? () => setScreen('threads') : undefined} />; })()}
    {nativeNew && !launchingNew.length ? home : <ScrollArea className="companion-body" viewportRef={viewport} viewportProps={{ onScroll: () => {
      const el = viewport.current;
      if (el) { const gap = el.scrollHeight - el.scrollTop - el.clientHeight; nearBottom.current = gap < 80; setShowLatest(gap > 200); }
    } }}>
      {floatingHeader && <div className="companion-fh-spacer" aria-hidden="true" />}
      {dashboardRetained && <div hidden={screen !== 'dashboard'} className="companion-dashboard-preserved"><CompanionDashboard outbox={pendingItems} onOfficeHeightChange={setOfficeHeight} onOfficeExpandedChange={setOfficeExpanded} nativeCards={nativeShell} nativeContent={nativeDashboardContent} read={read} globalAssistant={dashboardAssistant} onGlobalAssistantChange={setDashboardAssistant} client={client} assistantSelections={newAssistants} onAssistantChange={(project, assistant) => setNewAssistants(old => ({ ...old, [project]: assistant }))}
        controls={controls} onSelectionChange={(key, selection) => setControls(old => ({ ...old, [key]: { selection, permission: old[key]?.permission || 'bypass' } }))}
        onDictation={(project, text, assistant) => { setDrafts(old => ({ ...old, new: [old.new, text].filter(Boolean).join('\n') })); startDashboard(project, assistant); void setNativeComposerText([drafts.new, text].filter(Boolean).join('\n')); }} onOpenCommander={commanderProject ? openCommander : undefined} onSendCommander={commanderProject ? sendToCommander : undefined} snapshot={data} connected={connected} onOpen={id => { if (id.startsWith('outbox:')) { const item = pendingItems.find(m => `outbox:${m.id}` === id); if (item) startDashboard(item.project); return; } openThreadSheet(id); }} onProject={desktop ? undefined : openProjectSheet} onNew={startDashboard} /></div>}
      {screen === 'dashboard' ? null : screen === 'project' ? (projectSheet && <ProjectThreadList key={projectSheet.project} project={projectSheet.project} snapshot={scopedData} outbox={pendingItems} read={read} connected={connected} onOpen={openProjectSheetThread} onNew={() => startDashboard(projectSheet.project)} />) : screen === 'threads' ? threadListing : screen === 'new' ? (nativeNew ? null : <div className="companion-new"><h2>What would you like to work on?</h2><p>Choose a coding assistant configured on your Mac.</p><label>Project<select aria-label="New thread project" value={newProject} disabled={working} onChange={e => { setNewProject(e.target.value); delete requestIds.current.new; }}><option value="">Choose a project</option>{scopedData.projects.map(p => <option key={p.id} value={p.id} disabled={!p.canStart}>{projectName(p.name)}</option>)}</select></label>{!data.projects.some(p => p.canStart) && <p>Projects must be ready to run on your Mac.</p>}</div>) : task?.messagesLoaded === false ? <p className="companion-transcript-loading" role="status">Loading conversation…</p> : <ThreadLinksProvider threads={data.threads} projects={data.projects} onOpen={openLinkedThread}><PreviewContext.Provider value={task ? (url, opts) => previewOpen(task.id, url, opts?.start) : null}><ThreadTranscript readGeneratedFile={task && client.generatedFile ? (href, offset) => client.generatedFile!(task.id, href, offset) : undefined} key={task?.id} density="compact" messages={task?.messages || []} tasks={task?.tasks} active={!!task && ['starting', 'running', 'waiting'].includes(task.status)} pending={outgoingPreview(pendingMessages)}>{task?.error && <p role="alert">{task.error}</p>}{task?.pending && <fieldset disabled={!connected || working} key={JSON.stringify(task.pending.request_id ?? task.pending.id)}><Permission pending={task.pending} provider={task.provider || ''} onReply={respond} /></fieldset>}{task?.queueError && !task.queue?.length && <p role="alert">{task.queueError}</p>}{task && !task.canReply && !task.pending && !busyThread && !pendingMessages.length && <p>This thread cannot take replies. Start a new thread to continue.</p>}</ThreadTranscript></PreviewContext.Provider></ThreadLinksProvider>}
      {isCommander && <SubThreads hideEmpty threads={data.threads.filter(t => t.origin?.kind === 'commander' && t.origin.thread === task?.id)} projects={data.projects} onOpenThread={openLinkedThread} />}
      {screen === 'conversation' && <ThreadActivity thread={task} connection={connection.state}
        onStop={client.action ? () => void threadAction('stop') : undefined}
        onResume={client.resume && task?.canReply ? () => void resumeInterruptedThread() : undefined}
        disabled={!connected || working || task?.messagesLoaded === false} />}
      {screen === 'new' && <ThreadTranscript density="compact" messages={[]} pending={outgoingPreview(outgoing.filter(m => !m.thread))} />}
      {screen === 'threads' && <ProductUsageFooter products={data.productUsage} />}
    </ScrollArea>}
    {screen === 'conversation' && <button type="button" className="companion-latest" data-visible={showLatest} aria-label="Jump to latest message" tabIndex={showLatest ? 0 : -1} aria-hidden={!showLatest} onClick={() => viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: 'smooth' })}><ArrowDown size={18} /></button>}
    </div>
    {isCommander && client.commander && <CommanderSheet open={sheetOpen} onClose={() => setSheetOpen(false)} tab={commanderTab} onTab={setCommanderTab} waiting={waitingCount(commanderData)}>
      <CommanderPanel threads={data.threads.filter(t => isCommanderThread(t, commanderProject?.id) && t.id !== commanderData.state?.thread_id)} tab={commanderTab} client={client} data={commanderData} projects={data.projects.filter(p => p.kind !== 'commander')} commanderId={commanderProject!.id} onOpenThread={id => { setSheetOpen(false); setSelected(id); setScreen('conversation'); }} />
    </CommanderSheet>}
    <DashboardCall hideLauncher={nativeShell} visible={screen === 'dashboard' && !threadCallActive} enabled={!!commanderProject && !!client.commander && !!(client.transcribe || client.transcribeAudio) && !threadCallActive} connected={connected} io={dashboardCallIo} sendText={sendToCommander} onActive={setDashboardCallActive} onCallState={setDashboardCall} onReview={setDashboardReviewing} syncError={callSyncError}
      commandCenter={{ projects: scopedData.projects.filter(p => p.kind !== 'commander'),
        renderReview: props => {
          const project = data.projects.find(p => p.id === props.draft.projectId);
          const assistant = project ? dashboardAssistantFor(project, newAssistants[project.id] || dashboardAssistant) : undefined;
          const key = project ? dashboardControlKey(project, assistant?.id || '') : '';
          return <CompanionCommandCard projectNameUppercase={data.threadList?.projectNameUppercase} {...props} client={client} modelConfiguration={data.modelConfiguration} selection={controls[key]?.selection || defaultSelection} onSelection={selection => setControls(old => ({ ...old, [key]: { selection, permission: old[key]?.permission || 'bypass' } }))} projects={data.projects} assistant={assistant?.id || ''} onAssistant={id => rememberAssistant(props.draft.projectId, id)}/>;
        },
        launchDraft: async ({ projectId, instruction }) => {
          const project = data.projects.find(p => p.id === projectId);
          const assistant = project ? dashboardAssistantFor(project, newAssistants[projectId] || dashboardAssistant) : undefined;
          if (!connected || !project?.canStart || (project.assistants && !assistant)) throw new Error('Choose a project and coding agent that are ready on your Mac.');
          const saved = controls[dashboardControlKey(project, assistant?.id || '')];
          const provider = assistant?.provider || project.provider;
          const options = { model: saved?.selection.model.trim() || null, effort: !saved || saved.selection.effort === 'default' ? null : saved.selection.effort, speed: saved?.selection.speed === 'fast' ? 'fast' : null,
            permission_mode: provider === 'codex' || provider === 'claude' ? saved?.permission ?? 'bypass' : undefined, update_agent_controls: true };
          const key = `call:${JSON.stringify([projectId, assistant?.id, instruction, options])}`;
          const requestId = requestIds.current[key] ||= crypto.randomUUID();
          const message: Outgoing = { id: requestId, thread: '', project: projectId, prompt: instruction, ordinal: 1, startsTurn: true, acknowledged: false, attachments: [], assistant: project.kind === 'commander' ? undefined : assistant?.id, options: project.kind === 'commander' ? undefined : options };
          try { saveOutbox([...outgoing, message]); } catch { throw new Error('Could not save the message on this device. Free storage and try again.'); }
          enqueueDashboard(message, project.name);
          delete requestIds.current[key];
        } }}
      view={{ busy: !!callCommander && ['starting', 'running', 'waiting'].includes(callCommander.status), messages: callCommander?.messages ?? [] }} />
    {detail && !dashboardCallActive && <CompanionCall client={client} thread={screen === 'conversation' ? task : undefined} ready={screen === 'new' && newReady} connected={connected} onActive={setCallActive} sendText={async prompt => {
      if (screen === 'new') {
        if (!connected || !newReady) throw new Error('Choose a project and coding agent that are ready on your Mac.');
        const first = outgoing.find(m => m.id === newCallRequest.current);
        const id = crypto.randomUUID();
        const message: Outgoing = { id, thread: first?.thread || '', replyTo: first && !first.thread ? first.id : undefined, project: newProject, assistant: assistant || undefined, prompt, ordinal: 1, startsTurn: !first, acknowledged: false, attachments: [], options: { agent: selection.agent, model: selection.model.trim() || null, effort: selection.effort === 'default' ? null : selection.effort, speed: selection.speed === 'fast' ? 'fast' : null, permission_mode: provider === 'codex' || provider === 'claude' ? permission : undefined, update_agent_controls: true } };
        saveOutbox([...outgoing, message]);
        if (!newCallRequest.current) newCallRequest.current = id;
        deliveryNavigation.current[id] = navigationRevision.current;
        setOutgoing(old => [...old, message]);
        return;
      }
      if (!connected || !task || (!task.canReply && !outgoing.some(m => m.id === newCallRequest.current && m.thread === task.id && m.acknowledged))) throw new Error('Your Mac is disconnected or this thread cannot take replies.');
      const id = crypto.randomUUID();
      const matching = task.messages.filter(m => m.role === 'user' && m.text === prompt).length;
      const ordinal = Math.max(matching, ...outgoing.filter(m => m.thread === task.id && m.prompt === prompt).map(m => m.ordinal)) + 1;
      const message: Outgoing = { id, thread: task.id, project: task.project, prompt, ordinal, startsTurn: classifySend(task.id, id), acknowledged: false, attachments: [], options: { agent: selection.agent, model: selection.model.trim() || null, effort: selection.effort === 'default' ? null : selection.effort, speed: selection.speed === 'fast' ? 'fast' : null, permission_mode: provider === 'codex' || provider === 'claude' ? permission : undefined, update_agent_controls: true } };
      saveOutbox([...outgoing, message]);
      setOutgoing(old => [...old, message]); trackLive(message);
      nearBottom.current = true;
    }} />}
    {detail && !nativeNew && <div className="companion-compose-area">
      {screen === 'conversation' && task && <TodoPanel key={`todos-${task.id}`} messages={task.messages} active={['starting', 'running', 'waiting'].includes(task.status)}/>}
      {screen === 'conversation' && !nativeShell && <ConversationUsage usage={task?.usage}/>}

      {screen === 'conversation' && task && !!queueMessages.length && <MessageQueue key={task.id} messages={queueMessages} pendingIds={pendingQueueIds} active={busyThread} paused={task.queuePaused} error={task.queueError} disabled={!connected || working || !client.queue} onAction={queueAction} />}
      {!nativeBar && <form className="companion-composer" onSubmit={e => void send(e)}>
        {screen === 'new' && !!draft.trim() && !newProjectData && <p className="new-thread-project-required" role="status">Choose a project above to send your message.</p>}
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
          <ComposerAgentPicker options={(screen === 'new' ? newProjectData : conversationProject)?.assistants?.map(a => ({ id: a.id, label: assistantLabel(a), provider: a.provider, color: a.color })) || []} agent={screen === 'new' ? assistant : conversationAgent} onAgentChange={id => { if (screen === 'new') { rememberAssistant(newProject, id); delete requestIds.current.new; } else setControls(old => ({ ...old, [controlKey]: { permission, selection: { agent: id, model: 'freddai-level:normal', effort: 'default' } } })); }} native={!!client.models} provider={provider} modelConfiguration={data.modelConfiguration} loadModels={client.models ? loadModels : undefined} value={selection} onChange={value => setControls(old => ({ ...old, [controlKey]: { selection: value, permission } }))} disabled={!connected || working}/>
          {screen === 'conversation' && busyThread && <Button type="button" variant="ghost" size="icon" aria-label="Stop current turn and pause queue" disabled={actionsDisabled} onClick={() => void threadAction('stop')}><Square size={16}/></Button>}
          <Button type="submit" size="icon" className="companion-send" aria-label={screen === 'new' ? 'Start thread' : busyThread || !!task?.queued ? 'Queue message' : 'Send reply'} disabled={!canSend}><ArrowUp size={20}/></Button>
        </div>
        {staging && <p className="companion-attachment-status" role="status">Copying attachments to your Mac…</p>}
        <p id="companion-composer-help" className="sr-only">Return inserts a new line on iPhone. Command or Control Enter sends. Messages sent during a turn join the queue. Stop pauses pending messages.</p>
      </form>}
    </div>}
    <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}><DialogContent><DialogHeader><DialogTitle>Delete thread?</DialogTitle><DialogDescription>Move “{task?.title}” to Deleted on your Mac. Deleting an active thread also stops its work. You can restore it from Deleted on your Mac.</DialogDescription></DialogHeader><DialogFooter><Button variant="ghost" disabled={working} onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="destructive" disabled={actionsDisabled} onClick={() => void threadAction('delete')}>Move to Deleted</Button></DialogFooter></DialogContent></Dialog>
  </main></div>;
}
