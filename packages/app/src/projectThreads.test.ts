import { expect, it } from 'vitest';
import { orderProjectThreads } from './projectThreads';

it('uses navigation priority once per thread, with send recency within each tier', () => {
  const threads = [
    { id: 'recent', status: 'done', updated: 100, last_user_message_at: 90 },
    { id: 'pin', status: 'running', updated: 1, pinned: true },
    { id: 'running', status: 'running', updated: 10 },
    { id: 'queued', status: 'done', updated: 9 },
    { id: 'waiting', status: 'waiting', updated: 8 },
    { id: 'unread', status: 'done', updated: 7 },
    { id: 'older', status: 'done', updated: 200, last_user_message_at: 2 },
  ];
  const read = { recent: 100, queued: 9, older: 200 };
  expect(orderProjectThreads([...threads, threads[1]], read, t => t.id === 'queued' ? 1 : 0).map(t => t.id))
    .toEqual(['pin', 'running', 'queued', 'waiting', 'unread', 'recent', 'older']);
  expect(threads[0].id).toBe('recent');
});
