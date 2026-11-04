import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unconfirmedReplies, previewReplies } from '../src/desktop/outgoing.ts';
const message = { id: 'send-1', role: 'user', text: 'Same prompt', attachments: [{ id: 'file-1' }], delivery: 'Sending…' };
const outgoing = [{ thread: 'a', message, ordinal: 2 }];
const sessions = [{ id: 'a', messages: [{ id: 'old', role: 'user', text: 'Same prompt' }] }, { id: 'b', messages: [] }];
test('desktop send appears before acknowledgement, survives stale snapshots and preserves attachments', () => {
  const pending = unconfirmedReplies(outgoing, sessions);
  assert.equal(pending.length, 1);
  const preview = previewReplies(sessions, pending);
  assert.equal(preview[0].messages.at(-1), message);
  assert.equal(preview[1], sessions[1]);
  assert.equal(sessions[0].messages.length, 1, 'does not mutate authoritative history');
  assert.equal(unconfirmedReplies(outgoing, structuredClone(sessions)).length, 1);
});
test('host transcript replaces only the new repeated prompt and ignores other roles/threads', () => {
  const next = structuredClone(sessions);
  next[0].messages.push({ id: 'assistant', role: 'assistant', text: message.text });
  next[1].messages.push({ ...message });
  assert.equal(unconfirmedReplies(outgoing, next).length, 1);
  next[0].messages.push({ ...message, id: 'host-generated' });
  assert.equal(unconfirmedReplies(outgoing, next).length, 0);
});
test('host queue acceptance replaces preview using the exact idempotency key', () => {
  assert.equal(unconfirmedReplies(outgoing, sessions, [{ session: 'b', messages: [{id:message.id}] }]).length, 1);
  assert.equal(unconfirmedReplies(outgoing, sessions, [{ session: 'a', messages: [{id:'different'}] }]).length, 1);
  assert.equal(unconfirmedReplies(outgoing, sessions, [{ session: 'a', messages: [{id:message.id}] }]).length, 0);
});
