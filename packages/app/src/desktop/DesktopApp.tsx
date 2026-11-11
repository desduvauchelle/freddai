import { DashboardCall } from "./DashboardCall";
import { isCompletionNotice } from "../conversation/CompletionCards";
import { isBackgroundWake } from "../conversation/systemNotice";
import { Dot, labelStatus } from "./ThreadStatus";
import { isCommanderThread } from "../commanderThreads";
import { BrowserWorkspace, BrowserToggle } from "./BrowserWorkspace";
import { useNavigationState } from '../hooks/use-navigation-state';
import { useThreadPins } from "./thread-pins";
import { scheduleEnded } from "./schedule-end";
import { agentDisplayName } from "./types";
import { CalendarClock, Pin, PinOff, AppWindow, CheckCheck, ClipboardCheck, Play, Archive, ArchiveRestore, FolderInput, Trash2, RotateCcw, Pencil } from "lucide-react";
import brandMascotUrl from "../../../../assets/brand/dormouse/dormouse-v3.svg?url";
import { statusReadCursors } from "./status-read-cursors";
import { threadListTitle } from "./thread-list-title";
import { AttachmentLabel } from "./AttachmentLabel";
import { previewQueues, previewReplies, unconfirmedReplies, type OutgoingReply } from "./outgoing";
import { browserThreadRecencyTracker } from "../thread-recency";
import { migrateLocalRead, readFromThreads } from "../read-sync";
import { Permission } from "./AgentRequest";
import { MessageQueue } from "./MessageQueue";
import { hasSpeech } from "../conversation/voiceCallMarkup";
import { listenNativeDrops } from "./native-drops";
import { projectDropTarget } from "./project-drop";
import { OLDER_PAGE_SIZE, RECENT_FINISHED_DEFAULT, RECENT_FINISHED_MAX, compareThreadRecency, sanitizeRecentCount, splitOlderThreads, groupThreadsByDay, bucketThreads, attentionCount, threadListStatus, threadVisibility, threadCapabilities } from "./types";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuLabel } from "@freddai/ui/components/context-menu";
import { ConversationUsage } from "./ConversationUsage";
import { ThreadError } from "./ThreadError";
import { ThreadList } from "./ThreadList";
import { RecentThreadsFooter, ThreadViewToggle } from "../RecentThreadsControls";
import { THREAD_NAV_VIEW_KEY, asThreadNavView, selectRecentThreads } from "../recentThreads";
import { HomeView } from "./HomeView";
import { CommanderView } from "./commander/CommanderView";
import { CommanderTrailingContext } from "./commander/TrailingContext";
import { CommanderProfile } from "./commander/CommanderProfile";
import { CommanderSettings } from "./commander/CommanderSettings";
import { useCommander } from "./commander/useCommander";
import { ProjectObjective } from "./commander/ProjectObjective";
import { commanderApi } from "./commander/api";
import { ThreadTitle } from "./ThreadTitle";
import { resolveHomeLaunch } from "./home-launch";
import { PermissionSelect, effectivePermissionMode } from "./PermissionSelect";
import { savedPermissionMode } from "./permission-mode";
import type { PermissionMode } from "./types";
import { AgentControls, defaultSelection, type AgentSelection } from "./AgentControls";
import { ApprovalMouse, ConversationActivity, MascotHero } from "./MascotScenes";
import { ScheduleManager } from "./ScheduleManager";
import { GitHistoryPanel } from "./GitHistoryPanel";
import { ShipButton, SHIP_PROMPT } from "./ShipButton";
import { tauriGitClient } from "./git-actions";
import type { PaneSelection } from "./git-history";
import { UsageFooter } from "./UsageFooter";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@freddai/ui/components/field";
import { Switch } from "@freddai/ui/components/switch";
import { ScrollArea } from "@freddai/ui/components/scroll-area";
import { ColorField } from "./ColorField";
import { ThreadStats } from "./ThreadStats";
import { WorkspaceSettings } from "./WorkspaceSettings";
import { SettingsPanel } from "./SettingsPanel";
import { AppearanceSettings } from "./AppearanceSettings";
import { useFontSizes } from "./use-font-sizes";
import { useTheme } from "./use-theme";
import { CompanionSettings } from "./CompanionSettings";
import { BackgroundSettings } from "./BackgroundSettings";
import { ConnectedAccountsSettings } from "./ConnectedAccountsSettings";
import { VoiceSettings } from "./VoiceSettings";
import { AgentConfigSettings } from "./AgentConfigSettings";
import { MicButton, VoiceNotice, useHoldToTalk } from "./VoiceControls";
import { useVoiceCall } from "./voiceCall";
import { VoiceCallBar } from "./VoiceCallBar";
import { joinDictation, focusEnd, shortcutLabel, useVoice, voice } from "./voice";
import { ImportSessions } from "./ImportSessions";
import { AccountOverview } from "./AccountOverview";
import { AccountSetup } from "./AccountSetup";
import { accountLabel } from "./types";
import { ThreadTranscript } from "../conversation/ThreadTranscript";
import { ThreadLinksProvider } from "../conversation/ThreadLinksContext";
import { TodoPanel } from "../conversation/TodoList";
import { reconcileSnapshot } from "./reconcileSnapshot";
import { applySnapshotDelta, type SnapshotReply } from "./applySnapshotDelta";
import { getDraft, setDraft as setThreadDraft, updateDraft, useDraft, useHasDraftText, saveDraftsForRestart, restoreDrafts, newThreadDraftKey } from "./drafts";
import { updateBanner } from "./app-update";
import { useAppUpdate } from "./use-app-update";
import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode, type Ref } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { mergeAttachments, runScreenGrab, type ScreenGrabDestination } from "./screen-grab";
import { Button } from "@freddai/ui/components/button";
type PanelImperativeHandle = { collapse: () => void; expand: () => void; isCollapsed: () => boolean; getSize: () => { asPercentage: number; inPixels: number }; resize: (size: number | string) => void };
import { Input } from "@freddai/ui/components/input";
import { Textarea } from "@freddai/ui/components/textarea";
import { SuggestTextarea } from "./ComposerSuggest";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@freddai/ui/components/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@freddai/ui/components/select";
import {
  useDefaultLayout,
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@freddai/ui/components/resizable";
import {
  Code2,
  FolderPlus,
  GitFork,
  GitBranch,
  GripVertical,
  Terminal,
  Plus,
  Search,
  Settings2,
  Paperclip,
  ArrowUp,
  ArrowDown,
  Square,
  Phone,
  Columns2,
  X,
  FolderGit2,
  Folder,
  FolderOpen,
  PanelLeft,
  Ellipsis,
  House,
  SquareTerminal,
} from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from "@freddai/ui/components/dropdown-menu";
import {
  empty,
  busy,
  resolveAccount,
  type Database,
  type Project,
  type Session,
  type Pending,
  type Attachment,
  type LaunchOptions,
} from "./types";
import { commandFor, shortcuts, navigation } from "./shortcuts";
import { terminalPanel } from "./terminal-panel-state";
import { TerminalPanel } from "./TerminalPanel";
import { runInTerminal } from "./terminal-sessions";
import { closePane, focusPane, focusedThread, openThreads, otherThread, restoreSplitView, selectThread, splitPreference, toggleSplit, type SplitPreference, type SplitSide, type SplitView } from "./split-view";
import { hostUpdateNotice, shouldSurfacePollError, RESTART_NOW_LABEL } from "./host-update";
import { interruptedThreads, interruptedBannerText, resumeAll, resumeFailureMessage } from "./interrupted";
import "../workspace.css";
import "./desktop.css";
import "./themes.css";
const colors = [
  "#b59ae9",
  "#77b9df",
  "#8ec6a2",
  "#e7a17d",
  "#e89cbd",
  "#d9c079",
];
function Picker({
  label,
  value,
  onChange,
  options,
  disabled = false,
  dropdown = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  dropdown?: boolean;
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent className="dev-popup" position={dropdown ? "popper" : "item-aligned"} side="bottom" align="start" avoidCollisions={!dropdown}>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function readPreference<T>(key: string, initial: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? initial;
  } catch {
    return initial;
  }
}
// Matches the stylesheet breakpoint where the selected thread takes over the main area.
function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 720px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 720px)");
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}
function usePreference<T>(key: string, initial: T) {
  const [v, set] = useState<T>(() => readPreference(key, initial));
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(v));
  }, [key, v]);
  return [v, set] as const;
}
function SplitToggle({ split, onToggle }: { split: boolean; onToggle: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={split ? "Close split view" : "Split view"}
      aria-pressed={split}
      title={`${split ? "Close split view" : "Split view"} (⌘ \\)`}
      onClick={onToggle}
    >
      <Columns2 size={15} />
    </Button>
  );
}
// The composer textarea owns its subscription to the thread's draft, so typing re-renders only this component.
function ReplyTextarea({ threadId, id, composerRef, placeholder, onSend }: {
  threadId: string; id?: string; composerRef?: Ref<HTMLTextAreaElement>; placeholder: string;
  onSend: (e?: FormEvent, steer?: boolean) => Promise<void>;
}) {
  const reply = useDraft(threadId);
  return (
    <SuggestTextarea
      id={id}
      composerRef={composerRef}
      aria-label="Message agent"
      placeholder={placeholder}
      value={reply}
      context={{ session: threadId }}
      onValueChange={(value) => setThreadDraft(threadId, value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          void onSend(undefined, e.metaKey || e.ctrlKey);
        }
      }}
    />
  );
}
function SendButton({ threadId, label, blocked }: { threadId: string; label: string; blocked: boolean }) {
  const hasText = useHasDraftText(threadId);
  return (
    <Button className="chat-send" size="icon" aria-label={label} disabled={blocked || !hasText}>
      <ArrowUp size={16} />
    </Button>
  );
}
// One conversation (header, transcript, composer). Drafts, attachments and agent controls arrive as props keyed by thread in the parent.
/** Deletes still-queued messages carrying the live-call marker (meaningless once the call ended). Returns whether any were deleted. */
async function purgeVoiceQueued(queue: { session: string; messages: { id: string; prompt: string }[] } | undefined): Promise<boolean> {
  const ids = (queue?.messages ?? []).filter(m => m.prompt.includes("<voice-call>")).map(m => m.id);
  for (const id of ids) await invoke("queue_action", { session: queue!.session, action: "delete", message: id, prompt: null });
  return ids.length > 0;
}

function ConversationPane({
  task, db, read, native, working, staging, standalone = false, split, side, focused, canToggleSplit, composerRef,
  attachments, onAttachments, permission, onPermission, selection, onSelection,
  onFocus, onClose, onOpenThread, onToggleSplit, onFork, onPopOut, onRename, onSend, onSendText, onQueueAction, onAttach,
  action, refresh, changeThread, openAccounts, fileChips, resumeThread,
}: {
  standalone?: boolean;
  task: Session; db: Database; read: Record<string, number>; native: boolean; working: boolean; staging: number;
  split: boolean; side: SplitSide; focused: boolean; canToggleSplit: boolean;
  composerRef?: Ref<HTMLTextAreaElement>;
  attachments: Attachment[]; onAttachments: (files: Attachment[]) => void;
  permission: PermissionMode; onPermission: (value: PermissionMode) => void;
  selection: AgentSelection; onSelection: (value: AgentSelection) => void;
  onFocus: () => void; onClose: () => void; onToggleSplit: () => void; onFork: () => void;
  onPopOut: () => void;
  onOpenThread: (id: string) => void;
  onRename: (title: string) => Promise<void>;
  onSend: (e?: FormEvent, steer?: boolean) => Promise<void>;
  /** Voice call: send exact text (queued when the thread is busy). Rejects on failure. */
  onSendText: (text: string) => Promise<void>;
  onQueueAction: (action: string, message?: string, prompt?: string) => Promise<boolean | undefined>;
  onAttach: () => void;
  action: <T>(fn: () => Promise<T>) => Promise<T | undefined>; refresh: () => Promise<void>;
  changeThread: (id: string, operation: string) => Promise<void>;
  openAccounts: () => void;
  resumeThread: (task: Session) => Promise<void>;
  fileChips: (files: Attachment[], set: (v: Attachment[]) => void) => ReactNode;
}) {
  const project = db.projects.find((p) => p.id === task.project),
    terminalCwd = task.working_dir || project?.path,
    terminalOpen = useSyncExternalStore(terminalPanel.subscribe, terminalPanel.getSnapshot).open,
    taskAccount = db.accounts.find((a) => a.id === task.account),
    taskQueue = db.queues?.find(q => q.session === task.id);
  const capabilities = threadCapabilities(task, !!taskAccount);
  // Hands-free voice call on this thread (Tauri only). Stop/send reuse the composer's own paths.
  const voiceCall = useVoiceCall({
    threadId: task.id,
    enabled: native && !!taskAccount && !task.archived && task.deleted_at == null,
    thread: {
      isBusy: () => busy(task),
      stopTurn: async () => { await invoke("stop", { session: task.id }); await refresh(); },
      sendText: onSendText,
      purgeVoiceQueue: async () => { if (await purgeVoiceQueued(db.queues?.find(q => q.session === task.id))) await refresh(); },
    },
    view: { busy: busy(task), messages: task.messages },
  });
  const [scheduleOpen,setScheduleOpen] = useState(false);
  const [renameRequest, setRenameRequest] = useState(0);
  const renameChosen = useRef(false);
  const transcript = useRef<HTMLDivElement>(null);
  const [showLatest, setShowLatest] = useState(false);
  const lastMessageCount = useRef(task.messages.length);
  useEffect(() => {
    const el = transcript.current;
    const appended = task.messages.length - lastMessageCount.current;
    lastMessageCount.current = task.messages.length;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 180) {
      // Ease to the bottom when a new item was appended; follow streaming text instantly.
      if (appended > 0 && appended < 4 && typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      else el.scrollTop = el.scrollHeight;
    }
  }, [task.messages, task.status, task.pending]);
  useEffect(() => {
    const el = transcript.current;
    if (!el) { setShowLatest(false); return; }
    el.scrollTop = el.scrollHeight;
    const measure = () => setShowLatest(el.scrollHeight - el.scrollTop - el.clientHeight > 24);
    const resize = new ResizeObserver(measure);
    const observe = () => {
      resize.disconnect();
      resize.observe(el);
      for (const child of el.children) resize.observe(child);
      measure();
    };
    const mutation = new MutationObserver(observe);
    mutation.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener("scroll", measure, { passive: true });
    observe();
    return () => { resize.disconnect(); mutation.disconnect(); el.removeEventListener("scroll", measure); };
  }, [task.id]);
  return (
    <section
      className={`thread-detail${split ? " split-pane" : ""}${split && focused ? " split-pane-focused" : ""}`}
      aria-label={split ? `Conversation, ${side} pane` : "Conversation"}
      onFocusCapture={onFocus}
      onPointerDownCapture={onFocus}
    >
      <BrowserWorkspace key={task.id} threadId={task.id}>
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}><DialogContent className="dark capture-panel"><DialogHeader><DialogTitle>Recurring tasks</DialogTitle><DialogDescription>Create from this thread or manage existing schedules.</DialogDescription></DialogHeader><ScheduleManager db={db} native={native} context={task} onRefresh={refresh} onSelect={id=>{setScheduleOpen(false);onOpenThread(id);}}/></DialogContent></Dialog>
      <div className="pane-title" data-tauri-drag-region={standalone || undefined} aria-current={split && focused ? "true" : undefined}>
        <span className="pane-project" title={project?.name}>
          <span className="pane-project-dot" style={{ background: project?.color }} aria-hidden="true" />
          <span className="pane-project-name">{project?.name}</span>
        </span>
        <span className="pane-sep" aria-hidden="true">/</span>
        <span className="pane-account" style={{ color: taskAccount?.color }} title={taskAccount ? agentDisplayName(taskAccount) : "Connection removed"}>
          {taskAccount?.provider === "codex" ? <Code2 size={14} /> : <Terminal size={14} />}
          <span>{taskAccount ? agentDisplayName(taskAccount) : "Connection removed"}</span>
        </span>
        <span className="pane-sep" aria-hidden="true">/</span>
        {(task.schedule_id || task.options?.scheduled) && <span title="Created by a scheduled task"><CalendarClock size={14} aria-label="Scheduled task" /></span>}
        <h1 className="pane-thread-title"><ThreadTitle key={task.id} title={task.title} onRename={onRename} editRequest={renameRequest} /></h1>
        <div className="conversation-header-actions">
          <span className="conversation-header-status" role="status"><Dot status={task.status}/><span className="status-label">{labelStatus(task.status)}</span></span>
          {native && <BrowserToggle />}
          {native && terminalCwd && <Button variant="ghost" size="icon" aria-label="Toggle terminal" aria-pressed={terminalOpen} title="Toggle terminal (Ctrl+`)" onClick={terminalPanel.toggle}><SquareTerminal size={16} /></Button>}
          {canToggleSplit && <SplitToggle split={split} onToggle={onToggleSplit} />}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Thread actions" title="Thread actions"><Ellipsis size={16} /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={e => { if (renameChosen.current) { e.preventDefault(); renameChosen.current = false; } }}>
              <DropdownMenuLabel className="thread-menu-label">{taskAccount ? agentDisplayName(taskAccount) : "Connection removed"}</DropdownMenuLabel>
              {native && !standalone && <DropdownMenuItem onSelect={onPopOut}><AppWindow size={14} aria-hidden="true" />Open in New Window</DropdownMenuItem>}
              {task.deleted_at == null && <DropdownMenuItem onSelect={() => void changeThread(task.id, task.pinned ? "unpin" : "pin")}>{task.pinned ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}{task.pinned ? "Unpin thread" : "Pin to project"}</DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => { renameChosen.current = true; setRenameRequest(n => n + 1); }}><Pencil size={14} aria-hidden="true" />Rename<DropdownMenuShortcut>F2</DropdownMenuShortcut></DropdownMenuItem>
              {!standalone && <DropdownMenuItem onSelect={()=>setScheduleOpen(true)}><CalendarClock size={14} aria-hidden="true" />Schedule recurring task…</DropdownMenuItem>}
              {!standalone && <DropdownMenuItem onSelect={onFork}><GitFork size={14} aria-hidden="true" />Fork thread<DropdownMenuShortcut>⌘⇧F</DropdownMenuShortcut></DropdownMenuItem>}
              {!task.deleted_at && <DropdownMenuItem
                disabled={working || !native || (task.archived ? !capabilities.change : !capabilities.archive || busy(task))}
                onSelect={() => void changeThread(task.id, task.archived ? "unarchive" : "archive")}
              >{task.archived ? <ArchiveRestore size={14} aria-hidden="true" /> : <Archive size={14} aria-hidden="true" />}{task.archived ? "Unarchive" : "Archive"}</DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onClose}><X size={14} aria-hidden="true" />{standalone ? "Close window" : split ? `Close ${side} pane` : "Close conversation"}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {(task.working_dir || task.deleted_at != null || task.archived) && <div className="detail-heading">
        <div className="detail-meta">
          {task.working_dir && <span title={task.working_dir}>Worktree</span>}
          {task.working_dir && !busy(task) && task.status !== "archived" && <Button size="sm" variant="ghost" onClick={() => void action(async () => { await invoke("remove_worktree", { session: task.id }); await refresh(); })}>Remove clean worktree</Button>}
          {task.deleted_at != null ? <Button size="sm" variant="outline" disabled={working || !native || !!db.host_update_pending} onClick={() => void changeThread(task.id, "restore")}>Restore thread</Button>
            : task.archived && <Button size="sm" variant="outline" disabled={working || !native || !!db.host_update_pending} onClick={() => void changeThread(task.id, "unarchive")}>Unarchive</Button>}
        </div>
      </div>}
      <div className="chat-surface">
        <div className="chat-transcript-viewport">
        <ScrollArea className="min-h-0 flex-1" viewportRef={transcript} viewportProps={{ className: "chat-transcript", role: "region", "aria-label": "Conversation messages" }}>
          {task.transcriptLoaded === false && <div role="status">Loading conversation details…</div>}
          <ThreadLinksProvider threads={db.sessions} projects={db.projects} onOpen={onOpenThread}>
          <ThreadTranscript readToolText={(message, offset, hash) => invoke("tool_text", { thread: task.id, message, offset, hash })} readGeneratedFile={(href, offset) => invoke("generated_file", { thread: task.id, href, offset })} resolveLocalPage={href => invoke("preview_file_url", { thread: task.id, href })} messages={task.messages} tasks={task.tasks} active={busy(task)} renderAttachment={file => <AttachmentLabel file={file}/>}>
          {(task.error || task.status === "interrupted") && (
            <ThreadError error={task.error || "This turn was interrupted."} onOpenAccounts={standalone ? undefined : openAccounts}
              onContinue={task.status === "interrupted" && capabilities.resume ? () => void action(async () => { await resumeThread(task); await refresh(); }) : undefined}
              continueDisabled={working || !native || !!db.host_update_pending} />
          )}
          {task.pending && (
            <div className="approval-with-mouse"><ApprovalMouse />
            <Permission
              key={`${task.id}:${JSON.stringify(task.pending.request_id ?? task.pending.id)}`}
              pending={task.pending}
              provider={taskAccount?.provider || "codex"}
              onReply={async (allow, answers) => {
                await invoke("respond", { session: task.id, requestId: JSON.stringify(task.pending?.request_id ?? task.pending?.id), allow, answers });
                await refresh().catch(() => {});
              }}
            />
            </div>
          )}
          <CommanderTrailingContext.Consumer>{trailing => trailing}</CommanderTrailingContext.Consumer>
          <ConversationActivity thread={task}
            onStop={capabilities.stop ? () => void action(async () => { await invoke("stop", { session: task.id }); await refresh(); }) : undefined}
            onResume={capabilities.resume ? () => void action(async () => { await resumeThread(task); await refresh(); }) : undefined}
            disabled={working || !native || !!db.host_update_pending} />
          </ThreadTranscript>
          </ThreadLinksProvider>
        </ScrollArea>
        {showLatest && <Button
          type="button"
          size="icon"
          variant="outline"
          className="jump-to-latest"
          aria-label="Scroll to latest message"
          title="Scroll to latest message"
          onClick={() => {
            const el = transcript.current;
            if (el) el.scrollTop = el.scrollHeight;
            setShowLatest(false);
            transcript.current?.focus({ preventScroll: true });
          }}
        ><ArrowDown size={18}/></Button>}
        </div>
        <TodoPanel key={`todos-${task.id}`} messages={task.messages} active={busy(task)}/>
        <ConversationUsage key={task.id} usage={task.usage}/>
        {taskQueue && <MessageQueue queue={taskQueue} active={busy(task)} disabled={working} canSteer={!!taskAccount} onAction={onQueueAction}/>}
        {voiceCall.snapshot && voiceCall.controller && <VoiceCallBar call={voiceCall.controller} snapshot={voiceCall.snapshot} agentBusy={busy(task)} onEnd={voiceCall.end}/>}
        <form className="chat-composer" onSubmit={e => void onSend(e)}>
          {fileChips(attachments, onAttachments)}
          <ReplyTextarea
            threadId={task.id}
            id={focused ? "thread-composer" : undefined}
            composerRef={composerRef}
            placeholder={
              busy(task)
                ? "Draft your next message…"
                : "Message your agent…"
            }
            onSend={onSend}
          />
          <VoiceNotice target={focused} />
          <div className="chat-composer-tools">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="composer-attach"
              aria-label="Attach files"
              title="Attach files (⌘ ⇧ U)"
              onClick={onAttach}
              disabled={!native}
            >
              <Plus size={20} />
            </Button>
            <MicButton target={focused} onText={(text, button) => {
              updateDraft(task.id, previous => joinDictation(previous, text));
              const box = button.closest("form")?.querySelector("textarea");
              setTimeout(() => focusEnd(box), 0);
            }} />
            {native && <Button type="button" variant="ghost" size="icon" className="composer-call" data-active={!!voiceCall.snapshot}
              aria-label={voiceCall.snapshot ? "End voice call" : "Start voice call"} title={voiceCall.snapshot ? "End voice call" : voiceCall.otherActive ? "A voice call is already running in another thread" : "Start a hands-free voice call"}
              disabled={!voiceCall.snapshot && !voiceCall.canStart} onClick={() => voiceCall.snapshot ? voiceCall.end() : voiceCall.start()}><Phone size={18}/></Button>}
            <PermissionSelect provider={taskAccount?.provider} value={permission} onChange={onPermission} disabled={working || (task.status === "archived" || !!task.archived || task.deleted_at != null)}/>
            <span className="composer-spacer"/>
            {(staging || attachments.length > 0) && <span className="attachment-status" role="status">
              {staging ? "Copying attachments…" : `${attachments.length} file${attachments.length === 1 ? "" : "s"} ready`}
            </span>}
            <AgentControls key={task.id} account={taskAccount} native={native} value={selection} onChange={onSelection} disabled={working || (task.status === "archived" || !!task.archived || task.deleted_at != null)}/>
            {busy(task) && <Button type="button" size="icon" variant="outline" aria-label="Stop current turn and pause queue" disabled={working} onClick={() => void action(async () => { await invoke("stop", { session: task.id }); await refresh(); })}><Square size={14}/></Button>}
            <SendButton
              threadId={task.id}
              label={busy(task) ? "Queue message" : "Send message"}
              blocked={
                !native || !taskAccount ||
                !!staging || working ||
                (!busy(task) && !task.provider_id) || (task.status === "archived" || !!task.archived || task.deleted_at != null)
              }
            />
          </div>
        </form>
        <p className={taskAccount ? "chat-composer-hint sr-only" : "chat-composer-hint"}>
          {taskAccount
            ? "Enter to send or queue · ⌘ Enter to steer · Shift Enter for new line"
            : "This connection was removed. Fork thread to continue with a connection you choose."}
        </p>
      </div>
      {native && terminalCwd && terminalOpen && (!split || focused) && <TerminalPanel cwd={terminalCwd} />}
      </BrowserWorkspace>
    </section>
  );
}
function EmptyPane({ side, focused, canToggleSplit, onFocus, onClose, onToggleSplit }: {
  side: SplitSide; focused: boolean; canToggleSplit: boolean;
  onFocus: () => void; onClose: () => void; onToggleSplit: () => void;
}) {
  return (
    <section
      className={`thread-detail split-pane${focused ? " split-pane-focused" : ""}`}
      aria-label={`Conversation, ${side} pane`}
      onFocusCapture={onFocus}
      onPointerDownCapture={onFocus}
    >
      <div className="pane-title" aria-current={focused ? "true" : undefined}>
        <span>No thread open</span>
        <div className="conversation-header-actions">
          {canToggleSplit && <SplitToggle split onToggle={onToggleSplit} />}
          <Button variant="ghost" size="icon" aria-label={`Close ${side} pane`} onClick={onClose}><X size={14} /></Button>
        </div>
      </div>
      <div className="native-empty">
        <MascotHero line="Pick a thread and I'll keep you company." />
        <Columns2 size={24} />
        <h2>Select a thread from the list</h2>
        <p>It opens in the highlighted pane.</p>
      </div>
    </section>
  );
}
export function DesktopApp() {
  return <DesktopWorkspace />;
}

function DesktopWorkspace() {
  const native = isTauri();
  const navigationRevision = useRef(0);
  const [windowThread] = useState(() => native ? new URLSearchParams(window.location.search).get("thread") || "" : "");
  const { theme, setTheme, saved: themeSaved, appearance } = useTheme();
  const fontSizes = useFontSizes();
  const [snapshot, setDb] = useState<Database>(empty),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [view, setView] = useNavigationState<SplitView>(() => windowThread ? { split: false, left: windowThread, right: "", focus: "left" } : restoreSplitView(readPreference<Partial<SplitPreference> | null>("freddai.split", null)), navigationRevision);
  // The focused pane's thread is "the selected thread"; selecting routes through the split-view state.
  const selected = focusedThread(view), secondary = otherThread(view);
  const [scheduleView, setScheduleView] = useNavigationState<{project: string; id?: string} | null>(null, navigationRevision);
  const [scheduleProjects, setScheduleProjects] = useState<string[]>([]);
  // Opening a thread from any list moves focus to its composer (after the click's own focus settles); narrow layouts skip it so the on-screen keyboard stays down.
  const setSelected = (id: string) => { if (windowThread) return; setScheduleView(null); setView(current => selectThread(current, id)); if (id && !narrowRef.current) setTimeout(() => composer.current?.focus(), 0); };
  const selectScheduleRun = (id: string) => setView(current => selectThread(current, id));
  const narrow = useNarrow();
  const narrowRef = useRef(narrow); narrowRef.current = narrow;
  const splitActive = view.split && !narrow;
  useEffect(() => { if (!windowThread) localStorage.setItem("freddai.split", JSON.stringify(splitPreference(view))); }, [view.split, view.right, windowThread]);
  // Non-thread main pane (git history). Cleared whenever a thread or the new-thread pane is chosen.
  const [pane, setPane] = useNavigationState<PaneSelection>(null, navigationRevision);
  useEffect(() => { if (selected) setPane(null); }, [selected]);
  const [launching, setLaunching] = useState<Session | null>(null);
  // Home hub is the landing view; it yields to any thread, new-thread draft or git pane the user opens.
  const [home, setHome] = useNavigationState(!windowThread, navigationRevision);
  const [commanderOpen, setCommanderOpen] = useState(false);
  const commanderThread = useRef("");
  const lastSelected = useRef(selected);
  useEffect(() => { if (selected && selected !== lastSelected.current) setHome(false); lastSelected.current = selected; }, [selected]);
  useEffect(() => { if (pane) setHome(false); }, [pane]);
  const [outgoing, setOutgoing] = useState<OutgoingReply[]>([]);
  // Stable identities: these are rebuilt only when the snapshot, pending sends or launch actually change.
  const [threadPins, setThreadPin] = useThreadPins();
  const visibleSnapshot = useMemo(() => ({ ...snapshot, queues: previewQueues(snapshot.queues, unconfirmedReplies(outgoing, snapshot.sessions, snapshot.queues)), sessions: previewReplies(snapshot.sessions, unconfirmedReplies(outgoing, snapshot.sessions, snapshot.queues)).map(t => Object.hasOwn(threadPins, t.id) ? { ...t, pinned: threadPins[t.id] } : t) }), [snapshot, outgoing, JSON.stringify(threadPins)]);
  useEffect(() => {
    setOutgoing(old => old.length ? unconfirmedReplies(old, snapshot.sessions, snapshot.queues) : old);
  }, [snapshot]);
  // Keep the launch visible even when an older in-flight snapshot arrives.
  const db = useMemo(() => launching && launching.id !== "pending-launch" && !visibleSnapshot.sessions.some(t => t.id === launching.id)
    ? { ...visibleSnapshot, sessions: [launching, ...visibleSnapshot.sessions] } : visibleSnapshot, [visibleSnapshot, launching]);
  useEffect(() => {
    if (!scheduleView?.id || selected) return;
    const run = [...(db.schedules?.find(s=>s.id===scheduleView.id)?.runs || [])].reverse().find(r=>r.session && db.sessions.some(t=>t.id===r.session));
    if (run?.session) selectScheduleRun(run.session);
  }, [db.schedules, db.sessions, scheduleView?.id, selected]);
  useEffect(() => {
    if (launching && snapshot.sessions.some(t => t.id === launching.id)) setLaunching(null);
  }, [snapshot, launching]);
  const [dialog, setDialog] = useNavigationState<
      "new" | "accounts" | "usage" | "settings" | "threads" | "projects" | "appearance" | "voice" | "agentconfig" | "commander" | "background" | "companion" | "project" | "help" | "schedules" | "import" | "google" | null
    >(null, navigationRevision),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [projectFilter, setProjectFilter] = useState("all");
  const [workspaceFilter, setWorkspaceFilter] = usePreference("freddai.workspace", "all");
  const workspaces = db.preferences.workspaces || [];
  const activeWorkspace = workspaceFilter === "all" ? undefined : workspaces.find(w => w.id === workspaceFilter);
  const workspaceProjects = db.projects.filter(p => !activeWorkspace || activeWorkspace.projects.includes(p.id));
  useEffect(() => {
    if (projectFilter !== "all" && !workspaceProjects.some(p => p.id === projectFilter)) setProjectFilter("all");
  }, [projectFilter, workspaceProjects.map(p => p.id).join(",")]);
  const [savedProjectOrder, setSavedProjectOrder] = usePreference<string[]>("freddai.projectOrder", []);
  const projectOrderWrites = useRef(0), projectOrderVersion = useRef(0);
  useEffect(() => {
    if (!native) return;
    let live = true;
    const sync = () => {
      if (projectOrderWrites.current) return;
      const version = projectOrderVersion.current;
      void invoke<string[] | null>("load_project_order").then(order => {
      if (live && order && version === projectOrderVersion.current) setSavedProjectOrder(previous => JSON.stringify(previous) === JSON.stringify(order) ? previous : order);
    }).catch(e => { if (live) setError(String(e)); }); };
    sync();
    const timer = window.setInterval(sync, 2000);
    return () => { live = false; window.clearInterval(timer); };
  }, [native]);
  const [projectDrag, setProjectDrag] = useState<{ id: string; target: string; after: boolean } | null>(null);
  const [collapsedProjects, setCollapsedProjects] = usePreference<string[]>("freddai.collapsedProjects", []);
  const [grouped, setGrouped] = usePreference("freddai.grouped", true),
    [ignoreUnread, setIgnoreUnread] = usePreference("freddai.ignoreUnread", false),
    [hideRead, setHideRead] = usePreference("freddai.hideRead", true),
    [storedNavView, setNavView] = usePreference<string>(THREAD_NAV_VIEW_KEY, "projects"),
    [recentPages, setRecentPages] = useState(0),
    [recentFinishedPref, setRecentFinished] = usePreference<number>("freddai.recentFinished", RECENT_FINISHED_DEFAULT),
    [readOverlay, setReadOverlay] = useState<Record<string, number>>({}),
    [olderPages, setOlderPages] = useState<Record<string, number>>({});
  // Publish only sidebar presentation settings; migrate existing local preferences on launch.
  const threadListSave = useRef(Promise.resolve<unknown>(undefined));
  useEffect(() => {
    if (!native) return;
    const thread_list = { projectOrder: savedProjectOrder, grouped, hideRead, ignoreUnread, recentFinished: sanitizeRecentCount(recentFinishedPref) };
    threadListSave.current = threadListSave.current
      .then(() => invoke("save_thread_list", { settings: thread_list }))
      .catch(e => setError(String(e)));
  }, [native, savedProjectOrder, grouped, hideRead, ignoreUnread, recentFinishedPref]);
  const [projectId, setProjectId] = useState(""),
    [accountId, setAccountId] = useState("default"),
    [newAttachments, setNewAttachments] = useState<Attachment[]>([]);
  const newDraftKey = newThreadDraftKey(projectId);
  const draft = useDraft(newDraftKey);
  const setDraft = (value: string | ((previous: string) => string)) =>
    setThreadDraft(newDraftKey, typeof value === "function" ? value(getDraft(newDraftKey)) : value);
  const [threadDialog, setThreadDialog] = useState<{ id: string; action: "move" | "delete" | "resume" | "review" } | null>(null);
  // Read state lives on the host (`read_at` per session); the overlay only bridges the poll gap after a local mark.
  const actualRead = useMemo(() => readFromThreads(db.sessions, readOverlay), [db.sessions, readOverlay]);
  const read = useMemo(() => statusReadCursors(db.sessions, actualRead, ignoreUnread), [db.sessions, actualRead, ignoreUnread]);
  const readSent = useRef(new Set<string>());
  function markThreadRead(t: Pick<Session, "id" | "updated">) {
    if ((actualRead[t.id] ?? -1) >= t.updated) return;
    setReadOverlay(r => (r[t.id] ?? -1) >= t.updated ? r : { ...r, [t.id]: t.updated });
    const key = `${t.id}:${t.updated}`;
    if (!native || readSent.current.has(key)) return;
    readSent.current.add(key);
    invoke("mark_read", { thread: t.id, at: t.updated }).catch(error => {
      readSent.current.delete(key);
      console.error("[read-sync] mark_read failed", { thread: t.id, at: t.updated, error: String(error) });
    });
  }
  useEffect(() => {
    if (!native) return;
    void migrateLocalRead("freddai.read", localStorage, cursors => invoke("merge_read", { cursors }));
  }, [native]);
  const [moveProject, setMoveProject] = useState("");
  const resumeRequest = useRef(crypto.randomUUID());
  const [resumePrompt, setResumePrompt] = useState("Continue where you left off.");
  const dialogThread = db.sessions.find(t => t.id === threadDialog?.id);
  const [worktree, setWorktree] = useState(false), [model, setModel] = useState(""), [effort, setEffort] = useState("default");
  const [homeAccount, setHomeAccount] = usePreference<string>("freddai.home-agent-account", "");
  const [homeSelections, setHomeSelections] = usePreference<Record<string, AgentSelection>>("freddai.home-agent-selections", {});
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("bypass");
  const [replyPermissions, setReplyPermissions] = useState<Record<string, PermissionMode>>({});
  const [replySelections, setReplySelections] = useState<Record<string, AgentSelection>>({});
  // Reply drafts and attachments belong to a thread and survive navigation for this app session.
  // Reply text lives in the external draft store (./drafts) so keystrokes do not re-render this component.
  const [replyAttachments, setReplyAttachments] = useState<Record<string, Attachment[]>>({});
  const draftRequest = useRef(crypto.randomUUID()), replyRequests = useRef<Record<string, string>>({});
  const replyRequest = (id: string) => replyRequests.current[id] ??= crypto.randomUUID();
  // Where files may land: the new-thread composer, or the composer of any thread still open in a pane.
  const targetRef = useRef("");
  targetRef.current = dialog === "new" ? "new" : selected;
  const liveTargets = useRef<string[]>([]);
  const [staging, setStaging] = useState(0);
  const grabbing = useRef(false), [grabbingUi, setGrabbing] = useState(false);
  const projectNavigation = useRef<HTMLElement>(null);
  const importingProjects = useRef(false);
  const [projectDropActive, setProjectDropActive] = useState(false);
  const [projectImportBusy, setProjectImportBusy] = useState(false);
  const [working, setWorking] = useState(false);
  const [accountReturn, setAccountReturn] = useState<
    "project" | "new" | "settings" | "usage" | null
  >(null);
  const settingsVisible = dialog !== null && dialog !== "new";
  const onboardingChecked = useRef(false);
  function openAccounts() {
    setAccountReturn(
      dialog === "project" || dialog === "new" || dialog === "settings" || dialog === "usage"
        ? dialog
        : null,
    );
    setDialog("accounts");
  }
  function finishAccounts() {
    setDialog(accountReturn);
    setAccountReturn(null);
  }
  const [editing, setEditing] = useState<Project>({
      id: "",
      name: "",
      path: "",
      color: colors[0],
      policy: "inherit",
      account: null,
      last: null,
    }),
    [helpQuery, setHelpQuery] = useState("");
  const search = useRef<HTMLInputElement>(null),
    composer = useRef<HTMLTextAreaElement>(null),
    list = useRef<HTMLDivElement>(null),
    newPrompt = useRef<HTMLTextAreaElement>(null);
  const actionLock = useRef(false);
  const accountSelectionSave = useRef<Promise<unknown>>(Promise.resolve());
  const task = db.sessions.find((t) => t.id === selected),
    taskAccount = db.accounts.find((a) => a.id === task?.account);
  const openIds = openThreads(splitActive ? view : { ...view, split: false, left: selected });
  const commanderData = useCommander({ todos: false, enabled: native });
  const [dashboardCallActive, setDashboardCallActive] = useState(false);
  const snapshotScope = useRef<string[]>([]);
  const scopeKey = JSON.stringify([...new Set([...(home || dialog === "new" ? [] : openIds), ...(dashboardCallActive && commanderData.state?.thread_id ? [commanderData.state.thread_id] : [])])].sort());
  snapshotScope.current = JSON.parse(scopeKey);
  const openTasks = openIds.flatMap(id => db.sessions.find(t => t.id === id) ?? []);
  liveTargets.current = dialog === "new" ? ["new"] : openIds;
  const threadPaneLayout = useDefaultLayout({
    id: windowThread ? "freddai.thread-window-panes" : "freddai.thread-panes",
    onlySaveAfterUserInteractions: true,
  });
  const listPanel = useRef<PanelImperativeHandle | null>(null);
  const [listHidden, setListHidden] = useState(!!windowThread);
  const threadWindowFocused = useRef(false);
  useEffect(() => {
    if (windowThread && task && listPanel.current && !threadWindowFocused.current) {
      listPanel.current.collapse();
      threadWindowFocused.current = true;
    }
  }, [windowThread, task]);
  function toggleList() {
    const panel = listPanel.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand(); else panel.collapse();
  }
  const destination = db.projects.find((p) => p.id === projectId);
  const effective =
    accountId === "default" ? resolveAccount(db, destination) : accountId;
  const newAccount = db.accounts.find(a => a.id === effective);
  const replySelectionFor = (t: Session) => replySelections[t.id] || { model: t.options?.model || "", effort: t.options?.effort || "default" };
  useEffect(() => { setModel(""); setEffort("default"); }, [newAccount?.provider]);
  const [trackThreadRecency] = useState(browserThreadRecencyTracker);
  const rawSnapshot = useRef<Database>(empty);
  function acceptSnapshot(next: Database) {
    // Keep unchanged sessions/messages/projects reference-equal across polls so identical snapshots cause no re-render.
    const raw = reconcileSnapshot(rawSnapshot.current, next);
    rawSnapshot.current = raw;
    const tracked = { ...raw, sessions: trackThreadRecency(raw.sessions) };
    setDb(current => reconcileSnapshot(current, tracked));
  }
  // Revision/host the next `snapshot_since` is relative to, and a tail so overlapping polls and
  // refreshes run one at a time (an older partial reply must never land after a newer one).
  const syncCursor = useRef<{ revision: number; hostId: string | null; tail: Promise<unknown>; scope?: string }>({ revision: 0, hostId: null, tail: Promise.resolve() });
  function fetchSnapshot(): Promise<Database> {
    const cursor = syncCursor.current;
    const run = async (): Promise<Database> => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const openThreads = snapshotScope.current;
        const scope = JSON.stringify(openThreads);
        if (cursor.scope !== scope) { cursor.revision = 0; cursor.hostId = null; cursor.scope = scope; }
        const reply = await invoke<SnapshotReply>("snapshot_since", { revision: cursor.revision, hostId: cursor.hostId, openThreads });
        if (JSON.stringify(snapshotScope.current) !== scope) continue; // navigation changed while the request was in flight
        const next = applySnapshotDelta(rawSnapshot.current, reply);
        if (next) {
          cursor.revision = reply.revision;
          cursor.hostId = reply.hostId;
          if (!reply.unchanged) acceptSnapshot(next);
          return next;
        }
        cursor.revision = 0; cursor.hostId = null; // inconsistent delta: ask for a full snapshot
      }
      throw new Error("Snapshot out of sync with the host");
    };
    const result = cursor.tail.then(run, run);
    cursor.tail = result.catch(() => {});
    return result;
  }
  async function refresh() {
    if (native) await fetchSnapshot();
  }
  useEffect(() => {
    if (native) void fetchSnapshot().catch(() => {}); // navigation hydrates immediately; regular polling handles retry/errors
  }, [native, scopeKey]);
  async function action<T>(fn: () => Promise<T>): Promise<T | undefined> {
    if (actionLock.current) return;
    actionLock.current = true;
    setWorking(true);
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError(String(e));
      return undefined;
    } finally {
      actionLock.current = false;
      setWorking(false);
    }
  }
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    async function poll() {
      try {
        const d = await fetchSnapshot();
        failures = 0;
        if (!disposed) {
          if (!onboardingChecked.current) {
            onboardingChecked.current = true;
            if (!windowThread && !d.accounts.length) setDialog("accounts");
          }
        }
      } catch (e) {
        // The host may restart briefly while it upgrades itself; the next poll reconnects.
        failures += 1;
        if (!disposed && shouldSurfacePollError(failures)) setError(String(e));
      }
      if (!disposed) timer = setTimeout(poll, 350);
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [native]);
  useEffect(() => {
    const markVisibleRead = () => {
      if (!dialog && !threadDialog && document.visibilityState === "visible" && document.hasFocus())
        for (const t of openTasks) if (t.status === "done" || t.status === "failed") {
          markThreadRead(t);
        }
    };
    markVisibleRead();
    window.addEventListener("focus", markVisibleRead);
    document.addEventListener("visibilitychange", markVisibleRead);
    return () => {
      window.removeEventListener("focus", markVisibleRead);
      document.removeEventListener("visibilitychange", markVisibleRead);
    };
  }, [openTasks.map(t => `${t.id}:${t.status}:${t.updated}`).join(), dialog, threadDialog, native, read]);
  // Navigation restores saved text without deleting drafts or staged files from other threads.
  useEffect(() => {
    const savedNewDraft = restoreDrafts(openIds);
    if (savedNewDraft) updateDraft(newThreadDraftKey(""), current => current || savedNewDraft);
  }, [openIds.join()]);
  function selectNewAccount(value: string) {
    setAccountId(value);
    if (native && value !== "default") {
      const patch = { last_selected: value };
      // Remember the choice without taking the send lock. Serialize rapid changes
      // so an older write cannot overwrite the latest choice; polling refreshes it.
      accountSelectionSave.current = accountSelectionSave.current
        .then(() => invoke("save_preferences", { patch }))
        .catch(e => { setError(String(e)); });
    }
  }
  function newThread() { openNewThread(true); }
  function openNewThread(focus: boolean) {
    newThreadInProject(projectFilter !== "all"
      ? projectFilter
      : "", focus);
  }
  // Above the single-pane (mobile) breakpoint the list always has a pane beside it: with nothing open, that is the new-thread draft.
  // Opening it only fills in local draft state; no thread is created until the user sends.
  useEffect(() => {
    if (!narrow && !home && !commanderOpen && !selected && !dialog && !pane && !scheduleView && !threadDialog && !launching) openNewThread(false);
  }, [narrow, home, commanderOpen, selected, dialog, pane, scheduleView, threadDialog, launching]);
  useEffect(() => { if (dialog === "new") setHome(false); }, [dialog]);
  const respondProposal = async (id: string, approve: boolean) => { await commanderApi.proposalRespond(id, approve); await commanderData.refresh(); };
  const homeActive = home && dialog !== "new" && !scheduleView && !commanderOpen;
  const commanderActive = commanderOpen && !dialog && !scheduleView && !pane;
  // Commander-in-Chief view: reuses the normal conversation for its thread; any other navigation closes it.
  useEffect(() => { if (selected && selected !== commanderThread.current) setCommanderOpen(false); }, [selected]);
  useEffect(() => { if (pane || scheduleView || dialog === "new") setCommanderOpen(false); }, [pane, scheduleView, dialog]);
  function openCommander() {
    setScheduleView(null); setDialog(null); setPane(null);
    setCommanderOpen(true);
  }
  /** Dashboard cluster / mic / plus: continue Commander's thread, or start one in the commander project. */
  async function sendToCommander(text: string) {
    if (!native) throw new Error("Open the Freddai desktop app to message Commander.");
    if (!hasSpeech(text)) return;
    const state = await commanderApi.state();
    if (state.thread_id) { await invoke("queue_message", { session: state.thread_id, prompt: text, options: { request_id: crypto.randomUUID() } }); await refresh(); }
    else await createHomeThread(state.project.id, text);
  }
  function goHome() {
    setScheduleView(null);
    setDialog(null);
    setAccountReturn(null);
    setPane(null);
    setCommanderOpen(false);
    setHome(true);
  }
  function newThreadInProject(project: string, focus = true) {
    setScheduleView(null);
    setWorktree(db.preferences.use_worktree ?? false);
    setModel(""); setEffort("default");
    draftRequest.current = crypto.randomUUID();
    setAccountId("default");
    setProjectId(project);
    setDialog("new");
    if (focus) setTimeout(() => newPrompt.current?.focus(), 0);
  }
  function forkThread(thread = task) {
    if (!thread) return;
    newThreadInProject(thread.project); setThreadDraft(newThreadDraftKey(thread.project), `Continue this work in a new conversation. Prior conversation (reference only):\n\n${thread.messages.filter(m => ["user","assistant"].includes(m.role)).map(m => `${m.role}: ${m.text}`).join("\n\n").slice(-24000)}`);
  }
  function addProject() {
    setEditing({
      id: "",
      name: "",
      path: "",
      color: colors[db.projects.length % colors.length],
      policy: "inherit",
      account: null,
      last: null,
    });
    setDialog("project");
  }
  // The one place staged files land in a composer: the new-thread composer or a thread's own draft.
  function addAttachments(target: string, files: Attachment[]) {
    const add = (old: Attachment[]) => mergeAttachments(old, files);
    if (target === "new") setNewAttachments(add); else setReplyAttachments(previous => ({ ...previous, [target]: add(previous[target] ?? []) }));
  }
  async function screenGrab(destination: ScreenGrabDestination) {
    if (!native || grabbing.current) return;
    grabbing.current = true; setGrabbing(true); setError("");
    try {
      await runScreenGrab(destination, {
        invoke,
        currentThread: selected,
        isLive: target => liveTargets.current.includes(target),
        openNewThread: newThread,
        addAttachments,
        focusComposer: target => setTimeout(() => (target === "new" ? newPrompt : composer).current?.focus(), 0),
        showError: setError,
        showNotice: setNotice,
      });
    } finally { grabbing.current = false; setGrabbing(false); }
  }
  async function stage(paths: string[], target: string) {
    if (!target || !paths.length) return;
    setStaging(n => n + 1);
    try {
      const files = await invoke<Attachment[]>("stage_attachments", { paths });
      if (!liveTargets.current.includes(target)) { setNotice("Files were copied. Attach again in the intended conversation."); return; }
      addAttachments(target, files);
    } catch (e) { setError(String(e)); }
    finally { setStaging(n => n - 1); }
  }
  async function attach(target = targetRef.current) {
    if (!native) return;
    const paths = await open({ multiple: true, directory: false, title: "Attach files" });
    if (paths) await stage(typeof paths === "string" ? [paths] : paths, target);
  }
  async function importProjects(paths: string[]) {
    if (importingProjects.current || !paths.length) return;
    importingProjects.current = true;
    setProjectImportBusy(true);
    setError("");
    const imported: Project[] = [], failures: string[] = [];
    try {
      for (const path of new Set(paths)) {
        try {
          imported.push(await invoke<Project>("import_project", {
            path, color: colors[(db.projects.length + imported.length) % colors.length],
          }));
        } catch (e) { failures.push(`${path}: ${String(e)}`); }
      }
      if (imported.length) {
        await refresh();
        setProjectFilter(imported[imported.length - 1].id);
        setFilter("all"); setQuery(""); setOlderPages({});
        setNotice(imported.length === 1 ? `${imported[0].name} is ready. Use + to start a thread.` : `${imported.length} project folders are ready.`);
      }
    } catch (e) { failures.push(String(e)); }
    finally {
      if (failures.length) setError(failures.join("\n"));
      importingProjects.current = false;
      setProjectImportBusy(false);
    }
  }
  useEffect(() => {
    if (!native) return;
    let off: (() => void) | undefined, disposed = false;
    void listenNativeDrops(getCurrentWindow().label, event => {
      if (event.type === "leave") { setProjectDropActive(false); return; }
      const inNavigation = projectDropTarget(event.position,
        projectNavigation.current?.getBoundingClientRect(), window.devicePixelRatio, settingsVisible || !!threadDialog);
      setProjectDropActive(event.type !== "drop" && inNavigation);
      if (event.type !== "drop") return;
      if (inNavigation) { void importProjects(event.paths); return; }
      if (!threadDialog && (dialog === "new" || (!dialog && selected)))
        void stage(event.paths, targetRef.current);
    }).then(f => { if (disposed) f(); else off = f; }).catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; off?.(); };
  }, [native, dialog, threadDialog, selected, db.projects.length]);
  function focusList() {
    if (listPanel.current?.isCollapsed()) listPanel.current.expand();
    const row =
      list.current?.querySelector<HTMLElement>('[aria-current="true"]') ||
      list.current?.querySelector<HTMLElement>(".task-row");
    if (row) row.focus();
    else search.current?.focus();
  }
  // Push-to-talk dictation: refresh settings on focus, hold the configured key to talk into the visible composer.
  const voiceShortcut = useSyncExternalStore(voice.subscribe, () => { const s = voice.getSnapshot().status; return s?.ready ? s.shortcut : ""; });
  useEffect(() => {
    if (!native) return;
    if (!/Mac/.test(navigator.platform)) return;
    void voice.refresh();
    const refresh = () => void voice.refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [native]);
  useHoldToTalk({
    canListen: () => !settingsVisible && !threadDialog && (dialog === "new" || !!selected),
    onText: text => {
      if (dialog === "new") { setDraft(previous => joinDictation(previous, text)); setTimeout(() => focusEnd(newPrompt.current), 0); }
      else if (selected) { updateDraft(selected, previous => joinDictation(previous, text)); setTimeout(() => focusEnd(composer.current), 0); }
    },
  });
  useEffect(() => {
    function key(e: KeyboardEvent) {
      const command = commandFor(e);
      if (threadDialog || document.querySelector('[role="menu"], .attachment-preview')) return;
      if (settingsVisible) {
        if (command === "home") { e.preventDefault(); goHome(); return; }
        if (settingsVisible && e.key === "Escape" && !e.isComposing && !document.querySelector('[role="listbox"], [role="dialog"]')) {
          e.preventDefault();
          if (dialog === "accounts") finishAccounts();
          else if (dialog === "project") setDialog("projects");
          else { setDialog(null); setTimeout(focusList, 0); }
        }
        return;
      }
      if (windowThread && command && !["terminal", "composer", "attach", "stop"].includes(command)) { e.preventDefault(); return; }
      if (command) {
        e.preventDefault();
        switch (command) {
          case "home": goHome(); break;
          case "schedules": setDialog("schedules"); break;
          case "fork": forkThread(); break;
          case "split": if (!narrow) setView(toggleSplit); break;
          case "terminal": if (native) terminalPanel.toggle(); break;
          case "new":
            newThread();
            break;
          case "search":
            search.current?.focus();
            search.current?.select();
            break;
          case "settings":
            setDialog("settings");
            break;
          case "accounts":
            setDialog("usage");
            break;
          case "projects":
            addProject();
            break;
          case "list":
            focusList();
            break;
          case "composer":
            (dialog === "new" ? newPrompt : composer).current?.focus();
            break;
          case "attention":
            setFilter("attention");
            focusList();
            break;
          case "attach":
            void attach();
            break;
          case "stop":
            if (task && busy(task))
              void action(() => invoke("stop", { session: task.id }));
            break;
          case "help":
            setDialog("help");
            break;
        }
      } else if (
        e.key === "Escape" &&
        !e.isComposing &&
        !document.querySelector('[role="listbox"]')
      ) {
        e.preventDefault();
        setSelected("");
        setTimeout(focusList, 0);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [dialog, threadDialog, task, db, projectFilter, narrow]);
  async function start(e?: FormEvent) {
    e?.preventDefault();
    if (!db.accounts.length) {
      openAccounts();
      return;
    }
    if (!native || working || staging || !newAccount || !destination || !draft.trim()) return;
    await action(async () => {
      await launchThread({
        project: projectId, account: effective, prompt: draft, attachments: newAttachments, requestId: draftRequest.current,
        options: { permission_mode: effectivePermissionMode(newAccount?.provider, permissionMode), worktree, model: model.trim() || null, effort: effort === "default" || !["codex","claude"].includes(db.accounts.find(a => a.id === effective)?.provider || "") ? null : effort, attachments: newAttachments.map(f => f.id), request_id: draftRequest.current },
      });
      setDraft("");
      setNewAttachments([]);
      await refresh();
    });
  }
  /** The single launch path: used by the New thread composer and by Home's per-project prompt. */
  async function launchThread({ project, account, prompt, attachments, requestId, options, select = true, onCreated }: {
    project: string; account: string; prompt: string; attachments: Attachment[]; requestId: string; options: LaunchOptions;
    /** False for Home tiles: the thread appears in the snapshot but is not opened, so Home stays put. */
    select?: boolean;
    onCreated?: (id: string) => void;
  }) {
    const preview: Session = {
      id: "pending-launch", project, account,
      title: prompt.trim().split("\n")[0].slice(0, 100), status: "starting",
      updated: Date.now(), provider_id: null, pending: null, error: null,
      messages: [{ id: requestId, role: "user", text: prompt, attachments }],
    };
    const sentNavigation = navigationRevision.current;
    setLaunching(preview);
    try {
      const commander = db.projects.find(p => p.id === project)?.kind === "commander";
      const existing = commander ? (await commanderApi.state()).thread_id : null;
      const sid = await invoke<string>("launch", { project, account: existing ? null : account, prompt, options, existing });
      onCreated?.(sid);
      setLaunching({ ...preview, id: sid });
      if (select && navigationRevision.current === sentNavigation) {
        setSelected(sid);
        if (commander) { commanderThread.current = sid; setCommanderOpen(true); }
        setDialog(null);
      }
      return sid;
    } catch (error) {
      setLaunching(null);
      throw error;
    }
  }
  // Keep a call begun in the empty composer alive when its first utterance opens the thread.
  const newCallThread = useRef<string | null>(null);
  const newCallSession = db.sessions.find(t => t.id === newCallThread.current) ?? (launching?.id === newCallThread.current ? launching : undefined);
  const newVoiceCall = useVoiceCall({
    threadId: "new-thread-call",
    enabled: native && dialog === "new" && !!newAccount && !!destination && !working,
    thread: {
      isBusy: () => !!newCallSession && busy(newCallSession),
      stopTurn: async () => { if (newCallThread.current) { await invoke("stop", { session: newCallThread.current }); await refresh(); } },
      sendText: async prompt => {
        if (newCallThread.current) {
          if (!newCallSession) throw new Error("The new conversation is still loading.");
          await send(newCallSession, undefined, false, prompt);
          return;
        }
        if (!native || !newAccount || !destination || actionLock.current) throw new Error("Choose a ready project and agent before starting a call.");
        actionLock.current = true; setWorking(true);
        try {
          const requestId = crypto.randomUUID();
          await launchThread({ onCreated: id => { newCallThread.current = id; }, project: projectId, account: effective, prompt, attachments: [], requestId,
            options: { permission_mode: effectivePermissionMode(newAccount.provider, permissionMode), worktree, model: model.trim() || null, effort: effort === "default" ? null : effort, attachments: [], request_id: requestId } });
          await refresh();
        } finally { actionLock.current = false; setWorking(false); }
      },
    },
    view: { busy: !!newCallSession && busy(newCallSession), messages: newCallSession?.messages ?? [] },
  });
  useEffect(() => {
    if (!newVoiceCall.snapshot?.active) { newCallThread.current = null; return; }
    if (dialog === "new" && !newCallThread.current) return;
    if (newCallThread.current === selected && !dialog && !homeActive && !settingsVisible) return;
    newVoiceCall.end();
  }, [dialog, selected, homeActive, settingsVisible, newVoiceCall.snapshot?.active]);
  // Home prompt: same launch path and defaults as a fresh New thread draft (project/global default account,
  // saved worktree preference, current default permission mode). Errors propagate to the tile.
  const resolveHomeTile = (project: string) => resolveHomeLaunch(db, project, permissionMode, homeSelections, homeAccount);
  async function createHomeThread(project: string, prompt: string): Promise<string> {
    if (!native) throw new Error("Open the Freddai desktop app to start threads.");
    const plan = resolveHomeTile(project);
    if (!plan.ok) { if (!db.accounts.length) openAccounts(); throw new Error(plan.reason); }
    if (actionLock.current) throw new Error("Another action is still running.");
    actionLock.current = true; setWorking(true); setError("");
    try {
      const requestId = crypto.randomUUID();
      await launchThread({
        project: plan.project, account: plan.account, prompt, attachments: [], requestId, select: false,
        options: { permission_mode: plan.permission_mode, worktree: plan.worktree, model: plan.model, effort: plan.effort, attachments: [], request_id: requestId },
      });
      await refresh();
      return prompt.trim().split("\n")[0].slice(0, 100);
    } finally { actionLock.current = false; setWorking(false); }
  }
  /** Dashboard command center launch: new thread in the project with the card's agent/model/difficulty. Never goes through Commander. */
  async function launchCommand({ projectId, accountId, model, effort, prompt }: { projectId: string; accountId: string; model: string; effort: string; prompt: string }) {
    if (!native) throw new Error("Open the Freddai desktop app to start threads.");
    const account = db.accounts.find(a => a.id === accountId);
    if (!account) throw new Error("The selected agent account no longer exists.");
    const base = resolveHomeLaunch(db, projectId, permissionMode, {}, accountId);
    if (!base.ok) throw new Error(base.reason);
    if (actionLock.current) throw new Error("Another action is still running.");
    actionLock.current = true; setWorking(true); setError("");
    try {
      const requestId = crypto.randomUUID();
      await launchThread({
        project: projectId, account: accountId, prompt, attachments: [], requestId, select: false,
        options: { permission_mode: base.permission_mode, worktree: base.worktree, model: model.trim() || null, effort: effort === "default" || !["codex", "claude"].includes(account.provider) ? null : effort, attachments: [], request_id: requestId },
      });
      await refresh();
    } finally { actionLock.current = false; setWorking(false); }
  }
  async function respondHome(thread: Session, allow: boolean, answers: Record<string, unknown>) {
    await invoke("respond", { session: thread.id, requestId: JSON.stringify(thread.pending?.request_id ?? thread.pending?.id), allow, answers });
    await refresh().catch(() => {});
  }
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState("");
  const appUpdate = useAppUpdate(native, () => saveDraftsForRestart(""));
  const appUpdateBanner = updateBanner(appUpdate.state);
  const [interruptedDismissed, setInterruptedDismissed] = useState(false);
  const interruptedList = interruptedThreads(db.sessions).filter(t => threadCapabilities(t, db.accounts.some(a => a.id === t.account)).resume);
  useEffect(() => { if (interruptedList.length === 0) setInterruptedDismissed(false); }, [interruptedList.length]);
  async function restartNow() {
    setRestarting(true);
    setRestartError("");
    try {
      const interrupted = await invoke<number>("restart_host_now");
      console.info(JSON.stringify({ event: "host_upgrade.forced", interrupted }));
      await refresh();
    } catch (e) {
      console.error(JSON.stringify({ event: "host_upgrade.force_failed", error: String(e) }));
      setRestartError(`Restart failed: ${String(e)}`);
    } finally {
      setRestarting(false);
    }
  }
  async function resumeThread(task: Session, prompt = "Continue where you left off.") {
    if (db.queues?.some(q => q.session === task.id)) await invoke("queue_action", { session: task.id, action: "pause", message: null });
    await invoke("launch", { project: task.project, account: null, existing: task.id, prompt, options: { request_id: crypto.randomUUID() } });
  }
  async function resumeAllInterrupted() {
    await action(async () => {
      const { failures } = await resumeAll(interruptedList, resumeThread);
      await refresh();
      if (failures.length) throw new Error(resumeFailureMessage(failures));
    });
  }
  /** `override` sends that exact text (voice call) instead of the draft: the draft and attachments stay untouched and failures throw to the caller. */
  async function send(task: Session, e?: FormEvent, steer = false, override?: string) {
    e?.preventDefault();
    const taskAccount = db.accounts.find(a => a.id === task.account), reply = override ?? getDraft(task.id), attachments = override === undefined ? replyAttachments[task.id] ?? [] : [];
    if (override !== undefined) {
      if (!native || !taskAccount || task.status === "archived" || !!task.archived || task.deleted_at != null) throw new Error("This thread cannot receive messages right now.");
      if (!reply.trim()) return;
      if (actionLock.current) throw new Error("Another action is still running.");
      actionLock.current = true; setWorking(true);
      try {
        const requestId = replyRequest(task.id);
        const command = busy(task) || !!db.queues?.find(q => q.session === task.id)?.messages.some(m => !isCompletionNotice(m)) ? "queue_message" : "launch";
        setOutgoing(old => [...old, { thread: task.id, message: { id: requestId, role: "user", text: reply, attachments, delivery: "Sending…" }, queued: command === "queue_message", options: { attachments: [] }, ordinal: task.messages.filter(m => m.role === "user" && m.text === reply).length + 1 }]);
        try {
          await invoke(command, {
            session: task.id, project: task.project, account: null, prompt: reply,
            options: { permission_mode: effectivePermissionMode(taskAccount.provider, replyPermissions[task.id] || savedPermissionMode(task.options?.permission_mode)), model: replySelectionFor(task).model.trim() || null, effort: replySelectionFor(task).effort === "default" ? null : replySelectionFor(task).effort, update_agent_controls: true, attachments: [], request_id: requestId },
            existing: task.id,
          });
        } catch (error) {
          setOutgoing(old => old.filter(m => m.message.id !== requestId));
          throw error;
        }
        setOutgoing(old => old.map(m => m.message.id === requestId ? { ...m, message: { ...m.message, delivery: "Sent · syncing…" } } : m));
        delete replyRequests.current[task.id];
        await refresh();
      } finally { actionLock.current = false; setWorking(false); }
      return;
    }
    // "!command" runs in the thread's terminal panel instead of going to the agent ("!!" sends a literal "!" message).
    const terminalCwd = task.working_dir || db.projects.find(p => p.id === task.project)?.path;
    if (native && terminalCwd && !attachments.length && /^!(?!!)/.test(reply) && reply.slice(1).trim()) {
      runInTerminal(terminalCwd, reply.slice(1).trim());
      setThreadDraft(task.id, "");
      return;
    }
    if (!native || working || staging || !taskAccount || (task.status === "archived" || !!task.archived || task.deleted_at != null) || !reply.trim()) return;
    await action(async () => {
      const requestId = replyRequest(task.id);
      const command = steer && busy(task) ? "steer_message" : busy(task) || !!db.queues?.find(q => q.session === task.id)?.messages.some(m => !isCompletionNotice(m)) ? "queue_message" : "launch";
      setOutgoing(old => [...old, { thread: task.id, message: { id: requestId, role: "user", text: reply, attachments, delivery: "Sending…" }, queued: command === "queue_message", options: { attachments: attachments.map(f => f.id) }, ordinal: task.messages.filter(m => m.role === "user" && m.text === reply).length + 1 }]);
      setThreadDraft(task.id, "");
      setReplyAttachments(previous => ({ ...previous, [task.id]: [] }));
      try {
        await invoke(command, {
        session: task.id,
        project: task.project,
        account: null,
        prompt: reply,
        options: { permission_mode: effectivePermissionMode(taskAccount.provider, replyPermissions[task.id] || savedPermissionMode(task.options?.permission_mode)), model: replySelectionFor(task).model.trim() || null, effort: replySelectionFor(task).effort === "default" ? null : replySelectionFor(task).effort, update_agent_controls: true, attachments: attachments.map(f => f.id), request_id: requestId },
        existing: task.id,
      });
      } catch (error) {
        setOutgoing(old => old.filter(m => m.message.id !== requestId));
        updateDraft(task.id, previous => previous ? `${reply}\n${previous}` : reply);
        setReplyAttachments(previous => ({ ...previous, [task.id]: [...attachments, ...(previous[task.id] || [])] }));
        throw error;
      }
      setOutgoing(old => old.map(m => m.message.id === requestId ? { ...m, message: { ...m.message, delivery: "Sent · syncing…" } } : m));
      delete replyRequests.current[task.id];
      await refresh();
    });
  }
  async function queueActionFor(task: Session, queueAction: string, message?: string, prompt?: string) {
    if (queueAction === "delete") {
      // Not gated by the global action lock/working flag: deleting must work while a turn or another action runs. Errors propagate to the queue UI.
      await invoke("queue_action", { session: task.id, action: "delete", message: message || null, prompt: null });
      await refresh();
      return true;
    }
    return action(async () => {
      await invoke("queue_action", { session: task.id, action: queueAction, message: message || null, prompt: prompt ?? null });
      await refresh();
      return true;
    });
  }
  const commanderProject = db.projects.find(p => p.kind === "commander");
  const commanderProjectId = commanderProject?.id;
  const sorted = db.sessions.filter(t => !isCommanderThread(t, commanderProjectId))
    .sort(compareThreadRecency)
    .filter(
      (t) =>
        threadVisibility(t, filter) &&
        (!activeWorkspace || activeWorkspace.projects.includes(t.project)) &&
        (projectFilter === "all" || t.project === projectFilter) &&
        t.title.toLowerCase().includes(query.toLowerCase()) &&
        (["all", "archived", "deleted"].includes(filter) ||
          (filter === "attention" &&
            ["unread", "waiting", "failed", "interrupted"].includes(threadListStatus(t, read))) ||
          (filter === "running" && busy(t)) ||
          (filter === "failed" && t.status === "failed") ||
          (filter === "done" && threadListStatus(t, read) === "done") ||
          (filter === "scheduled" && !!t.options?.scheduled)),
    );
  const defaultProjectOrder = [...new Set([
    ...sorted.map((t) => t.project),
    ...(!query && filter === "all" ? workspaceProjects.filter(p =>
      (projectFilter === "all" || projectFilter === p.id),
    ).map(p => p.id) : []),
  ])];
  // The Commander project always sorts first.
  const fullProjectOrder = [...new Set([
    ...(commanderProjectId ? [commanderProjectId] : []),
    ...savedProjectOrder.filter(id => db.projects.some(p => p.id === id)),
    ...defaultProjectOrder,
    ...db.projects.map(p => p.id),
  ])];
  const projectOrder = fullProjectOrder.filter(id => id !== commanderProjectId && defaultProjectOrder.includes(id));
  function moveProjectGroup(id: string, target: string, after: boolean) {
    if (id === target) return;
    const next = fullProjectOrder.filter(p => p !== id);
    const index = next.indexOf(target);
    if (index < 0) return;
    next.splice(index + (after ? 1 : 0), 0, id);
    setSavedProjectOrder(next);
    if (native) {
      projectOrderVersion.current++; projectOrderWrites.current++;
      void invoke("save_project_order", { order: next }).catch(e => setError(String(e))).finally(() => { projectOrderWrites.current--; });
    }
  }
  // Two buckets: active (live) rows, then an unlabeled continuation of the newest `recentFinished` read/finished rows (per project when grouped,
  // across all projects when flat), then older rows revealed OLDER_PAGE_SIZE at a time. Selection never moves a row between buckets;
  // only a selected row that would be hidden under "older" is appended to Recent so the open thread stays visible.
  const recentFinished = sanitizeRecentCount(recentFinishedPref);
  const buckets = bucketThreads(sorted, {
    read, selected, recentCount: recentFinished, scope: grouped ? "grouped" : "flat", hideRead, filter, pinned: secondary,
    queued: t => db.queues?.find(q => q.session === t.id)?.messages.filter(m => !isBackgroundWake(m)).length ?? 0,
  });
  // "Recent" is one flat list across every project, newest first; it honours the same search/project/status filters as the project view.
  const navView = asThreadNavView(storedNavView);
  const recent = selectRecentThreads(sorted, recentPages);
  const olderFor = (pid: string) => buckets.older.filter(t => t.project === pid);
  const shownOlder = (pid: string) => olderFor(pid).slice(0, (olderPages[pid] ?? 0) * OLDER_PAGE_SIZE);
  const recentFor = (pid: string) => buckets.recent.filter(t => t.project === pid);
  const visible = buckets.active;
  async function renameThread(session: string, title: string) {
    if (native) await invoke("rename_session", { session, title });
    setDb(current => ({ ...current, sessions: current.sessions.map(t => t.id === session ? { ...t, title } : t) }));
  }
  async function changeThread(id: string, operation: string, project?: string) {
    if (operation === "pin" || operation === "unpin") {
      setThreadPin(id, operation === "pin");
      return;
    }
    await action(async () => {
      await invoke("thread_action", { session: id, action: operation, project: project || null });
      await refresh();
      setThreadDialog(null);
    });
  }
  function openThreadDialog(t: Session, operation: "move" | "delete" | "resume" | "review") {
    setError("");
    setMoveProject(t.project);
    setResumePrompt("Continue where you left off.");
    resumeRequest.current = crypto.randomUUID();
    setThreadDialog({ id: t.id, action: operation });
  }
  function row(t: Session) {
    const a = db.accounts.find((a) => a.id === t.account);
    const capabilities = threadCapabilities(t, !!a);
    const disabled = working || !native || !!db.host_update_pending;
    const removalDisabled = working || !native;
    return (
      <ContextMenu key={t.id}>
      <ContextMenuTrigger asChild>
      <div
        role="button"
        tabIndex={0}
        className={`task-row compact-session ${selected === t.id ? "task-selected" : ""}${splitActive && secondary === t.id ? " task-open-other" : ""}`}
        aria-current={selected === t.id ? "true" : undefined}
        data-open-pane={splitActive && secondary === t.id ? "other" : undefined}
        aria-description={splitActive && secondary === t.id ? "Open in the other pane" : undefined}
        onClick={() => { setPane(null); setSelected(t.id); setDialog(null); }}
        onKeyDown={(e) => {
          if ((e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) && !(e.target instanceof HTMLInputElement)) {
            e.preventDefault(); e.stopPropagation();
            const bounds = e.currentTarget.getBoundingClientRect();
            e.currentTarget.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: bounds.left + 20, clientY: bounds.bottom - 4 }));
            return;
          }
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPane(null); setSelected(t.id); setDialog(null); return; }
          const rows = Array.from(
            list.current?.querySelectorAll<HTMLElement>(".task-row") ||
              [],
          );
          const index = rows.indexOf(e.currentTarget);
          const target =
            e.key === "ArrowDown"
              ? Math.min(rows.length - 1, index + 1)
              : e.key === "ArrowUp"
                ? Math.max(0, index - 1)
                : e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? rows.length - 1
                    : -1;
          if (target >= 0) {
            e.preventDefault();
            rows[target]?.focus();
          }
        }}
      >
        <span
          className="session-agent"
          title={a ? agentDisplayName(a) : "Connection removed"}
          aria-label={a ? agentDisplayName(a) : "Connection removed"}
          style={{ color: a?.color }}
        >
          {a?.provider === "codex" ? <Code2 size={14} /> : <Terminal size={14} />}
        </span>
        <strong className="session-title"><ThreadTitle title={t.title} displayTitle={t.schedule_id ? t.title : threadListTitle(t.title, t.messages)} onRename={title => renameThread(t.id, title)} /></strong>
        {(!grouped || navView === "recent") && (
          <span
            className={navView === "recent" ? "session-project thread-project-chip" : undefined}
            title={db.projects.find((p) => p.id === t.project)?.name}
            style={{
              color: db.projects.find((p) => p.id === t.project)?.color,
            }}
          >
            {db.projects.find((p) => p.id === t.project)?.name}
          </span>
        )}
        {(t.schedule_id || t.options?.scheduled) && <span title="Created by a scheduled task"><CalendarClock size={12} aria-label="Scheduled task" /></span>}
        {t.pinned && <Pin size={12} aria-label="Pinned to project" className="thread-pin" />}
        <Dot status={threadListStatus(t, read)} />
      </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="thread-context-menu" aria-label={`Actions for ${t.title}`}>
        <ContextMenuLabel className="thread-menu-label">{t.title}</ContextMenuLabel>
        {native && <ContextMenuItem onSelect={() => void action(() => invoke("open_thread_window", { session: t.id }))}><AppWindow size={14} aria-hidden="true" />Open in New Window</ContextMenuItem>}
        {t.deleted_at == null && <ContextMenuItem onSelect={() => void changeThread(t.id, t.pinned ? "unpin" : "pin")}>{t.pinned ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}{t.pinned ? "Unpin thread" : "Pin to project"}</ContextMenuItem>}
        {!ignoreUnread && (t.status === "done" || t.status === "failed") && <ContextMenuItem onSelect={() => markThreadRead(t)}><CheckCheck size={14} aria-hidden="true" />Mark as read</ContextMenuItem>}
        <ContextMenuItem disabled={working || !native || !capabilities.review} onSelect={() => openThreadDialog(t, "review")}><ClipboardCheck size={14} aria-hidden="true" />Review decision…</ContextMenuItem>
        <ContextMenuItem disabled={disabled || !capabilities.stop} onSelect={() => void action(async () => { await invoke("stop", { session: t.id }); await refresh(); })}><Square size={14} aria-hidden="true" />Stop</ContextMenuItem>
        <ContextMenuItem disabled={disabled || !capabilities.resume} onSelect={() => openThreadDialog(t, "resume")}><Play size={14} aria-hidden="true" />Resume…</ContextMenuItem>
        <ContextMenuSeparator />
        {capabilities.restore ?
          <ContextMenuItem disabled={disabled || busy(t)} onSelect={() => void changeThread(t.id, "restore")}><RotateCcw size={14} aria-hidden="true" />Restore thread</ContextMenuItem> : <>
          <ContextMenuItem disabled={t.archived ? disabled || !capabilities.change : removalDisabled || !capabilities.archive} onSelect={() => void changeThread(t.id, t.archived ? "unarchive" : "archive")}>{t.archived ? <ArchiveRestore size={14} aria-hidden="true" /> : <Archive size={14} aria-hidden="true" />}{t.archived ? "Unarchive" : "Archive"}</ContextMenuItem>
          <ContextMenuItem disabled={disabled || !capabilities.change || db.projects.length < 2} onSelect={() => openThreadDialog(t, "move")}><FolderInput size={14} aria-hidden="true" />Change project…</ContextMenuItem>
          <ContextMenuItem className="thread-menu-danger" disabled={removalDisabled || !capabilities.delete} onSelect={() => openThreadDialog(t, "delete")}><Trash2 size={14} aria-hidden="true" />Delete…</ContextMenuItem>
        </>}
      </ContextMenuContent>
      </ContextMenu>
    );
  }
  function recentGroup(threads: Session[], key: string) {
    if (!threads.length) return null;
    return <ThreadList key={`${filter}:${query}:${hideRead}:${recentFinished}:recent:${key}`} threads={threads} renderRow={row} />;
  }
  function older(pid: string) {
    const total = olderFor(pid).length;
    if (!total) return null;
    const pages = olderPages[pid] ?? 0;
    const shown = shownOlder(pid);
    const remaining = total - shown.length;
    const projectName = !grouped ? ` · ${db.projects.find(p => p.id === pid)?.name}` : "";
    return <div key={pid} className="thread-older">
      {groupThreadsByDay(shown).map(group => <div key={group.label || "today"}>
        {group.label && <div className="thread-day-label" role="separator" aria-label={group.label}>{group.label}</div>}
        {group.threads.map(row)}
      </div>)}
      {remaining > 0 && <Button className="thread-history" variant="ghost" size="sm"
        onClick={() => setOlderPages(p => ({ ...p, [pid]: pages + 1 }))}>
        {pages ? `Show ${Math.min(OLDER_PAGE_SIZE, remaining)} more` : "Show older threads"} ({remaining}){projectName}
      </Button>}
      {pages > 0 && <Button className="thread-history" variant="ghost" size="sm"
        aria-expanded
        onClick={() => setOlderPages(p => ({ ...p, [pid]: 0 }))}>
        Hide older threads{projectName}
      </Button>}
    </div>;
  }
  function fileChips(files: Attachment[], set: (v: Attachment[]) => void) {
    return (
      <div className="chat-attachments">
        {files.map((f) => (
          <span key={f.id} title={`${f.name} · ${Math.ceil(f.bytes / 1024)} KB`}>
            <AttachmentLabel file={f}/>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ${f.name}`}
              onClick={() => set(files.filter((p) => p !== f))}
            >
              <X size={12} />
            </Button>
          </span>
        ))}
      </div>
    );
  }
  // One pane of the conversation area; `side` is the pane when split, otherwise the single pane.
  function conversation(side: SplitSide) {
    const id = splitActive ? view[side] : selected, thread = db.sessions.find(t => t.id === id);
    const focused = !splitActive || view.focus === side;
    const toggle = { canToggleSplit: !windowThread && !narrow && (!splitActive || side === "right"), onToggleSplit: () => setView(toggleSplit) };
    const onFocus = () => setView(current => focusPane(current, side));
    const onClose = () => {
      if (windowThread) { void action(() => getCurrentWindow().close()); return; }
      if (splitActive) setView(current => closePane(current, side));
      else setSelected("");
      setTimeout(focusList, 0);
    };
    if (!thread) return splitActive ? <EmptyPane side={side} focused={focused} onFocus={onFocus} onClose={onClose} {...toggle} /> : null;
    return (
      <ConversationPane
        key={thread.id}
        standalone={!!windowThread}
        task={thread} db={db} read={read} native={native} working={working} staging={staging}
        split={splitActive} side={side} focused={focused} {...toggle}
        composerRef={focused ? composer : undefined}
        attachments={replyAttachments[thread.id] ?? []} onAttachments={files => setReplyAttachments(previous => ({ ...previous, [thread.id]: files }))}
        permission={replyPermissions[thread.id] || savedPermissionMode(thread.options?.permission_mode)}
        onPermission={value => setReplyPermissions(previous => ({ ...previous, [thread.id]: value }))}
        selection={replySelectionFor(thread)} onSelection={value => setReplySelections(previous => ({ ...previous, [thread.id]: value }))}
        onOpenThread={setSelected} onFocus={onFocus} onClose={onClose} onFork={() => forkThread(thread)}
        onPopOut={() => void action(() => invoke("open_thread_window", { session: thread.id }))}
        onRename={title => renameThread(thread.id, title)}
        onSend={(e, steer) => send(thread, e, steer)}
        onSendText={text => send(thread, undefined, false, text)}
        onQueueAction={(queueAction, message, prompt) => queueActionFor(thread, queueAction, message, prompt)}
        onAttach={() => void attach(thread.id)}
        action={action} refresh={refresh} changeThread={changeThread} openAccounts={openAccounts} fileChips={fileChips} resumeThread={resumeThread}
      />
    );
  }
  // Secondary windows mount only the conversation, never the workspace chrome or settings.
  if (windowThread) return (
    <div className={`dev-app native-workspace thread-window${native && /Mac/.test(navigator.platform) ? " native-macos" : ""}`}>
      {error && <div role="alert" className="native-error">{error}<Button variant="ghost" size="icon" aria-label="Dismiss error" onClick={() => setError("")}><X size={14}/></Button></div>}
      <main className="thread-window-content" aria-label="Thread window">
        {task ? conversation("left") : <div className="native-empty" role="status">{snapshot.sessions.length ? "This thread is unavailable." : "Loading thread…"}</div>}
      </main>
    </div>
  );
  return (
    <div className={`dev-app native-workspace${settingsVisible ? " settings-visible" : ""}${native && /Mac/.test(navigator.platform) ? " native-macos" : ""}`}>
      <a className="skip-link" href={settingsVisible ? "#settings-content" : "#thread-composer"}>
        {settingsVisible ? "Skip to settings" : "Skip to message composer"}
      </a>
      <header className="app-titlebar workbench-toolbar native-titlebar" data-tauri-drag-region>
        <div className="titlebar-leading" data-tauri-drag-region>
          <Button
            variant="ghost"
            size="icon"
            className="titlebar-sidebar-toggle"
            aria-label={listHidden ? "Show thread list" : "Hide thread list"}
            aria-pressed={!listHidden}
            title={listHidden ? "Show thread list" : "Hide thread list"}
            onClick={toggleList}
          >
            <PanelLeft size={16} />
          </Button>
        </div>
        <div className="titlebar-heading" data-tauri-drag-region>
          <span className="titlebar-brand" role="img" aria-label="Freddai" data-tauri-drag-region>
            <img src={brandMascotUrl} alt="" draggable={false} data-tauri-drag-region />
            <span aria-hidden="true" data-tauri-drag-region>fredd<span className="titlebar-brand-a" data-tauri-drag-region>a</span>i</span>
          </span>
        </div>
        <div className="titlebar-actions">
          <ThreadStats sessions={db.sessions.filter(t =>
            (!activeWorkspace || activeWorkspace.projects.includes(t.project)) &&
            (projectFilter === "all" || t.project === projectFilter))} />
          {native && <DashboardCall onActive={setDashboardCallActive} visible={homeActive && !settingsVisible} enabled={!!commanderData.state?.project.account || db.accounts.length > 0} sendText={sendToCommander} purgeVoiceQueue={async () => { if (await purgeVoiceQueued(db.queues?.find(q => q.session === commanderData.state?.thread_id))) await refresh(); }}
            commandCenter={{ projects: db.projects, accounts: db.accounts, native, homeAccountId: homeAccount || undefined, homeSelections, launch: launchCommand }}
            view={{ busy: db.sessions.some(t => t.id === commanderData.state?.thread_id && busy(t)), messages: db.sessions.find(t => t.id === commanderData.state?.thread_id)?.messages ?? [] }} />}
          <Button
            variant="ghost"
            size="icon"
            aria-label="New thread"
            title="New thread (⌘ N)"
            onClick={newThread}
          >
            <Plus size={16} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More actions" title="More actions"><Ellipsis size={16} /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="titlebar-menu">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={!native || grabbingUi}>Screen grab</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem disabled={!task || dialog === "new"} onSelect={() => void screenGrab("current")}>Attach to current thread</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void screenGrab("new")}>Start new thread</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onSelect={() => setDialog("schedules")}>Schedules<DropdownMenuShortcut>⌘⇧S</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuItem disabled={!native} onSelect={() => setDialog("import")}>Import sessions…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setDialog("settings")}>Settings<DropdownMenuShortcut>⌘,</DropdownMenuShortcut></DropdownMenuItem>
              <DropdownMenuItem onSelect={openAccounts}>Revisit onboarding</DropdownMenuItem>
              <DropdownMenuItem disabled={!native || appUpdate.state.state === "checking" || appUpdate.state.state === "downloading"} onSelect={() => void appUpdate.check()}>Check for updates</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      {!native && (
        <div className="native-banner">
          Open the Freddai macOS app to connect agents. This browser view cannot
          launch local sessions.
        </div>
      )}
      {hostUpdateNotice(db) && <div role="status" className="native-banner host-update-notice">
        <span>{hostUpdateNotice(db)}</span>
        <Button type="button" size="sm" variant="outline" disabled={!native || restarting} onClick={() => void restartNow()}>{restarting ? "Restarting…" : RESTART_NOW_LABEL}</Button>
      </div>}
      {appUpdateBanner && <div role={appUpdateBanner.error ? "alert" : "status"} className={`native-banner host-update-notice app-update-banner${appUpdateBanner.error ? " native-error" : ""}`}>
        <span>{appUpdateBanner.text}</span>
        {appUpdateBanner.action && <Button type="button" size="sm" variant="outline" onClick={() => void appUpdate.run(appUpdateBanner.action!.kind)}>{appUpdateBanner.action.label}</Button>}
      </div>}
      {appUpdate.notice && <div role="status" className="native-banner host-update-notice">
        <span>{appUpdate.notice}</span>
        <Button type="button" size="icon" variant="ghost" aria-label="Dismiss" title="Dismiss" onClick={appUpdate.dismissNotice}><X size={12} /></Button>
      </div>}
      {restartError && <div role="alert" className="native-error">{restartError}</div>}
      {interruptedList.length > 0 && !interruptedDismissed && <div role="status" className="native-banner interrupted-banner">
        <span>{interruptedBannerText(interruptedList.length)}</span>
        <Button type="button" size="sm" variant="outline" disabled={working || !native || !!db.host_update_pending} onClick={() => void resumeAllInterrupted()}>Resume all</Button>
        <Button type="button" size="icon" variant="ghost" aria-label="Dismiss interrupted threads notice" title="Dismiss" onClick={() => setInterruptedDismissed(true)}><X size={12} /></Button>
      </div>}
      {error && (
        <div role="alert" className="native-error">
          {error}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={14} />
          </Button>
        </div>
      )}

      {newVoiceCall.snapshot?.active && newVoiceCall.controller && <VoiceCallBar call={newVoiceCall.controller} snapshot={newVoiceCall.snapshot} agentBusy={!!newCallSession && busy(newCallSession)} onEnd={newVoiceCall.end} />}
      <div className="app-body">
        <main className="workbench">
          <div className={`workbench-panes ${scheduleView || (task && !homeActive) || dialog === "new" ? "has-detail" : ""}`}>
            <ResizablePanelGroup orientation="horizontal" defaultLayout={threadPaneLayout.defaultLayout} onLayoutChanged={threadPaneLayout.onLayoutChanged}>
              <ResizablePanel id="thread-list" defaultSize="42%" minSize="220px" collapsible collapsedSize="0%" collapsedThreshold="180px" panelRef={listPanel} onResize={size => setListHidden(size.asPercentage === 0)}>
                <section ref={projectNavigation} className="thread-browser project-navigation" aria-label="Threads" aria-busy={projectImportBusy}>
                  {(projectDropActive || projectImportBusy) && <div className="project-drop-overlay" role="status">
                    <FolderGit2 size={28} />
                    <strong>{projectImportBusy ? "Adding project folders…" : "Drop folders to add projects"}</strong>
                    <span>Folder names and your account defaults are used automatically.</span>
                  </div>}
                  {launching?.id === "pending-launch" && <div className="task-row compact-session" role="status" aria-label="Starting new thread"><Dot status="starting"/><span>{launching.title}</span><span>Starting…</span></div>}
                  <div className="dashboard-navigation">
                    <button
                      type="button"
                      className="dashboard-link"
                      aria-current={homeActive && !settingsVisible ? "page" : undefined}
                      title="Dashboard (⌘ 1)"
                      onClick={goHome}
                    >
                      <House size={15} aria-hidden="true" />
                      <span>Dashboard</span>
                    </button>
                    {commanderProject && <button
                      type="button"
                      className="dashboard-link"
                      aria-current={commanderActive && !settingsVisible ? "page" : undefined}
                      aria-label={`Open ${commanderProject.name}`}
                      title={`Open ${commanderProject.name}`}
                      onClick={openCommander}
                    >
                      <img src={brandMascotUrl} width={15} height={15} alt="" />
                      <span>{commanderProject.name}</span>
                    </button>}
                  </div>
                  <ThreadViewToggle value={navView} onChange={view => { setNavView(view); setRecentPages(0); }} />
                  <div className="list-heading list-search-row">
                    <div className="toolbar-search">
                      <Search size={13} />
                      <Input
                        ref={search}
                        aria-label="Search threads"
                        placeholder="Filter threads…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Add project"
                      title="Add project (⌘ ⇧ P)"
                      onClick={addProject}
                    >
                      <FolderPlus size={15} />
                    </Button>
                  </div>
                  <div className="thread-filter-row">
                    {workspaces.length > 0 && <Picker label="Workspace filter" dropdown value={activeWorkspace?.id || "all"}
                        onChange={v => { setWorkspaceFilter(v); setProjectFilter("all"); setOlderPages({}); if (v === "all") { setQuery(""); setFilter("all"); } }}
                        options={[{ value: "all", label: "All workspaces" }, ...workspaces.map(w => ({ value: w.id, label: w.name }))]} />}
                    <Picker
                      label="Project filter"
                      dropdown
                      value={projectFilter}
                      onChange={(v) => {
                        setProjectFilter(v);
                        setOlderPages({});
                      }}
                      options={[
                        { value: "all", label: "All projects" },
                        ...workspaceProjects.map((p) => ({
                          value: p.id,
                          label: p.name,
                        })),
                      ]}
                    />
                    <Picker
                      label="Status filter"
                      dropdown
                      value={filter}
                      onChange={(v) => {
                        setFilter(v);
                        setOlderPages({});
                      }}
                      options={[
                        { value: "all", label: "All threads" },
                        { value: "attention", label: ignoreUnread ? "Needs you" : "Needs attention" },
                        { value: "running", label: ignoreUnread ? "Working" : "Running" },
                        { value: "failed", label: "Failed" },
                        { value: "done", label: ignoreUnread ? "Done" : "Finished" },
                        { value: "scheduled", label: "Scheduled runs" },
                        { value: "archived", label: "Archived" },
                        { value: "deleted", label: "Deleted" },
                      ]}
                    />

                  </div>
                  <ScrollArea className="thread-list-scroll min-h-0 flex-1" viewportRef={list} viewportProps={{ className: "thread-list", "aria-label": "Thread list" }}>
                    {navView === "recent" ? (
                      <>
                        <ThreadList key={`recent:${filter}:${query}:${projectFilter}`} threads={recent.threads} renderRow={row} />
                        <RecentThreadsFooter className="thread-history" remaining={recent.remaining} expanded={recent.expanded}
                          onMore={() => setRecentPages(p => p + 1)} onLess={() => setRecentPages(0)} />
                        {!recent.threads.length && <p className="thread-recent-empty" role="status">No recent threads</p>}
                      </>
                    ) : grouped ? (
                      projectOrder.map((pid) => {
                        const p = db.projects.find((p) => p.id === pid);
                        const collapsed = collapsedProjects.includes(pid);
                        const projectSchedules = (db.schedules || []).filter(s => s.project === pid);
                        const attention = collapsed ? attentionCount(sorted.filter(t => t.project === pid), read, t => db.queues?.find(q => q.session === t.id)?.messages.filter(m => !isBackgroundWake(m)).length ?? 0) : 0;
                        return (
                          <section key={pid} data-project-id={pid} data-collapsed={collapsed} aria-label={`${p?.name} threads`}
                            className={projectDrag?.target === pid && projectDrag.id !== pid ? `project-reorder-${projectDrag.after ? "after" : "before"}` : undefined}>

                            <div className="project-group-heading">
                              <button type="button" className="project-drag-handle"
                                aria-label={`Reorder ${p?.name}`}
                                title="Drag to reorder · Alt+↑/↓ to move"
                                onKeyDown={e => {
                                  if (!e.altKey || !["ArrowUp", "ArrowDown"].includes(e.key)) return;
                                  e.preventDefault();
                                  const offset = e.key === "ArrowUp" ? -1 : 1;
                                  const target = projectOrder[projectOrder.indexOf(pid) + offset];
                                  if (target) moveProjectGroup(pid, target, offset > 0);
                                }}
                                onPointerDown={e => {
                                  if (e.button !== 0) return;
                                  e.currentTarget.setPointerCapture(e.pointerId);
                                  setProjectDrag({ id: pid, target: pid, after: false });
                                }}
                                onPointerMove={e => {
                                  if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                                  const section = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("section[data-project-id]");
                                  if (!section || !projectNavigation.current?.contains(section)) return;
                                  const bounds = section.getBoundingClientRect();
                                  setProjectDrag({ id: pid, target: section.dataset.projectId!, after: e.clientY > bounds.top + bounds.height / 2 });
                                  const viewport = list.current;
                                  if (viewport) {
                                    const rect = viewport.getBoundingClientRect();
                                    if (e.clientY < rect.top + 35) viewport.scrollTop -= 16;
                                    if (e.clientY > rect.bottom - 35) viewport.scrollTop += 16;
                                  }
                                }}
                                onPointerUp={e => {
                                  if (projectDrag && projectNavigation.current?.contains(document.elementFromPoint(e.clientX, e.clientY))) {
                                    moveProjectGroup(projectDrag.id, projectDrag.target, projectDrag.after);
                                  }
                                  setProjectDrag(null);
                                }}
                                onPointerCancel={() => setProjectDrag(null)}
                                onLostPointerCapture={() => setProjectDrag(null)}
                              ><GripVertical size={13} /></button>
                              {p?.kind === "commander" ? <>
                                <button type="button" className="project-toggle" aria-label={`Open ${p.name}`} title={`Open ${p.name}`} onClick={openCommander}>
                                  <strong style={{ color: p.color }}>{p.name}</strong>
                                </button>
                              </> : <button type="button" className="project-toggle"
                                aria-expanded={!collapsed}
                                aria-label={`${collapsed ? "Expand" : "Collapse"} ${p?.name}`}
                                title={`${collapsed ? "Expand" : "Collapse"} ${p?.name}`}
                                onClick={() => setCollapsedProjects(c => c.includes(pid) ? c.filter(x => x !== pid) : [...c, pid])}>
                                {collapsed ? <Folder size={14} style={{ color: p?.color }} /> : <FolderOpen size={14} style={{ color: p?.color }} />}
                                <strong style={{ color: p?.color }}>{p?.name}</strong>
                              </button>}
                              {collapsed && attention > 0 && <span className="project-attention" role="status" aria-label={`${attention} ${attention === 1 ? "thread needs" : "threads need"} attention in ${p?.name}`}>{attention}</span>}
                              {p?.kind !== "commander" && <>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="project-settings-button project-more-button"
                                    aria-label={`More actions for ${p?.name}`} title={`More actions for ${p?.name}`}><Ellipsis size={14} /></Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {native && <DropdownMenuItem onSelect={() => { setScheduleProjects(ids => ids.includes(pid) ? ids.filter(id => id !== pid) : [...ids, pid]); setCollapsedProjects(ids => ids.filter(id => id !== pid)); }}>
                                    <CalendarClock size={14} />Scheduled tasks ({projectSchedules.length})
                                  </DropdownMenuItem>}
                                  <DropdownMenuItem onSelect={() => { if (!view.split) setSelected(""); setDialog(null); setScheduleView(null); setPane({ kind: "git", projectId: pid }); }}>
                                    <GitBranch size={14} />Git history
                                  </DropdownMenuItem>
                                  {p && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => { setEditing(p); setDialog("project"); }}>
                                    <Settings2 size={14} />Project settings…
                                  </DropdownMenuItem></>}
                                </DropdownMenuContent>
                              </DropdownMenu>
                              {native && p?.path && <ShipButton projectId={pid} projectName={p.name} path={p.path} client={tauriGitClient} onShip={pid2 => createHomeThread(pid2, SHIP_PROMPT)}
                                activity={db.sessions.filter(t => t.project === pid).map(t => `${t.id}:${t.status}`).join("|")} />}
                              {native && <MicButton target={false} variant="ghost" className="project-settings-button project-mic-button"
                                label={`Dictate new task in ${p?.name}`}
                                onText={text => { void createHomeThread(pid, text).catch(e => setError(String(e))); }} />}
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`New task in ${p?.name}`}
                                title={`New task in ${p?.name}`}
                                className="project-settings-button"
                                onClick={() => newThreadInProject(pid)}
                              >
                                <Plus size={13} />
                              </Button>
                              </>}
                            </div>
                            {p?.kind !== "commander" && !collapsed && <>
                            {native && scheduleProjects.includes(pid) && <div className="project-schedules" aria-label={`${p?.name} scheduled tasks`}>
                              {projectSchedules.map(s => <button type="button" className="schedule-thread-row" key={s.id} aria-pressed={scheduleView?.id === s.id} onClick={() => {
                                setScheduleView({project: pid, id: s.id}); setHome(false); setDialog(null); setPane(null);
                                selectScheduleRun([...s.runs].reverse().find(r => r.session && db.sessions.some(t => t.id === r.session))?.session || (s.new_chat===false&&db.sessions.some(t=>t.id===s.thread)?s.thread!:""));
                              }}><CalendarClock size={15}/><span><strong>{s.name}</strong><small>{scheduleEnded(s) ? "Ended" : s.enabled ? `Next ${new Date(s.next_due).toLocaleString()}` : "Paused"}</small></span></button>)}
                              <Button variant="ghost" size="sm" onClick={() => { setScheduleView({project:pid}); setHome(false); setDialog(null); setPane(null); selectScheduleRun(""); }}> <Plus size={13}/> New scheduled task</Button>
                            </div>}
                            <ThreadList key={`${filter}:${query}:${hideRead}:${recentFinished}`} threads={visible.filter((t) => t.project === pid)} renderRow={row} />
                            {recentGroup(recentFor(pid), pid)}
                            {older(pid)}
                            </>}
                          </section>
                        );
                      })
                    ) : (
                      <>
                        <ThreadList key={`${filter}:${query}:${hideRead}:${projectFilter}:${recentFinished}`} threads={visible} renderRow={row} />
                        {recentGroup(buckets.recent, "all")}
                        {projectOrder.map(pid => older(pid))}
                      </>
                    )}
                    {!sorted.length && navView !== "recent" && (
                      <div className="native-empty">
                        <MascotHero line={db.projects.length ? "Nothing here yet. Want to start something?" : "Hi, I'm Freddai. Let's get you set up."} />
                        <FolderGit2 size={24} />
                        <h2>
                          {db.projects.length
                            ? "No matching threads"
                            : "Choose where you build"}
                        </h2>
                        <p>
                          {db.projects.length
                            ? "Start a thread or adjust your filters."
                            : "Add a local project folder, connect an account, then start a conversation."}
                        </p>
                        <Button
                          variant="outline"
                          onClick={db.projects.length ? newThread : addProject}
                        >
                          {db.projects.length ? "New thread" : "Add project"}
                        </Button>
                      </div>
                    )}

                  </ScrollArea>
                </section>
              </ResizablePanel>
              {dialog === "new" && <>
                <ResizableHandle withHandle />
                <ResizablePanel id="thread-detail" defaultSize="58%" minSize="20%">
                  <section className="thread-detail new-conversation" aria-label="New conversation">
                    <div className="pane-title"><span>New thread</span><Button variant="ghost" size="icon" className="ml-auto" aria-label="Close new conversation" onClick={() => { setDialog(null); setTimeout(focusList, 0); }}><X size={14}/></Button></div>
                    <div className="chat-surface">
                      <div className="chat-transcript" aria-label={launching ? "Starting conversation" : "Empty conversation"}>
                        {!launching && <MascotHero line="What should we work on today?" />}
                        {launching && <ThreadTranscript messages={[]} pending={[{ id: "launching", text: launching.messages[0]?.text || "", attachments: launching.messages[0]?.attachments }]} renderAttachment={file => <AttachmentLabel file={file}/>}><ConversationActivity thread={launching} /></ThreadTranscript>}
                      </div>
                      {error && <p role="alert" className="inline-error">{error}</p>}
                      {!db.accounts.length && <p className="new-conversation-note">Connect an agent account to start. <Button variant="ghost" size="sm" onClick={openAccounts}>Set up agents & accounts</Button></p>}
                      {!db.projects.length && <p className="new-conversation-note">Add a project folder to start. <Button variant="ghost" size="sm" onClick={() => { addProject(); }}>Add project</Button></p>}
                      <form className="chat-composer" onSubmit={start}>
                        {fileChips(newAttachments, setNewAttachments)}
                        <SuggestTextarea id="thread-composer" composerRef={newPrompt} autoFocus aria-label="Task prompt" placeholder="What should we work on?" disabled={!!launching} value={launching ? "" : draft} context={{ project: projectId, account: newAccount?.id }} onValueChange={setDraft} onKeyDown={e => {
                          if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing) { e.preventDefault(); void start(); }
                        }}/>
                        <div className="new-conversation-options">
                          <Picker label="Project" value={projectId || "__global__"} onChange={value => setProjectId(value === "__global__" ? "" : value)} options={[{ value: "__global__", label: "Select project" }, ...db.projects.map(p => ({ value: p.id, label: p.name }))]}/>
                          <Picker label="Agent and account" disabled={!native || working} value={effective || "default"} onChange={selectNewAccount} options={[...(!effective ? [{ value: "default", label: "No default account configured" }] : []), ...db.accounts.map(a => ({ value: a.id, label: agentDisplayName(a) }))]}/>
                          <label className="new-worktree" title={worktree ? "New branch from the current commit; uncommitted files stay in the original folder." : "Use the project folder directly. Your choice is remembered."}><input type="checkbox" checked={worktree} onChange={e => {
                            setWorktree(e.target.checked);
                            if (native) void action(() => invoke("save_preferences", { patch: { use_worktree: e.target.checked } }));
                          }}/>Separate worktree</label>
                        </div>
                        <VoiceNotice target />
                        <div className="chat-composer-tools">
                          <Button type="button" variant="ghost" size="icon" className="composer-attach" aria-label="Attach files" title="Attach files (⌘ ⇧ U)" onClick={() => void attach()} disabled={!native}><Plus size={20}/></Button>
                          <MicButton target onText={(text, button) => {
                            setDraft(previous => joinDictation(previous, text));
                            const box = button.closest("form")?.querySelector("textarea");
                            setTimeout(() => focusEnd(box), 0);
                          }} />
                          {native && <Button type="button" variant="ghost" size="icon" aria-label="Start voice call" title="Start a hands-free voice call" disabled={!newVoiceCall.canStart} onClick={() => { newCallThread.current = null; newVoiceCall.start(); }}><Phone size={18}/></Button>}
                          <PermissionSelect provider={newAccount?.provider} value={permissionMode} onChange={setPermissionMode} disabled={working}/>
                          <span className="composer-spacer"/>
                          {!!staging && <span className="attachment-status" role="status">Copying attachments…</span>}
                          <AgentControls account={newAccount} native={native} value={{ model, effort }} onChange={value => { setModel(value.model); setEffort(value.effort); }} disabled={working}/>
                          <Button className="chat-send" size="icon" aria-label="Start thread" title="Start thread" disabled={!native || !!staging || working || !newAccount || !draft.trim() || !destination}><ArrowUp size={16}/></Button>
                        </div>
                      </form>
                      <p className="sr-only">Enter to start · Shift Enter for new line</p>
                    </div>
                  </section>
                </ResizablePanel>
              </>}
              {homeActive && <>
                <ResizableHandle withHandle />
                <ResizablePanel id="thread-detail" defaultSize="58%" minSize="20%">
                  <div className="home-pane">
                    <HomeView
            sessions={db.sessions} read={read} projects={fullProjectOrder.flatMap(id => { const project = db.projects.find(p => p.id === id); return project ? [project] : []; })} accounts={db.accounts} schedules={db.schedules}
            workspaces={workspaces}
            onMoveProject={moveProjectGroup}
            canCreate={native && !working && !launching}
            onOpenThread={id => { setHome(false); setSelected(id); }}
            onAddProject={addProject}
            onNewThread={newThreadInProject}
            native={native} homeSelections={homeSelections} homeAccount={homeAccount} onHomeAccount={setHomeAccount}
            onHomeSelection={(account, selection) => setHomeSelections(previous => ({ ...previous, [account]: selection }))}
            onCreateThread={createHomeThread}
            commander={native ? { onOpen: openCommander, onSend: sendToCommander, proposals: Array.isArray(commanderData.proposals) ? commanderData.proposals : undefined, onProposalRespond: respondProposal } : undefined}
            resolveLaunch={resolveHomeTile}
            onRespond={respondHome}
          />
                  </div>
                </ResizablePanel>
              </>}
              {commanderActive && <>
                <ResizableHandle withHandle={!listHidden} />
                <ResizablePanel id="thread-detail" defaultSize="58%" minSize="20%">
                  <CommanderView projects={db.projects} schedules={db.schedules} threads={db.sessions.filter(t => !t.deleted_at)}
                    renderConversation={id => selected === id ? conversation(view.focus) : null}
                    onSelectThread={id => { commanderThread.current = id; if (selected !== id) setSelected(id); }}
                    onOpenThread={id => { commanderThread.current = ""; setCommanderOpen(false); setSelected(id); }}
                    onCreateThread={createHomeThread}
                    onManageSchedules={() => setDialog("schedules")}
                    onBack={goHome} />
                </ResizablePanel>
              </>}
              {pane?.kind === "git" && !dialog && !homeActive && !scheduleView && <>
                <ResizableHandle withHandle />
                <ResizablePanel id="thread-detail" defaultSize="58%" minSize="20%">
                  <GitHistoryPanel key={pane.projectId} project={db.projects.find(p => p.id === pane.projectId)} native={native} onClose={() => { setPane(null); setTimeout(focusList, 0); }} />
                </ResizablePanel>
              </>}
              {scheduleView && dialog !== "new" && <>
                <ResizableHandle withHandle/>
                <ResizablePanel id="schedule-workspace" defaultSize="70%" minSize="30%">
                  <ScheduleManager key={`${scheduleView.project}:${scheduleView.id || "new"}`} db={db} native={native} projectId={scheduleView.project} scheduleId={scheduleView.id} onRefresh={refresh} onSelect={selectScheduleRun} onDeleted={() => setScheduleView(null)} onClose={() => setScheduleView(null)} onSaved={id=>setScheduleView({project:scheduleView.project,id})}
                    conversation={({form}) => task ? conversation(view.focus) : <section className="thread-detail new-conversation" aria-label="Routine conversation">
                      <div className="pane-title"><span>{form.name || "New routine"}</span></div>
                      <div className="chat-surface">
                        <div className="chat-transcript"><div className="routine-empty"><CalendarClock size={24}/><h2>This routine hasn’t been run yet</h2><p>{form.id ? "Choose Run now in the configuration panel to start its first conversation." : "Add a name and schedule, then save your routine."}</p></div></div>

                      </div>
                    </section>}/>

                </ResizablePanel>
              </>}
              {dialog !== "new" && !homeActive && !commanderActive && !scheduleView && (task || splitActive) && !(pane?.kind === "git" && !dialog) && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel id="thread-detail" defaultSize="58%" minSize="20%">
                    {splitActive ? (
                      <ResizablePanelGroup orientation="horizontal">
                        {(["left", "right"] as const).map((side, index) => <Fragment key={side}>
                          {index > 0 && <ResizableHandle withHandle />}
                          <ResizablePanel defaultSize="50%" minSize="25%">{conversation(side)}</ResizablePanel>
                        </Fragment>)}
                      </ResizablePanelGroup>
                    ) : conversation(view.focus)}
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </div>
        </main>
      </div>
      <footer className="statusbar native-accounts">
        <span role="status" className="sr-only">
          {notice}
        </span>
        <ScrollArea orientation="horizontal" className="min-w-0 flex-1 h-full" viewportProps={{ "aria-label": "Accounts" }}><div className="footer-account-list">
        <UsageFooter accounts={db.accounts} native={native} onOpen={() => setDialog("usage")} />
        </div></ScrollArea>
        {!db.accounts.length && <Button variant="ghost" size="sm" onClick={openAccounts}>
          <Plus size={13} /> Connect accounts
        </Button>}
      </footer>
      <Dialog open={!!threadDialog} onOpenChange={open => { if (!open && !working) setThreadDialog(null); }}>
        <DialogContent className="capture-panel native-dialog" onCloseAutoFocus={e => { e.preventDefault(); focusList(); }}>
          <ScrollArea viewportProps={{ style: { maxHeight: "calc(85dvh - 3rem)" }, "aria-label": "Thread action details" }}><div className="grid gap-4 pr-3">
          <DialogHeader>
            <DialogTitle>{threadDialog?.action === "review" ? "Review decision" : threadDialog?.action === "resume" ? "Resume thread" : threadDialog?.action === "move" ? "Change project" : "Delete thread"}</DialogTitle>
            <DialogDescription>{dialogThread?.title || "This thread is no longer available."}</DialogDescription>
          </DialogHeader>
          {error && <p role="alert" className="inline-error">{error}</p>}
          {dialogThread && threadDialog?.action === "review" && (dialogThread.pending ?
            <Permission key={`${dialogThread.id}:${JSON.stringify(dialogThread.pending.request_id ?? dialogThread.pending.id)}`}
              pending={dialogThread.pending} provider={db.accounts.find(a => a.id === dialogThread.account)?.provider || "codex"}
              onReply={async (allow, answers) => {
                await invoke("respond", { session: dialogThread.id, requestId: JSON.stringify(dialogThread.pending?.request_id ?? dialogThread.pending?.id), allow, answers });
                setThreadDialog(null); await refresh().catch(() => {});
              }} /> : <p role="status">This decision is no longer pending.</p>)}
          {dialogThread && threadDialog?.action === "move" && <form onSubmit={e => { e.preventDefault(); void changeThread(dialogThread.id, "move", moveProject); }}>
            <p className="capture-help">Changes the thread’s project group. Its original working folder, account, and conversation stay the same. Queued messages will pause.</p>
            <label>Project<Picker label="Move thread to project" value={moveProject} onChange={setMoveProject} options={db.projects.map(p => ({ value: p.id, label: p.name }))}/></label>
            <Button disabled={working || !native || !!db.host_update_pending || busy(dialogThread) || !moveProject || moveProject === dialogThread.project}>Change project</Button>
          </form>}
          {dialogThread && threadDialog?.action === "delete" && <>
            <p>Permanently delete this thread and its queued messages from Freddai? This cannot be undone. Active work will stop in the background. Project files and provider-side conversation history are kept.</p>
            <Button variant="outline" disabled={working || !native} onClick={() => void changeThread(dialogThread.id, "purge")}>Delete permanently</Button>
          </>}
          {dialogThread && threadDialog?.action === "resume" && <form onSubmit={e => { e.preventDefault(); void action(async () => {
            if (db.queues?.some(q => q.session === dialogThread.id)) await invoke("queue_action", { session: dialogThread.id, action: "pause", message: null });
            await invoke("launch", { project: dialogThread.project, account: null, existing: dialogThread.id, prompt: resumePrompt, options: { request_id: resumeRequest.current } });
            await refresh(); setThreadDialog(null);
          }); }}>
            <p className="capture-help">Resumes the saved conversation with its existing account, working folder, and agent settings. Existing queued messages stay paused.</p>
            <label>Message<Textarea autoFocus aria-label="Resume message" value={resumePrompt} onChange={e => setResumePrompt(e.target.value)} /></label>
            <Button disabled={working || !native || !!db.host_update_pending || !resumePrompt.trim() || !threadCapabilities(dialogThread, db.accounts.some(a => a.id === dialogThread.account)).resume}>Resume thread</Button>
          </form>}
          <Button variant="ghost" disabled={working} onClick={() => setThreadDialog(null)}>Cancel</Button>
          </div></ScrollArea>
        </DialogContent>
      </Dialog>
      <SettingsPanel
        page={settingsVisible}
        open={settingsVisible}
        current={dialog || "settings"}
        onNavigate={setDialog}
        onClose={() => {
          setDialog(null); setAccountReturn(null); setTimeout(focusList, 0);
        }}
        onRestoreFocus={() => {
          if (task) composer.current?.focus();
          else search.current?.focus();
        }}
        title={
              dialog === "schedules" ? "Schedules" : dialog === "usage"
                ? "Accounts & usage"
                : dialog === "new"
                ? "New thread"
                : dialog === "accounts"
                  ? "Set up agents & accounts"
                  : dialog === "threads" ? "Thread display"
                  : dialog === "projects" ? "Projects"
                  : dialog === "import" ? "Import sessions"
                  : dialog === "appearance" ? "Appearance"
                  : dialog === "companion" ? "Devices & satellite"
                  : dialog === "voice" ? "Voice"
                  : dialog === "agentconfig" ? "Agent config"
                  : dialog === "commander" ? "Commander"
                  : dialog === "google" ? "Connected accounts"
                  : dialog === "background" ? "Background work"
                  : dialog === "settings"
                    ? "Agents & defaults"
                    : dialog === "project"
                      ? editing.id
                        ? `${editing.name} settings`
                        : "Add project"
                      : "Keyboard shortcuts"
        }
        description={
              dialog === "schedules" ? "Schedules belong to Freddai, independently of agent sign-ins." : dialog === "usage"
                ? "Usage limits and reset times across your accounts."
                : dialog === "new"
                ? "Choose the project and account for this conversation."
                : dialog === "accounts"
                  ? "Each agent’s accounts in one place. Sign in, then pick the default for new threads."
                  : dialog === "threads" ? "Choose how conversations appear in your workspace."
                  : dialog === "projects" ? "Manage local folders, project defaults, and workspaces."
                  : dialog === "import" ? "Bring Claude Code and Codex sessions started outside Freddai into your projects."
                  : dialog === "appearance" ? "Make Freddai feel at home with a workspace theme."
                  : dialog === "companion" ? "Generate a six-digit code, then approve your phone to connect to this Mac."
                  : dialog === "voice" ? "Push-to-talk dictation, transcribed on this Mac."
                  : dialog === "agentconfig" ? "MCP servers, hooks, plugins and memory files for Claude Code and Codex. Applies to new agent sessions."
                  : dialog === "commander" ? "Name, attitude and what Commander remembers. The app manages these quietly; edit only if you want to."
                  : dialog === "google" ? "Connect Google accounts and start agent work when mail arrives or your calendar and Drive change."
                  : dialog === "background" ? "Control startup and work that continues when the window closes."
                  : dialog === "settings"
                    ? "Manage agents and accounts, then choose the default for new conversations."
                    : dialog === "project"
                      ? "A local folder and the agent defaults for its threads."
                      : "Use Command on macOS, Control elsewhere. Shortcuts never approve agent actions."
        }
      >
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          {dialog === "schedules" && <ScheduleManager db={db} native={native} onRefresh={refresh} onSelect={id => { setSelected(id); setDialog(null); }}/>}
          {dialog === "usage" && <AccountOverview db={db} native={native} onManage={openAccounts} />}
          {dialog === "accounts" && (
            <AccountSetup
              db={db}
              native={native}
              onRefresh={refresh}
              onDone={finishAccounts}
            />
          )}
          {dialog === "project" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  await invoke("save_project", { project: editing });
                  setDialog("projects");
                  await refresh();
                });
              }}
            >
              <label>
                Project name
                <Input
                  value={editing.name}
                  onChange={(e) =>
                    setEditing((p) => ({ ...p, name: e.target.value }))
                  }
                />
              </label>
              <label>
                Local folder
                <Input
                  value={editing.path}
                  readOnly
                  placeholder="Choose a folder"
                />
              </label>
              {!editing.id && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!native}
                  onClick={() =>
                    void action(async () => {
                      const path = await open({
                        directory: true,
                        multiple: false,
                        title: "Select project folder",
                      });
                      if (typeof path === "string")
                        setEditing((p) => ({
                          ...p,
                          path,
                          name: p.name || path.split("/").pop() || "",
                        }));
                    })
                  }
                >
                  Choose folder
                </Button>
              )}
              <label>
                Project color
                <ColorField label="Project color" value={editing.color}
                  onChange={color => setEditing(p => ({ ...p, color }))} />
              </label>
              {editing.id && <ProjectObjective projectId={editing.id} objective={db.projects.find(p => p.id === editing.id)?.objective ?? editing.objective} disabled={!native} onSaved={refresh} />}
              <h3>Default agent & account</h3>
              {!db.accounts.length ? (
                <div className="setup-note">
                  <strong>No agent accounts connected yet</strong>
                  <p>
                    You can save this project now. Before starting a thread, set
                    up Codex or Claude Code and sign in to an account.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={openAccounts}
                  >
                    Set up agents & accounts
                  </Button>
                </div>
              ) : (
                <>
                  <Picker
                    label="Project agent policy"
                    value={editing.policy}
                    onChange={(v) =>
                      setEditing((p) => ({
                        ...p,
                        policy: v as Project["policy"],
                      }))
                    }
                    options={[
                      {
                        value: "inherit",
                        label: `Global default: ${accountLabel(db, resolveAccount(db))}`,
                      },
                      { value: "fixed", label: "Use this account for this project" },
                      {
                        value: "last",
                        label: "Remember last used in this project",
                      },
                    ]}
                  />
                  {editing.policy === "fixed" && (
                    <Picker
                      label="Project default account"
                      value={editing.account || ""}
                      onChange={(v) =>
                        setEditing((p) => ({ ...p, account: v }))
                      }
                      options={db.accounts.map((a) => ({
                        value: a.id,
                        label: agentDisplayName(a),
                      }))}
                    />
                  )}
                  <p className="capture-help">Project preferences apply when your new-thread setting allows them. Last selected and Global default everywhere take precedence. Manage this in Agents & defaults.</p>
                  <p className="capture-help">
                    {editing.policy === "fixed"
                      ? `New threads use ${accountLabel(db, editing.account || "")}.`
                      : editing.policy === "last"
                        ? `Remembers this project's last account. Until then: ${accountLabel(db, resolveAccount(db))}.`
                        : `Global default currently resolves to ${accountLabel(db, resolveAccount(db))}. Change it in account setup, or choose a specific account for this project.`}
                  </p>
                  <Button type="button" variant="ghost" onClick={openAccounts}>
                    Manage accounts & default
                  </Button>
                </>
              )}
              <p className="capture-help">
                Multiple conversations can run at the same time. Threads share the project files.
              </p>
              <Button
                disabled={
                  !native ||
                  working ||
                  !editing.name ||
                  !editing.path ||
                  (editing.policy === "fixed" && !editing.account)
                }
              >
                Save project
              </Button>
            </form>
          )}
          {dialog === "settings" && (
            <>
              <Field>
                <FieldLabel>Agent and connection for new threads</FieldLabel>
                <Picker label="New thread selection" disabled={!native || working} value={db.preferences.new_thread_policy || (db.preferences.prefer_last ? "legacy" : "project")} onChange={value => void action(async () => {
                  await invoke("save_preferences", { patch: { new_thread_policy: value === "legacy" ? null : value, prefer_last: value === "legacy" } });
                  await refresh();
                })} options={[
                  { value: "last_selected", label: "Last selected across projects" },
                  { value: "project", label: "Project preferences" },
                  { value: "default", label: "Global default everywhere" },
                  ...(!db.preferences.new_thread_policy && db.preferences.prefer_last ? [{ value: "legacy", label: "Project preferences, then last successfully used (existing)" }] : []),
                ]}/>
                <FieldDescription>{db.preferences.new_thread_policy === "last_selected"
                  ? `Last selected takes precedence over project preferences. Until you select a connection, use project preferences, then the global default. Remembered: ${accountLabel(db, db.preferences.last_selected || "")}.`
                  : db.preferences.new_thread_policy === "default"
                    ? "Use the global default in every project."
                    : "Use each project’s fixed connection or last used connection, then the global default."} You can override this in the new-thread composer. Changes save automatically.</FieldDescription>
              </Field>
              {!!db.accounts.length && (
                <Picker
                  label="Global fallback account"
                  value={db.preferences.fallback || ""}
                  onChange={(v) =>
                    void action(async () => {
                      await invoke("save_preferences", { patch: { fallback: v } });
                      await refresh();
                    })
                  }
                  options={db.accounts.map((a) => ({
                    value: a.id,
                    label: agentDisplayName(a),
                  }))}
                />
              )}
              <section aria-labelledby="settings-agent-setup-heading">
                <h2 id="settings-agent-setup-heading">Set up agents & accounts</h2>
                <AccountSetup db={db} native={native} onRefresh={refresh} />
              </section>
            </>
          )}
          {dialog === "companion" && <CompanionSettings native={native} />}
          {dialog === "appearance" && <AppearanceSettings fontSizes={fontSizes} appearance={appearance} theme={theme} onChange={setTheme} saved={themeSaved} />}
          {dialog === "voice" && <VoiceSettings native={native && /Mac/.test(navigator.platform)}/>}
          {dialog === "agentconfig" && <AgentConfigSettings native={native} accounts={db.accounts} projects={db.projects}/>}
          {dialog === "commander" && <><CommanderProfile/><CommanderSettings projects={db.projects}/></>}
          {dialog === "google" && <ConnectedAccountsSettings db={db} native={native}/>}
          {dialog === "background" && <BackgroundSettings native={native}/>}
          {dialog === "threads" && (
            <FieldGroup>
              <Field orientation="horizontal">
                <FieldContent><FieldLabel htmlFor="ignore-unread">Ignore unread status (experimental)</FieldLabel><FieldDescription>Focus on Working, Needs you, and Done. Finished replies count as Done immediately, without opening them or marking them as read. Approvals, errors, and interruptions still need your attention. Also applies to your companion app. Turn off anytime to restore unread indicators.</FieldDescription></FieldContent>
                <Switch id="ignore-unread" checked={ignoreUnread} onCheckedChange={setIgnoreUnread} />
              </Field>
              <Field orientation="horizontal">
                <FieldContent><FieldLabel htmlFor="group-by-project">Group by project</FieldLabel><FieldDescription>Organize your thread list by project folder.</FieldDescription></FieldContent>
                <Switch id="group-by-project" checked={grouped} onCheckedChange={setGrouped} />
              </Field>
              <Field orientation="horizontal">
                <FieldContent><FieldLabel htmlFor="hide-read-threads">{ignoreUnread ? "Move completed threads out of the active list" : "Hide completed threads after reading"}</FieldLabel><FieldDescription>{ignoreUnread ? "Finished replies move to recent or older threads immediately. They remain available in the Done filter." : "Completed conversations remain available in the Finished filter."}</FieldDescription></FieldContent>
                <Switch id="hide-read-threads" checked={hideRead} onCheckedChange={setHideRead} />
              </Field>
              <Field orientation="horizontal">
                <FieldContent><FieldLabel htmlFor="recent-finished-threads">Recent finished threads to keep visible</FieldLabel><FieldDescription>Read or finished threads stay visible under active ones. Set 0 to tuck them all under Show older threads.</FieldDescription></FieldContent>
                <Input id="recent-finished-threads" type="number" inputMode="numeric" min={0} max={RECENT_FINISHED_MAX} step={1} className="w-20"
                  value={recentFinished} onChange={(e) => setRecentFinished(e.target.value === "" ? 0 : sanitizeRecentCount(e.target.value))} />
              </Field>
            </FieldGroup>
          )}
          {dialog === "import" && <ImportSessions db={db} native={native} onImported={refresh} />}
          {dialog === "projects" && (
              <div className="settings-projects">
                {!db.projects.length && <p className="capture-help">Add a local folder to organize threads and choose project defaults.</p>}
                {!!db.projects.length && <p className="capture-help">Drag a handle to reorder projects. You can also focus a handle and press Alt+↑/↓.</p>}
                {fullProjectOrder.map(id => db.projects.find(p => p.id === id)!).map((p) => (
                  <div key={p.id} data-settings-project-id={p.id}
                    className={`settings-project-row ${projectDrag?.target === p.id && projectDrag.id !== p.id ? `project-reorder-${projectDrag.after ? "after" : "before"}` : ""}`}>
                  <button type="button" className="project-drag-handle" aria-label={`Reorder ${p.name}`}
                    title="Drag to reorder · Alt+↑/↓ to move"
                    onKeyDown={e => {
                      if (!e.altKey || !["ArrowUp", "ArrowDown"].includes(e.key)) return;
                      e.preventDefault();
                      const offset = e.key === "ArrowUp" ? -1 : 1;
                      const target = fullProjectOrder[fullProjectOrder.indexOf(p.id) + offset];
                      if (target) moveProjectGroup(p.id, target, offset > 0);
                    }}
                    onPointerDown={e => {
                      if (e.button !== 0) return;
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setProjectDrag({ id: p.id, target: p.id, after: false });
                    }}
                    onPointerMove={e => {
                      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                      const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-settings-project-id]");
                      if (row) {
                        const bounds = row.getBoundingClientRect();
                        setProjectDrag({ id: p.id, target: row.dataset.settingsProjectId!, after: e.clientY > bounds.top + bounds.height / 2 });
                      }
                      const viewport = e.currentTarget.closest<HTMLElement>('[data-radix-scroll-area-viewport]');
                      if (viewport) {
                        const bounds = viewport.getBoundingClientRect();
                        if (e.clientY < bounds.top + 35) viewport.scrollTop -= 16;
                        if (e.clientY > bounds.bottom - 35) viewport.scrollTop += 16;
                      }
                    }}
                    onPointerUp={e => {
                      const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-settings-project-id]");
                      if (row && projectDrag) {
                        const bounds = row.getBoundingClientRect();
                        moveProjectGroup(p.id, row.dataset.settingsProjectId!, e.clientY > bounds.top + bounds.height / 2);
                      }
                      setProjectDrag(null);
                    }}
                    onPointerCancel={() => setProjectDrag(null)}
                    onLostPointerCapture={() => setProjectDrag(null)}
                  ><GripVertical size={13} /></button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditing(p);
                      setDialog("project");
                    }}
                  >
                    <span
                      className="account-color"
                      style={{ background: p.color }}
                    />
                    {p.name}
                    <Settings2 size={12} />
                  </Button>
                  </div>
                ))}
                <Button variant="outline" onClick={addProject}>
                  Add project
                </Button>
                <Button variant="outline" onClick={() => setDialog("import")}>
                  Import sessions…
                </Button>
                <section aria-label="Workspaces" className="mt-6 space-y-4 border-t pt-6">
                  <div className="space-y-1"><h2 className="text-lg font-semibold">Workspaces</h2><p className="capture-help">Group your projects and choose a color for each workspace.</p></div>
                  {native && !db.preferences.workspaces && <p role="status" className="capture-help">Workspace editing will be available when the background update finishes. You can also use Restart now in the update banner.</p>}
                  <WorkspaceSettings projects={db.projects} workspaces={workspaces} disabled={!native || working || !db.preferences.workspaces}
                    onSave={next => action(async () => { await invoke("save_preferences", { patch: { workspaces: next } }); await refresh(); return true; })} />
                </section>
              </div>
          )}
          {dialog === "help" && (
            <>
              <Input
                autoFocus
                aria-label="Search shortcuts"
                placeholder="Find a shortcut…"
                value={helpQuery}
                onChange={(e) => setHelpQuery(e.target.value)}
              />
              <dl className="shortcut-list">
                {[...shortcuts.map((s) => [s.keys, s.name]), ...(voiceShortcut ? [[`Hold ${shortcutLabel(voiceShortcut)}`, "Dictate into the composer"]] : []), ...navigation]
                  .filter(([keys, name]) =>
                    `${keys} ${name}`
                      .toLowerCase()
                      .includes(helpQuery.toLowerCase()),
                  )
                  .map(([keys, name]) => (
                    <div key={name}>
                      <dt>{name}</dt>
                      <dd>
                        <kbd>{keys}</kbd>
                      </dd>
                    </div>
                  ))}
              </dl>
            </>
          )}
      </SettingsPanel>
    </div>
  );
}
