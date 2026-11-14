import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@freddai/ui/components/dialog";
import { uuid, type Item, type ItemLane } from "../api";
import type { NewItemDialogProps } from "../contracts";
import { DarkButton, GhostButton, KindIcon, cx } from "../ui";
import { byOrder } from "../home/board";
import "./project.css";

type ItemKind = Item["kind"];

const KINDS: { kind: ItemKind; label: string }[] = [
  { kind: "email", label: "Email" },
  { kind: "meeting", label: "Meeting" },
  { kind: "task", label: "To-do" },
  { kind: "contact", label: "Contact" },
  { kind: "note", label: "Note" },
  { kind: "code", label: "Code" },
];

export function NewItemDialog({ state, actions, open, projectId, onClose, onCreated }: NewItemDialogProps) {
  const projects = useMemo(() => {
    const ws = [...state.workspaces].sort(byOrder);
    return ws.flatMap(w => state.projects.filter(p => p.workspace === w.id).sort(byOrder).map(p => ({ project: p, label: `${w.name} / ${p.name}` })))
      .concat(state.projects.filter(p => !ws.some(w => w.id === p.workspace)).map(p => ({ project: p, label: p.name })));
  }, [state.workspaces, state.projects]);

  const [kind, setKind] = useState<ItemKind>("task");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [project, setProject] = useState(projectId ?? "");
  const [lane, setLane] = useState<Exclude<ItemLane, "done">>("backlog");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKind("task"); setTitle(""); setSubtitle(""); setLane("backlog"); setError(null); setBusy(false);
    setProject(projectId ?? "");
  }, [open, projectId]);

  const canCreate = title.trim() !== "" && project !== "" && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    const now = new Date().toISOString();
    const inLane = state.items.filter(i => i.project === project && i.lane === lane);
    const item: Item = {
      id: uuid(), project, kind, title: title.trim(), subtitle: subtitle.trim() || null,
      lane, status: "none", source: null, origin: "user", thread: null,
      order: inLane.reduce((max, i) => Math.max(max, i.order + 1), 0),
      created: now, updated: now, done_at: null,
    };
    setBusy(true);
    setError(null);
    try {
      await actions.itemSave(item);
      onCreated(item.id);
    } catch (err) {
      console.error("[scout] item_create failed", err);
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sc-dialog ni">
        <DialogTitle className="ni__title">New item</DialogTitle>
        <DialogDescription className="sr-only">Create an item in a project.</DialogDescription>
        <form className="ni__form" onSubmit={submit}>
          <fieldset className="ni__kinds">
            <legend className="ni__label">Type</legend>
            {KINDS.map(k => (
              <button key={k.kind} type="button" className={cx("ni__kind", kind === k.kind && "is-active")}
                aria-pressed={kind === k.kind} onClick={() => setKind(k.kind)}>
                <KindIcon kind={k.kind} size={18} />
                <span>{k.label}</span>
              </button>
            ))}
          </fieldset>
          <label className="ni__field">
            <span className="ni__label">Title</span>
            <input className="ni__input" value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs doing?" autoFocus required />
          </label>
          <label className="ni__field">
            <span className="ni__label">Details <small>(optional)</small></span>
            <input className="ni__input" value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="e.g. Gmail · jordan@acme.example" />
          </label>
          <div className="ni__row">
            <label className="ni__field">
              <span className="ni__label">Project</span>
              <select className="ni__input" value={project} onChange={e => setProject(e.target.value)} required>
                <option value="" disabled>Choose a project</option>
                {projects.map(({ project: p, label }) => <option key={p.id} value={p.id}>{label}</option>)}
              </select>
            </label>
            <div className="ni__field">
              <span className="ni__label" id="ni-lane">Lane</span>
              <div className="ni__seg" role="radiogroup" aria-labelledby="ni-lane">
                {(["focus", "backlog"] as const).map(l => (
                  <button key={l} type="button" role="radio" aria-checked={lane === l} className={cx("ni__seg-btn", lane === l && "is-active")}
                    onClick={() => setLane(l)}>{l === "focus" ? "Focus" : "Backlog"}</button>
                ))}
              </div>
            </div>
          </div>
          {projects.length === 0 && <p className="sc-dialog__error" role="alert">Create a project first: items always live in a project.</p>}
          {error && <p className="sc-dialog__error" role="alert">Could not create the item: {error}</p>}
          <div className="sc-dialog__actions">
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            <DarkButton type="submit" disabled={!canCreate}>{busy ? "Creating…" : "Create"}</DarkButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
