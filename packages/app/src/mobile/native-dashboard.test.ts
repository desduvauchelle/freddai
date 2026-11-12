import { beforeEach, expect, it } from 'vitest';
import { buildDashboardModel, dashboardAssistantFor } from './native-dashboard';
import { saveLastAssistant, saveControls, savedControls } from './native-home';
import type { Outgoing } from './outbox';
import type { CompanionSnapshot } from './companion';

it('native iOS and Android display and launch the resolved saved integration', () => {
  const snapshot: CompanionSnapshot = { projects: [{ id: 'p', name: 'Project', color: '#777', canStart: true, defaultAssistant: 'rs', assistants: [{ id: 'rs', name: 'RS', provider: 'codex' }, { id: 'other', name: 'Other', provider: 'claude' }] }], threads: [] };
  const controls = { 'new:p:rs:codex': { selection: { model: 'custom-model', effort: 'high' } } };
  const model = buildDashboardModel(snapshot, true, '', controls, false);
  expect(model.agent).toBe('Codex · RS');
  expect(model.projects[0].assistant).toBe('rs');
  expect(model.model).toBe('custom-model · Default');
  expect(model.difficulty).toBe('custom-model · High');
  snapshot.projects[0].defaultAssistant = 'other';
  expect(buildDashboardModel(snapshot, true, '', controls, false).agent).toBe('Claude · Other');
  expect(buildDashboardModel(snapshot, true, 'rs', controls, false).agent).toBe('Codex · RS');
});

it('keeps recent-card statuses identical to drawer rows through running, approval and read changes', () => {
  const thread = { id: 't', title: 'A long unmodified thread title', project: 'p', status: 'running', updated: 123, messages: [], canReply: false, queued: 0, error: null };
  const snapshot: CompanionSnapshot = { projects: [{ id: 'p', name: 'Project', color: '#777', canStart: true }], threads: [thread] };
  const recent = (read = {}) => buildDashboardModel(snapshot, true, '', {}, false, 1000, false, read).projects[0].recent[0];
  expect(recent()).toMatchObject({ title: thread.title, status: 'running', unread: false });
  thread.status = 'done';
  expect(recent()).toMatchObject({ status: 'done', unread: true });
  expect(recent({ t: 123 })).toMatchObject({ status: 'done', unread: false });
  snapshot.threadList = { ignoreUnread: true };
  expect(recent().unread).toBe(false);
});

beforeEach(() => localStorage.clear());
const outgoing = (over: Partial<Outgoing>): Outgoing => ({ id: 'o1', thread: '', project: 'p', prompt: 'Fix the login bug', ordinal: 1, startsTurn: true, acknowledged: false, attachments: [], ...over });
const base = { id: 't', title: 'Existing', project: 'p', status: 'done', updated: 5, messages: [], canReply: false, queued: 0, error: null };
const snap = (threads: CompanionSnapshot['threads'] = [base]): CompanionSnapshot => ({ projects: [{ id: 'p', name: 'Project', color: '#777', canStart: true }, { id: 'q', name: 'Other', color: '#777', canStart: true }], threads });

it('merges pending outbox items into the project recent list as sending or queued rows and drops project.sending', () => {
  const long = 'x'.repeat(100);
  const model = buildDashboardModel(snap(), true, '', {}, false, 1000, false, {}, [outgoing({}), outgoing({ id: 'o2', prompt: long, blocked: true }), outgoing({ id: 'o3', project: 'q' })]);
  const recent = model.projects[0].recent;
  expect(model.projects[0]).not.toHaveProperty('sending');
  expect(recent.map(r => r.id)).toEqual(['outbox:o2', 'outbox:o1', 't']);
  expect(recent[0]).toMatchObject({ status: 'queued', unread: false, updatedAt: 1000 });
  expect(recent[0].title).toHaveLength(60);
  expect(recent[1]).toMatchObject({ title: 'Fix the login bug', status: 'sending' });
  expect(model.projects[1].recent.map(r => r.id)).toEqual(['outbox:o3']);
  expect(buildDashboardModel(snap(), false, '', {}, false, 1000, false, {}, [outgoing({})]).projects[0].recent[0].status).toBe('queued');
});

it('caps recent at three with pending rows first and hides items that became real threads', () => {
  const threads = [1, 2, 3].map(n => ({ ...base, id: `t${n}`, updated: n }));
  const ids = (outbox: Outgoing[]) => buildDashboardModel(snap(threads), true, '', {}, false, 1000, false, {}, outbox).projects[0].recent.map(r => r.id);
  expect(ids([outgoing({})])).toEqual(['outbox:o1', 't3', 't2']);
  expect(ids([outgoing({ thread: 't3', acknowledged: true })])).toEqual(['t3', 't2', 't1']);
  expect(ids([outgoing({ thread: 'new', acknowledged: true })])).toEqual(['new', 't3', 't2']);
});

it('resolves the agent as explicit, then persisted last-used, then default, ignoring a stale persisted id', () => {
  const project = { id: 'p', name: 'P', color: '#777', canStart: true, defaultAssistant: 'a', assistants: [{ id: 'a', name: 'A', provider: 'claude' }, { id: 'b', name: 'B', provider: 'codex' }, { id: 'c', name: 'C', provider: 'codex' }] };
  expect(dashboardAssistantFor(project, '')?.id).toBe('a');
  saveLastAssistant('p', 'b');
  expect(localStorage.getItem('freddai.companion.lastAssistant.p')).toBe('b');
  expect(dashboardAssistantFor(project, '')?.id).toBe('b');
  expect(dashboardAssistantFor(project, 'c')?.id).toBe('c');
  saveLastAssistant('p', 'gone');
  expect(dashboardAssistantFor(project, '')?.id).toBe('a');
});

it('persists last-used model and effort under new: keys only', () => {
  saveControls({ 'new:p:a:claude': { selection: { model: 'opus', effort: 'high' } }, 'thread-1': { selection: { model: 'x', effort: 'low' } } });
  expect(savedControls()).toEqual({ 'new:p:a:claude': { model: 'opus', effort: 'high' } });
  expect(localStorage.getItem('freddai.companion.controls')).toContain('new:p:a:claude');
});

it('uppercases dashboard project names only when the Mac setting is on', () => {
  const data = snap();
  expect(buildDashboardModel(data, true, '', {}, false).projects.map(p => p.name)).toEqual(['Project', 'Other']);
  data.threadList = { projectNameUppercase: true };
  expect(buildDashboardModel(data, true, '', {}, false).projects.map(p => p.name)).toEqual(['PROJECT', 'OTHER']);
});

it('lists waiting threads across non-commander projects in needsYou, empty when none', () => {
  const t = (id: string, project: string, status: string, updated: number) => ({ id, title: id, project, status, updated, messages: [], canReply: false, queued: 0, error: null });
  const snapshot: CompanionSnapshot = {
    projects: [{ id: 'p', name: 'Project', color: '#777', canStart: true }, { id: 'c', name: 'Cmd', color: '#777', canStart: true, kind: 'commander' }],
    threads: [t('a', 'p', 'waiting', 1), t('b', 'p', 'done', 5), t('c1', 'c', 'waiting', 9), t('d', 'p', 'waiting', 3)],
  };
  const model = buildDashboardModel(snapshot, true, '', {}, false);
  expect(model.needsYou.map(n => n.id)).toEqual(['d', 'a']);
  expect(model.needsYou[0]).toMatchObject({ status: 'waiting', project: 'p', projectName: 'Project' });
  expect(buildDashboardModel({ ...snapshot, threads: [t('b', 'p', 'done', 5)] }, true, '', {}, false).needsYou).toEqual([]);
});
