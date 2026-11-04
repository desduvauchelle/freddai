import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySnapshotDelta } from '../src/desktop/applySnapshotDelta.ts';
import { reconcileSnapshot } from '../src/desktop/reconcileSnapshot.ts';

const session = (id, text = 'hi') => ({ id, title: id, updated: 1, messages: [{ id: 'm', role: 'assistant', text }] });
const prev = () => ({
  accounts: [{ id: 'a1' }], projects: [{ id: 'p1' }], preferences: { use_worktree: false }, schedules: [], queues: [],
  host_update_pending: false,
  sessions: [session('s1'), session('s2'), session('s3')],
});
const meta = { revision: 7, hostId: 'h1' };

test('unchanged reply returns the previous snapshot by identity', () => {
  const p = prev();
  assert.equal(applySnapshotDelta(p, { ...meta, unchanged: true }), p);
});
test('partial reply replaces only changed sessions and keeps the rest by identity', () => {
  const p = prev();
  const next = applySnapshotDelta(p, { ...meta, full: false, sessionIds: ['s1', 's2', 's3'], sessions: [session('s2', 'hi there')],
    accounts: p.accounts, projects: p.projects, preferences: p.preferences, schedules: [], queues: [] });
  assert.equal(next.sessions[0], p.sessions[0]);
  assert.equal(next.sessions[2], p.sessions[2]);
  assert.equal(next.sessions[1].messages[0].text, 'hi there');
  assert.equal(next.host_update_pending, false);
  for (const k of ['revision', 'hostId', 'full', 'sessionIds', 'unchanged', 'build']) assert.equal(k in next, false);
});
test('sessionIds drive order and drop deleted sessions', () => {
  const p = prev();
  const next = applySnapshotDelta(p, { ...meta, full: false, sessionIds: ['s3', 's1'], sessions: [], accounts: p.accounts });
  assert.deepEqual(next.sessions.map(s => s.id), ['s3', 's1']);
  assert.equal(next.sessions[0], p.sessions[2]);
});
test('new session appears from the changed list in its position', () => {
  const p = prev();
  const next = applySnapshotDelta(p, { ...meta, full: false, sessionIds: ['s0', 's1', 's2', 's3'], sessions: [session('s0')] });
  assert.deepEqual(next.sessions.map(s => s.id), ['s0', 's1', 's2', 's3']);
});
test('other top-level fields come from the reply', () => {
  const p = prev();
  const next = applySnapshotDelta(p, { ...meta, full: false, sessionIds: ['s1', 's2', 's3'], sessions: [], preferences: { use_worktree: true }, host_update_pending: true });
  assert.deepEqual(next.preferences, { use_worktree: true });
  assert.equal(next.host_update_pending, true);
});
test('full reply replaces all sessions', () => {
  const p = prev();
  const next = applySnapshotDelta(p, { ...meta, full: true, sessionIds: ['x'], sessions: [session('x')] });
  assert.deepEqual(next.sessions.map(s => s.id), ['x']);
});
test('a session missing locally and not sent asks for a resync', () => {
  assert.equal(applySnapshotDelta(prev(), { ...meta, full: false, sessionIds: ['s1', 'ghost'], sessions: [] }), null);
});
test('merged partial reconciles to untouched identities for unchanged sessions', () => {
  const p = prev();
  const next = applySnapshotDelta(p, { ...meta, full: false, sessionIds: ['s1', 's2', 's3'], sessions: [session('s2', 'more')] });
  const merged = reconcileSnapshot(p, next);
  assert.equal(merged.sessions[0], p.sessions[0]);
  assert.notEqual(merged.sessions[1], p.sessions[1]);
});
