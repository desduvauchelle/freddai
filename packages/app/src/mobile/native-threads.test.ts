import { expect, it, vi } from 'vitest';
import { buildThreadsModel, bumpOlderPage, createChangeSender, createThreadEventHandlers, createThreadActionHandler, nativeRunState } from './native-threads';
import type { CompanionSnapshot, CompanionThread } from './companion';

const thread = (id: string, project: string, status: string, updated: number, extra: Partial<CompanionThread> = {}): CompanionThread =>
  ({ id, project, title: `Thread ${id}`, status, updated, messages: [], canReply: true, queued: 0, error: null, ...extra });
const snapshot = (threads: CompanionThread[]): CompanionSnapshot => ({
  projects: [{ id: 'a', name: 'Alpha', color: '#fff', canStart: true }, { id: 'b', name: 'Beta', color: '#000', canStart: false }],
  threads,
});
const base = { read: {}, selected: '', project: '', query: '', filter: 'all' as const, olderPages: {} };

// The newest 5 finished threads stay visible after the live ones; these fill that quota so older paging is exercised.
const recent = (read: Record<string, number>) => ['r1', 'r2', 'r3', 'r4', 'r5'].map((id, i) => { read[id] = 30 - i; return thread(id, 'a', 'done', 30 - i); });
const recentIds = ['r1', 'r2', 'r3', 'r4', 'r5'];

it('builds groups with live threads, status flags and older paging counts', () => {
  const threads = [
    thread('run', 'a', 'running', 50),
    thread('unread', 'a', 'done', 40),
    thread('old1', 'a', 'done', 10),
    thread('old2', 'a', 'done', 9),
    thread('pend', 'b', 'running', 60, { pending: { id: 1 } as never }),
  ];
  const read: Record<string, number> = { old1: 10, old2: 9 };
  threads.push(...recent(read));
  const model = buildThreadsModel({ ...base, data: snapshot(threads), read });
  const alpha = model.groups.find(g => g.project === 'a')!;
  expect(alpha.label).toBe('Alpha');
  expect(alpha.canStart).toBe(true);
  expect(alpha.threads.map(t => t.id)).toEqual(['run', 'unread', ...recentIds]);
  expect(alpha.threads[1]).toMatchObject({ unread: true, status: 'done', updatedAt: 40 });
  expect(alpha.olderRemaining).toBe(2);
  expect(alpha.olderLabel).toBe('Show older threads (2)');
  expect(model.groups.find(g => g.project === 'b')!.threads[0].status).toBe('waiting');
  expect(model.projectOptions).toEqual([{ id: '', label: 'All projects' }, { id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }]);
  expect(model.statusOptions.map(o => o.id)).toEqual(['all', 'attention', 'running', 'done']);
});

it('expands older threads per project and keeps the selected thread live', () => {
  const read: Record<string, number> = { old1: 10, old2: 9 };
  const threads = [...recent(read), thread('old1', 'a', 'done', 10), thread('old2', 'a', 'done', 9)];
  const expanded = buildThreadsModel({ ...base, data: snapshot(threads), read, olderPages: bumpOlderPage({}, 'a') });
  expect(expanded.groups[0].threads.map(t => t.id)).toEqual([...recentIds, 'old1', 'old2']);
  expect(expanded.groups[0].olderRemaining).toBe(0);
  const selected = buildThreadsModel({ ...base, data: snapshot(threads), read, selected: 'old2' });
  expect(selected.selectedId).toBe('old2');
  expect(selected.groups[0].threads.map(t => t.id)).toEqual([...recentIds, 'old2']);
  expect(selected.groups[0].olderRemaining).toBe(1);
});

it('applies project, status and search filters and reports them back', () => {
  const threads = [thread('x', 'a', 'running', 3, { title: 'Fix login' }), thread('y', 'b', 'done', 2, { title: 'Docs' })];
  const model = buildThreadsModel({ ...base, data: snapshot(threads), query: 'login', filter: 'running', project: 'a' });
  expect(model.filters).toEqual({ project: 'a', status: 'running', query: 'login' });
  expect(model.groups.map(g => g.project)).toEqual(['a']);
  expect(model.groups[0].threads.map(t => t.id)).toEqual(['x']);
});

it('only sends when the serialized model changes, and retries after a failed send', async () => {
  const send = vi.fn().mockResolvedValue(undefined);
  const sender = createChangeSender<{ n: number }>(send);
  expect(await sender({ n: 1 })).toBe(true);
  expect(await sender({ n: 1 })).toBe(false);
  expect(await sender({ n: 2 })).toBe(true);
  expect(send).toHaveBeenCalledTimes(2);
  send.mockRejectedValueOnce(new Error('ipc down'));
  await expect(sender({ n: 3 })).rejects.toThrow('ipc down');
  expect(await sender({ n: 3 })).toBe(true);
  expect(send).toHaveBeenCalledTimes(4);
});

it('maps native events onto the right state changes', () => {
  const actions = { selectThread: vi.fn(), setQuery: vi.fn(), setFilters: vi.fn(), newThread: vi.fn(), showOlder: vi.fn() };
  const h = createThreadEventHandlers(actions);
  h.selectThread({ id: 't1' }); h.selectThread({}); h.selectThread({ id: '' });
  expect(actions.selectThread).toHaveBeenCalledTimes(1);
  expect(actions.selectThread).toHaveBeenCalledWith('t1');
  h.search({ query: 'abc' });
  expect(actions.setQuery).toHaveBeenCalledWith('abc');
  h.setFilter({ project: 'a', status: 'running' });
  expect(actions.setFilters).toHaveBeenCalledWith('a', 'running');
  h.setFilter({ project: 'a', status: 'bogus' });
  expect(actions.setFilters).toHaveBeenLastCalledWith('a', 'all');
  h.newThread({ project: 'a' }); h.newThread({});
  expect(actions.newThread.mock.calls).toEqual([['a'], ['']]);
  h.showOlder({ project: 'a' }); h.showOlder({});
  expect(actions.showOlder).toHaveBeenCalledTimes(1);
  expect(actions.showOlder).toHaveBeenCalledWith('a');
  expect(bumpOlderPage({ a: 1 }, 'a')).toEqual({ a: 2 });
});

it('routes native thread actions to the matching handlers and ignores unknown ones', () => {
  const handlers = { stop: vi.fn(), archive: vi.fn(), delete: vi.fn(), review: vi.fn() };
  const route = createThreadActionHandler(handlers);
  for (const action of ['stop', 'archive', 'delete', 'review']) route({ action });
  route({ action: 'nope' }); route({}); route(undefined as never);
  expect(handlers.stop).toHaveBeenCalledOnce();
  expect(handlers.archive).toHaveBeenCalledOnce();
  expect(handlers.delete).toHaveBeenCalledOnce();
  expect(handlers.review).toHaveBeenCalledOnce();
});

it('derives the run state word', () => {
  expect(nativeRunState(undefined)).toBe('');
  expect(nativeRunState({ status: 'running' })).toBe('running');
  expect(nativeRunState({ status: 'running', pending: {} })).toBe('waiting');
  expect(nativeRunState({ status: 'failed', pending: {} })).toBe('failed');
  expect(nativeRunState({ status: 'done' })).toBe('');
});

it('follows desktop project order and bucket settings in the native drawer', () => {
  const data = snapshot([thread('a1', 'a', 'done', 50), thread('b1', 'b', 'running', 10)]);
  data.threadList = { projectOrder: ['b', 'removed', 'a'], hideRead: false, recentFinished: 0 };
  expect(buildThreadsModel({ ...base, data }).groups.map(g => g.project)).toEqual(['b', 'a']);
  data.threadList.grouped = false;
  const model = buildThreadsModel({ ...base, data });
  expect(model.groups).toHaveLength(1);
  expect(model.groups[0].threads.map(t => t.id)).toEqual(['a1', 'b1']);
});
