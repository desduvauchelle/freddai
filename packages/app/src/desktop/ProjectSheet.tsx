import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, Code2, Plus, Terminal } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@freddai/ui/components/sheet";
import { Button } from "@freddai/ui/components/button";
import { Dot, labelStatus } from "./ThreadStatus";
import { agentDisplayName, threadListStatus, type Account, type Session } from "./types";
import type { HomeRecent } from "./HomeView";
import { orderProjectThreads } from "../projectThreads";
import { formatProjectName } from "../projectName";

const PAGE = 20;

export function relativeTime(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d}d ago`;
  return new Date(at).toLocaleDateString();
}

/** Side sheet listing one project's threads; a thread opens inside the sheet so the dashboard behind it never changes. */
/** True while a non-Radix popup (composer autocomplete, menu, combobox) inside the sheet is open and should consume Escape itself. */
function innerPopupOpen(root: ParentNode): boolean {
  return !!root.querySelector('[role="listbox"], [role="menu"], [role="combobox"][aria-expanded="true"], textarea[aria-expanded="true"]');
}

export function ProjectSheet({ project, accounts = [], sessions, pending = [], queuedThreadIds, read, now, threadId, composing = false, renderCompose, onSelectThread, onBack, onClose, onNewThread, onOpenInMain, renderThread, uppercase }: {
  uppercase?: boolean;
  accounts?: readonly Account[];
  /** Shows the new-thread composer panel instead of the list. */
  composing?: boolean;
  renderCompose?: () => ReactNode;
  project: { name: string; color: string };
  /** Already filtered to this project. */
  sessions: readonly Session[];
  pending?: readonly HomeRecent[];
  queuedThreadIds?: ReadonlySet<string>;
  read: Record<string, number>;
  now: number;
  threadId: string | null;
  onSelectThread: (id: string) => void; onBack: () => void; onClose: () => void; onNewThread?: () => void; onOpenInMain?: (id: string) => void;
  renderThread: (id: string) => ReactNode;
}) {
  const [all, setAll] = useState(false);
  const [visible, setVisible] = useState(true);
  const finishClose = useEffectEvent(onClose);
  // Keep the portal mounted long enough for Radix's exit animation. The
  // fallback also completes dismissal in a backgrounded webview.
  useEffect(() => {
    if (visible) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => finishClose(), reduced ? 0 : 280);
    return () => window.clearTimeout(timer);
  }, [visible]);
  const open = threadId ? sessions.find(t => t.id === threadId) : undefined;
  const rows = orderProjectThreads([
    ...pending.map(draft => ({ id: draft.id, status: draft.status, updated: now, draft, session: undefined as Session | undefined })),
    ...sessions.map(session => ({ ...session, session, draft: undefined as HomeRecent | undefined })),
  ], read, row => row.draft || queuedThreadIds?.has(row.id) ? 1 : 0);
  const shown = all ? rows : rows.slice(0, PAGE);
  const nested = !!threadId || composing;
  return <Sheet open={visible} onOpenChange={setVisible}>
    <SheetContent side="right" className="project-sheet native-workspace w-[min(760px,96vw)] gap-0 p-0 sm:max-w-none" aria-describedby={undefined}
      onEscapeKeyDown={e => {
        // Inner popups (autocomplete, menus) get Escape first; then a thread/composer panel steps back to the list; then the sheet closes.
        if (innerPopupOpen(document.querySelector(".project-sheet") ?? document)) { e.preventDefault(); return; }
        if (nested) { e.preventDefault(); onBack(); }
      }}>
      <SheetHeader className="project-sheet-header flex-row items-center gap-2 border-b py-3 pr-12">
        {composing ? <>
          <Button type="button" variant="ghost" size="icon" aria-label="Back to threads" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /></Button>
          <span className="home-project-dot" style={{ background: project.color }} aria-hidden="true" />
          <SheetTitle className="min-w-0 flex-1 truncate">New thread in <span style={{ color: project.color }}>{formatProjectName(project.name, uppercase)}</span></SheetTitle>
        </> : threadId ? <>
          <Button type="button" variant="ghost" size="icon" aria-label="Back to threads" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /></Button>
          <SheetTitle className="min-w-0 flex-1 truncate">{open?.title || "Untitled thread"}</SheetTitle>
          {onOpenInMain && <Button type="button" variant="ghost" size="sm" onClick={() => onOpenInMain(threadId)}>Open full page<ArrowUpRight size={12} aria-hidden="true" /></Button>}
        </> : <>
          <span className="home-project-dot" style={{ background: project.color }} aria-hidden="true" />
          <SheetTitle className="min-w-0 flex-1 truncate" style={{ color: project.color }}>{formatProjectName(project.name, uppercase)}</SheetTitle>
          {onNewThread && <Button type="button" variant="ghost" size="icon" aria-label={`New thread in ${project.name}`} title="New thread" onClick={onNewThread}><Plus size={16} aria-hidden="true" /></Button>}
        </>}
        <SheetDescription className="sr-only">{composing ? "New thread" : threadId ? "Conversation" : `Threads in ${project.name}`}</SheetDescription>
      </SheetHeader>
      {composing ? <div className="project-sheet-thread flex min-h-0 flex-1 flex-col" data-testid="project-sheet-compose">{renderCompose?.()}</div>
        : threadId ? <div className="project-sheet-thread flex min-h-0 flex-1 flex-col" data-testid="project-sheet-thread">{renderThread(threadId) ?? <p className="home-empty p-4" role="status">This thread is unavailable.</p>}</div>
        : <div className="project-sheet-list min-h-0 flex-1 overflow-y-auto p-2">
          {sessions.length === 0 && pending.length === 0 ? <div className="home-empty flex flex-col items-start gap-2 p-4">
            <p>No threads yet</p>
            {onNewThread && <Button type="button" size="sm" onClick={onNewThread}><Plus size={13} aria-hidden="true" />New thread</Button>}
          </div> : <ul aria-label={`Threads in ${project.name}`} className="flex flex-col">
            {shown.map(row => { const p = row.draft; if (p) return <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm"><Dot status={p.status} /><span className="min-w-0 flex-1 truncate">{p.title}</span><span className="text-xs text-muted-foreground">{labelStatus(p.status)}</span></li>;
              const t = row.session!; const status = threadListStatus(t, read), agent = accounts.find(a => a.id === t.account); return <li key={t.id}>
              <button type="button" className="task-row compact-session project-sheet-row w-full text-left" title={`${t.title || "Untitled thread"} · ${labelStatus(status)} · ${relativeTime(t.updated, now)}`} onClick={() => onSelectThread(t.id)}>
                <span className="session-agent" aria-label={agent ? agentDisplayName(agent) : "Agent"} style={{ color: agent?.color }}>{agent?.provider === "codex" ? <Code2 size={14} /> : <Terminal size={14} />}</span>
                <strong className="session-title">{t.title || "Untitled thread"}</strong>
                <Dot status={status} />
              </button>
            </li>; })}
          </ul>}
          {rows.length > PAGE && <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={() => setAll(v => !v)}>{all ? "Show less" : `Show more (${rows.length - PAGE})`}</Button>}
        </div>}
    </SheetContent>
  </Sheet>;
}
