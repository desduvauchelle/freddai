import "./WorkspaceSettings.css";
import { ColorField } from "./ColorField";
import { useRef, useState, type PointerEvent } from "react";
import { Check, GripVertical, Plus, Trash2, X } from "lucide-react";
import { Button } from "@freddai/ui/components/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@freddai/ui/components/sheet";
import { Input } from "@freddai/ui/components/input";
import type { Project, Workspace } from "./types";

const projectDragType = "application/x-freddai-workspace-project";
export function WorkspaceSettings({ projects, workspaces, disabled, onSave }: {
  projects: Pick<Project, "id" | "name" | "color">[]; workspaces: Workspace[]; disabled: boolean;
  onSave: (next: Workspace[]) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#b59ae9");
  const [adding, setAdding] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [savingProject, setSavingProject] = useState<string | null>(null);
  const saving = useRef(false);
  const [pickerError, setPickerError] = useState("");
  const pickerWorkspace = workspaces.find(w => w.id === adding);
  const pickerHeading = useRef<HTMLHeadingElement | null>(null);
  const addTrigger = useRef<HTMLButtonElement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const pointerDrag = useRef<{ id: string; source?: string; x: number; y: number; moved: boolean } | null>(null);
  const [workspaceDrag, setWorkspaceDrag] = useState<{ id: string; target: string; after: boolean } | null>(null);
  const workspacePointer = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const workspaceAt = (x: number, y: number) => {
    const card = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-workspace-id]");
    return card && root.current?.contains(card) ? card.dataset.workspaceId : undefined;
  };
  const moveWorkspace = (id: string, target: string, after: boolean) => {
    if (disabled || id === target) return;
    const workspace = workspaces.find(w => w.id === id);
    if (!workspace || !workspaces.some(w => w.id === target)) return;
    const next = workspaces.filter(w => w.id !== id);
    next.splice(next.findIndex(w => w.id === target) + (after ? 1 : 0), 0, workspace);
    if (next.some((w, index) => w.id !== workspaces[index].id)) void onSave(next);
  };
  const workspaceDrop = (x: number, y: number) => {
    const target = workspaceAt(x, y);
    const card = target && Array.from(root.current?.querySelectorAll<HTMLElement>("[data-workspace-id]") || []).find(card => card.dataset.workspaceId === target);
    if (!card) return null;
    const bounds = card.getBoundingClientRect();
    return { target: target!, after: y > bounds.top + bounds.height / 2 };
  };
  const clearWorkspaceDrag = () => { workspacePointer.current = null; setWorkspaceDrag(null); };
  const clearDrag = () => { pointerDrag.current = null; setDragging(null); setDropTarget(null); };
  const update = (workspace: Workspace) => onSave(workspaces.map(w => w.id === workspace.id ? workspace : w));
  const addProject = (workspace: Workspace, id: string) => {
    if (disabled || !projects.some(p => p.id === id) || workspace.projects.includes(id)) return;
    void update({ ...workspace, projects: [...workspace.projects, id] });
  };
  const moveProject = (id: string, source: string | undefined, target: string) => {
    if (disabled || source === target || !projects.some(p => p.id === id)) return;
    if (target && !workspaces.some(w => w.id === target)) return;
    const next = workspaces.map(w => ({ ...w, projects: !target || w.id === source
      ? w.projects.filter(p => p !== id)
      : w.id === target ? [...new Set([...w.projects, id])] : w.projects }));
    if (next.some((w, i) => w.projects.join('\0') !== workspaces[i].projects.join('\0'))) void onSave(next);
  };
  const projectPointer = (id: string, source?: string) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
          if (disabled || e.button !== 0) return;
          e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
          pointerDrag.current = { id, source, x: e.clientX, y: e.clientY, moved: false };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
          const drag = pointerDrag.current;
          if (!drag || disabled) return;
          if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
          drag.moved = true; setDragging(drag.id);
          setDropTarget(workspaceAt(e.clientX, e.clientY) ?? null);
          const viewport = root.current?.closest<HTMLElement>('[data-radix-scroll-area-viewport], .companion-workspaces');
          if (viewport) {
            const bounds = viewport.getBoundingClientRect();
            if (e.clientY < bounds.top + 40) viewport.scrollTop -= 16;
            if (e.clientY > bounds.bottom - 40) viewport.scrollTop += 16;
          }
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
          const drag = pointerDrag.current;
          const target = workspaceAt(e.clientX, e.clientY);
          clearDrag();
          if (drag?.moved && target !== undefined) moveProject(drag.id, drag.source, target);

    },
    onPointerCancel: clearDrag, onLostPointerCapture: clearDrag,
  });
  return <div ref={root} className="workspace-settings space-y-6">
    <form className="flex flex-wrap items-end gap-3" onSubmit={async e => {
      e.preventDefault();
      if (disabled || !name.trim()) return;
      const result = await onSave([...workspaces, { id: crypto.randomUUID(), name: name.trim(), color, projects: [] }]);
      if (result !== undefined) setName("");
    }}>
      <label className="grid flex-1 gap-2">Workspace name<Input aria-label="New workspace name" value={name} onChange={e => setName(e.target.value)} disabled={disabled} placeholder="e.g. Personal" /></label>
      <div className="grid gap-2"><span>Color</span><ColorField compact label="New workspace color" value={color} onChange={setColor} disabled={disabled} /></div>
      <Button type="submit" disabled={disabled || !name.trim()}><Plus size={14}/>Create workspace</Button>
    </form>
    <section aria-label="Available projects" className="space-y-2">
      <h2 className="font-medium">Your projects</h2>
      <p className="text-sm text-muted-foreground">Use Add projects in a workspace to choose its projects. A project can belong to more than one workspace. You can also drag projects between groups.</p>
      <div className="flex flex-wrap gap-2">{projects.map(p => <span key={p.id} draggable={false} className="workspace-project-source" data-dragging={dragging === p.id}
        {...projectPointer(p.id)}>{p.name}</span>)}</div>
      {!projects.length && <p className="text-sm text-muted-foreground">Add projects in Settings → Projects first.</p>}
    </section>
    <section data-workspace-id="" aria-label="No workspace" className={`workspace-card ${dropTarget === "" ? "workspace-drop-target" : ""}`}>
      <h2>No workspace</h2>
      <p className="text-sm text-muted-foreground">Drop here to remove a project from all workspaces.</p>
      <div className="flex flex-wrap gap-2">{projects.filter(p => !workspaces.some(w => w.projects.includes(p.id))).map(p => <span key={p.id} className="workspace-project-source" data-dragging={dragging === p.id} {...projectPointer(p.id)}>{p.name}</span>)}</div>
    </section>
    {!workspaces.length && <p className="text-sm text-muted-foreground">Create your first workspace to group projects in the sidebar.</p>}
    {workspaces.length > 1 && <p className="text-sm text-muted-foreground">Drag a workspace handle to reorder. You can also focus a handle and press Alt+↑/↓.</p>}
    {workspaces.map(w => <section key={w.id} data-workspace-id={w.id} aria-label={`${w.name} workspace`} className={`workspace-card ${dragging ? "workspace-drop-ready" : ""} ${dropTarget === w.id ? "workspace-drop-target" : ""} ${workspaceDrag?.target === w.id && workspaceDrag.id !== w.id ? `project-reorder-${workspaceDrag.after ? "after" : "before"}` : ""}`} style={{ borderLeftColor: w.color }}
      onDragOver={e => { if (!disabled && e.dataTransfer.types.includes(projectDragType)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
      onDrop={e => { e.preventDefault(); setDragging(null); addProject(w, e.dataTransfer.getData(projectDragType)); }}>
      <div className="workspace-header">
        <button type="button" className="project-drag-handle" aria-label={`Reorder workspace ${w.name}`}
          title="Drag to reorder · Alt+↑/↓ to move" disabled={disabled || workspaces.length < 2}
          onKeyDown={e => {
            if (!e.altKey || !["ArrowUp", "ArrowDown"].includes(e.key)) return;
            e.preventDefault();
            const offset = e.key === "ArrowUp" ? -1 : 1;
            const target = workspaces[workspaces.findIndex(other => other.id === w.id) + offset];
            if (target) moveWorkspace(w.id, target.id, offset > 0);
          }}
          onPointerDown={e => {
            if (disabled || e.button !== 0) return;
            e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
            workspacePointer.current = w.id;
            setWorkspaceDrag({ id: w.id, target: w.id, after: false });
          }}
          onPointerMove={e => {
            if (workspacePointer.current !== w.id || disabled) return;
            const drop = workspaceDrop(e.clientX, e.clientY);
            setWorkspaceDrag(drop ? { id: w.id, ...drop } : null);
            const viewport = root.current?.closest<HTMLElement>('[data-radix-scroll-area-viewport], .companion-workspaces');
            if (viewport) {
              const bounds = viewport.getBoundingClientRect();
              if (e.clientY < bounds.top + 40) viewport.scrollTop -= 16;
              if (e.clientY > bounds.bottom - 40) viewport.scrollTop += 16;
            }
          }}
          onPointerUp={e => {
            const id = workspacePointer.current;
            const drop = workspaceDrop(e.clientX, e.clientY);
            clearWorkspaceDrag();
            if (id && drop) moveWorkspace(id, drop.target, drop.after);
          }}
          onPointerCancel={clearWorkspaceDrag} onLostPointerCapture={clearWorkspaceDrag}><GripVertical size={14}/></button>
        <Input key={`${w.id}:${w.name}`} className="flex-1" aria-label={`Name for ${w.name}`} defaultValue={w.name} disabled={disabled} onBlur={e => {
          const value = e.target.value.trim();
          if (value && value !== w.name) void update({ ...w, name: value });
          else e.target.value = w.name;
        }} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}/>
        <ColorField compact label={`Color for ${w.name}`} value={w.color} disabled={disabled} onChange={color => void update({ ...w, color })}/>
        <Button variant="outline" disabled={disabled} onClick={e => { addTrigger.current = e.currentTarget; setQuery(""); setPickerError(""); setAdding(w.id); }}><Plus size={14}/>Add projects</Button>
        <Button variant="ghost" size="icon" aria-label={`Delete workspace ${w.name}`} title="Delete workspace" disabled={disabled} onClick={() => setConfirmDelete(w.id)}><Trash2 size={16}/></Button>
      </div>
      {confirmDelete === w.id && <div className="flex flex-wrap items-center gap-2 text-sm"><p>Delete this workspace? Projects and threads will be kept.</p><Button variant="destructive" disabled={disabled} onClick={async () => { await onSave(workspaces.filter(other => other.id !== w.id)); setConfirmDelete(null); }}>Delete workspace</Button><Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button></div>}
      <div className="flex flex-wrap gap-2">{projects.filter(p => w.projects.includes(p.id)).map(p => <span key={p.id} className="workspace-member"><button type="button" className="project-drag-handle" disabled={disabled} aria-label={`Move ${p.name} from ${w.name}`} {...projectPointer(p.id, w.id)}><GripVertical size={14}/><span>{p.name}</span></button><Button variant="ghost" size="icon" aria-label={`Remove ${p.name} from ${w.name}`} disabled={disabled} onClick={() => void update({ ...w, projects: w.projects.filter(id => id !== p.id) })}><X size={12}/></Button></span>)}</div>
      {!projects.some(p => w.projects.includes(p.id)) && <p className="text-sm text-muted-foreground">No projects yet. Tap Add projects to choose some.</p>}
    </section>)}
    <Sheet open={!!pickerWorkspace} onOpenChange={open => { if (!open) setAdding(null); }}>
      <SheetContent side="bottom" className="workspace-project-sheet" showCloseButton={false}
        onOpenAutoFocus={e => { e.preventDefault(); pickerHeading.current?.focus(); }}
        onCloseAutoFocus={e => { e.preventDefault(); addTrigger.current?.focus(); }}>
        <SheetHeader><SheetTitle ref={pickerHeading} tabIndex={-1}>Add projects to {pickerWorkspace?.name}</SheetTitle><SheetDescription>Tap a project to add it. Changes save immediately.</SheetDescription></SheetHeader>
        <div className="workspace-project-search"><Input aria-label="Search projects" placeholder="Search projects…" value={query} onChange={e => setQuery(e.target.value)}/></div>
        <div className="workspace-project-options">
          {projects.filter(p => p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(p => {
            const added = !!pickerWorkspace?.projects.includes(p.id);
            return <button type="button" key={p.id} className="workspace-project-option" aria-label={`${p.name}${added ? ', added' : ''}`} disabled={disabled || added || !!savingProject}
              onClick={async () => {
                if (!pickerWorkspace || saving.current || disabled || added) return;
                saving.current = true; setSavingProject(p.id); setPickerError("");
                try {
                  const result = await update({ ...pickerWorkspace, projects: [...pickerWorkspace.projects, p.id] });
                  if (result === false) setPickerError(`Could not add ${p.name}. Try again.`);
                } catch (error) { setPickerError(error instanceof Error ? error.message : String(error)); }
                finally { saving.current = false; setSavingProject(null); }
              }}>
              <span className="workspace-project-dot" style={{ background: p.color }}/><span>{p.name}</span>
              <span className="workspace-project-status">{added ? <><Check size={18}/>Added</> : savingProject === p.id ? 'Adding…' : <Plus size={18}/>}</span>
            </button>;
          })}
          {!projects.length ? <p>Add a project folder first, then choose it here.</p> : !projects.some(p => p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) && <p>No projects match “{query}”.</p>}
        </div>
        <SheetFooter>{pickerError && <p role="alert">{pickerError}</p>}<p role="status">{pickerWorkspace?.projects.filter(id => projects.some(p => p.id === id)).length ?? 0} projects in this workspace</p><Button onClick={() => setAdding(null)}>Done</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  </div>;
}
