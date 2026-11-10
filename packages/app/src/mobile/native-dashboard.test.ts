import { expect, it } from 'vitest';
import { buildDashboardModel } from './native-dashboard';
import type { CompanionSnapshot } from './companion';

it('native iOS and Android display and launch the resolved saved integration', () => {
  const snapshot: CompanionSnapshot = { projects: [{ id: 'p', name: 'Project', color: '#777', canStart: true, defaultAssistant: 'rs', assistants: [{ id: 'rs', name: 'RS', provider: 'codex' }, { id: 'other', name: 'Other', provider: 'claude' }] }], threads: [] };
  const controls = { 'new:p:rs:codex': { selection: { model: 'custom-model', effort: 'high' } } };
  const model = buildDashboardModel(snapshot, true, '', controls, false);
  expect(model.agent).toBe('Codex · RS');
  expect(model.projects[0].assistant).toBe('rs');
  expect(model.model).toContain('custom-model');
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
