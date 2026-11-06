import { expect, it } from 'vitest';
import { previewReplies, previewQueues, unconfirmedReplies, type OutgoingReply } from './outgoing';
import type { Session } from './types';

const thread = { id: 'thread', messages: [] } as unknown as Session;
const reply: OutgoingReply = { thread: thread.id, ordinal: 1, queued: true, message: { id: 'request', role: 'user', text: 'Follow up' }, options: { attachments: ['file'] } };
it('previews a queued submission directly in the queue until the host confirms it', () => {
  expect(previewReplies([thread], [reply])[0].messages).toEqual([]);
  const queues = previewQueues([], [reply]);
  expect(queues[0].messages).toEqual([{ id: 'request', prompt: 'Follow up', options: { attachments: ['file'] } }]);
  expect(unconfirmedReplies([reply], [thread], queues)).toEqual([]);
  expect(previewQueues(queues, unconfirmedReplies([reply], [thread], queues))).toEqual(queues);
});
it('keeps immediate sends and steering in the transcript', () => {
  const immediate = { ...reply, queued: false };
  expect(previewReplies([thread], [immediate])[0].messages).toEqual([reply.message]);
  expect(previewQueues([], [immediate])).toEqual([]);
});
it('preserves queue order, pause state and errors while adding a pending preview', () => {
  const queue = { session: thread.id, paused: true, error: 'Paused after failure', messages: [{ id: 'older', prompt: 'Earlier', options: {} }] };
  const result = previewQueues([queue], [reply]);
  expect(result[0]).toMatchObject({ paused: true, error: queue.error });
  expect(result[0].messages.map(message => message.id)).toEqual(['older', 'request']);
  expect(queue.messages).toHaveLength(1);
});
it('removes the queue preview when the host has already dispatched the message', () => {
  const dispatched = { ...thread, messages: [{ ...reply.message, id: 'host-generated' }] };
  expect(unconfirmedReplies([reply], [dispatched], [])).toEqual([]);
});
