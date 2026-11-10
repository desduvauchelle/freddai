import { expect, it } from 'vitest';
import { dashboardProjectGroups } from './dashboard-projects';
import { buildDashboardModel } from './native-dashboard';
import type { CompanionSnapshot } from './companion';

const snapshot: CompanionSnapshot = {
  projects: ['a', 'b', 'c'].map(id => ({ id, name: id, color: '#777', canStart: true })), threads: [],
  workspaces: [
    { id: 'work', name: 'Work', color: '#777', projects: ['b', 'a'] },
    { id: 'empty', name: 'Empty', color: '#777', projects: ['missing'] },
    { id: 'home', name: 'Home', color: '#777', projects: ['a'] },
  ],
};
it('groups memberships in workspace order, omits empty groups, and keeps unassigned projects', () => {
  const groups = dashboardProjectGroups(snapshot).map(group => ({ ...group, projects: group.projects.map(p => p.id) }));
  expect(groups).toEqual([
    { id: 'work', name: 'Work', projects: ['a', 'b'] },
    { id: 'home', name: 'Home', projects: ['a'] },
    { id: '', name: 'Other projects', projects: ['c'] },
  ]);
  expect(buildDashboardModel(snapshot, true, '', {}, false).projectGroups).toEqual(groups);
});
it('retains ungrouped shortcuts for older hosts and excludes Commander', () => {
  const data = { ...snapshot, workspaces: undefined, projects: [...snapshot.projects, { id: 'chief', name: 'Chief', kind: 'commander' as const, color: '#777', canStart: true }] };
  expect(dashboardProjectGroups(data)).toEqual([{ id: '', name: null, projects: snapshot.projects }]);
});
it('omits other workspace groups when the snapshot is filtered', () => {
  expect(dashboardProjectGroups({ ...snapshot, projects: [snapshot.projects[1]!] }).map(g => g.name)).toEqual(['Work']);
});

it('links only the three most recent live threads using desktop user-message recency', () => {
  const threads = ['old', 'first', 'second', 'third', 'archived', 'other'].map((id, i) => ({
    id, title: id, project: id === 'other' ? 'b' : 'a', status: id === 'archived' ? 'archived' : 'done',
    updated: 100 + i, last_user_message_at: id === 'first' ? 500 : 100 + i,
    messages: [], canReply: false, queued: 0, error: null,
  }));
  const model = buildDashboardModel({ ...snapshot, threads }, false, '', {}, false);
  expect(model.projects[0]!.recent.map(t => t.id)).toEqual(['first', 'third', 'second']);
});
