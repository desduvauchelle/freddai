import { useState } from "react";
import { ArrowDown, ArrowUp, Download, Hash, Pencil, Plus, Trash2 } from "lucide-react";
import { uuid, type Project, type Workspace } from "../api";
import type { ScreenBase } from "../contracts";
import { cx, DarkButton, GhostButton } from "../ui";
import { InlineError, PALETTE, useRun } from "./common";

const sorted = <T extends { order: number }>(list: T[]) => [...list].sort((a, b) => a.order - b.order);

/** Text that becomes an input when clicked. Enter saves, Escape cancels. */
export function InlineName({ value, label, onSave, className, startEditing = false, onCancel }: {
  value: string; label: string; onSave: (name: string) => void; className?: string; startEditing?: boolean; onCancel?: () => void;
}) {
  const [editing, setEditing] = useState(startEditing);
  const [text, setText] = useState(value);
  if (!editing) {
    return <button type="button" className={cx("st-inline-name", className)} aria-label={`Rename ${value}`} title="Click to rename"
      onClick={() => { setText(value); setEditing(true); }}>{value}</button>;
  }
  const commit = () => {
    const name = text.trim();
    setEditing(false);
    if (name && name !== value) onSave(name);
    else onCancel?.();
  };
  return <input className={cx("st-inline-input", className)} aria-label={label} autoFocus value={text}
    onChange={e => setText(e.target.value)} onBlur={commit}
    onKeyDown={e => {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") { setEditing(false); setText(value); onCancel?.(); }
    }} />;
}

export function useWorkspaceOps({ state, actions }: Pick<ScreenBase, "state" | "actions">) {
  const { run, error, clearError } = useRun();
  const workspaces = sorted(state.workspaces);
  const projectsOf = (id: string) => sorted(state.projects.filter(p => p.workspace === id));
  return {
    run, error, clearError, workspaces, projectsOf,
    createWorkspace: (name: string) => run(() => actions.workspaceSave({
      id: uuid(), name, color: PALETTE[state.workspaces.length % PALETTE.length], order: state.workspaces.length, collapsed: false,
    })),
    createProject: (workspace: Workspace, name: string) => run(() => actions.projectSave({
      id: uuid(), workspace: workspace.id, name, color: workspace.color, order: projectsOf(workspace.id).length,
      pinned: false, hidden: false, freddai_project: null,
    })),
    renameWorkspace: (w: Workspace, name: string) => run(() => actions.workspaceSave({ ...w, name })),
    recolor: (w: Workspace, color: string) => run(() => actions.workspaceSave({ ...w, color })),
    renameProject: (p: Project, name: string) => run(() => actions.projectSave({ ...p, name })),
    importFreddai: () => run(() => actions.importFreddai()),
    move: (index: number, delta: number) => {
      const ids = workspaces.map(w => w.id);
      const target = index + delta;
      if (target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      void run(() => actions.workspaceReorder(ids));
    },
    remove: (id: string) => run(() => actions.workspaceDelete(id)),
  };
}

function NewWorkspaceInput({ onCreate, onDone }: { onCreate: (name: string) => void; onDone: () => void }) {
  return <InlineName value="" label="New workspace name" startEditing onCancel={onDone}
    onSave={name => { onCreate(name); onDone(); }} />;
}

/** Settings › Workspaces: a plain ordered list. */
export function WorkspaceList(props: Pick<ScreenBase, "state" | "actions">) {
  const ops = useWorkspaceOps(props);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  return <div className="st-workspaces">
    <div className="st-toolbar">
      <div className="st-toolbar__pills"><span className="st-muted">{ops.workspaces.length} workspace{ops.workspaces.length === 1 ? "" : "s"}</span></div>
      <div className="st-toolbar__actions">
        <GhostButton icon={<Download size={14} />} onClick={() => void ops.importFreddai()}>Import from Freddai</GhostButton>
        <DarkButton icon={<Plus size={14} />} onClick={() => setAdding(true)}>New workspace</DarkButton>
      </div>
    </div>
    <InlineError error={ops.error} onDismiss={ops.clearError} />
    {ops.workspaces.length === 0 && !adding && <p className="st-note">No workspaces yet. Create one, or import your Freddai workspaces and projects.</p>}
    <ul className="st-list">
      {ops.workspaces.map((w, i) => {
        const count = ops.projectsOf(w.id).length;
        return <li key={w.id} className="st-list__row">
          <span className="st-dot" style={{ background: w.color }} aria-hidden />
          <InlineName value={w.name} label={`Name of ${w.name}`} onSave={name => void ops.renameWorkspace(w, name)} />
          <span className="st-muted">{count} project{count === 1 ? "" : "s"}</span>
          <span className="st-list__actions">
            {confirming === w.id ? <>
              <span className="st-confirm">Delete “{w.name}”{count ? ` and its ${count} project${count === 1 ? "" : "s"}` : ""}?</span>
              <button type="button" className="sc-btn st-btn-danger" onClick={() => { setConfirming(null); void ops.remove(w.id); }}>Delete</button>
              <GhostButton onClick={() => setConfirming(null)}>Cancel</GhostButton>
            </> : <>
              <button type="button" className="st-icon-btn" aria-label={`Move ${w.name} up`} disabled={i === 0} onClick={() => ops.move(i, -1)}><ArrowUp size={14} /></button>
              <button type="button" className="st-icon-btn" aria-label={`Move ${w.name} down`} disabled={i === ops.workspaces.length - 1} onClick={() => ops.move(i, 1)}><ArrowDown size={14} /></button>
              <button type="button" className="st-icon-btn" aria-label={`Delete ${w.name}`} onClick={() => setConfirming(w.id)}><Trash2 size={14} /></button>
            </>}
          </span>
        </li>;
      })}
      {adding && <li className="st-list__row">
        <span className="st-dot" style={{ background: PALETTE[ops.workspaces.length % PALETTE.length] }} aria-hidden />
        <NewWorkspaceInput onCreate={name => void ops.createWorkspace(name)} onDone={() => setAdding(false)} />
      </li>}
    </ul>
  </div>;
}

/** Onboarding step 2: workspace cards with their projects, add / rename / color. */
export function WorkspaceBoard(props: Pick<ScreenBase, "state" | "actions">) {
  const ops = useWorkspaceOps(props);
  const [addingWorkspace, setAddingWorkspace] = useState(false);
  const [addingProject, setAddingProject] = useState<string | null>(null);
  const [coloring, setColoring] = useState<string | null>(null);
  return <div className="st-board-wrap">
    <div className="st-toolbar">
      <div className="st-toolbar__actions st-toolbar__actions--left">
        <button type="button" className="sc-btn st-btn-accent" onClick={() => void ops.importFreddai()}><Download size={14} /> Import from Freddai</button>
        <span className="st-muted">Brings in your Freddai workspaces and projects. Safe to run again.</span>
      </div>
    </div>
    <InlineError error={ops.error} onDismiss={ops.clearError} />
    <div className="st-board">
      {ops.workspaces.map(w => <section key={w.id} className="st-wscard" aria-label={w.name}>
        <header className="st-wscard__head">
          <button type="button" className="st-dot st-dot--btn" style={{ background: w.color }} aria-label={`Color of ${w.name}`} onClick={() => setColoring(c => c === w.id ? null : w.id)} />
          <InlineName value={w.name} label={`Name of ${w.name}`} className="st-wscard__name" onSave={name => void ops.renameWorkspace(w, name)} />
          <Pencil size={12} className="st-faint" aria-hidden />
        </header>
        {coloring === w.id && <div className="st-swatches" role="group" aria-label="Pick a color">
          {PALETTE.map(c => <button key={c} type="button" className={cx("st-swatch", c === w.color && "is-on")} style={{ background: c }}
            aria-label={`Use color ${c}`} onClick={() => { setColoring(null); void ops.recolor(w, c); }} />)}
        </div>}
        <div className="st-eyebrow">Projects</div>
        <ul className="st-projects">
          {ops.projectsOf(w.id).map(p => <li key={p.id} className="st-project">
            <Hash size={13} className="st-faint" aria-hidden />
            <InlineName value={p.name} label={`Name of ${p.name}`} onSave={name => void ops.renameProject(p, name)} />
          </li>)}
          {addingProject === w.id
            ? <li className="st-project is-editing"><Hash size={13} className="st-faint" aria-hidden />
              <InlineName value="" label={`New project in ${w.name}`} startEditing onCancel={() => setAddingProject(null)}
                onSave={name => { setAddingProject(null); void ops.createProject(w, name); }} /></li>
            : <li><button type="button" className="st-dashed" onClick={() => setAddingProject(w.id)}><Plus size={13} /> Add project</button></li>}
        </ul>
      </section>)}
      {addingWorkspace
        ? <section className="st-wscard st-wscard--new"><NewWorkspaceInput onCreate={name => void ops.createWorkspace(name)} onDone={() => setAddingWorkspace(false)} /></section>
        : <button type="button" className="st-wscard st-wscard--add" onClick={() => setAddingWorkspace(true)}>
          <span><Plus size={14} /> Add workspace</span>
          <span className="st-muted">A company or a part of your life</span>
        </button>}
    </div>
  </div>;
}
