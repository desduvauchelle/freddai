import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Clock, GitBranch, Info, Pin, Send, Sparkles, Square, SquareCheck, SquarePen, X } from "lucide-react";
import { launchThread } from "@freddai/shared/agent/client";
import { agentDisplayName, busy as sessionBusy, resolveAccount, type Project as FreddaiProject } from "@freddai/shared/agent/types";
import type { ItemThreadProps } from "../contracts";
import type { Item } from "../api";
import { Avatar, cx, DarkButton, GhostButton, KindIcon, Pill } from "../ui";
import { ScoutComposer } from "../chat/ScoutComposer";
import { ScoutTranscript } from "../chat/ScoutTranscript";
import { chatFreddaiProject } from "../chat/ChatPanel";
import { FreddaiLinkNotice } from "../chat/FreddaiLinkNotice";
import { useScoutChat } from "../chat/useScoutChat";
import { latestDraft } from "./draft";
import "./item.css";

export const HANDLE_PROMPT = "Handle this item and report back";

const placeholders: Record<Item["kind"], string> = {
  email: "Talk about this email, drop a file, or hold to talk",
  meeting: "Talk about this meeting, drop a file, or hold to talk",
  task: "Talk about this task, drop a file, or hold to talk",
  contact: "Talk about this contact, drop a file, or hold to talk",
  note: "Talk about this note, drop a file, or hold to talk",
  code: "Talk about this change, drop a file, or hold to talk",
};

/** First-message context block (docs/scout.md "Chat on an item"). */
export function itemPrompt(item: Pick<Item, "kind" | "title" | "subtitle">, text: string): string {
  const head = ["Scout item", item.kind, item.title, ...(item.subtitle ? [item.subtitle] : [])].join(" · ");
  return `${head}\n\n${text}`;
}

const basename = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

/** Right sheet showing one item as a conversation with a Freddai agent (Figma 55:800, 58:5569, 58:6364, 68:1582). */
export function ItemThread({ state, db, actions, itemId, onClose, onOpenProject }: ItemThreadProps) {
  const item = state.items.find(i => i.id === itemId);
  const project = item ? state.projects.find(p => p.id === item.project) : undefined;
  const workspace = project ? state.workspaces.find(w => w.id === project.workspace) : undefined;
  const freddaiProject = project?.freddai_project && db ? db.projects.find(p => p.id === project.freddai_project) : undefined;
  const [actionError, setActionError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [discarded, setDiscarded] = useState<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [seed, setSeed] = useState<{ text: string; nonce: number } | undefined>();

  const launch = useCallback(async (prompt: string) => {
    if (!db) throw new Error("Freddai is not reachable, so the agent cannot start.");
    const target = chatFreddaiProject(db, stateRef.current, project?.id ?? null);
    if (!target) {
      throw new Error(project?.freddai_project
        ? `The linked Freddai project (${project.freddai_project}) no longer exists. Link another one.`
        : "Link this project to a Freddai project to chat.");
    }
    return launchThread({ project: target.id, account: resolveAccount(db, target) || null, prompt });
  }, [db, project?.id, project?.freddai_project]);

  const onSessionCreated = useCallback(async (id: string) => {
    // Re-read the latest item so a lane/title change made during the launch is not overwritten.
    const latest = stateRef.current.items.find(i => i.id === itemId);
    if (!latest) return;
    try {
      await actions.itemSave({ ...latest, thread: id, status: "agent_working" });
    } catch (e) {
      // The message already went out; do not report the send as failed.
      setActionError(`Message sent, but linking the thread failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [actions, itemId]);

  const format = useCallback((text: string, first: boolean) => (first && item ? itemPrompt(item, text) : text), [item]);
  const chat = useScoutChat({ db, session: item?.thread ?? null, onSessionCreated, launch, format });
  const draft = useMemo(() => latestDraft(chat.messages), [chat.messages]);

  if (!item) {
    return <aside className="sc-item" aria-label="Item">
      <div className="sc-item__crumbs"><span />
        <button type="button" className="sc-icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button></div>
      <p className="sc-notice" role="alert">This item no longer exists.</p>
    </aside>;
  }

  const target = project ? chatFreddaiProject(db, state, project.id) : undefined;
  const account = db?.accounts.find(a => a.id === (chat.thread?.account || (target && db ? resolveAccount(db, target) : "")));
  const agentLabel = account ? agentDisplayName(account) : null;
  const agentShort = account ? agentDisplayName(account).split(" · ")[0] : "The agent";
  const liveSession = item.thread && db ? db.sessions.find(s => s.id === item.thread) : undefined;
  const status: Item["status"] = liveSession
    ? (liveSession.pending ? "needs_you" : sessionBusy(liveSession) ? "agent_working" : "ready")
    : item.status;
  const working = chat.busy || status === "agent_working";
  const linked = !!project?.freddai_project;
  const canChat = !!item.thread || !!target;

  async function run(task: () => Promise<void>) {
    setActionError(null);
    try { await task(); } catch (e) { setActionError(e instanceof Error ? e.message : String(e)); }
  }
  const done = item.lane === "done";

  return <aside className="sc-item" aria-label={`${item.title} thread`} data-kind={item.kind}>
    <div className="sc-item__crumbs">
      <nav className="sc-item__path" aria-label="Breadcrumb">
        <button type="button" className="sc-icon-btn sc-icon-btn--bare" aria-label="Back to project" disabled={!project} onClick={() => project && onOpenProject(project.id)}><ArrowLeft size={16} /></button>
        {workspace && <><span className="sc-dot" style={{ background: workspace.color }} aria-hidden /><span className="sc-muted">{workspace.name}</span><span className="sc-muted" aria-hidden>/</span></>}
        {project ? <button type="button" className="sc-link" onClick={() => onOpenProject(project.id)}>{project.name}</button> : <span className="sc-muted">No project</span>}
      </nav>
      <button type="button" className="sc-icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
    </div>

    <header className="sc-item__header">
      {item.kind === "task"
        ? <button type="button" role="checkbox" aria-checked={done} aria-label={done ? "Mark not done" : "Mark done"}
            className={cx("sc-item__tile", "sc-item__tile--task", "sc-item__check", done && "sc-item__check--on")}
            onClick={() => void run(() => actions.itemMove(item.id, done ? "focus" : "done", 0))}>
            {done ? <SquareCheck size={16} /> : <Square size={16} />}
          </button>
        : <span className={cx("sc-item__tile", `sc-item__tile--${item.kind}`)}><KindIcon kind={item.kind} size={16} /></span>}
      <div className="sc-item__heading">
        <h1 className="sc-item__title">{item.title}</h1>
        <div className="sc-item__meta">
          <ItemMeta item={item} freddaiProject={freddaiProject} workingDir={chat.thread?.working_dir ?? null} />
          {agentLabel && account && <span className="sc-item__agent"><Avatar name={agentLabel} color={account.color} size={14} />{agentLabel}</span>}
        </div>
      </div>
      <div className="sc-item__tools">
        {working && <span className="sc-item__working">Working</span>}
        <button type="button" className={cx("sc-icon-btn", working && "sc-icon-btn--working")} aria-label="Ask the agent to handle it" title="Ask the agent to handle it"
          disabled={!canChat || chat.busy} onClick={() => void chat.send(HANDLE_PROMPT)}><Sparkles size={15} /></button>
        <button type="button" className={cx("sc-icon-btn", showInfo && "sc-icon-btn--on")} aria-label="Item details" aria-expanded={showInfo} onClick={() => setShowInfo(v => !v)}><Info size={15} /></button>
        <button type="button" className={cx("sc-icon-btn", item.lane === "focus" && "sc-icon-btn--on")} disabled={done}
          aria-pressed={item.lane === "focus"}
          aria-label={item.lane === "focus" ? "Unpin" : "Pin"} title={item.lane === "focus" ? "Pinned · click to unpin" : "Pin to focus"}
          onClick={() => void run(() => actions.itemMove(item.id, item.lane === "focus" ? "backlog" : "focus", 0))}>
          {item.lane === "focus" ? <Pin size={15} fill="currentColor" /> : <Pin size={15} />}
        </button>
      </div>
    </header>

    {showInfo && <dl className="sc-item__info">
      <dt>Created</dt><dd>{new Date(item.created).toLocaleString()} · {item.origin}</dd>
      {item.source && <><dt>Source</dt><dd>{item.source}</dd></>}
      <dt>Project</dt><dd>{[workspace?.name, project?.name].filter(Boolean).join(" / ") || "None"}</dd>
      <dt>Freddai</dt><dd>{target ? `${target.name}${linked ? "" : " · default"}` : linked ? "Linked project missing" : "Not linked"}{item.thread ? " · thread linked" : ""}</dd>
    </dl>}

    {(done || status === "needs_you" || status === "ready") && <div className="sc-item__strip">
      {done && <span className="sc-done-mark"><span className="sc-done-mark__check"><Check size={12} strokeWidth={3} /></span>Done</span>}
      {status === "needs_you" && <Pill variant="danger">Needs you</Pill>}
      {status === "ready" && <Pill variant="success">Ready</Pill>}
    </div>}

    {actionError && <p className="sc-chat-error" role="alert">{actionError}</p>}

    <div className="sc-item__body">
      {item.thread && db && !chat.thread && <p className="sc-notice" role="alert">The Freddai thread for this item was not found ({item.thread}).</p>}
      {!item.thread && chat.pending.length === 0 && <p className="sc-item__empty">Ask anything about this {item.kind}. {agentShort} replies here and can act on it.</p>}
      <ScoutTranscript chat={chat} db={db} agentName={agentShort} />
      {draft && draft.messageId !== discarded && <section className="sc-draft" aria-label="Email draft">
        <p className="sc-draft__to"><span className="sc-muted">Draft · To</span> {draft.to ?? "(no recipient)"}</p>
        {draft.subject && <p className="sc-draft__subject">{draft.subject}</p>}
        <div className="sc-draft__body">{draft.body}</div>
        <div className="sc-draft__actions">
          <span title="Sending email is not connected yet"><DarkButton icon={<Send size={14} />} disabled aria-describedby="sc-draft-send-note">Send</DarkButton></span>
          <GhostButton icon={<SquarePen size={14} />} onClick={() => setSeed({ text: "Change the draft: ", nonce: Date.now() })}>Edit</GhostButton>
          <button type="button" className="sc-link sc-muted" onClick={() => setDiscarded(draft.messageId)}>Discard</button>
          <span id="sc-draft-send-note" className="sc-draft__note">Sending email is not connected yet{agentLabel ? ` · Drafted by ${agentLabel}` : ""}</span>
        </div>
      </section>}
    </div>

    {chat.error && <p className="sc-chat-error" role="alert">{chat.error}</p>}
    <div className="sc-item__footer">
      {project
        ? <>
            {!item.thread && !target && <FreddaiLinkNotice db={db}
              message={linked && db ? "The linked Freddai project no longer exists. Link another one to chat." : "Link this project to a Freddai project to chat"}
              onLink={id => actions.projectSave({ ...project, freddai_project: id })} />}
            <ScoutComposer placeholder={placeholders[item.kind]} disabled={!db || !canChat} onSend={chat.send} busy={chat.busy} onStop={() => void chat.stop()} seed={seed} />
          </>
        : <p className="sc-notice" role="alert">This item has no project, so there is no agent to chat with.</p>}
    </div>
  </aside>;
}

function ItemMeta({ item, freddaiProject, workingDir }: { item: Item; freddaiProject?: FreddaiProject; workingDir: string | null }) {
  if (item.kind === "code") {
    const repo = freddaiProject ? basename(freddaiProject.path) : null;
    const branch = workingDir && freddaiProject && workingDir !== freddaiProject.path ? basename(workingDir) : null;
    if (!repo) return item.subtitle ? <span>{item.subtitle}</span> : null;
    return <span className="sc-item__chip" title={workingDir ?? freddaiProject?.path}><GitBranch size={12} />{repo}{branch ? ` · ${branch}` : ""}</span>;
  }
  if (!item.subtitle) return null;
  if (item.kind === "email") {
    return /@/.test(item.subtitle) && !/\s/.test(item.subtitle.trim())
      ? <span><span className="sc-muted">To</span> {item.subtitle}</span>
      : <span>{item.subtitle}</span>;
  }
  if (item.kind === "meeting" || item.kind === "task") return <span><Clock size={12} aria-hidden /> {item.subtitle}</span>;
  return <span>{item.subtitle}</span>;
}
