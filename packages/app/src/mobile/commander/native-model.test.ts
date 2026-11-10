import { beforeEach, expect, it, vi } from 'vitest';
import type { CompanionSnapshot } from '../companion';
import { buildDashboardModel } from '../native-dashboard';
import { buildThreadsModel } from '../native-threads';

const invoke = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('@tauri-apps/api/core', () => ({ invoke, addPluginListener: vi.fn() }));
import { nativeCommanderClient } from '../native-client';

const snapshot: CompanionSnapshot = {
  projects: [
    { id: 'a', name: 'Alpha', color: '#fff', canStart: true },
    { id: 'c', name: 'Commander-in-Chief', color: '#d98a3d', canStart: true, kind: 'commander', objective: 'Chief of staff' },
  ],
  threads: [
    { id: 'ct', project: 'c', title: 'Chat', status: 'waiting', updated: 5, messages: [], canReply: true, queued: 0, error: null, pending: { id: 1 } as never },
    { id: 'at', project: 'a', title: 'Work', status: 'running', updated: 9, messages: [], canReply: true, queued: 0, error: null },
  ],
};
const base = { read: {}, selected: '', project: '', query: '', filter: 'all' as const, olderPages: {} };
beforeEach(() => invoke.mockClear());

it('lists the commander project first in the native drawer and marks its kind', () => {
  const model = buildThreadsModel({ ...base, data: snapshot });
  expect(model.groups.map(g => g.project)).toEqual(['c', 'a']);
  expect(model.groups[0].kind).toBe('commander');
  expect(model.groups[1].kind).toBeUndefined();
});

it('keeps the commander out of the native project cards and exposes its cluster model', () => {
  const model = buildDashboardModel(snapshot, true, '', {}, false);
  expect(model.projects.map(p => p.id)).toEqual(['a']);
  expect(model.commander).toEqual({ sending: false, id: 'c', name: 'Commander-in-Chief', needsYou: 1, running: 0, doneToday: 0 });
  expect(buildDashboardModel({ ...snapshot, projects: [snapshot.projects[0]] }, true, '', {}, false).commander).toBeNull();
});

it('proxies commander operations through the companion composer with the contract names', async () => {
  const c = nativeCommanderClient;
  await c.state(); await c.proposals(); await c.todos(); await c.notes();
  await c.respond({ id: 'p', approve: true, prompt: 'edited' }); await c.respond({ id: 'p', approve: false });
  await c.saveTodo({ id: 't', status: 'done' }); await c.readNote('n'); await c.writeNote('n', 'body');
  expect(invoke.mock.calls.map(call => call as unknown as [string, { operation: string; input: unknown }]).map(([cmd, a]) => [cmd, a.operation, a.input])).toEqual([
    ['companion_composer', 'commander_state', {}], ['companion_composer', 'commander_proposals', {}], ['companion_composer', 'commander_todos', {}], ['companion_composer', 'commander_notes', {}],
    ['companion_composer', 'commander_proposal_respond', { id: 'p', approve: true, prompt: 'edited' }],
    ['companion_composer', 'commander_proposal_respond', { id: 'p', approve: false }],
    ['companion_composer', 'commander_todo_save', { todo: { id: 't', status: 'done' } }],
    ['companion_composer', 'commander_note_read', { name: 'n' }], ['companion_composer', 'commander_note_write', { name: 'n', body: 'body' }],
  ]);
});
