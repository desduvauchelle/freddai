import { useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowRight, ArrowUp, Check, ChevronRight, CircleAlert, Link2, MoreHorizontal, Pencil, Pin, Plus, Sparkles, Trash2, X, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@freddai/ui/components/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@freddai/ui/components/dropdown-menu";
import type { Database } from "@freddai/shared/agent/types";
import type { Item, ItemLane } from "../api";
import type { ProjectPanelProps } from "../contracts";
import { Avatar, DarkButton, GhostButton, KindIcon, Pill, cx } from "../ui";
import { byOrder } from "../home/board";
import { usePointerDrag, type DropTarget } from "../home/usePointerDrag";
import "./project.css";

function run(event: string, p: Promise<void>) {
  p.catch(error => console.error(`[scout] ${event} failed`, error));
}

const agentNames: Record<string, string> = {
  claude: "Claude", codex: "Codex", gemini: "Gemini", antigravity: "Antigravity", grok: "Grok",
  opencode: "OpenCode", cursor: "Cursor", copilot: "Copilot",
};

/** "Claude is on it" when the item's Freddai thread tells us which agent; generic otherwise. */
export function agentLabel(db: Database | null, item: Item): string {
  const session = item.thread ? db?.sessions.find(s => s.id === item.thread) : undefined;
  const account = session ? db?.accounts.find(a => a.id === session.account) : undefined;
  return account ? `${agentNames[account.provider] ?? account.name} is on it` : "Agent is on it";
}

type Lanes = Record<ItemLane, Item[]>;

export function ProjectPanel({ state, db, actions, projectId, onClose, onOpenItem, onNewItem }: ProjectPanelProps) {
  const project = state.projects.find(p => p.id === projectId);
  const workspace = project ? state.workspaces.find(w => w.id === project.workspace) : undefined;
  const lanes = useMemo<Lanes>(() => {
    const mine = state.items.filter(i => i.project === projectId).sort(byOrder);
    return { focus: mine.filter(i => i.lane === "focus"), backlog: mine.filter(i => i.lane === "backlog"), done: mine.filter(i => i.lane === "done") };
  }, [state.items, projectId]);
  const [doneOpen, setDoneOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"link" | "delete" | null>(null);

  const { drag, start } = usePointerDrag<string>((id, target) => dropItem(id, target));

  function dropItem(id: string, target: DropTarget) {
    const item = state.items.find(i => i.id === id);
    if (!item) return;
    let lane: ItemLane;
    let index: number;
    if (target.kind === "item") {
      const over = lanes.focus.concat(lanes.backlog, lanes.done).find(i => i.id === target.id);
      if (!over || over.id === id) return;
      lane = over.lane;
      const rest = lanes[lane].filter(i => i.id !== id);
      index = rest.findIndex(i => i.id === over.id) + (target.after ? 1 : 0);
    } else if (target.kind === "lane") {
      lane = target.id as ItemLane;
      index = lanes[lane].filter(i => i.id !== id).length;
    } else return;
    if (lane === item.lane && lanes[lane].findIndex(i => i.id === id) === index) return;
    run("item_move", actions.itemMove(id, lane, index));
  }

  if (!project) {
    return <div className="pp pp--missing">
      <p>This project no longer exists.</p>
      <GhostButton onClick={onClose}>Close</GhostButton>
    </div>;
  }

  const linked = project.freddai_project ? db?.projects.find(p => p.id === project.freddai_project) : undefined;
  const highlight = lanes.focus.find(i => i.status === "needs_you")?.id ?? null;
  const draggingId = drag?.payload ?? null;
  const over = drag?.target ?? null;
  const card = (item: Item, opts: { promote?: boolean } = {}) => (
    <ItemCard key={item.id} item={item} db={db} highlighted={item.id === highlight}
      dragging={draggingId === item.id}
      dropEdge={over?.kind === "item" && over.id === item.id && draggingId !== item.id ? (over.after ? "after" : "before") : null}
      onPointerDown={start(item.id, item.title)}
      onOpen={() => onOpenItem(item.id)}
      onPromote={opts.promote ? () => run("item_move", actions.itemMove(item.id, "focus", lanes.focus.length)) : undefined} />
  );
  const laneOver = (lane: ItemLane) => over?.kind === "lane" && over.id === lane;

  const saveName = () => {
    const name = renaming?.trim();
    setRenaming(null);
    if (name && name !== project.name) run("project_rename", actions.projectSave({ ...project, name }));
  };

  return (
    <div className={cx("pp", draggingId && "is-dragging")}>
      <header className="pp__header">
        <Avatar name={workspace?.name ?? project.name} color={workspace?.color ?? project.color} size={30} className="pp__avatar" />
        <div className="pp__titles">
          <span className="pp__workspace">{workspace?.name ?? "No workspace"}</span>
          {renaming !== null ? (
            <input className="pp__rename" aria-label="Project name" value={renaming} autoFocus
              onChange={e => setRenaming(e.target.value)} onBlur={saveName}
              onKeyDown={e => { if (e.key === "Enter") saveName(); if (e.key === "Escape") { e.stopPropagation(); setRenaming(null); } }} />
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="pp__name" aria-label={`${project.name} menu`}>{project.name}</button>
              </DropdownMenuTrigger>
              <ProjectMenu onRename={() => setRenaming(project.name)} onLink={() => setDialog("link")} onDelete={() => setDialog("delete")} />
            </DropdownMenu>
          )}
        </div>
        <div className="pp__pills">
          <Pill icon={<Pin size={12} aria-hidden />}>{lanes.focus.length} Focus</Pill>
          <Pill variant="backlog">{lanes.backlog.length} Backlog</Pill>
          {linked && <Pill variant="purple" icon={<Link2 size={12} aria-hidden />} title="Linked Freddai project">{linked.name}</Pill>}
        </div>
        <div className="pp__actions">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="pp__icon" aria-label="Project options"><MoreHorizontal size={16} aria-hidden /></button>
            </DropdownMenuTrigger>
            <ProjectMenu onRename={() => setRenaming(project.name)} onLink={() => setDialog("link")} onDelete={() => setDialog("delete")} />
          </DropdownMenu>
          <DarkButton icon={<Plus size={14} aria-hidden />} onClick={() => onNewItem(project.id)}>Add</DarkButton>
          <button type="button" className="pp__icon pp__close" aria-label="Close" onClick={onClose}><X size={16} aria-hidden /></button>
        </div>
      </header>

      <div className={cx("pp__board", doneOpen && "is-done-open")}>
        <section className={cx("sc-lane sc-lane--focus pp-lane", laneOver("focus") && "is-drop")} aria-label="Focus"
          data-drop="lane" data-drop-id="focus">
          <h3 className="pp-lane__head"><Pin size={14} aria-hidden /> Focus <span className="pp-lane__count">{lanes.focus.length}</span></h3>
          <div className="pp-lane__list">{lanes.focus.map(i => card(i))}</div>
          <div className={cx("pp-drop", laneOver("focus") && "is-drop")} data-drop="lane" data-drop-id="focus">
            <ArrowUp size={14} aria-hidden /> Drag from Backlog to focus on it
          </div>
        </section>

        <section className={cx("sc-lane pp-lane pp-lane--backlog", laneOver("backlog") && "is-drop")} aria-label="Backlog"
          data-drop="lane" data-drop-id="backlog">
          <h3 className="pp-lane__head">Backlog <span className="pp-lane__count">{lanes.backlog.length}</span></h3>
          <div className="pp-lane__list">
            {lanes.backlog.map(i => card(i, { promote: true }))}
            {lanes.backlog.length === 0 && <p className="pp-lane__empty">Nothing in the backlog.</p>}
          </div>
        </section>

        <section className={cx("sc-lane sc-lane--done pp-done", doneOpen && "is-open", laneOver("done") && "is-drop")} aria-label="Done"
          data-drop="lane" data-drop-id="done">
          <button type="button" className="pp-done__toggle" aria-expanded={doneOpen} onClick={() => setDoneOpen(o => !o)}
            aria-label={doneOpen ? "Collapse done" : `Show ${lanes.done.length} done`}>
            <span className="pp-done__check"><Check size={16} strokeWidth={3} aria-hidden /></span>
            <span className="pp-done__count">{lanes.done.length}</span>
            <span className="pp-done__label">Done</span>
            {doneOpen && <ChevronRight size={14} className="pp-done__chev" aria-hidden />}
          </button>
          {doneOpen && (
            <ul className="pp-done__list">
              {lanes.done.map(i => (
                <li key={i.id} data-drop="item" data-drop-id={i.id} data-drop-axis="y">
                  <button type="button" className="pp-done__item" onPointerDown={start(i.id, i.title)} onClick={() => onOpenItem(i.id)}>
                    <KindIcon kind={i.kind} size={13} /> <span>{i.title}</span>
                  </button>
                </li>
              ))}
              {lanes.done.length === 0 && <li className="pp-lane__empty">Nothing done yet.</li>}
            </ul>
          )}
        </section>
      </div>

      {drag && <div className="pp-ghost" style={{ left: drag.x + 12, top: drag.y + 12 }} aria-hidden>{drag.label}</div>}

      <LinkDialog open={dialog === "link"} db={db} current={project.freddai_project} onClose={() => setDialog(null)}
        onSave={freddai_project => { setDialog(null); run("project_link", actions.projectSave({ ...project, freddai_project })); }} />

      <Dialog open={dialog === "delete"} onOpenChange={o => { if (!o) setDialog(null); }}>
        <DialogContent className="sc-dialog">
          <DialogTitle>Delete {project.name}?</DialogTitle>
          <DialogDescription>
            {lanes.focus.length + lanes.backlog.length + lanes.done.length} items in this project will be deleted too. This cannot be undone.
          </DialogDescription>
          <div className="sc-dialog__actions">
            <GhostButton onClick={() => setDialog(null)}>Cancel</GhostButton>
            <DarkButton className="sc-dialog__danger" onClick={() => {
              setDialog(null);
              actions.projectDelete(project.id).then(onClose, error => console.error("[scout] project_delete failed", error));
            }}><Trash2 size={14} aria-hidden /> Delete project</DarkButton>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProjectMenu({ onRename, onLink, onDelete }: { onRename: () => void; onLink: () => void; onDelete: () => void }) {
  return (
    <DropdownMenuContent align="start">
      <DropdownMenuItem onSelect={onRename}><Pencil size={14} aria-hidden /> Rename</DropdownMenuItem>
      <DropdownMenuItem onSelect={onLink}><Link2 size={14} aria-hidden /> Link to a Freddai project…</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onSelect={onDelete}><Trash2 size={14} aria-hidden /> Delete project…</DropdownMenuItem>
    </DropdownMenuContent>
  );
}

function LinkDialog({ open, db, current, onClose, onSave }: {
  open: boolean; db: Database | null; current: string | null; onClose: () => void; onSave: (id: string | null) => void;
}) {
  const [value, setValue] = useState(current ?? "");
  return (
    <Dialog open={open} onOpenChange={o => { if (o) setValue(current ?? ""); else onClose(); }}>
      <DialogContent className="sc-dialog">
        <DialogTitle>Link to a Freddai project</DialogTitle>
        <DialogDescription>Chats on this project's items run in the linked Freddai project.</DialogDescription>
        {db ? (
          <select className="sc-dialog__select" aria-label="Freddai project" value={value} onChange={e => setValue(e.target.value)}>
            <option value="">Not linked</option>
            {db.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ) : <p className="sc-dialog__error" role="alert">Freddai projects could not be loaded, so linking is unavailable right now.</p>}
        <div className="sc-dialog__actions">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <DarkButton disabled={!db} onClick={() => onSave(value || null)}>Save</DarkButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ItemCard({ item, db, highlighted, dragging, dropEdge, onPointerDown, onOpen, onPromote }: {
  item: Item; db: Database | null; highlighted: boolean; dragging: boolean; dropEdge: "before" | "after" | null;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void; onOpen: () => void; onPromote?: () => void;
}) {
  return (
    <article className={cx("sc-card pp-card", highlighted && "is-selected", dragging && "is-dragged", dropEdge && `is-drop-${dropEdge}`)}
      aria-label={item.title} data-drop="item" data-drop-id={item.id} data-drop-axis="y"
      onPointerDown={onPointerDown} onClick={onOpen}>
      <div className="pp-card__head">
        <KindIcon kind={item.kind} size={16} />
        <button type="button" className="pp-card__title" onClick={e => { e.stopPropagation(); onOpen(); }}>{item.title}</button>
        {onPromote && (
          <button type="button" className="pp__icon pp-card__promote" aria-label={`Move ${item.title} to Focus`} title="Move to Focus" data-no-drag
            onClick={e => { e.stopPropagation(); onPromote(); }}><ArrowUp size={15} aria-hidden /></button>
        )}
      </div>
      {item.subtitle && <p className="pp-card__sub">{item.subtitle}</p>}
      <div className="pp-card__foot">
        {item.status === "needs_you" && <Pill variant="danger" icon={<CircleAlert size={12} aria-hidden />}>Needs you</Pill>}
        {item.status === "agent_working" && <Pill variant="purple" icon={<Sparkles size={12} aria-hidden />}>{agentLabel(db, item)}</Pill>}
        {item.status === "ready" && <Pill variant="success" icon={<Check size={12} aria-hidden />}>Ready</Pill>}
        {item.origin === "rule" && <Pill variant="success" icon={<Zap size={12} aria-hidden />}>Added by a rule</Pill>}
        {highlighted && (
          <DarkButton className="pp-card__go" icon={<ArrowRight size={14} aria-hidden />} data-no-drag
            onClick={e => { e.stopPropagation(); onOpen(); }}>Let's go</DarkButton>
        )}
      </div>
    </article>
  );
}
