import type { Item, Project, ScoutState, Workspace } from "../api";

export const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;

export type ProjectView = { project: Project; workspace: Workspace | undefined; focus: Item[]; backlog: Item[] };

export type BoardModel = {
  pinned: ProjectView[];
  sections: { workspace: Workspace; projects: ProjectView[] }[];
  collapsed: { workspace: Workspace; count: number }[];
  hidden: Project[];
  counts: { needsYou: number; focus: number; backlog: number };
  total: number;
};

/** Pure grouping for the home board. Hidden projects never reach the grid; pinned projects
 *  appear in Pinned AND in their workspace. Search matches project names and item titles
 *  (an item-title-only match narrows the card to the matching items). */
export function buildBoard(state: ScoutState, workspaceFilter: string | null, search: string): BoardModel {
  const q = search.trim().toLowerCase();
  const workspaces = [...state.workspaces].sort(byOrder).filter(w => !workspaceFilter || w.id === workspaceFilter);
  const wsById = new Map(state.workspaces.map(w => [w.id, w]));
  const open = new Map<string, Item[]>();
  for (const item of [...state.items].sort(byOrder)) {
    if (item.lane === "done") continue;
    const list = open.get(item.project) ?? [];
    list.push(item);
    open.set(item.project, list);
  }
  const counts = { needsYou: 0, focus: 0, backlog: 0 };
  const view = (project: Project): ProjectView | null => {
    let items = open.get(project.id) ?? [];
    if (q && !project.name.toLowerCase().includes(q)) {
      items = items.filter(i => i.title.toLowerCase().includes(q));
      if (!items.length) return null;
    }
    return { project, workspace: wsById.get(project.workspace), focus: items.filter(i => i.lane === "focus"), backlog: items.filter(i => i.lane === "backlog") };
  };

  const sections: BoardModel["sections"] = [];
  const collapsed: BoardModel["collapsed"] = [];
  const pinned: ProjectView[] = [];
  let total = 0;
  for (const workspace of workspaces) {
    const visible = state.projects.filter(p => p.workspace === workspace.id && !p.hidden).sort(byOrder);
    for (const p of visible) for (const i of open.get(p.id) ?? []) {
      if (i.status === "needs_you") counts.needsYou++;
      if (i.lane === "focus") counts.focus++; else counts.backlog++;
    }
    const views = visible.map(view).filter((v): v is ProjectView => v !== null);
    total += views.length;
    pinned.push(...views.filter(v => v.project.pinned));
    if (workspace.collapsed) {
      if (!q || views.length) collapsed.push({ workspace, count: q ? views.length : visible.length });
    } else if (views.length || !q) sections.push({ workspace, projects: views });
  }
  const hidden = state.projects.filter(p => p.hidden && (!workspaceFilter || p.workspace === workspaceFilter)).sort(byOrder);
  return { pinned, sections, collapsed, hidden, counts, total };
}

/** "1 needs you · 5 in backlog", "2 in focus · 4 in backlog", "Nothing in focus · 3 in backlog". */
export function projectMeta(focus: Item[], backlog: Item[]): string {
  const needs = [...focus, ...backlog].filter(i => i.status === "needs_you").length;
  const lead = needs ? `${needs} needs you` : focus.length ? `${focus.length} in focus` : "Nothing in focus";
  return `${lead} · ${backlog.length} in backlog`;
}

/** Index for scout_project_move: position among the target workspace's projects (by order,
 *  hidden included, the moved project excluded). */
export function projectMoveIndex(state: ScoutState, movingId: string, workspaceId: string, beforeId: string | null, after: boolean): number {
  const list = state.projects.filter(p => p.workspace === workspaceId && p.id !== movingId).sort(byOrder);
  if (!beforeId) return list.length;
  const at = list.findIndex(p => p.id === beforeId);
  return at < 0 ? list.length : at + (after ? 1 : 0);
}

/** New workspace order after dropping `movingId` before/after `targetId`. */
export function reorderIds(ids: string[], movingId: string, targetId: string, after: boolean): string[] {
  if (movingId === targetId) return ids;
  const rest = ids.filter(id => id !== movingId);
  const at = rest.indexOf(targetId);
  if (at < 0) return ids;
  rest.splice(at + (after ? 1 : 0), 0, movingId);
  return rest;
}
