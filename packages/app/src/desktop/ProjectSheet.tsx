import { useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, Plus } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@freddai/ui/components/sheet";
import { Button } from "@freddai/ui/components/button";
import { Dot, labelStatus } from "./ThreadStatus";
import { threadListStatus, type Session } from "./types";
import type { HomeRecent } from "./HomeView";
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
export function ProjectSheet({ project, sessions, pending = [], read, now, threadId, onSelectThread, onBack, onClose, onNewThread, onOpenInMain, renderThread, uppercase }: {
  uppercase?: boolean;
  project: { name: string; color: string };
  /** Already filtered to this project and sorted latest first. */
  sessions: readonly Session[];
  pending?: readonly HomeRecent[];
  read: Record<string, number>;
  now: number;
  threadId: string | null;
  onSelectThread: (id: string) => void; onBack: () => void; onClose: () => void; onNewThread?: () => void; onOpenInMain?: (id: string) => void;
  renderThread: (id: string) => ReactNode;
}) {
  const [all, setAll] = useState(false);
  const open = threadId ? sessions.find(t => t.id === threadId) : undefined;
  const shown = all ? sessions : sessions.slice(0, PAGE);
  return <Sheet open onOpenChange={next => { if (!next) onClose(); }}>
    <SheetContent side="right" className="project-sheet w-[min(760px,96vw)] gap-0 p-0 sm:max-w-none" aria-describedby={undefined}>
      <SheetHeader className="project-sheet-header flex-row items-center gap-2 border-b py-3 pr-12">
        {threadId ? <>
          <Button type="button" variant="ghost" size="icon" aria-label="Back to threads" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /></Button>
          <SheetTitle className="min-w-0 flex-1 truncate">{open?.title || "Untitled thread"}</SheetTitle>
          {onOpenInMain && <Button type="button" variant="ghost" size="sm" onClick={() => onOpenInMain(threadId)}>Open in main view<ArrowUpRight size={12} aria-hidden="true" /></Button>}
        </> : <>
          <span className="home-project-dot" style={{ background: project.color }} aria-hidden="true" />
          <SheetTitle className="min-w-0 flex-1 truncate" style={{ color: project.color }}>{formatProjectName(project.name, uppercase)}</SheetTitle>
          {onNewThread && <Button type="button" variant="ghost" size="icon" aria-label={`New thread in ${project.name}`} title="New thread" onClick={onNewThread}><Plus size={16} aria-hidden="true" /></Button>}
        </>}
        <SheetDescription className="sr-only">{threadId ? "Conversation" : `Threads in ${project.name}`}</SheetDescription>
      </SheetHeader>
      {threadId ? <div className="project-sheet-thread flex min-h-0 flex-1 flex-col" data-testid="project-sheet-thread">{renderThread(threadId) ?? <p className="home-empty p-4" role="status">This thread is unavailable.</p>}</div>
        : <div className="project-sheet-list min-h-0 flex-1 overflow-y-auto p-2">
          {sessions.length === 0 && pending.length === 0 ? <div className="home-empty flex flex-col items-start gap-2 p-4">
            <p>No threads yet</p>
            {onNewThread && <Button type="button" size="sm" onClick={onNewThread}><Plus size={13} aria-hidden="true" />New thread</Button>}
          </div> : <ul aria-label={`Threads in ${project.name}`} className="flex flex-col">
            {pending.map(p => <li key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm"><Dot status={p.status} /><span className="min-w-0 flex-1 truncate">{p.title}</span><span className="text-xs text-muted-foreground">{labelStatus(p.status)}</span></li>)}
            {shown.map(t => { const status = threadListStatus(t, read); return <li key={t.id}>
              <button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => onSelectThread(t.id)}>
                <Dot status={status} />
                <span className={`min-w-0 flex-1 truncate${status === "unread" ? " font-semibold" : ""}`}>{t.title || "Untitled thread"}</span>
                {status === "unread" && <span className="size-2 rounded-full bg-primary" role="img" aria-label="Unread" />}
                <time className="shrink-0 text-xs text-muted-foreground" dateTime={new Date(t.updated).toISOString()}>{relativeTime(t.updated, now)}</time>
              </button>
            </li>; })}
          </ul>}
          {sessions.length > PAGE && <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={() => setAll(v => !v)}>{all ? "Show less" : `Show more (${sessions.length - PAGE})`}</Button>}
        </div>}
    </SheetContent>
  </Sheet>;
}
