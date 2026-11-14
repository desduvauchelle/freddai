import { SubThreads } from "./SubThreads";
import { isCommanderThread } from "../../commanderThreads";
import type { Session } from "../types";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, CircleAlert, Phone, Settings, Wrench, X } from "lucide-react";
import { Dormouse } from "../Dormouse";
import { MASCOT_PRIORITY } from "../mascot-state";
import type { Project, Schedule } from "../types";
import { ApprovalCard } from "./ApprovalCard";
import type { Proposal } from "./api";
import { AWAY_MS, awayCards, awayGap, recordVisit, type AwayCard } from "./away";
import { CommanderTools, pendingProposals, type ToolsTab } from "./CommanderTools";
import { statusText } from "./CommanderCluster";
import { CommanderTrailingContext } from "./TrailingContext";
import { useCommander } from "./useCommander";
import "./commander.css";

export function CommanderView({ projects, schedules = [], threads = [], renderConversation, onSelectThread, onOpenThread, onNewThread, onManageSchedules, onBack }: {
  projects: Project[]; schedules?: Schedule[]; threads?: Session[];
  /** Existing conversation (transcript + composer) for the commander thread; null when it is not ready/selected. */
  renderConversation: (threadId: string) => ReactNode;
  /** Asks the host to select the commander thread so `renderConversation` can render it. */
  onSelectThread: (threadId: string) => void;
  onOpenThread: (id: string) => void;
  /** Existing new-thread launch path. */
  onNewThread: (projectId: string) => void;
  onManageSchedules?: () => void;
  onBack?: () => void;
}) {
  const data = useCommander();
  const { state, proposals, todos, error } = data;
  const name = state?.project.name ?? "Commander";
  const threadId = state?.thread_id ?? null;
  const [tools, setTools] = useState<{ open: boolean; tab: ToolsTab }>({ open: false, tab: "waiting" });
  const [decided, setDecided] = useState<Record<string, Proposal>>({});

  const [away, setAway] = useState<{ gap: number; since: number } | null>(null), [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const now = Date.now(), gap = recordVisit(now);
    if (gap !== null && gap > AWAY_MS) setAway({ gap, since: now - gap });
    return () => { recordVisit(); };
  }, []);
  useEffect(() => { if (threadId) onSelectThread(threadId); }, [threadId]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = pendingProposals(proposals);
  const trayCards = [...pending, ...Object.values(decided).filter(d => !pending.some(p => p.id === d.id))];
  const proj = (id: string | null) => projects.find(p => p.id === id);
  const cards = away && !dismissed ? awayCards(todos, proposals, projects, away.since) : [];

  const delegated = threads.filter(t => t.origin?.kind === "commander" && t.origin.thread === threadId);
  const tray = <><SubThreads threads={delegated} projects={projects} onOpenThread={onOpenThread} hideEmpty />{trayCards.length > 0 ? <div className="commander-approvals" aria-label="Waiting on you">
    {trayCards.map(p => <ApprovalCard key={p.id} proposal={decided[p.id] ?? p} projectName={proj(p.project)?.name} projectColor={proj(p.project)?.color}
      onDecided={r => { setDecided(d => ({ ...d, [r.id]: r })); void data.refresh(); }} onOpenThread={onOpenThread} />)}
  </div> : null}</>;

  function followCard(card: AwayCard) {
    setDismissed(true);
    if (card.thread) onOpenThread(card.thread); else setTools({ open: true, tab: card.tab ?? "waiting" });
  }

  return <section className="commander-view" aria-label={name}>
    <header className="commander-header">
      {onBack && <button type="button" className="commander-icon-btn commander-back" aria-label="Back to Dashboard" title="Back to Dashboard" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /></button>}
      <div className="commander-header-center">
        <button type="button" className="commander-header-avatar" aria-label={`${name} tools`} aria-expanded={tools.open} title="Open tools" data-needs={(state?.status.needs_you ?? 0) > 0}
          onClick={() => setTools(t => ({ ...t, open: !t.open }))}>
          <Dormouse size={32} priority={MASCOT_PRIORITY.header} mood={(state?.status.running ?? 0) > 0 ? 2 : (state?.status.needs_you ?? 0) > 0 ? 4 : 0} label={(state?.status.running ?? 0) > 0 ? "Working" : "Ready"} pauseControl={false} />
        </button>
        <span className="commander-header-pill">
          <strong className="commander-title">{name}</strong>
          {state && <small className="commander-status" role="status">{statusText(state.status)}</small>}
        </span>
      </div>
      <div className="commander-header-actions">
        {threadId && <button type="button" className="commander-header-btn" onClick={() => window.dispatchEvent(new Event("freddai:commander-call"))}><Phone size={15} aria-hidden="true" /><span>Call</span></button>}
        <button type="button" className="commander-header-btn" onClick={() => setTools({ open: true, tab: "settings" })}><Settings size={15} aria-hidden="true" /><span>Settings</span></button>
        <button type="button" className="commander-header-btn" aria-expanded={tools.open} onClick={() => setTools(t => ({ ...t, open: !t.open }))}><Wrench size={15} aria-hidden="true" /><span>Tools</span></button>
      </div>
    </header>

    {tools.open && <CommanderTools threads={threads.filter(t => isCommanderThread(t, state?.project.id) && t.id !== threadId)} key={tools.tab} data={data} projects={projects} schedules={schedules} commanderId={state?.project.id} initialTab={tools.tab}
      onOpenThread={id => { setTools(t => ({ ...t, open: false })); onOpenThread(id); }} onManageSchedules={onManageSchedules} onClose={() => setTools(t => ({ ...t, open: false }))} />}

    {state?.model_notice && <p className="commander-banner" role="status"><CircleAlert size={14} aria-hidden="true" />{state.model_notice}</p>}
    {error && <p className="commander-banner commander-error" role="alert"><CircleAlert size={14} aria-hidden="true" />Couldn't refresh {name}: {error}</p>}

    <div className="commander-surface">
      {cards.length > 0 && away && <aside className="commander-away" aria-label="While you were away">
        <strong>Welcome back</strong><span className="commander-away-gap">{awayGap(away.gap)}</span>
        {cards.map(c => <button key={c.id} type="button" className="commander-away-card" data-kind={c.kind} title={c.detail || undefined} onClick={() => followCard(c)}>{c.title}</button>)}
        <button type="button" className="commander-icon-btn commander-away-dismiss" aria-label="Dismiss" onClick={() => setDismissed(true)}><X size={14} aria-hidden="true" /></button>
      </aside>}
      {threadId
        ? <div className="commander-conversation"><CommanderTrailingContext.Provider value={tray}>{renderConversation(threadId)}</CommanderTrailingContext.Provider></div>
        : <div className="commander-empty-chat"><p>{state ? `Say hello to ${name}. Your first message starts the conversation.` : "Loading…"}</p>{tray}</div>}

      {!threadId && state && <button type="button" className="commander-send" onClick={() => onNewThread(state.project.id)}>Start conversation</button>}

    </div>
  </section>;
}
