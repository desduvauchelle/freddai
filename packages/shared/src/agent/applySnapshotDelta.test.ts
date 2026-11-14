import { describe, expect, it } from 'vitest';
import { applySnapshotDelta, type SnapshotReply } from './applySnapshotDelta';
import type { Database, Session } from './types';

const large = { id: 'tool', role: 'tool', text: 'output'.repeat(200000) };
const answer = { id: 'answer', role: 'assistant', text: 'hello' };
const session = { id: 'thread', messages: [large, answer] } as Session;
const previous = { sessions: [session] } as Database;
const delta: SnapshotReply = { revision: 2, hostId: 'host', full: false,
  sessionIds: ['thread'], messageIds: { thread: ['tool', 'answer'] },
  sessions: [{ ...session, messages: [{ ...answer, text: 'hello world' }] }] };

describe('message-level snapshots', () => {
  it('retains unchanged large output by identity while updating streamed text', () => {
    const next = applySnapshotDelta(previous, delta)!;
    expect(next.sessions[0].messages[0]).toBe(large);
    expect(next.sessions[0].messages[1].text).toBe('hello world');
    expect(previous.sessions[0].messages[1].text).toBe('hello');
    expect(next).not.toHaveProperty('messageIds');
  });
  it('applies order and deletion, including an empty transcript', () => {
    const next = applySnapshotDelta(previous, { ...delta, messageIds: { thread: ['answer'] } })!;
    expect(next.sessions[0].messages.map(m => m.id)).toEqual(['answer']);
    expect(applySnapshotDelta(previous, { ...delta, messageIds: { thread: [] } })!.sessions[0].messages).toEqual([]);
  });
  it('requests full recovery when referenced history is missing', () => {
    expect(applySnapshotDelta({ sessions: [] } as unknown as Database, delta)).toBeNull();
    expect(applySnapshotDelta(previous, { ...delta, messageIds: { thread: ['missing'] } })).toBeNull();
  });
  it('still accepts complete replies from older hosts', () => {
    expect(applySnapshotDelta(previous, { ...delta, messageIds: undefined })!.sessions[0].messages).toHaveLength(1);
    expect(applySnapshotDelta(previous, { ...delta, full: true })!.sessions[0]).toBe(delta.sessions![0]);
  });
});
