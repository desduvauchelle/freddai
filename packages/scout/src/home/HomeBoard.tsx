import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronRight, ChevronUp, CircleAlert, Eye, EyeOff, Pin, Plus, Sparkles } from "lucide-react";
import { MicButton } from "@freddai/shared/voice/VoiceControls";
import { uuid, type Item, type Project, type Workspace } from "../api";
import type { HomeBoardProps } from "../contracts";
import { KindIcon, Pill, StatusDot, cx } from "../ui";
import { buildBoard, projectMeta, projectMoveIndex, reorderIds, byOrder, type ProjectView } from "./board";
import { usePointerDrag, type DropTarget } from "./usePointerDrag";
import "./home.css";

type DragPayload = { type: "project"; id: string } | { type: "workspace"; id: string };

/** Mutations already surface in the shell's error bar (the store records and rethrows);
 *  here we only log a named event so the rejection is never unhandled. */
function run(event: string, p: Promise<void>) {
  p.catch(error => console.error(`[scout] ${event} failed`, error));
}

const FOCUS_ROWS = 2;
const CARD_ROWS = 4;

export function HomeBoard({ state, actions, workspaceFilter, search, onOpenProject, onOpenItem, onNewItem }: HomeBoardProps) {
  const board = useMemo(() => buildBoard(state, workspaceFilter, search), [state, workspaceFilter, search]);
  const [hiddenOpen, setHiddenOpen] = useState(false);

  const { drag, start } = usePointerDrag<DragPayload>((payload, target) => handleDrop(payload, target));

  function handleDrop(payload: DragPayload, target: DropTarget) {
    if (payload.type === "workspace") {
      if (target.kind !== "workspace" || target.id === payload.id) return;
      const ids = [...state.workspaces].sort(byOrder).map(w => w.id);
      // Dropping on a later workspace lands after it, on an earlier one before it.
      const next = reorderIds(ids, payload.id, target.id, ids.indexOf(payload.id) < ids.indexOf(target.id));
      if (next.join() !== ids.join()) run("workspace_reorder", actions.workspaceReorder(next));
      return;
    }
    const project = state.projects.find(p => p.id === payload.id);
    if (!project) return;
    if (target.kind === "hidden") {
      run("project_hide", actions.projectSave({ ...project, hidden: true }));
    } else if (target.kind === "pinned") {
      if (!project.pinned) run("project_pin", actions.projectSave({ ...project, pinned: true }));
    } else if (target.kind === "workspace") {
      run("project_move", actions.projectMove(project.id, target.id, projectMoveIndex(state, project.id, target.id, null, true)));
    } else if (target.kind === "project" && target.id !== project.id) {
      const over = state.projects.find(p => p.id === target.id);
      if (!over) return;
      run("project_move", actions.projectMove(project.id, over.workspace, projectMoveIndex(state, project.id, over.workspace, over.id, target.after)));
    }
  }

  const dragging = drag?.payload;
  const overId = (kind: string) => (drag?.target?.kind === kind ? drag.target.id : null);
  const cardProps = {
    state, actions, onOpenProject, onOpenItem, onNewItem,
    dragStart: (p: Project) => start({ type: "project", id: p.id }, p.name),
    draggingId: dragging?.type === "project" ? dragging.id : null,
    dropOver: drag?.target?.kind === "project" ? drag.target : null,
    acceptsDrop: dragging?.type !== "workspace",
  };
  const empty = board.total === 0 && board.collapsed.length === 0;

  return (
    <div className={cx("hb", dragging && "is-dragging", hiddenOpen && "is-hidden-open")}>
      <div className="hb__main">
        <header className="hb__header">
          <h1 className="hb__title">All projects</h1>
          <Suggestions />
          <div className="hb__counts" aria-label="Totals">
            <Pill variant="danger" icon={<CircleAlert size={13} aria-hidden />}>{board.counts.needsYou} need you</Pill>
            <Pill className="hb__count">{board.counts.focus} in focus</Pill>
            <Pill className="hb__count">{board.counts.backlog} in backlog</Pill>
          </div>
        </header>

        {empty ? (
          <p className="hb__empty">{search.trim() ? `No projects or items match “${search.trim()}”.` : "No projects here yet."}</p>
        ) : (
          <>
            <section className={cx("hb-section hb-section--pinned", overId("pinned") !== null && "is-drop")} aria-label="Pinned"
              data-drop={dragging?.type === "project" ? "pinned" : undefined} data-drop-id="pinned">
              <div className="hb-section__head">
                <Pin size={18} className="hb-section__pin" fill="currentColor" aria-hidden />
                <h2 className="hb-section__name">Pinned</h2>
                <span className="hb-section__count">{plural(board.pinned.length, "project")}</span>
                <span className="hb-section__hint">Pin projects to keep them here.</span>
              </div>
              {board.pinned.length > 0 && (
                <div className="hb-grid">
                  {board.pinned.map(v => <ProjectCard key={`pin-${v.project.id}`} view={v} {...cardProps} />)}
                </div>
              )}
            </section>

            <div className="hb-flow">
              {board.sections.map(({ workspace, projects }) => (
                <section key={workspace.id}
                  className={cx("hb-section hb-ws",
                    overId("workspace") === workspace.id && "is-drop",
                    dragging?.type === "workspace" && dragging.id === workspace.id && "is-dragged")}
                  aria-label={workspace.name}
                  data-drop="workspace" data-drop-id={workspace.id}>
                  <WorkspaceHead workspace={workspace} count={projects.length}
                    onPointerDown={start({ type: "workspace", id: workspace.id }, workspace.name)}
                    onToggle={() => run("workspace_collapse", actions.workspaceSave({ ...workspace, collapsed: true }))} />
                  {projects.length ? projects.map(v => <ProjectCard key={v.project.id} view={v} {...cardProps} />)
                    : <p className="hb-ws__empty">No projects. Drag one here.</p>}
                </section>
              ))}
            </div>

            {board.collapsed.length > 0 && (
              <div className="hb-collapsed">
                <span className="hb-collapsed__note">{board.collapsed.length} collapsed · click to expand</span>
                <div className="hb-collapsed__chips">
                  {board.collapsed.map(({ workspace, count }) => (
                    <button key={workspace.id} type="button"
                      className={cx("hb-chip", overId("workspace") === workspace.id && "is-drop")}
                      data-drop="workspace" data-drop-id={workspace.id}
                      onPointerDown={start({ type: "workspace", id: workspace.id }, workspace.name)}
                      onClick={() => run("workspace_expand", actions.workspaceSave({ ...workspace, collapsed: false }))}
                      aria-label={`Expand ${workspace.name}`}>
                      <span className="hb-dot" style={{ background: workspace.color }} aria-hidden />
                      <span className="hb-chip__name">{workspace.name}</span>
                      <span className="hb-chip__count">{plural(count, "project")}</span>
                      <ChevronRight size={14} aria-hidden />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <HiddenRail hidden={board.hidden} open={hiddenOpen} onToggle={() => setHiddenOpen(o => !o)}
        dropActive={dragging?.type === "project"} over={overId("hidden") !== null}
        workspaces={state.workspaces}
        onUnhide={p => run("project_unhide", actions.projectSave({ ...p, hidden: false }))} />

      {drag && <div className="hb-ghost" style={{ left: drag.x + 12, top: drag.y + 12 } as CSSProperties} aria-hidden>{drag.label}</div>}
    </div>
  );
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function WorkspaceHead({ workspace, count, onPointerDown, onToggle }: {
  workspace: Workspace; count: number; onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void; onToggle: () => void;
}) {
  return (
    <div className="hb-section__head hb-ws__head" onPointerDown={onPointerDown}>
      <span className="hb-dot hb-dot--lg" style={{ background: workspace.color }} aria-hidden />
      <h2 className="hb-section__name">{workspace.name}</h2>
      <span className="hb-section__count">{plural(count, "project")}</span>
      <button type="button" className="hb-icon hb-ws__chevron" onClick={onToggle} aria-label={`Collapse ${workspace.name}`} data-no-drag>
        <ChevronDown size={18} aria-hidden />
      </button>
    </div>
  );
}

type CardProps = Pick<HomeBoardProps, "state" | "actions" | "onOpenProject" | "onOpenItem" | "onNewItem"> & {
  view: ProjectView;
  dragStart: (p: Project) => (e: ReactPointerEvent<HTMLElement>) => void;
  draggingId: string | null;
  dropOver: DropTarget | null;
  acceptsDrop: boolean;
};

function ProjectCard({ view, state, actions, onOpenProject, onOpenItem, onNewItem, dragStart, draggingId, dropOver, acceptsDrop }: CardProps) {
  const { project, focus, backlog } = view;
  const [expanded, setExpanded] = useState(false);
  const shownFocus = expanded ? focus : focus.slice(0, FOCUS_ROWS);
  const shownBacklog = expanded ? backlog : backlog.slice(0, Math.max(0, CARD_ROWS - shownFocus.length));
  const more = focus.length + backlog.length - shownFocus.length - shownBacklog.length;
  const allClear = focus.length + backlog.length === 0;
  const isOver = dropOver?.id === project.id && draggingId !== project.id;

  /** Dictated text becomes a focus-lane note in this project, then opens. */
  async function voiceNote(text: string) {
    const title = text.trim();
    if (!title) return;
    const now = new Date().toISOString();
    const order = state.items.filter(i => i.project === project.id && i.lane === "focus").reduce((max, i) => Math.max(max, i.order + 1), 0);
    const item: Item = {
      id: uuid(), project: project.id, kind: "note", title, subtitle: null,
      lane: "focus", status: "none", source: null, origin: "user", thread: null,
      order, created: now, updated: now, done_at: null,
    };
    try {
      await actions.itemSave(item);
      onOpenItem(item.id);
    } catch (error) {
      console.error("[scout] voice_note_create failed", error);
    }
  }

  const icons = (
    <div className={cx("hb-card__actions", project.pinned && "is-pinned")} data-no-drag>
      <span className="hb-card__mic" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
        <MicButton target={false} className="hb-icon" label={`Voice note for ${project.name}`} onText={text => void voiceNote(text)} />
      </span>
      <button type="button" className="hb-icon" aria-label={`New item in ${project.name}`} title="New item"
        onClick={e => { e.stopPropagation(); onNewItem(project.id); }}><Plus size={15} aria-hidden /></button>
      <button type="button" className="hb-icon" aria-label={`Hide ${project.name}`} title="Hide"
        onClick={e => { e.stopPropagation(); run("project_hide", actions.projectSave({ ...project, hidden: true })); }}><Eye size={15} aria-hidden /></button>
      <button type="button" className="hb-icon hb-icon--pin" aria-pressed={project.pinned}
        aria-label={project.pinned ? `Unpin ${project.name}` : `Pin ${project.name}`} title={project.pinned ? "Unpin" : "Pin"}
        onClick={e => { e.stopPropagation(); run("project_pin", actions.projectSave({ ...project, pinned: !project.pinned })); }}>
        <Pin size={15} fill={project.pinned ? "currentColor" : "none"} aria-hidden />
      </button>
    </div>
  );

  return (
    <article
      className={cx("sc-card hb-card", allClear && "hb-card--clear", draggingId === project.id && "is-dragged",
        isOver && (dropOver!.after ? "is-drop-after" : "is-drop-before"))}
      aria-label={project.name}
      data-drop={acceptsDrop ? "project" : undefined} data-drop-id={project.id} data-drop-axis="x"
      onPointerDown={dragStart(project)}
      onClick={() => onOpenProject(project.id)}>
      <div className="hb-card__head">
        <span className="hb-dot" style={{ background: project.color }} aria-hidden />
        <button type="button" className="hb-card__name" onClick={e => { e.stopPropagation(); onOpenProject(project.id); }}>{project.name}</button>
        {icons}
      </div>
      {!allClear && <>
        <p className="hb-card__meta">{projectMeta(focus, backlog)}</p>
        <ul className="hb-card__items">
          {shownFocus.map(i => <ItemRow key={i.id} item={i} strong onOpen={onOpenItem} actions={actions} />)}
          {shownBacklog.map(i => <ItemRow key={i.id} item={i} onOpen={onOpenItem} />)}
        </ul>
        {(more > 0 || expanded) && (focus.length + backlog.length > CARD_ROWS || focus.length > FOCUS_ROWS) && (
          <button type="button" className="hb-card__more" data-no-drag onClick={e => { e.stopPropagation(); setExpanded(x => !x); }}>
            {expanded ? <>Show less <ChevronUp size={13} aria-hidden /></> : <>Show {more} more <ChevronDown size={13} aria-hidden /></>}
          </button>
        )}
      </>}
    </article>
  );
}

function ItemRow({ item, strong, onOpen, actions }: { item: Item; strong?: boolean; onOpen: (id: string) => void; actions?: HomeBoardProps["actions"] }) {
  return (
    <li>
      <button type="button" className={cx("hb-item", strong ? "hb-item--focus" : "hb-item--backlog")}
        onClick={e => { e.stopPropagation(); onOpen(item.id); }}>
        <KindIcon kind={item.kind} size={strong ? 15 : 13} />
        <span className="hb-item__title">{item.title}</span>
        {strong && <StatusDot status={item.status} className="hb-item__status" />}
      </button>
      {strong && actions && (
        <button type="button" className="hb-item__pin" aria-label={`Unpin ${item.title}`} title="Pinned · click to move to backlog"
          onClick={e => { e.stopPropagation(); run("item_move", actions.itemMove(item.id, "backlog", 0)); }}>
          <Pin size={12} fill="currentColor" aria-hidden />
        </button>
      )}
    </li>
  );
}

const SUGGESTION_EXAMPLES = [
  { kind: "email" as const, title: "Reply to Jordan about the pricing deck", from: "From Gmail · matched “Sales follow-ups”" },
  { kind: "meeting" as const, title: "Add “Acme pricing call” Tue 2pm", from: "From Gmail · matched “Calendar invites”" },
  { kind: "code" as const, title: "Fix login redirect loop", from: "From GitHub · matched “Bug reports”" },
];

/** Static placeholder until rule/agent suggestions exist: rows are labelled as examples and
 *  carry no Accept action, so nothing pretends to be live. */
function Suggestions() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", close); };
  }, [open]);
  return (
    <div className="hb-sugg" ref={root}>
      <button type="button" className={cx("hb-sugg__btn", open && "is-open")} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(o => !o)}>
        <Sparkles size={14} aria-hidden /> Suggestions <span className="hb-sugg__badge">{SUGGESTION_EXAMPLES.length}</span>
        {open ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
      </button>
      {open && (
        <div className="hb-sugg__panel" role="dialog" aria-label="Suggestions">
          <ul>
            {SUGGESTION_EXAMPLES.map(s => (
              <li key={s.title} className="hb-sugg__row">
                <span className={`hb-sugg__icon hb-sugg__icon--${s.kind}`}><KindIcon kind={s.kind} size={15} /></span>
                <span className="hb-sugg__text"><strong>{s.title}</strong><span>{s.from}</span></span>
                <span className="hb-sugg__tag">Example</span>
              </li>
            ))}
          </ul>
          <p className="hb-sugg__note">Suggestions come from rules and agents.</p>
        </div>
      )}
    </div>
  );
}

function HiddenRail({ hidden, open, onToggle, dropActive, over, workspaces, onUnhide }: {
  hidden: Project[]; open: boolean; onToggle: () => void; dropActive: boolean; over: boolean;
  workspaces: Workspace[]; onUnhide: (p: Project) => void;
}) {
  const wsName = (id: string) => workspaces.find(w => w.id === id)?.name ?? "";
  return (
    <aside className={cx("hb-hidden", open && "is-open", dropActive && "is-drop-ready", over && "is-drop")} aria-label="Hidden projects"
      data-drop={dropActive ? "hidden" : undefined} data-drop-id="hidden">
      <button type="button" className="hb-hidden__toggle" onClick={onToggle} aria-expanded={open}
        aria-label={open ? "Close hidden projects" : `Show ${hidden.length} hidden projects`}>
        <span className="hb-hidden__eye"><EyeOff size={15} aria-hidden /></span>
        <span className="hb-hidden__count">{hidden.length}</span>
        {!open && <span className="hb-hidden__label">Hidden</span>}
      </button>
      {open && (
        <div className="hb-hidden__list">
          <h2 className="hb-hidden__title">Hidden</h2>
          {hidden.length === 0 ? <p className="hb-hidden__empty">Nothing hidden. Drop a project here to hide it.</p> : (
            <ul>
              {hidden.map(p => (
                <li key={p.id} className="hb-hidden__row">
                  <span className="hb-dot" style={{ background: p.color }} aria-hidden />
                  <span className="hb-hidden__name">{p.name}<small>{wsName(p.workspace)}</small></span>
                  <button type="button" className="hb-icon" onClick={() => onUnhide(p)} aria-label={`Unhide ${p.name}`} title="Unhide">
                    <Eye size={15} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
