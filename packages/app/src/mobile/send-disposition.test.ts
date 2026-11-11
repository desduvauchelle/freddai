import { describe, expect, it } from 'vitest';
import { countUnreflected, sendDisposition } from './send-disposition';

describe('sendDisposition', () => {
  it('idle with nothing queued is a bubble', () => expect(sendDisposition({ status: 'completed', queued: 0, unreflectedLocal: 0 })).toBe('bubble'));
  it.each(['starting', 'running', 'waiting'])('%s goes to the queue', status => expect(sendDisposition({ status })).toBe('queue'));
  it('queue content goes to the queue', () => expect(sendDisposition({ status: 'completed', queued: 1 })).toBe('queue'));
  it('paused queue goes to the queue', () => expect(sendDisposition({ status: 'completed', queuePaused: true })).toBe('queue'));
  it('queue error goes to the queue', () => expect(sendDisposition({ status: 'completed', queueError: 'x' })).toBe('queue'));
  it('an unacknowledged local message counts as in flight', () => {
    const local = [{ thread: 't', prompt: 'a', ordinal: 1 }];
    expect(sendDisposition({ status: 'completed', unreflectedLocal: countUnreflected(local, 't', []) })).toBe('queue');
  });
  it('an acknowledged but unreflected local message still counts as in flight', () => {
    const local = [{ thread: 't', prompt: 'a', ordinal: 1, acknowledged: true }];
    expect(sendDisposition({ status: 'completed', queued: 0, unreflectedLocal: countUnreflected(local, 't', [{ role: 'assistant', text: 'a' }]) })).toBe('queue');
  });
  it('a local message the transcript reflects no longer counts', () => {
    const local = [{ thread: 't', prompt: 'a', ordinal: 1 }];
    expect(countUnreflected(local, 't', [{ role: 'user', text: 'a' }])).toBe(0);
    expect(countUnreflected(local, 'other', [])).toBe(0);
  });
  it('repeated identical prompts need one transcript echo per ordinal', () => {
    expect(countUnreflected([{ thread: 't', prompt: 'a', ordinal: 2 }], 't', [{ role: 'user', text: 'a' }])).toBe(1);
  });
  it('a new thread is always a bubble', () => expect(sendDisposition({ isNewThread: true, status: 'running', queued: 3 })).toBe('bubble'));
});
