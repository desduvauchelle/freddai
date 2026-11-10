import type { Workspace } from '../desktop/types';

/** Preserve workspace membership/order and keep unassigned shortcuts reachable. */
export function dashboardProjectGroups<P extends { id: string; kind?: string | null }>(snapshot: { projects: readonly P[]; workspaces?: readonly Workspace[] }) {
  const projects = snapshot.projects.filter(project => project.kind !== 'commander');
  if (!snapshot.workspaces?.length) return [{ id: '', name: null, projects }];
  const groups = snapshot.workspaces.map(workspace => ({
    id: workspace.id, name: workspace.name as string | null,
    projects: projects.filter(project => workspace.projects.includes(project.id)),
  })).filter(group => group.projects.length > 0);
  const assigned = new Set(groups.flatMap(group => group.projects.map(project => project.id)));
  const other = projects.filter(project => !assigned.has(project.id));
  if (other.length) groups.push({ id: '', name: 'Other projects', projects: other });
  return groups;
}
