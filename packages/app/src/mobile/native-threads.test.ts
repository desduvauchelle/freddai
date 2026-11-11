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

it('labels expanded older rows "Show more (remaining)" and flags olderExpanded so Show less stays reachable when nothing remains', () => {
  const read: Record<string, number> = {};
  const old = Array.from({ length: 12 }, (_, i) => { read[`o${i}`] = i + 1; return thread(`o${i}`, 'a', 'done', i + 1); });
  const threads = [...recent(read), ...old];
  const at = (olderPages: Record<string, number>) => buildThreadsModel({ ...base, data: snapshot(threads), read, olderPages }).groups.find(g => g.project === 'a')!;
  expect(at({})).toMatchObject({ olderExpanded: false, olderLabel: 'Show older threads (12)' });
  expect(at({ a: 1 })).toMatchObject({ olderExpanded: true, olderRemaining: 2, olderLabel: 'Show more (2)' });
  expect(at({ a: 2 })).toMatchObject({ olderExpanded: true, olderRemaining: 0 });
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
  const showLess = vi.fn();
  const less = createThreadEventHandlers({ ...actions, showLess });
  less.showLess({ project: 'a' }); less.showLess({});
  expect(showLess.mock.calls).toEqual([['a']]);
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

it('fades only completed read threads without pending or queued work', () => {
  const threads = [
    thread('read', 'a', 'done', 10),
    thread('unread', 'a', 'done', 11),
    thread('pending', 'a', 'done', 10, { pending: { id: 1 } as never }),
    thread('queued', 'a', 'done', 10, { queued: 1 }),
    ...['running', 'starting', 'waiting', 'failed', 'interrupted'].map(status => thread(status, 'a', status, 10)),
  ];
  const read = Object.fromEntries(threads.map(t => [t.id, 10]));
  const model = buildThreadsModel({ ...base, data: snapshot(threads), read });
  const rows = model.groups.flatMap(g => g.threads);
  expect(rows.find(t => t.id === 'read')?.faded).toBe(true);
  expect(rows.filter(t => t.id !== 'read').every(t => t.faded === false)).toBe(true);
});

it('follows the Mac unread experiment in filters, grouping and native unread flags, and restores it when disabled', () => {
  const data = snapshot([
    thread('done', 'a', 'done', 40),
    thread('run', 'a', 'running', 50),
    thread('approval', 'a', 'waiting', 60),
    thread('failed', 'a', 'failed', 30),
  ]);
  data.threadList = { ignoreUnread: true, recentFinished: 0 };
  const read = { failed: 30 };
  let model = buildThreadsModel({ ...base, data, read });
  expect(model.groups[0].threads.map(t => t.id)).toEqual(['approval', 'run', 'failed']);
  expect(model.groups[0].olderRemaining).toBe(1);
  model = buildThreadsModel({ ...base, data, read, filter: 'done' });
  expect(model.groups[0].threads).toEqual([expect.objectContaining({ id: 'done', unread: false, faded: true })]);
  expect(model.statusOptions.map(o => o.label)).toEqual(['All threads', 'Needs you', 'Working', 'Done']);
  model = buildThreadsModel({ ...base, data, read, filter: 'attention' });
  expect(model.groups[0].threads.map(t => t.id)).toEqual(['approval', 'failed']);
  data.threadList.ignoreUnread = false;
  model = buildThreadsModel({ ...base, data, read });
  expect(model.groups[0].threads.find(t => t.id === 'done')?.unread).toBe(true);
  expect(read).toEqual({ failed: 30 });
});

it('scopes native navigation to workspace membership and retains projects without visible history', () => {
  const data = { ...snapshot([thread('a1', 'a', 'running', 3), thread('b1', 'b', 'done', 2)]),
    projects: [...snapshot([]).projects, { id: 'empty', name: 'Empty', color: '#fff', canStart: false }],
    workspaces: [{ id: 'w', name: 'Work', color: '#112233', projects: ['a', 'empty'] }] };
  const scoped = buildThreadsModel({ ...base, data, workspace: 'w', canManageWorkspaces: true });
  expect(scoped.groups.map(g => g.project)).toEqual(['a', 'empty']);
  expect(scoped.projectOptions.map(p => p.id)).toEqual(['', 'a', 'empty']);
  expect(scoped.workspaceOptions?.map(w => w.id)).toEqual(['', 'w', '__manage_workspaces']);
  expect(buildThreadsModel({ ...base, data, workspace: '' }).groups.map(g => g.project)).toContain('b');
  expect(buildThreadsModel({ ...base, data, workspace: 'deleted' }).groups.map(g => g.project)).toContain('b');
  expect(buildThreadsModel({ ...base, data: { ...data, threads: [] }, workspace: 'w' }).groups.map(g => g.project)).toEqual(['a', 'empty']);
});

it('keeps old pinned threads above live and recent threads without older expansion', () => {
  const read: Record<string, number> = { pinned: 1 };
  const data = snapshot([thread('run', 'a', 'running', 60), thread('pinned', 'a', 'done', 1, { pinned: true }), ...recent(read)]);
  const model = buildThreadsModel({ ...base, data, read });
  expect(model.groups[0].threads[0]).toMatchObject({ id: 'pinned', pinned: true });
  expect(model.groups[0].threads[1].id).toBe('run');
  const filtered = buildThreadsModel({ ...base, data, read, filter: 'running' });
  expect(filtered.groups[0].threads.map(t => t.id)).toEqual(['run']);
});

it('routes workspace changes separately so stale native project/status values cannot narrow the workspace', () => {
  const actions = { selectThread: vi.fn(), setQuery: vi.fn(), setFilters: vi.fn(), setWorkspace: vi.fn(), workspace: 'w', newThread: vi.fn(), showOlder: vi.fn() };
  const events = createThreadEventHandlers(actions);
  events.setFilter({ workspace: '', project: 'stale', status: 'running' });
  expect(actions.setWorkspace).toHaveBeenCalledWith('');
  expect(actions.setFilters).not.toHaveBeenCalled();
  events.setFilter({ project: 'a', status: 'done' });
  expect(actions.setFilters).toHaveBeenCalledWith('a', 'done');
  events.setFilter({ workspace: '__manage_workspaces' });
  expect(actions.setWorkspace).toHaveBeenCalledWith('__manage_workspaces');
});

it('sends the Recent view payload: mode, 25/+25 cross-project rows with project tag; section pages 5/+10 separately', () => {
  const many = Array.from({ length: 70 }, (_, i) => thread(`t${i}`, i % 2 ? 'a' : 'b', i === 3 ? 'archived' : 'done', 100 + i));
  const read = Object.fromEntries(many.map(t => [t.id, t.updated]));
  const first = buildThreadsModel({ ...base, data: snapshot(many), read, view: 'recent' });
  expect(first.view).toBe('recent');
  expect(first.recent.threads).toHaveLength(25);
  expect(first.recent.threads.slice(0, 3).map(t => t.id)).toEqual(['t69', 't68', 't67']);
  expect(first.recent.threads[0]).toMatchObject({ projectLabel: 'Alpha', projectColor: '#fff', status: 'done', updatedAt: 169 });
  expect(first.recent).toMatchObject({ remaining: 44, expanded: false });
  const more = buildThreadsModel({ ...base, data: snapshot(many), read, view: 'recent', recentPages: 1 });
  expect(more.recent.threads).toHaveLength(50);
  expect(more.recent.threads.map(t => t.id)).not.toContain('t3');
  expect(more.recent.expanded).toBe(true);
  // Bottom section of the Projects view: 5 first, +10, independent of the Recent view paging.
  expect(first.recentSection.threads.map(t => t.id)).toEqual(['t69', 't68', 't67', 't66', 't65']);
  expect(first.recentSection.threads[0].projectLabel).toBe('Alpha');
  expect(first.recentSection).toMatchObject({ remaining: 64, expanded: false });
  expect(more.recentSection.threads).toHaveLength(5);
  const sectionMore = buildThreadsModel({ ...base, data: snapshot(many), read, sectionPages: 1 });
  expect(sectionMore.recentSection.threads).toHaveLength(15);
  expect(sectionMore.recentSection.expanded).toBe(true);
  expect(sectionMore.recent.threads).toHaveLength(25);
  expect(buildThreadsModel({ ...base, data: snapshot([]), read: {} }).recentSection.threads).toEqual([]);
  expect(buildThreadsModel({ ...base, data: snapshot(many), read }).view).toBe('projects');
});

it('maps native setView / recentPage events (view or bottom section) and ignores malformed payloads', () => {
  const actions = { selectThread: vi.fn(), setQuery: vi.fn(), setFilters: vi.fn(), newThread: vi.fn(), showOlder: vi.fn(), setView: vi.fn(), recentPage: vi.fn() };
  const h = createThreadEventHandlers(actions);
  h.setView({ view: 'recent' }); h.setView({ view: 'nope' }); h.setView({});
  expect(actions.setView.mock.calls).toEqual([['recent'], ['projects'], ['projects']]);
  h.recentPage({ action: 'more' }); h.recentPage({ action: 'less', section: 'bottom' }); h.recentPage({ action: 'x' }); h.recentPage({});
  expect(actions.recentPage.mock.calls).toEqual([['more', false], ['less', true]]);
});

it('keeps Commander and its delegated work out of grouped, recent and flat navigation even when selected', () => {
  const data = snapshot([thread('ordinary', 'a', 'running', 1), thread('main', 'cmd', 'done', 2), thread('internal', 'cmd', 'running', 3), thread('delegated', 'a', 'running', 4, { origin: { kind: 'commander' } })]);
  data.projects.unshift({ id: 'cmd', name: 'Commander', color: '#fff', canStart: true, kind: 'commander' });
  for (const grouped of [true, false]) {
    data.threadList = { grouped };
    const model = buildThreadsModel({ ...base, data, selected: 'delegated' });
    expect(model.groups.flatMap(g => g.threads.map(t => t.id))).toEqual(['ordinary']);
    expect(model.recent.threads.map(t => t.id)).toEqual(['ordinary']);
    expect(model.recentSection.threads.map(t => t.id)).toEqual(['ordinary']);
    if (grouped) expect(model.groups.find(g => g.kind === 'commander')?.threads).toEqual([]);
  }
});

it('preserves scheduled markers in project and recent navigation without marking ordinary threads', () => {
  const model = buildThreadsModel({ ...base, data: snapshot([
    thread('scheduled', 'a', 'done', 20, { scheduled: true }),
    thread('ordinary', 'a', 'done', 19),
  ]) });
  for (const rows of [model.groups[0].threads, model.recent.threads, model.recentSection.threads]) {
    expect(rows.find(row => row.id === 'scheduled')?.scheduled).toBe(true);
    expect(rows.find(row => row.id === 'ordinary')?.scheduled).toBe(false);
  }
});
