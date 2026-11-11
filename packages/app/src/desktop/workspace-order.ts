import type { Workspace } from "./types";

export type DropPosition = { targetProjectId: string; after: boolean };

/** Remove `id` from every workspace, then insert it into `target` (null = no workspace) next to `position.targetProjectId`, else at the end. */
export function moveProjectToWorkspace(workspaces: readonly Workspace[], id: string, target: string | null, position?: DropPosition): Workspace[] {
  return workspaces.map(w => {
    const projects = w.projects.filter(p => p !== id);
    if (w.id !== target) return { ...w, projects };
    const at = position ? projects.indexOf(position.targetProjectId) : -1;
    if (at < 0) projects.push(id); else projects.splice(at + (position!.after ? 1 : 0), 0, id);
    return { ...w, projects };
  });
}

export type DashboardDrop = { id: string; from: string; to: string; list: readonly string[] };

/** Where a dropped card landed: its container and the neighbour it sits next to (previous card preferred). */
export function dropOutcome({ id, from, to, list }: DashboardDrop) {
  const index = list.indexOf(id);
  const position: DropPosition | undefined = index > 0 ? { targetProjectId: list[index - 1], after: true }
    : index === 0 && list.length > 1 ? { targetProjectId: list[1], after: false } : undefined;
  return { crossed: from !== to, position };
}

/** Ensure every workspace key (and "other" when workspaces exist) has a list so empty groups are valid drop targets. */
export function withEmptyGroups(layout: Record<string, string[]>, workspaceKeys: readonly string[], hasWorkspaces: boolean): Record<string, string[]> {
  const out = { ...layout };
  for (const key of workspaceKeys) if (!(key in out)) out[key] = [];
  if (hasWorkspaces && !("other" in out)) out.other = [];
  return out;
}
