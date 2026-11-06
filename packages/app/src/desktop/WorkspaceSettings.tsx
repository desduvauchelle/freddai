import { ColorField } from "./ColorField";
import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@freddai/ui/components/button";
import { Input } from "@freddai/ui/components/input";
import type { Project, Workspace } from "./types";

const projectDragType = "application/x-freddai-workspace-project";
export function WorkspaceSettings({ projects, workspaces, disabled, onSave }: {
  projects: Project[]; workspaces: Workspace[]; disabled: boolean;
  onSave: (next: Workspace[]) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#b59ae9");
  const [adding, setAdding] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const pointerDrag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const workspaceAt = (x: number, y: number) => {
    const card = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-workspace-id]");
    return card && root.current?.contains(card) ? card.dataset.workspaceId : undefined;
  };
  const clearDrag = () => { pointerDrag.current = null; setDragging(null); setDropTarget(null); };
  const update = (workspace: Workspace) => onSave(workspaces.map(w => w.id === workspace.id ? workspace : w));
  const addProject = (workspace: Workspace, id: string) => {
    if (disabled || !projects.some(p => p.id === id) || workspace.projects.includes(id)) return;
    void update({ ...workspace, projects: [...workspace.projects, id] });
  };
  return <div ref={root} className="workspace-settings space-y-6">
    <form className="flex flex-wrap items-end gap-3" onSubmit={async e => {
      e.preventDefault();
      if (disabled || !name.trim()) return;
      const result = await onSave([...workspaces, { id: crypto.randomUUID(), name: name.trim(), color, projects: [] }]);
      if (result !== undefined) setName("");
    }}>
      <label className="grid flex-1 gap-2">Workspace name<Input aria-label="New workspace name" value={name} onChange={e => setName(e.target.value)} disabled={disabled} placeholder="e.g. Personal" /></label>
      <div className="grid gap-2"><span>Color</span><ColorField label="New workspace color" value={color} onChange={setColor} disabled={disabled} /></div>
      <Button type="submit" disabled={disabled || !name.trim()}><Plus size={14}/>Create workspace</Button>
    </form>
    <section aria-label="Available projects" className="space-y-2">
      <h2 className="font-medium">Your projects</h2>
      <p className="text-sm text-muted-foreground">Drag a project into a workspace, or use its Add project button. Projects can belong to more than one workspace.</p>
      <div className="flex flex-wrap gap-2">{projects.map(p => <span key={p.id} draggable={false} className="workspace-project-source" data-dragging={dragging === p.id}
        onPointerDown={e => {
          if (disabled || e.button !== 0) return;
          e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
          pointerDrag.current = { id: p.id, x: e.clientX, y: e.clientY, moved: false };
        }}
        onPointerMove={e => {
          const drag = pointerDrag.current;
          if (!drag || disabled) return;
          if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
          drag.moved = true; setDragging(drag.id);
          setDropTarget(workspaceAt(e.clientX, e.clientY) || null);
          const viewport = root.current?.closest<HTMLElement>('[data-radix-scroll-area-viewport]');
          if (viewport) {
            const bounds = viewport.getBoundingClientRect();
            if (e.clientY < bounds.top + 40) viewport.scrollTop -= 16;
            if (e.clientY > bounds.bottom - 40) viewport.scrollTop += 16;
          }
        }}
        onPointerUp={e => {
          const drag = pointerDrag.current;
          const target = workspaceAt(e.clientX, e.clientY);
          clearDrag();
          if (drag?.moved && target) {
            const workspace = workspaces.find(w => w.id === target);
            if (workspace) addProject(workspace, drag.id);
          }
        }}
        onPointerCancel={clearDrag} onLostPointerCapture={clearDrag}>{p.name}</span>)}</div>
      {!projects.length && <p className="text-sm text-muted-foreground">Add projects in Settings → Projects first.</p>}
    </section>
    {!workspaces.length && <p className="text-sm text-muted-foreground">Create your first workspace to group projects in the sidebar.</p>}
    {workspaces.map(w => <section key={w.id} data-workspace-id={w.id} aria-label={`${w.name} workspace`} className={`workspace-card ${dragging ? "workspace-drop-ready" : ""} ${dropTarget === w.id ? "workspace-drop-target" : ""}`} style={{ borderLeftColor: w.color }}
      onDragOver={e => { if (!disabled && e.dataTransfer.types.includes(projectDragType)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
      onDrop={e => { e.preventDefault(); setDragging(null); addProject(w, e.dataTransfer.getData(projectDragType)); }}>
      <div className="flex flex-wrap items-center gap-3">
        <ColorField label={`Color for ${w.name}`} value={w.color} disabled={disabled} onChange={color => void update({ ...w, color })}/>
        <Input key={`${w.id}:${w.name}`} className="flex-1" aria-label={`Name for ${w.name}`} defaultValue={w.name} disabled={disabled} onBlur={e => {
          const value = e.target.value.trim();
          if (value && value !== w.name) void update({ ...w, name: value });
          else e.target.value = w.name;
        }} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}/>
        <Button variant="outline" disabled={disabled} onClick={() => setAdding(adding === w.id ? null : w.id)}><Plus size={14}/>Add project</Button>
        <Button variant="ghost" disabled={disabled} onClick={() => setConfirmDelete(w.id)}>Delete</Button>
      </div>
      {confirmDelete === w.id && <div className="flex flex-wrap items-center gap-2 text-sm"><p>Delete this workspace? Projects and threads will be kept.</p><Button variant="destructive" disabled={disabled} onClick={async () => { await onSave(workspaces.filter(other => other.id !== w.id)); setConfirmDelete(null); }}>Delete workspace</Button><Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button></div>}
      {adding === w.id && <div className="flex flex-wrap gap-2" aria-label={`Add projects to ${w.name}`}>
        {projects.filter(p => !w.projects.includes(p.id)).map(p => <Button key={p.id} variant="outline" disabled={disabled} onClick={() => addProject(w, p.id)}><Plus size={12}/>{p.name}</Button>)}
        {projects.every(p => w.projects.includes(p.id)) && <p className="text-sm text-muted-foreground">All projects have been added.</p>}
      </div>}
      <div className="flex flex-wrap gap-2">{projects.filter(p => w.projects.includes(p.id)).map(p => <span key={p.id} className="workspace-member">{p.name}<Button variant="ghost" size="icon" aria-label={`Remove ${p.name} from ${w.name}`} disabled={disabled} onClick={() => void update({ ...w, projects: w.projects.filter(id => id !== p.id) })}><X size={12}/></Button></span>)}</div>
      {!projects.some(p => w.projects.includes(p.id)) && <p className="text-sm text-muted-foreground">Drop projects here or click Add project.</p>}
    </section>)}
  </div>;
}
